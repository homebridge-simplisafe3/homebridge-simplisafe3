import WebSocket from 'ws';
import { RTCPeerConnection } from 'werift';

const KINESIS_URL_BASE = 'https://app-hub.prd.aser.simplisafe.com/v2';

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
     * Get live view credentials from SimpliSafe API
     * @param {string} locationId - The SimpliSafe location/subscription ID
     * @param {string} cameraSerial - The camera serial number
     * @returns {Promise<LiveViewResponse>}
     */
    async getLiveView(locationId, cameraSerial) {
        const url = `${KINESIS_URL_BASE}/cameras/${cameraSerial}/${locationId}/live-view`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.authManager.accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to get live view: ${response.status} ${response.statusText} - ${errorText}`);
        }

        return await response.json();
    }

    /**
     * Create a WebRTC connection to the camera via Kinesis signaling
     * @param {string} locationId - The SimpliSafe location/subscription ID
     * @param {string} cameraSerial - The camera serial number
     * @returns {Promise<KinesisSession>}
     */
    async createSession(locationId, cameraSerial) {
        const liveView = await this.getLiveView(locationId, cameraSerial);

        if (this.debug) {
            this.log(`Kinesis live view response for ${cameraSerial}: endpoint=${liveView.signedChannelEndpoint.substring(0, 50)}...`);
        }

        // Convert SimpliSafe ICE servers to werift format
        const iceServers = liveView.iceServers.map(server => ({
            urls: server.urls,
            username: server.username,
            credential: server.credential
        }));

        // Create peer connection with ICE servers
        const peerConnection = new RTCPeerConnection({
            iceServers: iceServers,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        });

        // Add transceivers for receiving video and audio
        peerConnection.addTransceiver('video', { direction: 'recvonly' });
        peerConnection.addTransceiver('audio', { direction: 'recvonly' });

        // Connect to Kinesis signaling WebSocket
        const signaling = new WebSocket(liveView.signedChannelEndpoint);

        /** @type {KinesisSession} */
        const session = {
            peerConnection,
            signaling,
            videoTrack: null,
            audioTrack: null,
            clientId: liveView.clientId
        };

        return new Promise((resolve, reject) => {
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this._cleanup(session);
                    reject(new Error('Kinesis connection timeout'));
                }
            }, 30000);

            signaling.on('error', (err) => {
                if (this.debug) this.log.error('Kinesis signaling error:', err);
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    this._cleanup(session);
                    reject(err);
                }
            });

            signaling.on('close', () => {
                if (this.debug) this.log('Kinesis signaling closed');
            });

            signaling.on('open', async () => {
                if (this.debug) this.log('Kinesis signaling connected');

                try {
                    // Create and send SDP offer
                    const offer = await peerConnection.createOffer();
                    await peerConnection.setLocalDescription(offer);

                    const offerMessage = {
                        action: 'SDP_OFFER',
                        recipientClientId: liveView.clientId,
                        messagePayload: JSON.stringify({
                            type: 'offer',
                            sdp: offer.sdp
                        })
                    };

                    if (this.debug) this.log('Sending SDP offer');
                    signaling.send(JSON.stringify(offerMessage));
                } catch (err) {
                    if (this.debug) this.log.error('Failed to create/send offer:', err);
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
                    const candidateMessage = {
                        action: 'ICE_CANDIDATE',
                        recipientClientId: liveView.clientId,
                        messagePayload: JSON.stringify(candidate.toJSON())
                    };
                    if (this.debug) this.log('Sending ICE candidate');
                    signaling.send(JSON.stringify(candidateMessage));
                }
            };

            // Handle connection state changes
            peerConnection.onconnectionstatechange = () => {
                const state = peerConnection.connectionState;
                if (this.debug) this.log(`Kinesis connection state: ${state}`);

                if (state === 'connected') {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        resolve(session);
                    }
                } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
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
                if (this.debug) this.log(`Received ${track.kind} track`);

                if (track.kind === 'video') {
                    session.videoTrack = track;
                } else if (track.kind === 'audio') {
                    session.audioTrack = track;
                }
            };

            // Handle signaling messages from Kinesis
            signaling.on('message', async (data) => {
                try {
                    const message = JSON.parse(data.toString());

                    if (this.debug) this.log(`Kinesis signaling message: ${message.messageType || message.type || 'unknown'}`);

                    if (message.messageType === 'SDP_ANSWER') {
                        const answer = JSON.parse(message.messagePayload);
                        if (this.debug) this.log('Received SDP answer');
                        await peerConnection.setRemoteDescription({
                            type: 'answer',
                            sdp: answer.sdp
                        });
                    } else if (message.messageType === 'ICE_CANDIDATE') {
                        const candidate = JSON.parse(message.messagePayload);
                        if (this.debug) this.log('Received ICE candidate');
                        if (candidate.candidate) {
                            await peerConnection.addIceCandidate(candidate);
                        }
                    }
                } catch (err) {
                    if (this.debug) this.log.error('Error handling signaling message:', err);
                }
            });
        });
    }

    /**
     * Clean up a Kinesis session
     * @param {KinesisSession} session
     */
    _cleanup(session) {
        try {
            if (session.signaling && session.signaling.readyState === WebSocket.OPEN) {
                session.signaling.close();
            }
        } catch (e) {
            // Ignore cleanup errors
        }

        try {
            if (session.peerConnection) {
                session.peerConnection.close();
            }
        } catch (e) {
            // Ignore cleanup errors
        }
    }

    /**
     * Close a Kinesis session
     * @param {KinesisSession} session
     */
    closeSession(session) {
        if (this.debug) this.log('Closing Kinesis session');
        this._cleanup(session);
    }
}

export default KinesisClient;
