#!/usr/bin/env node
/**
 * Standalone test script for Kinesis WebRTC outdoor camera connection.
 *
 * Usage:
 *   node scripts/test-kinesis.js --token <access_token> --location <location_id> --camera <camera_serial>
 *
 * Or with Homebridge storage path (reads token from persist/AccessToken):
 *   node scripts/test-kinesis.js --storage ~/.homebridge --location <location_id> --camera <camera_serial>
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import WebSocket from 'ws';
import { RTCPeerConnection, RTCRtpCodecParameters, useNACK, usePLI, useREMB } from 'werift';

const KINESIS_URL_BASE = 'https://app-hub.prd.aser.simplisafe.com/v2';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {};

    for (let i = 0; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        opts[key] = args[i + 1];
    }

    return opts;
}

function getAccessToken(opts) {
    if (opts.token) {
        return opts.token;
    }

    if (opts.storage) {
        const tokenPath = join(opts.storage, 'persist', 'AccessToken');
        try {
            return readFileSync(tokenPath, 'utf8').trim();
        } catch (e) {
            console.error(`Failed to read token from ${tokenPath}: ${e.message}`);
            process.exit(1);
        }
    }

    console.error('Must provide --token or --storage');
    process.exit(1);
}

async function getLiveView(accessToken, locationId, cameraSerial) {
    const url = `${KINESIS_URL_BASE}/cameras/${cameraSerial}/${locationId}/live-view`;
    console.log(`[API] Requesting live view: ${url}`);

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Live view API failed: ${response.status} ${response.statusText} - ${text.substring(0, 200)}`);
    }

    return response.json();
}

async function testKinesisConnection(accessToken, locationId, cameraSerial) {
    const startTime = Date.now();

    console.log('\n=== Kinesis WebRTC Test ===');
    console.log(`Location: ${locationId}`);
    console.log(`Camera: ${cameraSerial}`);
    console.log('');

    // Step 1: Get live view credentials
    console.log('[Step 1] Getting live view credentials...');
    const liveView = await getLiveView(accessToken, locationId, cameraSerial);
    console.log(`  ✓ Client ID: ${liveView.clientId}`);
    console.log(`  ✓ ICE servers: ${liveView.iceServers?.length || 0}`);
    console.log(`  ✓ Signaling URL: ${liveView.signedChannelEndpoint?.substring(0, 80)}...`);

    // Step 2: Create peer connection
    console.log('\n[Step 2] Creating RTCPeerConnection...');
    const iceServers = liveView.iceServers.map(server => ({
        urls: server.urls,
        username: server.username,
        credential: server.credential
    }));

    // Configure H264 codec - SimpliSafe outdoor cameras require H264, not VP8
    const pc = new RTCPeerConnection({
        iceServers,
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

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    // CRITICAL: Add data channel - camera requires this in SDP offer
    // Without it, camera responds with a=inactive instead of a=sendonly
    const dataChannel = pc.createDataChannel('kvsDataChannel');
    dataChannel.onopen = () => console.log('  Data channel opened');
    dataChannel.onclose = () => console.log('  Data channel closed');

    console.log('  ✓ Peer connection created with video/audio transceivers + data channel');

    // Step 3: Connect to signaling WebSocket
    console.log('\n[Step 3] Connecting to signaling WebSocket...');
    const ws = new WebSocket(liveView.signedChannelEndpoint);

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Connection timeout after 30s'));
        }, 30000);

        let localCandidates = 0;
        let remoteCandidates = 0;
        let videoTrackReceived = false;
        let audioTrackReceived = false;
        let rtpPackets = 0;

        function cleanup() {
            clearTimeout(timeout);
            try { ws.close(); } catch (e) {}
            try { pc.close(); } catch (e) {}
        }

        ws.on('error', (err) => {
            console.error(`  ✗ WebSocket error: ${err.message}`);
            cleanup();
            reject(err);
        });

        ws.on('open', async () => {
            console.log('  ✓ WebSocket connected');

            try {
                // Create and send offer
                console.log('\n[Step 4] Creating SDP offer...');
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                console.log(`  ✓ Offer created (${offer.sdp?.length || 0} bytes)`);

                // As VIEWER, we do NOT include recipientClientId
                // messagePayload must be Base64-encoded JSON (Kinesis WebRTC protocol)
                const offerPayload = JSON.stringify({
                    type: 'offer',
                    sdp: offer.sdp
                });
                const offerMessage = {
                    action: 'SDP_OFFER',
                    messagePayload: Buffer.from(offerPayload).toString('base64')
                };

                ws.send(JSON.stringify(offerMessage));
                console.log('  ✓ Offer sent to signaling server (Base64 encoded)');
            } catch (err) {
                console.error(`  ✗ Offer failed: ${err.message}`);
                cleanup();
                reject(err);
            }
        });

        pc.onicecandidate = ({ candidate }) => {
            if (candidate && ws.readyState === WebSocket.OPEN) {
                localCandidates++;
                // As VIEWER, we do NOT include recipientClientId
                // messagePayload must be Base64-encoded JSON
                const candidatePayload = JSON.stringify(candidate.toJSON());
                ws.send(JSON.stringify({
                    action: 'ICE_CANDIDATE',
                    messagePayload: Buffer.from(candidatePayload).toString('base64')
                }));
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`  ICE state: ${pc.iceConnectionState}`);
        };

        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            const elapsed = Date.now() - startTime;

            if (state === 'connected') {
                console.log(`\n[Step 6] WebRTC CONNECTED (${elapsed}ms)`);
                console.log(`  Local ICE candidates: ${localCandidates}`);
                console.log(`  Remote ICE candidates: ${remoteCandidates}`);

                // Wait a bit to collect some RTP packets
                setTimeout(() => {
                    console.log(`\n=== TEST RESULTS ===`);
                    console.log(`Total time: ${Date.now() - startTime}ms`);
                    console.log(`Video track: ${videoTrackReceived ? '✓' : '✗'}`);
                    console.log(`Audio track: ${audioTrackReceived ? '✓' : '✗'}`);
                    console.log(`RTP packets received: ${rtpPackets}`);
                    console.log(`Status: ${rtpPackets > 0 ? 'SUCCESS' : 'PARTIAL - no RTP data yet'}`);

                    cleanup();
                    resolve({ success: rtpPackets > 0, packets: rtpPackets });
                }, 3000);

            } else if (state === 'failed') {
                console.error(`  ✗ Connection failed after ${elapsed}ms`);
                cleanup();
                reject(new Error('WebRTC connection failed'));
            }
        };

        pc.ontrack = (event) => {
            const track = event.track;
            console.log(`\n[Step 5] Track received: ${track.kind}`);

            if (track.kind === 'video') {
                videoTrackReceived = true;
                track.onReceiveRtp.subscribe((rtp) => {
                    rtpPackets++;
                    if (rtpPackets === 1) {
                        console.log(`  ✓ First video RTP packet (${rtp.payload.length} bytes)`);
                    } else if (rtpPackets % 100 === 0) {
                        console.log(`  ... ${rtpPackets} packets received`);
                    }
                });
            } else if (track.kind === 'audio') {
                audioTrackReceived = true;
            }
        };

        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());

                if (message.messageType === 'SDP_ANSWER') {
                    // messagePayload is Base64-encoded JSON
                    const answerJson = Buffer.from(message.messagePayload, 'base64').toString('utf8');
                    const answer = JSON.parse(answerJson);
                    console.log(`  ✓ SDP answer received (${answer.sdp?.length || 0} bytes)`);
                    await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });

                } else if (message.messageType === 'ICE_CANDIDATE') {
                    // messagePayload is Base64-encoded JSON
                    const candidateJson = Buffer.from(message.messagePayload, 'base64').toString('utf8');
                    const candidate = JSON.parse(candidateJson);
                    if (candidate.candidate) {
                        remoteCandidates++;
                        await pc.addIceCandidate(candidate);
                    }
                }
            } catch (err) {
                console.error(`  ✗ Message error: ${err.message}`);
            }
        });
    });
}

async function main() {
    const opts = parseArgs();

    if (!opts.location || !opts.camera) {
        console.log('Usage:');
        console.log('  node scripts/test-kinesis.js --token <access_token> --location <location_id> --camera <camera_serial>');
        console.log('  node scripts/test-kinesis.js --storage ~/.homebridge --location <location_id> --camera <camera_serial>');
        process.exit(1);
    }

    const accessToken = getAccessToken(opts);

    try {
        await testKinesisConnection(accessToken, opts.location, opts.camera);
    } catch (err) {
        console.error(`\n✗ Test failed: ${err.message}`);
        process.exit(1);
    }
}

main();
