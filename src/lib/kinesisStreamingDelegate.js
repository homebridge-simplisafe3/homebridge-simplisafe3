/*global Buffer, process */
import { spawn } from 'child_process';
import crypto from 'crypto';
import ip from 'ip';
import path from 'path';
import fs from 'fs';

import KinesisClient from './kinesisClient';

const unsupportedCameraImage = path.resolve(__dirname, '..', 'images', 'unsupportedcamera_snapshot.png');
const unsupportedCameraImageInBytes = fs.readFileSync(unsupportedCameraImage);

/**
 * Streaming delegate for SimpliSafe outdoor cameras using Kinesis WebRTC
 */
class KinesisStreamingDelegate {
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

        // Create Kinesis client
        this.kinesisClient = new KinesisClient(
            ss3Camera.authManager,
            this.log,
            ss3Camera.debug
        );

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

        this.log(`[KinesisDelegate] Initialized for camera '${this.cameraDetails.cameraSettings?.cameraName || ss3Camera.name}'`);
        if (this.ss3Camera.debug) {
            this.log(`[KinesisDelegate]   Model: ${this.cameraDetails.model}`);
            this.log(`[KinesisDelegate]   Resolution: ${resolution}`);
            this.log(`[KinesisDelegate]   FPS: ${fps}`);
        }
    }

    async handleSnapshotRequest(request, callback) {
        const startTime = Date.now();
        const cameraName = this.cameraDetails.cameraSettings?.cameraName || 'Outdoor Camera';

        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            this.log.error(`[KinesisDelegate] Snapshot blocked (rate limited) for '${cameraName}'`);
            callback(new Error('Camera snapshot request blocked (rate limited)'));
            return;
        }

        const resolution = `${request.width}x${request.height}`;
        this.log(`[KinesisDelegate] Snapshot requested for '${cameraName}' at ${resolution}`);

        // Check cache first
        if (this.cachedSnapshot && (Date.now() - this.snapshotCacheTime) < this.snapshotCacheTTL) {
            const cacheAge = Math.round((Date.now() - this.snapshotCacheTime) / 1000);
            if (this.ss3Camera.debug) {
                this.log(`[KinesisDelegate] Returning cached snapshot (age: ${cacheAge}s, size: ${Math.round(this.cachedSnapshot.length / 1024)}KB)`);
            }
            callback(undefined, this.cachedSnapshot);
            return;
        }

        // For outdoor cameras, we need to capture a frame from WebRTC
        try {
            if (this.ss3Camera.debug) {
                this.log('[KinesisDelegate] Cache miss, starting WebRTC session for snapshot');
            }
            const snapshot = await this._captureSnapshotFromWebRTC(request.width, request.height);
            this.cachedSnapshot = snapshot;
            this.snapshotCacheTime = Date.now();
            this.log(`[KinesisDelegate] Snapshot captured in ${Date.now() - startTime}ms (size: ${Math.round(snapshot.length / 1024)}KB)`);
            callback(undefined, snapshot);
        } catch (err) {
            this.log.error(`[KinesisDelegate] Snapshot capture failed after ${Date.now() - startTime}ms: ${err.message}`);
            if (this.ss3Camera.debug) {
                this.log.error('[KinesisDelegate]   Using placeholder image instead');
            }
            callback(undefined, unsupportedCameraImageInBytes);
        }
    }

    async _captureSnapshotFromWebRTC(width, height) {
        const startTime = Date.now();

        // Get subscription ID for location
        const subscription = await this.simplisafe.getSubscription();
        const locationId = subscription.sid;

        if (this.ss3Camera.debug) {
            this.log('[KinesisDelegate] Starting WebRTC snapshot session');
            this.log(`[KinesisDelegate]   Location: ${locationId}`);
            this.log(`[KinesisDelegate]   Camera: ${this.ss3Camera.id}`);
            this.log(`[KinesisDelegate]   Target size: ${width}x${height}`);
        }

        let session = null;
        try {
            session = await this.kinesisClient.createSession(locationId, this.ss3Camera.id);

            if (this.ss3Camera.debug) {
                this.log(`[KinesisDelegate] WebRTC session established in ${Date.now() - startTime}ms`);
            }

            // Wait for first video frame and capture it
            return await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Snapshot timeout - no frame received within 15s'));
                }, 15000);

                if (!session.videoTrack) {
                    clearTimeout(timeout);
                    reject(new Error('No video track available from Kinesis session'));
                    return;
                }

                // Use FFmpeg to capture a single frame from the RTP stream
                const ffmpegArgs = [
                    '-f', 'rawvideo',
                    '-pix_fmt', 'yuv420p',
                    '-video_size', `${width}x${height}`,
                    '-i', 'pipe:0',
                    '-vframes', '1',
                    '-f', 'mjpeg',
                    '-q:v', '5',
                    'pipe:1'
                ];

                if (this.ss3Camera.debug) {
                    this.log(`[KinesisDelegate] Spawning FFmpeg for snapshot: ${this.ss3Camera.ffmpegPath} ${ffmpegArgs.join(' ')}`);
                }

                const ffmpeg = spawn(this.ss3Camera.ffmpegPath, ffmpegArgs, { env: process.env });

                const chunks = [];
                let rtpPacketCount = 0;
                let bytesWritten = 0;

                ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));

                ffmpeg.stderr.on('data', (data) => {
                    if (this.ss3Camera.debug) {
                        this.log(`[KinesisDelegate] FFmpeg snapshot stderr: ${data.toString().trim()}`);
                    }
                });

                ffmpeg.on('close', (code) => {
                    clearTimeout(timeout);
                    if (this.ss3Camera.debug) {
                        this.log(`[KinesisDelegate] Snapshot FFmpeg closed (code: ${code}, packets: ${rtpPacketCount}, bytes: ${bytesWritten})`);
                    }
                    if (code === 0 && chunks.length > 0) {
                        resolve(Buffer.concat(chunks));
                    } else {
                        reject(new Error(`FFmpeg snapshot exited with code ${code} (packets: ${rtpPacketCount})`));
                    }
                });

                ffmpeg.on('error', (err) => {
                    clearTimeout(timeout);
                    this.log.error(`[KinesisDelegate] FFmpeg snapshot error: ${err.message}`);
                    reject(err);
                });

                // Write RTP packets to FFmpeg
                const maxFrames = 60; // Capture up to 2 seconds at 30fps

                session.videoTrack.onReceiveRtp.subscribe((rtp) => {
                    if (rtpPacketCount < maxFrames) {
                        try {
                            ffmpeg.stdin.write(rtp.payload);
                            bytesWritten += rtp.payload.length;
                            rtpPacketCount++;
                            if (rtpPacketCount >= maxFrames) {
                                if (this.ss3Camera.debug) {
                                    this.log(`[KinesisDelegate] Snapshot reached ${maxFrames} packets, closing input`);
                                }
                                ffmpeg.stdin.end();
                            }
                        } catch (e) {
                            // Stream ended
                        }
                    }
                });

                // Backup timeout to end the capture
                setTimeout(() => {
                    if (rtpPacketCount > 0) {
                        try {
                            ffmpeg.stdin.end();
                        } catch (e) {
                            // Already ended
                        }
                    }
                }, 3000);
            });
        } finally {
            if (session) {
                this.kinesisClient.closeSession(session);
            }
        }
    }

    prepareStream(request, callback) {
        const sessionID = request.sessionID;
        const sessionIdentifier = this.api.hap.uuid.unparse(sessionID);

        this.log(`[KinesisDelegate] Preparing stream session ${sessionIdentifier.substring(0, 8)}...`);

        if (this.ss3Camera.debug) {
            this.log(`[KinesisDelegate]   Target address: ${request.targetAddress}`);
            if (request.video) {
                this.log(`[KinesisDelegate]   Video port: ${request.video.port}`);
                this.log(`[KinesisDelegate]   Video MTU: ${request.video.mtu || 'default'}`);
            }
            if (request.audio) {
                this.log(`[KinesisDelegate]   Audio port: ${request.audio.port}`);
            }
        }

        let response = {};
        let sessionInfo = {
            address: request.targetAddress
        };

        if (request.video) {
            let ssrcSource = crypto.randomBytes(4);
            ssrcSource[0] = 0;
            let ssrc = ssrcSource.readInt32BE(0, true);

            response.video = {
                port: request.video.port,
                ssrc: ssrc,
                srtp_key: request.video.srtp_key,
                srtp_salt: request.video.srtp_salt
            };

            sessionInfo.video_port = request.video.port;
            sessionInfo.video_srtp = Buffer.concat([
                request.video.srtp_key,
                request.video.srtp_salt
            ]);
            sessionInfo.video_ssrc = ssrc;

            if (this.ss3Camera.debug) {
                this.log(`[KinesisDelegate]   Video SSRC: ${ssrc}`);
            }
        }

        if (request.audio) {
            let ssrcSource = crypto.randomBytes(4);
            ssrcSource[0] = 0;
            let ssrc = ssrcSource.readInt32BE(0, true);

            response.audio = {
                port: request.audio.port,
                ssrc: ssrc,
                srtp_key: request.audio.srtp_key,
                srtp_salt: request.audio.srtp_salt
            };

            sessionInfo.audio_port = request.audio.port;
            sessionInfo.audio_srtp = Buffer.concat([
                request.audio.srtp_key,
                request.audio.srtp_salt
            ]);
            sessionInfo.audio_ssrc = ssrc;

            if (this.ss3Camera.debug) {
                this.log(`[KinesisDelegate]   Audio SSRC: ${ssrc}`);
            }
        }

        let myIPAddress = ip.address();
        response.address = {
            address: myIPAddress,
            type: ip.isV4Format(myIPAddress) ? 'v4' : 'v6'
        };

        if (this.ss3Camera.debug) {
            this.log(`[KinesisDelegate]   Local address: ${myIPAddress}`);
        }

        this.pendingSessions[sessionIdentifier] = sessionInfo;

        this.log('[KinesisDelegate] Stream prepared, waiting for start request');
        callback(undefined, response);
    }

    async handleStreamRequest(request, callback) {
        const sessionId = request.sessionID;
        if (!sessionId) {
            this.log.error('[KinesisDelegate] Stream request missing session ID');
            callback(new Error('Missing session ID'));
            return;
        }

        const sessionIdentifier = this.api.hap.uuid.unparse(sessionId);
        const shortId = sessionIdentifier.substring(0, 8);

        if (request.type === 'start') {
            this.log(`[KinesisDelegate] Starting stream session ${shortId}...`);

            if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
                delete this.pendingSessions[sessionIdentifier];
                const waitTime = Math.round((this.simplisafe.nextAttempt - Date.now()) / 1000);
                this.log.error(`[KinesisDelegate] Stream blocked (rate limited, retry in ${waitTime}s)`);
                callback(new Error('Camera stream request blocked (rate limited)'));
                return;
            }

            const sessionInfo = this.pendingSessions[sessionIdentifier];
            if (!sessionInfo) {
                this.log.error(`[KinesisDelegate] No pending session found for ${shortId}`);
                callback(new Error('Session not found'));
                return;
            }

            try {
                await this._startKinesisStream(sessionInfo, request, sessionIdentifier, sessionId, callback);
            } catch (err) {
                this.log.error(`[KinesisDelegate] Stream start failed for ${shortId}: ${err.message}`);
                delete this.pendingSessions[sessionIdentifier];
                callback(err);
                return;
            }

            delete this.pendingSessions[sessionIdentifier];

        } else if (request.type === 'stop') {
            this.log(`[KinesisDelegate] Stopping stream session ${shortId}...`);
            await this._stopKinesisStream(sessionIdentifier);
            callback();

        } else if (request.type === 'reconfigure') {
            if (this.ss3Camera.debug) {
                this.log(`[KinesisDelegate] Reconfigure request for ${shortId} (ignored)`);
            }
            callback();
        }
    }

    async _startKinesisStream(sessionInfo, request, sessionIdentifier, sessionId, callback) {
        const startTime = Date.now();
        const shortId = sessionIdentifier.substring(0, 8);

        // Get subscription ID for location
        const subscription = await this.simplisafe.getSubscription();
        const locationId = subscription.sid;

        this.log(`[KinesisDelegate] Establishing WebRTC connection for session ${shortId}`);
        if (this.ss3Camera.debug) {
            this.log(`[KinesisDelegate]   Location: ${locationId}`);
            this.log(`[KinesisDelegate]   Camera: ${this.ss3Camera.id}`);
        }

        // Create Kinesis session
        const kinesisSession = await this.kinesisClient.createSession(locationId, this.ss3Camera.id);

        const webrtcTime = Date.now() - startTime;
        this.log(`[KinesisDelegate] WebRTC connected in ${webrtcTime}ms, starting FFmpeg pipeline`);

        let width = request.video.width ?? 1920;
        let height = request.video.height ?? 1080;
        let fps = this.cameraDetails.cameraSettings?.admin?.fps || 30;
        let videoBitrate = this.cameraDetails.cameraSettings?.admin?.bitRate || 2000;
        let mtu = request.video.mtu ?? 1316;

        if (request.video.fps < fps) {
            fps = request.video.fps;
        }
        if (request.video.max_bit_rate < videoBitrate) {
            videoBitrate = request.video.max_bit_rate;
        }

        if (this.ss3Camera.debug) {
            this.log('[KinesisDelegate] Stream parameters:');
            this.log(`[KinesisDelegate]   Resolution: ${width}x${height}`);
            this.log(`[KinesisDelegate]   FPS: ${fps}`);
            this.log(`[KinesisDelegate]   Bitrate: ${videoBitrate}kbps`);
            this.log(`[KinesisDelegate]   MTU: ${mtu}`);
            this.log(`[KinesisDelegate]   Target: srtp://${sessionInfo.address}:${sessionInfo.video_port}`);
        }

        // Build FFmpeg command for processing WebRTC -> HomeKit SRTP
        const ffmpegArgs = [
            // Input from pipe (H.264 RTP payload)
            '-f', 'h264',
            '-i', 'pipe:0',

            // Video output
            '-map', '0:v',
            '-vcodec', 'libx264',
            '-tune', 'zerolatency',
            '-preset', 'superfast',
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

        // Apply custom video options if provided
        if (this.cameraOptions?.videoOptions) {
            let options = (typeof this.cameraOptions.videoOptions === 'string')
                ? Object.fromEntries(this.cameraOptions.videoOptions.split('-').filter(x => x).map(arg => '-' + arg).map(a => a.split(' ').filter(x => x)))
                : this.cameraOptions.videoOptions;
            if (this.ss3Camera.debug) {
                this.log(`[KinesisDelegate] Custom video options: ${JSON.stringify(options)}`);
            }
        }

        try {
            if (this.ss3Camera.debug) {
                this.log('[KinesisDelegate] FFmpeg command:');
                this.log(`[KinesisDelegate]   ${this.ss3Camera.ffmpegPath} ${ffmpegArgs.join(' ')}`);
            }

            const ffmpeg = spawn(this.ss3Camera.ffmpegPath, ffmpegArgs, {
                env: process.env
            });

            // Track RTP statistics
            let rtpPacketCount = 0;
            let rtpByteCount = 0;
            let lastStatsTime = Date.now();
            let lastPacketCount = 0;

            // Log stats periodically
            const statsInterval = setInterval(() => {
                if (rtpPacketCount > 0) {
                    const elapsed = (Date.now() - lastStatsTime) / 1000;
                    const packetsPerSecond = Math.round((rtpPacketCount - lastPacketCount) / elapsed);
                    const totalKB = Math.round(rtpByteCount / 1024);

                    if (this.ss3Camera.debug) {
                        this.log(`[KinesisDelegate] Stream stats: ${rtpPacketCount} packets (${packetsPerSecond}/s), ${totalKB}KB total`);
                    }

                    lastStatsTime = Date.now();
                    lastPacketCount = rtpPacketCount;
                }
            }, 10000);

            let started = false;
            let ffmpegOutput = '';

            ffmpeg.stderr.on('data', data => {
                const output = data.toString();
                ffmpegOutput += output;

                // Keep only last 2KB of output for error reporting
                if (ffmpegOutput.length > 2048) {
                    ffmpegOutput = ffmpegOutput.substring(ffmpegOutput.length - 2048);
                }

                if (!started) {
                    started = true;
                    const totalTime = Date.now() - startTime;
                    this.log(`[KinesisDelegate] Stream started for session ${shortId} (total: ${totalTime}ms, WebRTC: ${webrtcTime}ms)`);
                    callback();
                }

                if (this.ss3Camera.debug) {
                    // Log FFmpeg output but filter out repetitive frame info
                    const lines = output.split('\n').filter(l => l.trim() && !l.includes('frame='));
                    lines.forEach(line => {
                        if (line.trim()) {
                            this.log(`[KinesisDelegate] FFmpeg: ${line.trim()}`);
                        }
                    });
                }
            });

            ffmpeg.on('error', err => {
                clearInterval(statsInterval);
                this.log.error(`[KinesisDelegate] FFmpeg error for session ${shortId}: ${err.message}`);
                if (!started) {
                    callback(err);
                }
            });

            ffmpeg.on('close', code => {
                clearInterval(statsInterval);
                const duration = Math.round((Date.now() - startTime) / 1000);

                if (code === null || code === 0 || code === 255) {
                    this.log(`[KinesisDelegate] Stream ended for session ${shortId} (duration: ${duration}s, packets: ${rtpPacketCount})`);
                } else {
                    this.log.error(`[KinesisDelegate] FFmpeg exited with code ${code} for session ${shortId}`);
                    this.log.error(`[KinesisDelegate]   Duration: ${duration}s`);
                    this.log.error(`[KinesisDelegate]   Packets received: ${rtpPacketCount}`);
                    this.log.error('[KinesisDelegate]   Last FFmpeg output:');
                    ffmpegOutput.split('\n').slice(-5).forEach(line => {
                        if (line.trim()) {
                            this.log.error(`[KinesisDelegate]     ${line.trim()}`);
                        }
                    });

                    if (!started) {
                        callback(new Error(`FFmpeg exited with code ${code}`));
                    } else {
                        this.controller.forceStopStreamingSession(sessionId);
                    }
                }
            });

            // Store session info for cleanup
            this.ongoingSessions[sessionIdentifier] = {
                ffmpeg: ffmpeg,
                kinesisSession: kinesisSession,
                statsInterval: statsInterval,
                startTime: startTime
            };

            // Pipe video RTP packets from Kinesis to FFmpeg
            if (kinesisSession.videoTrack) {
                if (this.ss3Camera.debug) {
                    this.log('[KinesisDelegate] Subscribing to video track RTP packets');
                }

                kinesisSession.videoTrack.onReceiveRtp.subscribe((rtp) => {
                    try {
                        ffmpeg.stdin.write(rtp.payload);
                        rtpPacketCount++;
                        rtpByteCount += rtp.payload.length;

                        // Log first packet
                        if (rtpPacketCount === 1 && this.ss3Camera.debug) {
                            this.log(`[KinesisDelegate] First RTP packet received (${rtp.payload.length} bytes)`);
                        }
                    } catch (e) {
                        // Stream ended - this is normal when stopping
                        if (this.ss3Camera.debug && rtpPacketCount < 10) {
                            this.log(`[KinesisDelegate] RTP write error after ${rtpPacketCount} packets: ${e.message}`);
                        }
                    }
                });
            } else {
                this.log.error('[KinesisDelegate] No video track available from Kinesis session');
                throw new Error('No video track available from Kinesis');
            }

        } catch (e) {
            this.log.error(`[KinesisDelegate] Failed to start FFmpeg: ${e.message}`);
            if (this.ss3Camera.debug) {
                this.log.error(`[KinesisDelegate]   FFmpeg path: ${this.ss3Camera.ffmpegPath}`);
            }
            this.kinesisClient.closeSession(kinesisSession);
            throw e;
        }
    }

    async _stopKinesisStream(sessionIdentifier) {
        const shortId = sessionIdentifier.substring(0, 8);
        const session = this.ongoingSessions[sessionIdentifier];

        if (!session) {
            if (this.ss3Camera.debug) {
                this.log(`[KinesisDelegate] No active session found for ${shortId}`);
            }
            return;
        }

        const duration = session.startTime ? Math.round((Date.now() - session.startTime) / 1000) : 0;
        this.log(`[KinesisDelegate] Stopping session ${shortId} (duration: ${duration}s)`);

        // Clear stats interval
        if (session.statsInterval) {
            clearInterval(session.statsInterval);
        }

        // Stop FFmpeg
        if (session.ffmpeg) {
            try {
                if (this.ss3Camera.debug) {
                    this.log('[KinesisDelegate] Terminating FFmpeg process');
                }
                session.ffmpeg.stdin.end();
                session.ffmpeg.kill('SIGTERM');

                // Force kill after 2 seconds if still running
                setTimeout(() => {
                    try {
                        session.ffmpeg.kill('SIGKILL');
                    } catch (e) {
                        // Already dead
                    }
                }, 2000);
            } catch (e) {
                this.log.error(`[KinesisDelegate] Error terminating FFmpeg: ${e.message}`);
            }
        }

        // Close Kinesis session
        if (session.kinesisSession) {
            try {
                this.kinesisClient.closeSession(session.kinesisSession);
            } catch (e) {
                this.log.error(`[KinesisDelegate] Error closing Kinesis session: ${e.message}`);
            }
        }

        delete this.ongoingSessions[sessionIdentifier];
        this.log(`[KinesisDelegate] Session ${shortId} stopped`);
    }
}

export default KinesisStreamingDelegate;
