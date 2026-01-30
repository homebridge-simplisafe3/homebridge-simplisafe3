#!/usr/bin/env node
/**
 * Test script for LiveKit (MIST) camera connections.
 * Back Yard camera uses LiveKit instead of Kinesis WebRTC.
 */

import { Room, RoomEvent, TrackKind, VideoStream, dispose } from '@livekit/rtc-node';

const LIVEKIT_URL = 'wss://livestream.services.simplisafe.com:7880';

// Get token from command line or environment
const token = process.argv[2] || process.env.LIVEKIT_TOKEN;

if (!token) {
    console.error('Usage: node test-livekit.js <livekit_token>');
    console.error('Get token from: curl -s "https://app-hub.prd.aser.simplisafe.com/v2/cameras/{uuid}/{locationId}/live-view" -H "Authorization: Bearer {accessToken}"');
    process.exit(1);
}

async function main() {
    console.log('=== LiveKit Camera Test ===\n');
    console.log(`URL: ${LIVEKIT_URL}`);
    console.log(`Token: ${token.substring(0, 50)}...`);
    console.log('');

    const room = new Room();
    let videoTrack = null;
    let videoStream = null;

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        console.log(`Track subscribed: ${track.kind} from ${participant.identity}`);

        if (track.kind === TrackKind.KIND_VIDEO) {
            console.log('Video track received!');
            videoTrack = track;

            // Try to create VideoStream
            try {
                videoStream = new VideoStream(track);
                console.log('VideoStream created');

                // Process frames
                (async () => {
                    let frameCount = 0;
                    for await (const event of videoStream) {
                        frameCount++;
                        if (frameCount <= 5 || frameCount % 30 === 0) {
                            console.log(`Frame #${frameCount}: ${event.frame.width}x${event.frame.height}`);
                        }
                        if (frameCount >= 100) {
                            console.log('Received 100 frames, stopping...');
                            break;
                        }
                    }
                })();
            } catch (e) {
                console.error('VideoStream error:', e.message);
            }
        }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
        console.log(`Track unsubscribed: ${track.kind}`);
    });

    room.on(RoomEvent.Disconnected, (reason) => {
        console.log(`Disconnected: ${reason}`);
    });

    room.on(RoomEvent.ParticipantConnected, (participant) => {
        console.log(`Participant connected: ${participant.identity}`);
    });

    try {
        console.log('Connecting to room...');
        await room.connect(LIVEKIT_URL, token, { autoSubscribe: true });
        console.log(`Connected! Room: ${room.name}`);
        console.log(`Local participant: ${room.localParticipant?.identity}`);
        console.log(`Remote participants: ${room.remoteParticipants?.size || 0}`);

        // List existing participants and tracks
        for (const [id, participant] of room.remoteParticipants || []) {
            console.log(`  Participant: ${participant.identity}`);
            for (const [trackSid, pub] of participant.trackPublications || []) {
                console.log(`    Track: ${pub.kind} - ${pub.trackName} (subscribed: ${pub.subscribed})`);
            }
        }

        // Wait for 30 seconds
        console.log('\nWaiting 30 seconds for video...');
        await new Promise(resolve => setTimeout(resolve, 30000));

    } catch (e) {
        console.error('Connection error:', e.message);
    } finally {
        console.log('\nDisconnecting...');
        if (videoStream) await videoStream.close();
        await room.disconnect();
        await dispose();
        console.log('Done');
    }
}

main().catch(console.error);
