#!/usr/bin/env node
/**
 * Debug script for Kinesis WebRTC outdoor camera connections.
 * Tests the full connection flow and reports detailed diagnostics.
 *
 * Usage:
 *   node scripts/debug-kinesis.js --token <access_token> --location <location_id> --camera <camera_uuid>
 *
 * Or with Homebridge auth file:
 *   node scripts/debug-kinesis.js --auth /path/to/simplisafe3auth.json --location <location_id> --camera <camera_uuid>
 */

import { readFileSync } from 'fs';
import WebSocket from 'ws';
import { RTCPeerConnection, RTCRtpCodecParameters, useNACK, usePLI, useREMB } from 'werift';

const KINESIS_URL_BASE = 'https://app-hub.prd.aser.simplisafe.com/v2';
const TEST_DURATION_MS = 15000;

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {};

    for (let i = 0; i < args.length; i += 2) {
        const key = args[i]?.replace(/^--/, '');
        const value = args[i + 1];
        if (key && value) opts[key] = value;
    }

    return opts;
}

function getAccessToken(opts) {
    if (opts.token) {
        return opts.token;
    }

    if (opts.auth) {
        try {
            const authData = JSON.parse(readFileSync(opts.auth, 'utf8'));
            return authData.accessToken;
        } catch (e) {
            console.error(`Failed to read auth file ${opts.auth}: ${e.message}`);
            process.exit(1);
        }
    }

    console.error('Must provide --token or --auth');
    process.exit(1);
}

function printUsage() {
    console.log(`
Usage:
  node scripts/debug-kinesis.js --token <access_token> --location <location_id> --camera <camera_uuid>
  node scripts/debug-kinesis.js --auth /path/to/simplisafe3auth.json --location <location_id> --camera <camera_uuid>

Options:
  --token     SimpliSafe access token
  --auth      Path to simplisafe3auth.json file containing accessToken
  --location  SimpliSafe location/subscription ID
  --camera    Camera UUID (32 hex characters, not the short serial)

Example:
  node scripts/debug-kinesis.js --auth ~/.homebridge/simplisafe3auth.json --location 1234567 --camera abcd1234...
`);
}

async function debugKinesisConnection(accessToken, locationId, cameraUuid) {
    const startTime = Date.now();
    const elapsed = () => `${Date.now() - startTime}ms`;

    console.log('=== Kinesis WebRTC Debug ===\n');
    console.log(`Location: ${locationId}`);
    console.log(`Camera:   ${cameraUuid}`);
    console.log('');

    // Step 1: Get live view credentials
    console.log('[1] Fetching live view credentials...');
    const response = await fetch(`${KINESIS_URL_BASE}/cameras/${cameraUuid}/${locationId}/live-view`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        const text = await response.text();
        console.error(`    FAILED: ${response.status} ${response.statusText}`);
        console.error(`    ${text.substring(0, 200)}`);
        process.exit(1);
    }

    const liveView = await response.json();
    console.log(`    OK (${elapsed()})`);
    console.log(`    Client ID: ${liveView.clientId}`);
    console.log(`    ICE servers: ${liveView.iceServers?.length || 0}`);

    // Step 2: Create peer connection with H264 codec
    console.log('\n[2] Creating RTCPeerConnection...');
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

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    const dataChannel = pc.createDataChannel('kvsDataChannel');
    console.log('    OK - H264 codec, transceivers, data channel');

    // Track stats
    let videoRtp = 0;
    let audioRtp = 0;
    let localCandidates = 0;
    let remoteCandidates = 0;

    pc.ontrack = (event) => {
        const kind = event.track.kind;
        console.log(`\n>>> TRACK: ${kind} (${elapsed()})`);

        if (event.track.onReceiveRtp) {
            event.track.onReceiveRtp.subscribe((rtp) => {
                if (kind === 'video') {
                    videoRtp++;
                    if (videoRtp <= 5 || videoRtp % 100 === 0) {
                        console.log(`    VIDEO RTP #${videoRtp}: ${rtp.payload.length} bytes`);
                    }
                } else {
                    audioRtp++;
                    if (audioRtp <= 3) {
                        console.log(`    AUDIO RTP #${audioRtp}: ${rtp.payload.length} bytes`);
                    }
                }
            });
        }
    };

    pc.onconnectionstatechange = () => {
        console.log(`    Connection: ${pc.connectionState} (${elapsed()})`);
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`    ICE: ${pc.iceConnectionState} (${elapsed()})`);
    };

    // Step 3: Connect to signaling WebSocket
    console.log('\n[3] Connecting to signaling WebSocket...');
    const ws = new WebSocket(liveView.signedChannelEndpoint);

    return new Promise((resolve) => {
        ws.on('error', (err) => {
            console.error(`    WebSocket error: ${err.message}`);
        });

        ws.on('open', async () => {
            console.log(`    OK (${elapsed()})`);

            // Step 4: Create and send offer
            console.log('\n[4] Creating SDP offer...');
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            const codecLines = offer.sdp.match(/a=rtpmap:\d+ \S+/g) || [];
            console.log(`    Codecs: ${codecLines.slice(0, 3).join(', ')}`);
            console.log(`    Has data channel: ${offer.sdp.includes('webrtc-datachannel')}`);

            const offerPayload = JSON.stringify({ type: 'offer', sdp: offer.sdp });
            ws.send(JSON.stringify({
                action: 'SDP_OFFER',
                messagePayload: Buffer.from(offerPayload).toString('base64')
            }));
            console.log(`    Sent (${elapsed()})`);
        });

        ws.on('message', async (data) => {
            const dataStr = data.toString();
            if (!dataStr) return;

            try {
                const msg = JSON.parse(dataStr);

                if (msg.messageType === 'SDP_ANSWER') {
                    console.log(`\n[5] SDP answer received (${elapsed()})`);
                    const answerJson = Buffer.from(msg.messagePayload, 'base64').toString('utf8');
                    const answer = JSON.parse(answerJson);

                    // Analyze answer
                    const videoMatch = answer.sdp.match(/m=video[\s\S]*?(?=m=|$)/);
                    if (videoMatch) {
                        const section = videoMatch[0];
                        const hasSendonly = section.includes('a=sendonly');
                        const hasInactive = section.includes('a=inactive');
                        const codec = section.match(/a=rtpmap:\d+ (\S+)/)?.[1] || 'unknown';
                        console.log(`    Video codec: ${codec}`);
                        console.log(`    Direction: ${hasSendonly ? 'sendonly (OK)' : hasInactive ? 'inactive (PROBLEM!)' : 'unknown'}`);

                        if (hasInactive) {
                            console.log('\n    WARNING: Camera responded with a=inactive');
                            console.log('    This usually means codec mismatch or missing data channel');
                        }
                    }

                    await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
                    console.log('    Remote description set');

                } else if (msg.messageType === 'ICE_CANDIDATE') {
                    const candJson = Buffer.from(msg.messagePayload, 'base64').toString('utf8');
                    const cand = JSON.parse(candJson);
                    if (cand.candidate) {
                        remoteCandidates++;
                        await pc.addIceCandidate(cand);
                    }
                }
            } catch (e) {
                // Ignore parse errors
            }
        });

        pc.onicecandidate = ({ candidate }) => {
            if (candidate && ws.readyState === WebSocket.OPEN) {
                localCandidates++;
                const payload = JSON.stringify(candidate.toJSON());
                ws.send(JSON.stringify({
                    action: 'ICE_CANDIDATE',
                    messagePayload: Buffer.from(payload).toString('base64')
                }));
            }
        };

        setTimeout(() => {
            console.log(`\n=== RESULTS (${TEST_DURATION_MS / 1000}s) ===`);
            console.log(`Connection state: ${pc.connectionState}`);
            console.log(`ICE state: ${pc.iceConnectionState}`);
            console.log(`ICE candidates: ${localCandidates} local, ${remoteCandidates} remote`);
            console.log(`Video RTP packets: ${videoRtp}`);
            console.log(`Audio RTP packets: ${audioRtp}`);
            console.log('');

            if (videoRtp > 0 && pc.connectionState === 'connected') {
                console.log('STATUS: SUCCESS - Video streaming!');
            } else if (pc.connectionState === 'connected' && audioRtp > 0) {
                console.log('STATUS: PARTIAL - Audio only, no video');
                console.log('        Check codec configuration and data channel');
            } else if (pc.connectionState === 'connected') {
                console.log('STATUS: CONNECTED but no media');
            } else {
                console.log('STATUS: FAILED - Connection not established');
            }

            ws.close();
            pc.close();
            resolve({ videoRtp, audioRtp, state: pc.connectionState });
        }, TEST_DURATION_MS);
    });
}

async function main() {
    const opts = parseArgs();

    if (!opts.location || !opts.camera) {
        printUsage();
        process.exit(1);
    }

    if (opts.camera.length !== 32) {
        console.error(`ERROR: Camera UUID should be 32 hex characters, got ${opts.camera.length}`);
        console.error('       Use the full UUID, not the short serial');
        process.exit(1);
    }

    const accessToken = getAccessToken(opts);

    try {
        await debugKinesisConnection(accessToken, opts.location, opts.camera);
    } catch (err) {
        console.error(`\nFATAL: ${err.message}`);
        process.exit(1);
    }
}

main();
