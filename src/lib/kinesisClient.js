import WebSocket from 'ws';
import { RTCPeerConnection, RTCRtpCodecParameters, useNACK, usePLI, useREMB } from 'werift';

const KINESIS_URL_BASE = 'https://app-hub.prd.aser.simplisafe.com/v2';
const CONNECTION_TIMEOUT_MS = 30000;

/**
 * @typedef {Object} LiveViewResponse
 * @property {string} signedChannelEndpoint - Pre-signed WebSocket URL for Kinesis signaling
 * @property {string} clientId - Client ID for signaling messages
 * @property {Array<{urls: string[], username?: string, credential?: string}>} iceServers - ICE server configuration
 */

/**
 * @typedef {Object} KinesisSession
 * @property {RTCPeerConnection} peerConnection - The WebRTC peer connection
 * @property {WebSocket} signaling - The signaling WebSocket
 * @property {import('werift').MediaStreamTrack|null} videoTrack - Video track from the peer connection
 * @property {import('werift').MediaStreamTrack|null} audioTrack - Audio track from the peer connection
 * @property {string} clientId - Client ID for signaling
 * @property {string} cameraSerial - Camera serial number for logging
 */

/**
 * Client for SimpliSafe Kinesis WebRTC streaming
 */
class KinesisClient {
    /**
     * @param {Object} authManager - The auth manager instance with accessToken
     * @param {Object} log - Logger instance
     * @param {boolean} debug - Whether debug logging is enabled
     */
    constructor(authManager, log, debug = false) {
        this.authManager = authManager;
        this.log = log;
        this.debug = debug;
    }

    /**
     * Format elapsed time for logging
     * @param {number} startTime - Start timestamp from Date.now()
     * @returns {string}
     */
    _elapsed(startTime) {
        return `${Date.now() - startTime}ms`;
    }

    /**
     * Get live view credentials from SimpliSafe API
     * @param {string} locationId - The SimpliSafe location/subscription ID
     * @param {string} cameraSerial - The camera serial number
     * @returns {Promise<LiveViewResponse>}
     */
    async getLiveView(locationId, cameraSerial) {
        const url = `${KINESIS_URL_BASE}/cameras/${cameraSerial}/${locationId}/live-view`;
        const startTime = Date.now();

        if (this.debug) {
            this.log(`[Kinesis] Requesting live view: camera=${cameraSerial} location=${locationId}`);
        }

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.authManager.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                const error = new Error(`Live view API failed: ${response.status} ${response.statusText}`);
                this.log.error(`[Kinesis] Live view failed: ${response.status} ${response.statusText} (${this._elapsed(startTime)}) - ${errorText.substring(0, 200)}`);
                throw error;
            }

            const data = await response.json();

            // Always log API response structure for debugging
            const iceInfo = data.iceServers?.map((s, i) => `ICE${i}:${s.username ? 'auth' : 'noauth'}:${s.urls?.length || 0}urls`).join(' ') || 'none';
            this.log(`[Kinesis] Live view OK (${this._elapsed(startTime)}): clientId=${data.clientId} iceServers=${data.iceServers?.length || 0} ${iceInfo}`);
            this.log(`[Kinesis] Signaling URL: ${data.signedChannelEndpoint?.substring(0, 100)}...`);

            if (!data.clientId) {
                this.log.error(`[Kinesis] WARNING: No clientId in response! Keys: ${Object.keys(data).join(',')}`);
            }
            if (!data.iceServers || data.iceServers.length === 0) {
                this.log.error(`[Kinesis] WARNING: No ICE servers in response!`);
            }

            return data;
        } catch (err) {
            if (!err.message.includes('Live view API failed')) {
                this.log.error(`[Kinesis] Live view request error after ${this._elapsed(startTime)}: ${err.message}`);
            }
            throw err;
        }
    }

    /**
     * Create a WebRTC connection to the camera via Kinesis signaling
     * @param {string} locationId - The SimpliSafe location/subscription ID
     * @param {string} cameraSerial - The camera serial number
     * @returns {Promise<KinesisSession>}
     */
    async createSession(locationId, cameraSerial) {
        const sessionStartTime = Date.now();
        this.log(`[Kinesis] Creating session for camera ${cameraSerial}`);

        const liveView = await this.getLiveView(locationId, cameraSerial);

        // Convert SimpliSafe ICE servers to werift format
        const iceServers = liveView.iceServers.map(server => ({
            urls: server.urls,
            username: server.username,
            credential: server.credential
        }));

        if (this.debug) {
            this.log('[Kinesis] Creating RTCPeerConnection (bundle=max, rtcpMux=require)');
        }

        // Create peer connection with ICE servers and H264 codec
        // SimpliSafe outdoor cameras only support H264 (profile 42e01f), not VP8
        const peerConnection = new RTCPeerConnection({
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
                    // H264 Constrained Baseline - required by SimpliSafe cameras
                    new RTCRtpCodecParameters({
                        mimeType: 'video/H264',
                        clockRate: 90000,
                        rtcpFeedback: [useNACK(), usePLI(), useREMB()],
                        parameters: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
                    }),
                ],
            },
        });

        // Add transceivers for receiving video and audio
        peerConnection.addTransceiver('video', { direction: 'recvonly' });
        peerConnection.addTransceiver('audio', { direction: 'recvonly' });

        // CRITICAL: Add a data channel - the camera requires this in the SDP offer
        // Without a data channel, the camera responds with a=inactive instead of a=sendonly
        const dataChannel = peerConnection.createDataChannel('kvsDataChannel');
        dataChannel.onopen = () => {
            if (this.debug) this.log('[Kinesis] Data channel opened');
        };
        dataChannel.onclose = () => {
            if (this.debug) this.log('[Kinesis] Data channel closed');
        };

        if (this.debug) {
            this.log('[Kinesis] Added transceivers: video (recvonly), audio (recvonly), data channel');
        }

        // Connect to Kinesis signaling WebSocket
        const signalingStartTime = Date.now();
        if (this.debug) {
            this.log('[Kinesis] Connecting to signaling WebSocket...');
        }

        const signaling = new WebSocket(liveView.signedChannelEndpoint);

        /** @type {KinesisSession} */
        const session = {
            peerConnection,
            signaling,
            videoTrack: null,
            audioTrack: null,
            clientId: liveView.clientId,
            cameraSerial: cameraSerial
        };

        // Track ICE candidates for logging
        let localCandidateCount = 0;
        let remoteCandidateCount = 0;

        return new Promise((resolve, reject) => {
            let resolved = false;

            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this.log.error(`[Kinesis] Connection timeout (${CONNECTION_TIMEOUT_MS}ms): ice=${localCandidateCount}/${remoteCandidateCount} state=${peerConnection.connectionState} iceState=${peerConnection.iceConnectionState}`);
                    this._cleanup(session);
                    reject(new Error('Kinesis connection timeout - camera may be asleep or unreachable'));
                }
            }, CONNECTION_TIMEOUT_MS);

            signaling.on('error', (err) => {
                this.log.error(`[Kinesis] Signaling error: ${err.message}`);
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    this._cleanup(session);
                    reject(new Error(`Signaling error: ${err.message}`));
                }
            });

            signaling.on('close', (code, reason) => {
                const reasonStr = reason?.toString() || 'no reason';
                if (this.debug) {
                    this.log(`[Kinesis] Signaling WebSocket closed (code: ${code}, reason: ${reasonStr})`);
                }
                if (!resolved && code !== 1000) {
                    resolved = true;
                    clearTimeout(timeout);
                    this._cleanup(session);
                    reject(new Error(`Signaling closed unexpectedly (code: ${code})`));
                }
            });

            signaling.on('open', async () => {
                if (this.debug) {
                    this.log(`[Kinesis] Signaling WebSocket connected in ${this._elapsed(signalingStartTime)}`);
                }

                try {
                    // Create and send SDP offer
                    const offerStartTime = Date.now();
                    if (this.debug) {
                        this.log('[Kinesis] Creating SDP offer...');
                    }

                    const offer = await peerConnection.createOffer();
                    await peerConnection.setLocalDescription(offer);

                    if (this.debug) {
                        this.log(`[Kinesis] SDP offer created (${this._elapsed(offerStartTime)}, ${offer.sdp?.length || 0} bytes)`);
                    }

                    // As a VIEWER, we do NOT include recipientClientId
                    // The master (camera) will receive our offer automatically
                    // messagePayload must be Base64-encoded JSON (Kinesis WebRTC protocol)
                    const offerPayload = JSON.stringify({
                        type: 'offer',
                        sdp: offer.sdp
                    });
                    const offerMessage = {
                        action: 'SDP_OFFER',
                        messagePayload: Buffer.from(offerPayload).toString('base64')
                    };

                    const offerJson = JSON.stringify(offerMessage);
                    this.log(`[Kinesis] Sending SDP_OFFER as VIEWER (${offerJson.length} bytes)`);
                    signaling.send(offerJson);
                    this.log(`[Kinesis] SDP_OFFER sent, waiting for answer...`);

                } catch (err) {
                    this.log.error(`[Kinesis] SDP offer failed: ${err.message}`);
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        this._cleanup(session);
                        reject(err);
                    }
                }
            });

            // Handle ICE candidates from local peer connection
            // As VIEWER, we do NOT include recipientClientId
            // messagePayload must be Base64-encoded JSON (Kinesis WebRTC protocol)
            peerConnection.onicecandidate = ({ candidate }) => {
                if (candidate && signaling.readyState === WebSocket.OPEN) {
                    localCandidateCount++;
                    const candidateJson = candidate.toJSON();
                    const candidatePayload = JSON.stringify(candidateJson);
                    const candidateMessage = {
                        action: 'ICE_CANDIDATE',
                        messagePayload: Buffer.from(candidatePayload).toString('base64')
                    };
                    this.log(`[Kinesis] ICE candidate send #${localCandidateCount}: ${candidate.candidate?.substring(0, 80)}`);
                    signaling.send(JSON.stringify(candidateMessage));
                } else if (candidate === null) {
                    this.log(`[Kinesis] ICE gathering complete (${localCandidateCount} candidates)`);
                }
            };

            // Handle ICE gathering state changes
            peerConnection.onicegatheringstatechange = () => {
                if (this.debug) {
                    this.log(`[Kinesis] ICE gathering state: ${peerConnection.iceGatheringState}`);
                }
            };

            // Handle ICE connection state changes
            peerConnection.oniceconnectionstatechange = () => {
                const state = peerConnection.iceConnectionState;
                if (this.debug) {
                    this.log(`[Kinesis] ICE connection state: ${state}`);
                }
                if (state === 'failed') {
                    this.log.error(`[Kinesis] ICE failed: local=${localCandidateCount} remote=${remoteCandidateCount}`);
                }
            };

            // Handle connection state changes
            peerConnection.onconnectionstatechange = () => {
                const state = peerConnection.connectionState;
                const elapsed = this._elapsed(sessionStartTime);

                if (state === 'connected') {
                    this.log(`[Kinesis] WebRTC connected (${elapsed}): ice=${localCandidateCount}/${remoteCandidateCount}`);
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        resolve(session);
                    }
                } else if (state === 'connecting') {
                    if (this.debug) {
                        this.log(`[Kinesis] Connection state: ${state} (${elapsed})`);
                    }
                } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                    this.log.error(`[Kinesis] Connection ${state} after ${elapsed}`);
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        reject(new Error(`Kinesis connection ${state}`));
                    }
                }
            };

            // Handle incoming tracks
            peerConnection.ontrack = (event) => {
                const track = event.track;
                const elapsed = this._elapsed(sessionStartTime);

                if (track.kind === 'video') {
                    session.videoTrack = track;
                    if (this.debug) this.log(`[Kinesis] Video track received (${elapsed})`);
                } else if (track.kind === 'audio') {
                    session.audioTrack = track;
                    if (this.debug) this.log(`[Kinesis] Audio track received (${elapsed})`);
                }
            };

            // Handle signaling messages from Kinesis
            signaling.on('message', async (data, isBinary) => {
                const elapsed = this._elapsed(sessionStartTime);
                try {
                    const dataStr = isBinary ? data.toString('utf8') : data.toString();

                    // Skip empty acknowledgment frames
                    if (!dataStr || dataStr.length === 0) {
                        if (this.debug) {
                            this.log(`[Kinesis] WS empty frame received (${elapsed})`);
                        }
                        return;
                    }

                    // Always log received messages for debugging
                    this.log(`[Kinesis] WS recv (${elapsed}): ${dataStr.substring(0, 200)}${dataStr.length > 200 ? '...' : ''}`);

                    const message = JSON.parse(dataStr);
                    const msgType = message.messageType || message.type || 'unknown';
                    this.log(`[Kinesis] Message type: ${msgType} senderClientId=${message.senderClientId || 'none'}`);

                    if (message.messageType === 'SDP_ANSWER') {
                        // messagePayload is Base64-encoded JSON (Kinesis WebRTC protocol)
                        const answerJson = Buffer.from(message.messagePayload, 'base64').toString('utf8');
                        const answer = JSON.parse(answerJson);
                        this.log(`[Kinesis] SDP ANSWER received (${elapsed}): ${answer.sdp?.length || 0} bytes`);
                        if (this.debug) {
                            // Log first few lines of SDP for debugging
                            const sdpPreview = answer.sdp?.split('\n').slice(0, 5).join(' | ') || 'no sdp';
                            this.log(`[Kinesis] SDP preview: ${sdpPreview}`);
                        }
                        await peerConnection.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
                        this.log(`[Kinesis] Remote description set successfully`);

                    } else if (message.messageType === 'ICE_CANDIDATE') {
                        // messagePayload is Base64-encoded JSON (Kinesis WebRTC protocol)
                        const candidateJson = Buffer.from(message.messagePayload, 'base64').toString('utf8');
                        const candidate = JSON.parse(candidateJson);
                        if (candidate.candidate) {
                            remoteCandidateCount++;
                            this.log(`[Kinesis] ICE candidate recv #${remoteCandidateCount} (${elapsed}): ${candidate.candidate.substring(0, 80)}`);
                            await peerConnection.addIceCandidate(candidate);
                            this.log(`[Kinesis] ICE candidate #${remoteCandidateCount} added successfully`);
                        } else {
                            this.log(`[Kinesis] ICE candidate recv with empty candidate (end of candidates)`);
                        }
                    } else {
                        // Log any unknown message types
                        this.log(`[Kinesis] Unknown message: type=${message.messageType || message.type || 'none'} keys=${Object.keys(message).join(',')}`);
                    }
                } catch (err) {
                    const preview = data?.toString?.()?.substring(0, 300) || 'no data';
                    this.log.error(`[Kinesis] Signaling parse error: ${err.message}`);
                    this.log.error(`[Kinesis] Raw data: ${preview}`);
                }
            });
        });
    }

    /**
     * Clean up a Kinesis session
     * @param {KinesisSession} session
     */
    _cleanup(session) {
        if (this.debug) {
            this.log(`[Kinesis] Cleaning up session for camera ${session.cameraSerial || 'unknown'}`);
        }

        try {
            if (session.signaling) {
                if (session.signaling.readyState === WebSocket.OPEN) {
                    session.signaling.close(1000, 'Session cleanup');
                }
                session.signaling.removeAllListeners();
            }
        } catch (e) {
            if (this.debug) {
                this.log(`[Kinesis] Error closing signaling: ${e.message}`);
            }
        }

        try {
            if (session.peerConnection) {
                session.peerConnection.close();
            }
        } catch (e) {
            if (this.debug) {
                this.log(`[Kinesis] Error closing peer connection: ${e.message}`);
            }
        }
    }

    /**
     * Close a Kinesis session
     * @param {KinesisSession} session
     */
    closeSession(session) {
        this.log(`[Kinesis] Closing session for camera ${session.cameraSerial || 'unknown'}`);
        this._cleanup(session);
    }
}

export default KinesisClient;
