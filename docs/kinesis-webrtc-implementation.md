# Kinesis WebRTC Implementation for SimpliSafe Outdoor Cameras

This document captures all learnings from implementing native WebRTC streaming for SimpliSafe outdoor cameras using AWS Kinesis Video Streams.

## Overview

SimpliSafe uses two different streaming technologies:
- **Indoor cameras**: LiveKit WebRTC (`wss://livestream.services.simplisafe.com`)
- **Outdoor cameras**: AWS Kinesis Video Streams WebRTC

This implementation focuses on outdoor cameras using Kinesis.

## API Endpoints

### Live View Credentials

```
GET https://app-hub.prd.aser.simplisafe.com/v2/cameras/{cameraUuid}/{locationId}/live-view
Authorization: Bearer {accessToken}
```

**Response:**
```json
{
  "signedChannelEndpoint": "wss://...",
  "clientId": "viewer-xxx",
  "iceServers": [
    {
      "urls": ["turn:..."],
      "username": "...",
      "credential": "..."
    }
  ]
}
```

**Critical**: Use the full camera UUID (32 hex characters), not the short serial (8 hex characters).

## Kinesis WebRTC Signaling Protocol

### Message Format

All signaling messages use this structure:
```json
{
  "action": "SDP_OFFER" | "ICE_CANDIDATE",
  "messagePayload": "<base64-encoded-json>"
}
```

**Critical**: The `messagePayload` MUST be Base64-encoded JSON, not raw JSON strings.

### Sending Messages (Viewer Role)

```javascript
// SDP Offer
const offerPayload = JSON.stringify({ type: 'offer', sdp: offer.sdp });
ws.send(JSON.stringify({
    action: 'SDP_OFFER',
    messagePayload: Buffer.from(offerPayload).toString('base64')
}));

// ICE Candidate
const candidatePayload = JSON.stringify(candidate.toJSON());
ws.send(JSON.stringify({
    action: 'ICE_CANDIDATE',
    messagePayload: Buffer.from(candidatePayload).toString('base64')
}));
```

**Critical**: As a VIEWER, do NOT include `recipientClientId` in messages. The master (camera) receives messages automatically.

### Receiving Messages

```javascript
if (message.messageType === 'SDP_ANSWER') {
    const answerJson = Buffer.from(message.messagePayload, 'base64').toString('utf8');
    const answer = JSON.parse(answerJson);
    await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
}

if (message.messageType === 'ICE_CANDIDATE') {
    const candidateJson = Buffer.from(message.messagePayload, 'base64').toString('utf8');
    const candidate = JSON.parse(candidateJson);
    if (candidate.candidate) {
        await pc.addIceCandidate(candidate);
    }
}
```

### Empty WebSocket Frames

Kinesis sends empty acknowledgment frames. Handle them gracefully:
```javascript
const dataStr = data.toString();
if (!dataStr || dataStr.length === 0) {
    return; // Skip empty frames
}
```

## Codec Configuration

### The Problem

SimpliSafe outdoor cameras only support **H264** video codec. The werift library defaults to **VP8**.

When the camera receives an SDP offer without H264:
- Video direction: `a=inactive` (camera won't send video)
- Video track: `fakeStream`/`fakeTrack` placeholders
- Result: Audio works, video doesn't

### The Solution

Configure H264 explicitly in the RTCPeerConnection:

```javascript
import { RTCPeerConnection, RTCRtpCodecParameters, useNACK, usePLI, useREMB } from 'werift';

const pc = new RTCPeerConnection({
    iceServers: iceServers,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    codecs: {
        audio: [
            new RTCRtpCodecParameters({
                mimeType: 'audio/opus',
                clockRate: 48000,
                channels: 2,
            }),
        ],
        video: [
            new RTCRtpCodecParameters({
                mimeType: 'video/H264',
                clockRate: 90000,
                rtcpFeedback: [useNACK(), usePLI(), useREMB()],
                parameters: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
            }),
        ],
    },
});
```

### H264 Profile Details

- **Profile**: `42e01f` = Constrained Baseline Profile, Level 3.1
- **Packetization Mode**: 1 (non-interleaved, single NAL unit per packet)
- **Level Asymmetry**: Allowed

## Data Channel Requirement

### The Problem

Even with correct H264 codec, the camera responds with `a=inactive` if the SDP offer doesn't include a data channel.

### The Solution

Create a data channel before generating the SDP offer:

```javascript
pc.addTransceiver('video', { direction: 'recvonly' });
pc.addTransceiver('audio', { direction: 'recvonly' });

// CRITICAL: Camera requires data channel in SDP
const dataChannel = pc.createDataChannel('kvsDataChannel');
dataChannel.onopen = () => console.log('Data channel opened');
dataChannel.onclose = () => console.log('Data channel closed');

// Now create and send offer
const offer = await pc.createOffer();
```

### Why This Works

The browser's SDP offer includes:
```
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
a=sctp-port:5000
a=max-message-size:262144
```

When the camera sees this, it responds with:
- `a=sendonly` for video and audio (will send media)
- Real stream identifiers (`myKvsVideoStream`, `myVideoTrack`)

Without the data channel:
- `a=inactive` for video
- Fake stream identifiers (`fakeStream`, `fakeTrack`)

## Complete Working Configuration

```javascript
import WebSocket from 'ws';
import { RTCPeerConnection, RTCRtpCodecParameters, useNACK, usePLI, useREMB } from 'werift';

// 1. Get live view credentials
const liveView = await fetch(
    `https://app-hub.prd.aser.simplisafe.com/v2/cameras/${cameraUuid}/${locationId}/live-view`,
    { headers: { 'Authorization': `Bearer ${token}` } }
).then(r => r.json());

// 2. Create peer connection with H264 codec
const pc = new RTCPeerConnection({
    iceServers: liveView.iceServers,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    codecs: {
        audio: [
            new RTCRtpCodecParameters({
                mimeType: 'audio/opus',
                clockRate: 48000,
                channels: 2,
            }),
        ],
        video: [
            new RTCRtpCodecParameters({
                mimeType: 'video/H264',
                clockRate: 90000,
                rtcpFeedback: [useNACK(), usePLI(), useREMB()],
                parameters: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
            }),
        ],
    },
});

// 3. Add transceivers and data channel
pc.addTransceiver('video', { direction: 'recvonly' });
pc.addTransceiver('audio', { direction: 'recvonly' });
const dataChannel = pc.createDataChannel('kvsDataChannel');

// 4. Connect to signaling WebSocket
const ws = new WebSocket(liveView.signedChannelEndpoint);

// 5. On WebSocket open, create and send offer
ws.on('open', async () => {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const offerPayload = JSON.stringify({ type: 'offer', sdp: offer.sdp });
    ws.send(JSON.stringify({
        action: 'SDP_OFFER',
        messagePayload: Buffer.from(offerPayload).toString('base64')
    }));
});

// 6. Handle signaling messages
ws.on('message', async (data) => {
    const dataStr = data.toString();
    if (!dataStr) return;

    const msg = JSON.parse(dataStr);

    if (msg.messageType === 'SDP_ANSWER') {
        const answerJson = Buffer.from(msg.messagePayload, 'base64').toString('utf8');
        const answer = JSON.parse(answerJson);
        await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    } else if (msg.messageType === 'ICE_CANDIDATE') {
        const candJson = Buffer.from(msg.messagePayload, 'base64').toString('utf8');
        const cand = JSON.parse(candJson);
        if (cand.candidate) await pc.addIceCandidate(cand);
    }
});

// 7. Send local ICE candidates
pc.onicecandidate = ({ candidate }) => {
    if (candidate && ws.readyState === WebSocket.OPEN) {
        const payload = JSON.stringify(candidate.toJSON());
        ws.send(JSON.stringify({
            action: 'ICE_CANDIDATE',
            messagePayload: Buffer.from(payload).toString('base64')
        }));
    }
};

// 8. Handle incoming tracks
pc.ontrack = (event) => {
    const track = event.track;
    if (track.kind === 'video') {
        track.onReceiveRtp.subscribe((rtp) => {
            // Process H264 video RTP packets
        });
    }
};
```

## Debugging Checklist

When connection fails, check:

1. **Camera UUID**: Using full UUID, not short serial?
2. **Base64 encoding**: All `messagePayload` values Base64-encoded?
3. **Codec**: H264 configured, not just VP8?
4. **Data channel**: Created before `createOffer()`?
5. **Viewer role**: NOT including `recipientClientId`?
6. **SDP answer direction**: `a=sendonly` or `a=inactive`?

### SDP Answer Indicators

| Indicator | Meaning |
|-----------|---------|
| `a=sendonly` | Camera will send media (success) |
| `a=inactive` | Camera won't send media (fix needed) |
| `myKvsVideoStream` | Real video stream |
| `fakeStream` | Placeholder (no video) |

## Reverse Engineering Methodology

To compare browser behavior with our implementation:

1. Use Playwright to inject RTCPeerConnection interceptor:
```javascript
await page.addInitScript(() => {
    const OriginalRTCPeerConnection = window.RTCPeerConnection;
    window.__capturedSDPs = [];

    window.RTCPeerConnection = function(...args) {
        const pc = new OriginalRTCPeerConnection(...args);
        window.__capturedPC = pc;

        const origSetLocal = pc.setLocalDescription.bind(pc);
        pc.setLocalDescription = async function(desc) {
            window.__capturedSDPs.push({ type: 'local', sdp: desc?.sdp });
            return origSetLocal(desc);
        };

        const origSetRemote = pc.setRemoteDescription.bind(pc);
        pc.setRemoteDescription = async function(desc) {
            window.__capturedSDPs.push({ type: 'remote', sdp: desc?.sdp });
            return origSetRemote(desc);
        };

        return pc;
    };
    window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
});
```

2. Navigate to SimpliSafe cameras page, start stream
3. Extract captured SDPs:
```javascript
await page.evaluate(() => window.__capturedSDPs);
```

4. Compare local SDP (offer) and remote SDP (answer) with our implementation

## Performance Metrics

Successful connection metrics (from testing):
- Live view API: ~200-500ms
- WebSocket connect: ~100-200ms
- SDP answer received: ~1-2s
- ICE connected: ~2-4s
- First video RTP: ~3-5s total
- Video throughput: ~200-300 RTP packets/second (1200 byte payloads)

## Dependencies

- `werift`: Pure TypeScript WebRTC implementation (no native binaries)
- `ws`: WebSocket client for Node.js

## References

- [AWS Kinesis Video Streams WebRTC](https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/what-is-kvswebrtc.html)
- [Werift WebRTC Library](https://github.com/AgoraIO-Community/node-webrtc)
- [H264 Profile Levels](https://en.wikipedia.org/wiki/Advanced_Video_Coding#Levels)
