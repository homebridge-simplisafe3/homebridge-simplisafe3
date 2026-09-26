import WebSocket from 'ws';
import { RTCPeerConnection, RTCRtpCodecParameters } from 'werift';
import {
    SignalRequest,
    SignalResponse,
    SessionDescription,
    TrickleRequest,
    SignalTarget
} from '@livekit/protocol';

const trackTimeout = 30000; // ms, how long to wait for the camera's video track

// LiveKit subscriber. werift gives the encoded RTP so H.264 can be passed to HomeKit untouched
class LiveKitSource {
    constructor(ss3Camera) {
        this.ss3Camera = ss3Camera;
        this.simplisafe = ss3Camera.simplisafe;
        this.log = ss3Camera.log;
        this.debug = ss3Camera.debug;

        this.onVideoRtp = null;
        this.onAudioRtp = null;

        this.ws = null;
        this.pc = null;
        this.pingIntervalID = null;
        this.closed = false;
    }

    // Resolves once the first video RTP packet arrives i.e. media is flowing
    async connect() {
        const liveView = await this.simplisafe.getCameraLiveView(this.ss3Camera.id);
        if (this.debug) this.log(`LiveKit: ${this.ss3Camera.name} cameraStatus ${liveView.cameraStatus}`);

        const url = `${liveView.liveKitURL}/rtc?access_token=${liveView.userToken}&auto_subscribe=1&protocol=15&sdk=js&version=2.22.3`;
        this.ws = new WebSocket(url);

        // LiveKit renegotiates repeatedly as tracks appear
        // Serialize offers so werift doesnt throw
        let offerChain = Promise.resolve();

        return new Promise((resolve, reject) => {
            let settled = false;
            const timeoutID = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    reject(new Error(`Timed out after ${trackTimeout}ms waiting for video from ${this.ss3Camera.name}`));
                }
            }, trackTimeout);

            const settle = (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutID);
                if (err) reject(err); else resolve();
            };

            const send = (message) => {
                try {
                    this.ws.send(new SignalRequest(message).toBinary());
                } catch (err) {
                    if (this.debug) this.log.error('LiveKit: failed to send signal:', err.message);
                }
            };

            this.ws.on('error', err => settle(err));
            this.ws.on('close', () => settle(new Error('LiveKit signalling closed before video started')));

            this.ws.on('message', async data => {
                let response;
                try {
                    response = SignalResponse.fromBinary(new Uint8Array(data));
                } catch (err) {
                    return;
                }

                const message = response.message;

                switch (message.case) {
                case 'join':
                    this._handleJoin(message.value, send);
                    break;

                case 'offer': {
                    const sdp = message.value.sdp;
                    offerChain = offerChain
                        .then(async () => {
                            await this.pc.setRemoteDescription({ type: 'offer', sdp: sdp });
                            const answer = await this.pc.createAnswer();
                            await this.pc.setLocalDescription(answer);
                            send({ message: { case: 'answer', value: new SessionDescription({ type: 'answer', sdp: this.pc.localDescription.sdp }) } });
                        })
                        .catch(err => {
                            if (this.debug) this.log.error('LiveKit: negotiation failed:', err.message);
                        });
                    break;
                }

                case 'trickle':
                    try {
                        await this.pc.addIceCandidate(JSON.parse(message.value.candidateInit));
                    } catch (err) {
                        if (this.debug) this.log.error('LiveKit: bad ICE candidate:', err.message);
                    }
                    break;

                case 'leave':
                    if (this.debug) this.log('LiveKit: server ended the session');
                    settle(new Error('LiveKit server ended the session'));
                    this.close();
                    break;
                }
            });

            this._onFirstVideo = () => settle();
        });
    }

    _handleJoin(join, send) {
        if (this.debug) this.log(`LiveKit: joined room ${join.room && join.room.name}`);

        this.pc = new RTCPeerConnection({
            iceServers: (join.iceServers || []).map(server => ({
                urls: server.urls,
                username: server.username || undefined,
                credential: server.credential || undefined
            })),
            codecs: {
                // Explicitly request H.264
                video: [new RTCRtpCodecParameters({
                    mimeType: 'video/H264',
                    clockRate: 90000,
                    payloadType: 96,
                    rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }, { type: 'goog-remb' }],
                    parameters: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f'
                })],
                audio: [new RTCRtpCodecParameters({
                    mimeType: 'audio/opus',
                    clockRate: 48000,
                    channels: 2,
                    payloadType: 111
                })]
            }
        });

        this.pc.onIceCandidate.subscribe(candidate => {
            if (!candidate) return;
            send({ message: { case: 'trickle', value: new TrickleRequest({ candidateInit: JSON.stringify(candidate), target: SignalTarget.SUBSCRIBER }) } });
        });

        this.pc.onTrack.subscribe(track => {
            if (this.debug) this.log(`LiveKit: subscribed to ${track.kind} (${track.codec && track.codec.mimeType})`);

            track.onReceiveRtp.subscribe(rtp => {
                if (this.closed) return;

                if (track.kind === 'video') {
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

        if (join.pingInterval) {
            this.pingIntervalID = setInterval(() => {
                send({ message: { case: 'ping', value: BigInt(Date.now()) } });
            }, join.pingInterval * 1000);
        }
    }

    close() {
        if (this.closed) return;
        this.closed = true;

        clearInterval(this.pingIntervalID);
        this.onVideoRtp = null;
        this.onAudioRtp = null;

        try {
            if (this.pc) this.pc.close();
        } catch (err) { /* already gone */ }

        try {
            if (this.ws) this.ws.close();
        } catch (err) { /* already gone */ }

        this.pc = null;
        this.ws = null;
    }
}

export default LiveKitSource;
