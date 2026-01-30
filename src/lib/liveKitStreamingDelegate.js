/**
 * LiveKit Streaming Delegate for SimpliSafe Cameras
 *
 * This module handles video streaming for SimpliSafe cameras that use the MIST
 * (LiveKit) WebRTC provider instead of AWS Kinesis Video Streams.
 *
 * SimpliSafe uses two WebRTC providers for outdoor cameras:
 * - KVS (Kinesis Video Streams): Handled by kinesisStreamingDelegate.js
 * - MIST (LiveKit): Handled by this file
 *
 * The provider is determined by cameraDetails.currentState.webrtcProvider
 *
 * LiveKit Connection Flow:
 * 1. Request live-view credentials from SimpliSafe API
 * 2. API returns LiveKit URL and JWT token for the camera's room
 * 3. Connect to LiveKit room using @livekit/rtc-node SDK
 * 4. Subscribe to video track from camera participant
 * 5. Receive I420 (YUV420P) video frames via VideoStream
 * 6. Pipe frames to FFmpeg for transcoding to HomeKit SRTP
 *
 * Key differences from Kinesis:
 * - LiveKit SDK handles all WebRTC complexity (no manual SDP/ICE)
 * - Decoded video frames are received directly (no RTP depacketization needed)
 * - Frames are in I420 format, not H264 NAL units
 */

/*global Buffer, process */
import { spawn } from 'child_process';
import crypto from 'crypto';
import ip from 'ip';
import path from 'path';
import fs from 'fs';

import { Room, RoomEvent, TrackKind, VideoStream, dispose } from '@livekit/rtc-node';

// SimpliSafe's LiveKit server endpoint
const LIVEKIT_URL = 'wss://livestream.services.simplisafe.com:7880';

const unsupportedCameraImage = path.resolve(__dirname, '..', 'images', 'unsupportedcamera_snapshot.png');
const unsupportedCameraImageInBytes = fs.readFileSync(unsupportedCameraImage);

/**
 * Streaming delegate for SimpliSafe cameras using LiveKit (MIST provider)
 */
class LiveKitStreamingDelegate {
    constructor(ss3Camera) {
        this.ss3Camera = ss3Camera;
        this.simplisafe = ss3Camera.simplisafe;
        this.log = ss3Camera.log;
        this.api = ss3Camera.api;
        this.cameraOptions = ss3Camera.cameraOptions;
        this.cameraDetails = ss3Camera.cameraDetails;

        this.pendingSessions = {};
        this.ongoingSessions = {};

        // Snapshot cache
        this.cachedSnapshot = null;
        this.snapshotCacheTime = 0;
        this.snapshotCacheTTL = 60000; // 1 minute cache

        let fps = this.cameraDetails.cameraSettings?.admin?.fps || 30;
        let streamingOptions = {
            supportedCryptoSuites: [this.api.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
            video: {
                resolutions: [
                    [320, 240, fps],
                    [320, 240, 15],
                    [320, 180, fps],
                    [320, 180, 15],
                    [480, 360, fps],
                    [480, 270, fps],
                    [640, 480, fps],
                    [640, 360, fps],
                    [1280, 720, fps],
                    [1920, 1080, fps]
                ],
                codec: {
                    profiles: [this.api.hap.H264Profile.BASELINE, this.api.hap.H264Profile.MAIN, this.api.hap.H264Profile.HIGH],
                    levels: [this.api.hap.H264Level.LEVEL3_1, this.api.hap.H264Level.LEVEL3_2, this.api.hap.H264Level.LEVEL4_0],
                }
            },
            audio: {
                codecs: [
                    {
                        type: this.api.hap.AudioStreamingCodecType.OPUS,
                        samplerate: this.api.hap.AudioStreamingSamplerate.KHZ_16
                    }
                ]
            }
        };

        let resolution = this.cameraDetails.cameraSettings?.pictureQuality || '1080p';
        let maxSupportedHeight = +(resolution.split('p')[0]);
        streamingOptions.video.resolutions = streamingOptions.video.resolutions.filter(r => r[1] <= maxSupportedHeight);

        const cameraController = new this.api.hap.CameraController({
            cameraStreamCount: 2,
            delegate: this,
            streamingOptions: streamingOptions
        });

        this.controller = cameraController;

        if (this.ss3Camera.debug) {
            this.log(`[LiveKitDelegate] Initialized: camera='${this.cameraDetails.cameraSettings?.cameraName || ss3Camera.name}' model=${this.cameraDetails.model} resolution=${resolution} fps=${fps}`);
        }
    }

    async handleSnapshotRequest(request, callback) {
        const startTime = Date.now();
        const cameraName = this.cameraDetails.cameraSettings?.cameraName || 'Camera';

        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            this.log.error(`[LiveKitDelegate] Snapshot blocked (rate limited) for '${cameraName}'`);
            callback(new Error('Camera snapshot request blocked (rate limited)'));
            return;
        }

        const resolution = `${request.width}x${request.height}`;
        this.log(`[LiveKitDelegate] Snapshot requested for '${cameraName}' at ${resolution}`);

        // Check cache first
        if (this.cachedSnapshot && (Date.now() - this.snapshotCacheTime) < this.snapshotCacheTTL) {
            const cacheAge = Math.round((Date.now() - this.snapshotCacheTime) / 1000);
            if (this.ss3Camera.debug) {
                this.log(`[LiveKitDelegate] Returning cached snapshot (age: ${cacheAge}s, size: ${Math.round(this.cachedSnapshot.length / 1024)}KB)`);
            }
            callback(undefined, this.cachedSnapshot);
            return;
        }

        try {
            if (this.ss3Camera.debug) {
                this.log('[LiveKitDelegate] Cache miss, starting LiveKit session for snapshot');
            }
            const snapshot = await this._captureSnapshotFromLiveKit(request.width, request.height);
            this.cachedSnapshot = snapshot;
            this.snapshotCacheTime = Date.now();
            this.log(`[LiveKitDelegate] Snapshot captured in ${Date.now() - startTime}ms (size: ${Math.round(snapshot.length / 1024)}KB)`);
            callback(undefined, snapshot);
        } catch (err) {
            this.log.error(`[LiveKitDelegate] Snapshot capture failed after ${Date.now() - startTime}ms: ${err.message} (using placeholder)`);
            callback(undefined, unsupportedCameraImageInBytes);
        }
    }

    async _captureSnapshotFromLiveKit(width, height) {
        const token = await this._getLiveKitToken();

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Snapshot timeout - no frame received within 15s'));
            }, 15000);

            const room = new Room();
            let resolved = false;

            room.on(RoomEvent.TrackSubscribed, async (track, publication, participant) => {
                if (resolved || track.kind !== TrackKind.KIND_VIDEO) return;

                try {
                    const videoStream = new VideoStream(track);

                    // Get first frame
                    for await (const event of videoStream) {
                        if (resolved) break;

                        const frame = event.frame;
                        if (this.ss3Camera.debug) {
                            this.log(`[LiveKitDelegate] Snapshot frame: ${frame.width}x${frame.height}`);
                        }

                        // Convert frame to JPEG using FFmpeg
                        const jpeg = await this._frameToJpeg(frame, width, height);

                        resolved = true;
                        clearTimeout(timeout);
                        await room.disconnect();
                        resolve(jpeg);
                        break;
                    }
                } catch (e) {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        await room.disconnect();
                        reject(e);
                    }
                }
            });

            room.connect(LIVEKIT_URL, token, { autoSubscribe: true }).catch(err => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(err);
                }
            });
        });
    }

    async _frameToJpeg(frame, targetWidth, targetHeight) {
        return new Promise((resolve, reject) => {
            // LiveKit VideoFrame provides RGBA or I420 data
            const format = frame.type; // e.g., 'I420', 'RGBA'
            const width = frame.width;
            const height = frame.height;

            let inputFormat, pixFmt;
            if (format === 'RGBA' || format === 'BGRA') {
                inputFormat = 'rawvideo';
                pixFmt = format.toLowerCase();
            } else {
                // Default to I420/YUV420P
                inputFormat = 'rawvideo';
                pixFmt = 'yuv420p';
            }

            const ffmpegArgs = [
                '-f', inputFormat,
                '-pix_fmt', pixFmt,
                '-s', `${width}x${height}`,
                '-i', 'pipe:0',
                '-vframes', '1',
                '-vf', `scale=${targetWidth}:${targetHeight}`,
                '-f', 'mjpeg',
                '-q:v', '5',
                'pipe:1'
            ];

            const ffmpeg = spawn(this.ss3Camera.ffmpegPath, ffmpegArgs, { env: process.env });
            const chunks = [];

            ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
            ffmpeg.stderr.on('data', () => {}); // Ignore stderr

            ffmpeg.on('close', code => {
                if (code === 0 && chunks.length > 0) {
                    resolve(Buffer.concat(chunks));
                } else {
                    reject(new Error(`FFmpeg snapshot exited with code ${code}`));
                }
            });

            ffmpeg.on('error', reject);

            // Write frame data
            const buffer = frame.data;
            ffmpeg.stdin.write(Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength));
            ffmpeg.stdin.end();
        });
    }

    async _getLiveKitToken() {
        const subscription = await this.simplisafe.getSubscription();
        const locationId = subscription.sid;
        const cameraUuid = this.cameraDetails.uuid;

        const accessToken = this.ss3Camera.authManager.accessToken;

        const response = await fetch(
            `https://app-hub.prd.aser.simplisafe.com/v2/cameras/${cameraUuid}/${locationId}/live-view`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        if (!response.ok) {
            throw new Error(`Failed to get LiveKit token: ${response.status}`);
        }

        const data = await response.json();

        if (!data.liveKitDetails?.userToken) {
            throw new Error('No LiveKit token in response');
        }

        return data.liveKitDetails.userToken;
    }

    async prepareStream(request, callback) {
        const sessionIdentifier = request.sessionID;
        const shortId = sessionIdentifier.substring(0, 8);

        if (this.ss3Camera.debug) {
            this.log(`[LiveKitDelegate] Preparing stream session ${shortId}...`);
            this.log(`[LiveKitDelegate] Target: ${request.targetAddress} video=${request.video.port}(mtu:${request.video.mtu || 'default'}) audio=${request.audio.port}`);
        }

        const videoInfo = {
            address: request.targetAddress,
            video_port: request.video.port,
            video_srtp: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
            video_ssrc: this.api.hap.CameraController.generateSynchronisationSource(),
            audio_port: request.audio.port,
            audio_srtp: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
            audio_ssrc: this.api.hap.CameraController.generateSynchronisationSource()
        };

        this.pendingSessions[sessionIdentifier] = videoInfo;

        const currentAddress = ip.address('public', request.addressVersion);

        if (this.ss3Camera.debug) {
            this.log(`[LiveKitDelegate] Prepared: local=${currentAddress} videoSSRC=${videoInfo.video_ssrc} audioSSRC=${videoInfo.audio_ssrc}`);
        }

        const response = {
            address: currentAddress,
            video: {
                port: request.video.port,
                ssrc: videoInfo.video_ssrc,
                srtp_key: request.video.srtp_key,
                srtp_salt: request.video.srtp_salt
            },
            audio: {
                port: request.audio.port,
                ssrc: videoInfo.audio_ssrc,
                srtp_key: request.audio.srtp_key,
                srtp_salt: request.audio.srtp_salt
            }
        };

        if (this.ss3Camera.debug) {
            this.log('[LiveKitDelegate] Stream prepared, waiting for start request');
        }

        callback(undefined, response);
    }

    async handleStreamRequest(request, callback) {
        const sessionIdentifier = request.sessionID;
        const shortId = sessionIdentifier.substring(0, 8);

        switch (request.type) {
            case this.api.hap.StreamRequestTypes.START:
                this.log(`[LiveKitDelegate] Starting stream session ${shortId}...`);
                await this._startLiveKitStream(sessionIdentifier, request);
                callback();
                break;

            case this.api.hap.StreamRequestTypes.RECONFIGURE:
                if (this.ss3Camera.debug) {
                    this.log(`[LiveKitDelegate] Reconfigure request for session ${shortId}`);
                }
                callback();
                break;

            case this.api.hap.StreamRequestTypes.STOP:
                this.log(`[LiveKitDelegate] Stopping stream session ${shortId}...`);
                await this._stopLiveKitStream(sessionIdentifier);
                callback();
                break;
        }
    }

    async _startLiveKitStream(sessionIdentifier, request) {
        const shortId = sessionIdentifier.substring(0, 8);
        const sessionInfo = this.pendingSessions[sessionIdentifier];

        if (!sessionInfo) {
            this.log.error(`[LiveKitDelegate] No pending session found for ${shortId}`);
            return;
        }

        delete this.pendingSessions[sessionIdentifier];

        const startTime = Date.now();

        // Get LiveKit token
        let token;
        try {
            token = await this._getLiveKitToken();
        } catch (e) {
            this.log.error(`[LiveKitDelegate] Failed to get LiveKit token: ${e.message}`);
            return;
        }

        // Stream parameters
        let width = request.video.width ?? 1920;
        let height = request.video.height ?? 1080;
        let fps = this.cameraDetails.cameraSettings?.admin?.fps || 30;
        let videoBitrate = this.cameraDetails.cameraSettings?.admin?.bitRate || 2000;
        let mtu = request.video.mtu ?? 1316;

        if (request.video.fps < fps) fps = request.video.fps;
        if (request.video.max_bit_rate < videoBitrate) videoBitrate = request.video.max_bit_rate;

        if (this.ss3Camera.debug) {
            this.log(`[LiveKitDelegate] Stream: ${width}x${height}@${fps}fps bitrate=${videoBitrate}kbps mtu=${mtu}`);
        }

        // Build FFmpeg command - LiveKit gives us I420 (YUV420P) frames
        const ffmpegArgs = [
            '-f', 'rawvideo',
            '-pix_fmt', 'yuv420p',   // LiveKit VideoFrame is I420/YUV420P
            '-s', '1920x1080',       // LiveKit source resolution
            '-r', String(fps),
            '-i', 'pipe:0',

            '-map', '0:v',
            '-vcodec', 'libx264',
            '-tune', 'zerolatency',
            '-preset', 'ultrafast',
            '-pix_fmt', 'yuv420p',
            '-r', String(fps),
            '-vf', `scale=${width}:${height}`,
            '-b:v', `${videoBitrate}k`,
            '-bufsize', `${2 * videoBitrate}k`,
            '-maxrate', `${videoBitrate}k`,
            '-payload_type', '99',
            '-ssrc', String(sessionInfo.video_ssrc),
            '-f', 'rtp',
            '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
            '-srtp_out_params', sessionInfo.video_srtp.toString('base64'),
            `srtp://${sessionInfo.address}:${sessionInfo.video_port}?rtcpport=${sessionInfo.video_port}&localrtcpport=${sessionInfo.video_port}&pkt_size=${mtu}`
        ];

        const room = new Room();
        let ffmpeg = null;
        let frameCount = 0;
        let byteCount = 0;
        let videoStream = null;

        try {
            if (this.ss3Camera.debug) {
                this.log(`[LiveKitDelegate] Connecting to LiveKit room...`);
            }

            await room.connect(LIVEKIT_URL, token, { autoSubscribe: true });

            if (this.ss3Camera.debug) {
                this.log(`[LiveKitDelegate] Connected to room: ${room.name}`);
            }

            // Spawn FFmpeg
            ffmpeg = spawn(this.ss3Camera.ffmpegPath, ffmpegArgs, { env: process.env });

            ffmpeg.stderr.on('data', (data) => {
                const msg = data.toString().trim();
                if (this.ss3Camera.debug && (msg.includes('error') || msg.includes('Error') || frameCount < 3)) {
                    this.log(`[LiveKitDelegate] FFmpeg: ${msg}`);
                }
            });

            ffmpeg.on('close', (code) => {
                if (this.ss3Camera.debug) {
                    this.log(`[LiveKitDelegate] FFmpeg closed (code: ${code}, frames: ${frameCount})`);
                }
            });

            // Handle video track subscription
            room.on(RoomEvent.TrackSubscribed, async (track, publication, participant) => {
                if (track.kind !== TrackKind.KIND_VIDEO) return;

                if (this.ss3Camera.debug) {
                    this.log(`[LiveKitDelegate] Video track subscribed from ${participant.identity}`);
                }

                videoStream = new VideoStream(track);

                // Process frames
                try {
                    for await (const event of videoStream) {
                        const frame = event.frame;

                        // Pass I420/YUV420P frame data to FFmpeg
                        const frameBuffer = this._frameToI420Buffer(frame);

                        if (frameBuffer && ffmpeg.stdin.writable) {
                            ffmpeg.stdin.write(frameBuffer);
                            frameCount++;
                            byteCount += frameBuffer.length;

                            if (frameCount === 1 && this.ss3Camera.debug) {
                                this.log(`[LiveKitDelegate] First frame written (${frame.width}x${frame.height}, type=${frame.type}, ${frameBuffer.length} bytes)`);
                            }
                        }
                    }
                } catch (e) {
                    if (this.ss3Camera.debug) {
                        this.log(`[LiveKitDelegate] VideoStream ended: ${e.message}`);
                    }
                }
            });

            // Store session
            this.ongoingSessions[sessionIdentifier] = {
                room,
                ffmpeg,
                videoStream,
                startTime,
                frameCount: () => frameCount,
                byteCount: () => byteCount
            };

            // Stats logging
            const statsInterval = setInterval(() => {
                if (this.ss3Camera.debug) {
                    this.log(`[LiveKitDelegate] Stream stats: ${frameCount} frames, ${Math.round(byteCount / 1024)}KB total`);
                }
            }, 10000);

            this.ongoingSessions[sessionIdentifier].statsInterval = statsInterval;

            this.log(`[LiveKitDelegate] Stream started for session ${shortId}`);

        } catch (e) {
            this.log.error(`[LiveKitDelegate] Failed to start stream: ${e.message}`);
            if (ffmpeg) ffmpeg.kill('SIGTERM');
            await room.disconnect();
        }
    }

    _frameToI420Buffer(frame) {
        // LiveKit VideoFrame provides I420 (YUV420P) data
        // Just pass it directly to FFmpeg
        try {
            const data = frame.data;
            if (data instanceof Buffer) {
                return data;
            } else if (data.buffer) {
                return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
            } else {
                return Buffer.from(data);
            }
        } catch (e) {
            return null;
        }
    }

    async _stopLiveKitStream(sessionIdentifier) {
        const shortId = sessionIdentifier.substring(0, 8);
        const session = this.ongoingSessions[sessionIdentifier];

        if (!session) {
            if (this.ss3Camera.debug) {
                this.log(`[LiveKitDelegate] No active session found for ${shortId}`);
            }
            return;
        }

        const duration = session.startTime ? Math.round((Date.now() - session.startTime) / 1000) : 0;
        this.log(`[LiveKitDelegate] Stopping session ${shortId} (duration: ${duration}s)`);

        // Clear stats interval
        if (session.statsInterval) {
            clearInterval(session.statsInterval);
        }

        // Stop FFmpeg
        if (session.ffmpeg) {
            try {
                if (this.ss3Camera.debug) {
                    this.log('[LiveKitDelegate] Terminating FFmpeg process');
                }
                session.ffmpeg.stdin.end();
                session.ffmpeg.kill('SIGTERM');
            } catch (e) {
                // Ignore errors during cleanup
            }
        }

        // Disconnect from LiveKit
        if (session.room) {
            try {
                await session.room.disconnect();
            } catch (e) {
                // Ignore errors during cleanup
            }
        }

        delete this.ongoingSessions[sessionIdentifier];
        this.log(`[LiveKitDelegate] Session ${shortId} stopped`);
    }
}

export default LiveKitStreamingDelegate;
