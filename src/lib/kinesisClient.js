import WebSocket from 'ws';
import { RTCPeerConnection } from 'werift';

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
            this.log('[Kinesis] Requesting live view credentials');
            this.log(`[Kinesis]   URL: ${url}`);
            this.log(`[Kinesis]   Camera: ${cameraSerial}`);
            this.log(`[Kinesis]   Location: ${locationId}`);
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
                this.log.error(`[Kinesis] Live view request failed after ${this._elapsed(startTime)}`);
                this.log.error(`[Kinesis]   Status: ${response.status} ${response.statusText}`);
                this.log.error(`[Kinesis]   Response: ${errorText.substring(0, 500)}`);
                throw error;
            }

            const data = await response.json();

            if (this.debug) {
                this.log(`[Kinesis] Live view response received in ${this._elapsed(startTime)}`);
                this.log(`[Kinesis]   Client ID: ${data.clientId}`);
                this.log(`[Kinesis]   ICE servers: ${data.iceServers?.length || 0}`);
                if (data.iceServers) {
                    data.iceServers.forEach((server, i) => {
                        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
                        this.log(`[Kinesis]   ICE[${i}]: ${urls.join(', ')} ${server.username ? '(with credentials)' : '(no credentials)'}`);
                    });
                }
                this.log(`[Kinesis]   Signaling endpoint: ${data.signedChannelEndpoint?.substring(0, 80)}...`);
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
            this.log('[Kinesis] Creating RTCPeerConnection');
            this.log('[Kinesis]   Bundle policy: max-bundle');
            this.log('[Kinesis]   RTCP mux: require');
        }

        // Create peer connection with ICE servers
        const peerConnection = new RTCPeerConnection({
            iceServers: iceServers,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        });

        // Add transceivers for receiving video and audio
        peerConnection.addTransceiver('video', { direction: 'recvonly' });
        peerConnection.addTransceiver('audio', { direction: 'recvonly' });

        if (this.debug) {
            this.log('[Kinesis] Added transceivers: video (recvonly), audio (recvonly)');
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
                    this.log.error(`[Kinesis] Connection timeout after ${CONNECTION_TIMEOUT_MS}ms`);
                    this.log.error(`[Kinesis]   Local ICE candidates sent: ${localCandidateCount}`);
                    this.log.error(`[Kinesis]   Remote ICE candidates received: ${remoteCandidateCount}`);
                    this.log.error(`[Kinesis]   Connection state: ${peerConnection.connectionState}`);
                    this.log.error(`[Kinesis]   ICE connection state: ${peerConnection.iceConnectionState}`);
                    this.log.error(`[Kinesis]   ICE gathering state: ${peerConnection.iceGatheringState}`);
                    this.log.error(`[Kinesis]   Signaling state: ${peerConnection.signalingState}`);
                    this._cleanup(session);
                    reject(new Error('Kinesis connection timeout - camera may be asleep or unreachable'));
                }
            }, CONNECTION_TIMEOUT_MS);

            signaling.on('error', (err) => {
                this.log.error(`[Kinesis] Signaling WebSocket error: ${err.message}`);
                if (this.debug) {
                    this.log.error('[Kinesis]   Error details:', err);
                }
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
                        this.log(`[Kinesis] SDP offer created in ${this._elapsed(offerStartTime)}`);
                        this.log(`[Kinesis]   SDP type: ${offer.type}`);
                        this.log(`[Kinesis]   SDP length: ${offer.sdp?.length || 0} bytes`);
                        // Log media lines from SDP for debugging codec negotiation
                        const mediaLines = offer.sdp?.split('\n').filter(l => l.startsWith('m=')) || [];
                        mediaLines.forEach(line => {
                            this.log(`[Kinesis]   ${line.trim()}`);
                        });
                    }

                    const offerMessage = {
                        action: 'SDP_OFFER',
                        recipientClientId: liveView.clientId,
                        messagePayload: JSON.stringify({
                            type: 'offer',
                            sdp: offer.sdp
                        })
                    };

                    if (this.debug) {
                        this.log(`[Kinesis] Sending SDP offer to client ${liveView.clientId}`);
                    }
                    signaling.send(JSON.stringify(offerMessage));

                } catch (err) {
                    this.log.error(`[Kinesis] Failed to create/send SDP offer: ${err.message}`);
                    if (this.debug) {
                        this.log.error('[Kinesis]   Error details:', err);
                    }
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        this._cleanup(session);
                        reject(err);
                    }
                }
            });

            // Handle ICE candidates from local peer connection
            peerConnection.onicecandidate = ({ candidate }) => {
                if (candidate && signaling.readyState === WebSocket.OPEN) {
                    localCandidateCount++;
                    const candidateMessage = {
                        action: 'ICE_CANDIDATE',
                        recipientClientId: liveView.clientId,
                        messagePayload: JSON.stringify(candidate.toJSON())
                    };
                    if (this.debug) {
                        this.log(`[Kinesis] Sending ICE candidate #${localCandidateCount}: ${candidate.candidate?.substring(0, 60)}...`);
                    }
                    signaling.send(JSON.stringify(candidateMessage));
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
                    this.log.error('[Kinesis] ICE connection failed');
                    this.log.error(`[Kinesis]   Local candidates sent: ${localCandidateCount}`);
                    this.log.error(`[Kinesis]   Remote candidates received: ${remoteCandidateCount}`);
                }
            };

            // Handle connection state changes
            peerConnection.onconnectionstatechange = () => {
                const state = peerConnection.connectionState;
                const elapsed = this._elapsed(sessionStartTime);

                if (state === 'connected') {
                    this.log(`[Kinesis] WebRTC connected in ${elapsed}`);
                    if (this.debug) {
                        this.log(`[Kinesis]   Local ICE candidates: ${localCandidateCount}`);
                        this.log(`[Kinesis]   Remote ICE candidates: ${remoteCandidateCount}`);
                        this.log(`[Kinesis]   Video track: ${session.videoTrack ? 'received' : 'pending'}`);
                        this.log(`[Kinesis]   Audio track: ${session.audioTrack ? 'received' : 'pending'}`);
                    }
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
                    this.log(`[Kinesis] Video track received (${elapsed})`);
                    if (this.debug) {
                        this.log(`[Kinesis]   Track ID: ${track.id || 'unknown'}`);
                    }
                } else if (track.kind === 'audio') {
                    session.audioTrack = track;
                    this.log(`[Kinesis] Audio track received (${elapsed})`);
                    if (this.debug) {
                        this.log(`[Kinesis]   Track ID: ${track.id || 'unknown'}`);
                    }
                }
            };

            // Handle signaling messages from Kinesis
            signaling.on('message', async (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    const messageType = message.messageType || message.type || 'unknown';

                    if (message.messageType === 'SDP_ANSWER') {
                        const answer = JSON.parse(message.messagePayload);
                        if (this.debug) {
                            this.log('[Kinesis] Received SDP answer');
                            this.log(`[Kinesis]   SDP type: ${answer.type}`);
                            this.log(`[Kinesis]   SDP length: ${answer.sdp?.length || 0} bytes`);
                        }
                        await peerConnection.setRemoteDescription({
                            type: 'answer',
                            sdp: answer.sdp
                        });
                        if (this.debug) {
                            this.log('[Kinesis] Remote description set successfully');
                        }

                    } else if (message.messageType === 'ICE_CANDIDATE') {
                        const candidate = JSON.parse(message.messagePayload);
                        if (candidate.candidate) {
                            remoteCandidateCount++;
                            if (this.debug) {
                                this.log(`[Kinesis] Received ICE candidate #${remoteCandidateCount}: ${candidate.candidate?.substring(0, 60)}...`);
                            }
                            await peerConnection.addIceCandidate(candidate);
                        } else if (this.debug) {
                            this.log('[Kinesis] Received end-of-candidates signal');
                        }

                    } else if (this.debug) {
                        this.log(`[Kinesis] Received signaling message: ${messageType}`);
                        if (message.senderClientId) {
                            this.log(`[Kinesis]   Sender: ${message.senderClientId}`);
                        }
                    }
                } catch (err) {
                    this.log.error(`[Kinesis] Error handling signaling message: ${err.message}`);
                    if (this.debug) {
                        this.log.error(`[Kinesis]   Raw message: ${data.toString().substring(0, 200)}...`);
                    }
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
