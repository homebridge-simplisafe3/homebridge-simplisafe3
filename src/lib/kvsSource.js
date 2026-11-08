

// KVS WebRTC viewer for SimpliSafe cameras whose webRTCProvider is 'kvs'
// (Amazon Kinesis Video Streams). Mirrors lib/liveKitSource.js: same
// onVideoRtp / onAudioRtp / onSessionEnded surface, werift RTCPeerConnection,
// H.264 RTP passed through to HomeKit untouched.
//
// SimpliSafe's /v2/.../live-view endpoint returns a pre-signed KVS viewer URL
// plus ICE servers, so no AWS SDK or SigV4 signing is needed here. We just open
// the signed WebSocket and run the KVS signaling exchange (JSON envelopes).

import WebSocket from 'ws';
import { RTCPeerConnection, RTCRtpCodecParameters } from 'werift';

const trackTimeout = 30000; // ms to wait for the first video RTP before giving up

// KVS signaling envelope helpers -------------------------------------------

function encodeMessage(action, payload) {
    // payload (an SDP or ICE candidate object) is JSON, base64'd into messagePayload
    return JSON.stringify({
        action,
        messagePayload: Buffer.from(JSON.stringify(payload)).toString("base64"),
        correlationId: String(Date.now())
    });
}

function decodeMessage(data) {
    let parsed;
    try {
        parsed = JSON.parse(typeof data === "string" ? data : data.toString());
    } catch (e) {
        return null;
    }
    let payload = null;
    if (parsed.messagePayload) {
        try {
            payload = JSON.parse(Buffer.from(parsed.messagePayload, "base64").toString());
        } catch (e) {
            payload = null;
        }
    }
    return { type: parsed.messageType, sender: parsed.senderClientId, payload, raw: parsed };
}

class KvsSource {
    constructor(ss3Camera) {
        this.ss3Camera = ss3Camera;
        this.simplisafe = ss3Camera.simplisafe;
        this.log = ss3Camera.log;
        this.debug = ss3Camera.debug;

        this.onVideoRtp = null;
        this.onAudioRtp = null;
        this.onSessionEnded = null;

        this.ws = null;
        this.pc = null;
        this.closed = false;
        this.streaming = false;
        this._onFirstVideo = null;
    }

    // Fires only when a running session dies, not on a deliberate close
    _sessionEnded(reason) {
        if (this.closed || !this.streaming) return;
        const notify = this.onSessionEnded;
        this.close();
        if (notify) notify(reason);
    }

    // Resolves once the first video RTP packet arrives i.e. media is flowing
    async connect() {
        try {
            await this.simplisafe.wakeCameras();
        } catch (err) {
            if (this.debug) this.log(`KVS: wake request failed, continuing: ${err.message}`);
        }

        const view = await this.simplisafe.getCameraLiveView(this.ss3Camera.id);
        if (this.debug) this.log(`KVS: ${this.ss3Camera.name} cameraStatus ${view.cameraStatus}`);

        if (!view.signedChannelEndpoint) {
            throw new Error(`KVS: live-view response missing signedChannelEndpoint for ${this.ss3Camera.name}`);
        }

        this.pc = new RTCPeerConnection({
            iceServers: (view.iceServers || []).map(server => ({
                urls: server.urls,
                username: server.username || undefined,
                credential: server.credential || undefined
            })),
            codecs: {
                video: [new RTCRtpCodecParameters({
                    mimeType: "video/H264",
                    clockRate: 90000,
                    payloadType: 96,
                    rtcpFeedback: [{ type: "nack" }, { type: "nack", parameter: "pli" }, { type: "goog-remb" }],
                    parameters: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"
                })],
                audio: [new RTCRtpCodecParameters({
                    mimeType: "audio/opus",
                    clockRate: 48000,
                    channels: 2,
                    payloadType: 111
                })]
            }
        });

        // As a viewer we offer recvonly media lines.
        this.pc.addTransceiver("video", { direction: "recvonly" });
        this.pc.addTransceiver("audio", { direction: "recvonly" });

        this.pc.connectionStateChange.subscribe(state => {
            if (this.debug) this.log(`KVS: connection ${state} for ${this.ss3Camera.name}`);
            if (state === "failed" || state === "closed" || state === "disconnected") {
                this._sessionEnded(`connection ${state}`);
            }
        });

        this.pc.onTrack.subscribe(track => {
            if (this.debug) this.log(`KVS: subscribed to ${track.kind} (${track.codec && track.codec.mimeType})`);
            track.onReceiveRtp.subscribe(rtp => {
                if (this.closed) return;
                if (track.kind === "video") {
                    this.streaming = true;
                    if (this._onFirstVideo) {
                        const notify = this._onFirstVideo;
                        this._onFirstVideo = null;
                        notify();
                    }
                    if (this.onVideoRtp) this.onVideoRtp(rtp);
                } else if (this.onAudioRtp) {
                    this.onAudioRtp(rtp);
                }
            });
        });

        return new Promise((resolve, reject) => {
            let settled = false;
            const timeoutID = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    const features = this.ss3Camera.cameraDetails && this.ss3Camera.cameraDetails.supportedFeatures;
                    const hint = features && features.wired === false ? " This camera is battery powered and may have been asleep." : "";
                    reject(new Error(`Timed out after ${trackTimeout}ms waiting for video from ${this.ss3Camera.name}.${hint}`));
                }
            }, trackTimeout);

            const settle = (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutID);
                if (err) reject(err); else resolve();
            };
            this._onFirstVideo = () => settle();

            const send = (message) => {
                try {
                    this.ws.send(message);
                } catch (err) {
                    if (this.debug) this.log.error("KVS: failed to send signal:", err.message);
                }
            };

            this.ws = new WebSocket(view.signedChannelEndpoint);

            this.ws.on("error", err => { settle(err); this._sessionEnded(err.message); });
            this.ws.on("close", () => {
                settle(new Error("KVS signalling closed before video started"));
                this._sessionEnded("signalling closed");
            });

            // Send our offer to the camera (the signaling master) as soon as the channel is open.
            this.ws.on("open", async () => {
                try {
                    const offer = await this.pc.createOffer();
                    await this.pc.setLocalDescription(offer);

                    // Trickle our ICE candidates to the master as they are gathered.
                    this.pc.onIceCandidate.subscribe(candidate => {
                        if (!candidate) return;
                        send(encodeMessage("ICE_CANDIDATE", {
                            candidate: candidate.candidate,
                            sdpMid: candidate.sdpMid,
                            sdpMLineIndex: candidate.sdpMLineIndex
                        }));
                    });

                    send(encodeMessage("SDP_OFFER", {
                        type: "offer",
                        sdp: this.pc.localDescription.sdp
                    }));
                } catch (err) {
                    settle(err);
                }
            });

            this.ws.on("message", async data => {
                const msg = decodeMessage(data);
                if (!msg) return;

                switch (msg.type) {
                case "SDP_ANSWER":
                    try {
                        await this.pc.setRemoteDescription({ type: "answer", sdp: msg.payload.sdp });
                        if (this.debug) this.log(`KVS: answer applied for ${this.ss3Camera.name}`);
                    } catch (err) {
                        settle(err);
                    }
                    break;

                case "ICE_CANDIDATE":
                    try {
                        if (msg.payload && msg.payload.candidate) {
                            await this.pc.addIceCandidate(msg.payload);
                        }
                    } catch (err) {
                        if (this.debug) this.log.error("KVS: bad ICE candidate:", err.message);
                    }
                    break;

                case "STATUS_RESPONSE":
                    // KVS reports signaling errors here (e.g. bad client id).
                    if (msg.raw.statusResponse && msg.raw.statusResponse.success === false) {
                        settle(new Error(`KVS status error: ${JSON.stringify(msg.raw.statusResponse)}`));
                    }
                    break;
                }
            });
        });
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this.streaming = false;
        this.onVideoRtp = null;
        this.onAudioRtp = null;
        this.onSessionEnded = null;

        try { if (this.pc) this.pc.close(); } catch (err) { /* already gone */ }
        try { if (this.ws) this.ws.close(); } catch (err) { /* already gone */ }

        this.pc = null;
        this.ws = null;
    }
}


export default KvsSource;
