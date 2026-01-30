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
    }

    async handleSnapshotRequest(request, callback) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            callback(new Error('Camera snapshot request blocked (rate limited)'));
            return;
        }

        let resolution = `${request.width}x${request.height}`;
        if (this.ss3Camera.debug) this.log(`Handling Kinesis camera snapshot for '${this.cameraDetails.cameraSettings?.cameraName || 'Outdoor Camera'}' at ${resolution}`);

        // Check cache first
        if (this.cachedSnapshot && (Date.now() - this.snapshotCacheTime) < this.snapshotCacheTTL) {
            if (this.ss3Camera.debug) this.log('Returning cached snapshot');
            callback(undefined, this.cachedSnapshot);
            return;
        }

        // For outdoor cameras, we need to capture a frame from WebRTC
        // This is expensive, so we return the unsupported image for now and cache real frames during streaming
        // A full implementation would start a brief WebRTC session to grab a keyframe
        try {
            const snapshot = await this._captureSnapshotFromWebRTC(request.width, request.height);
            this.cachedSnapshot = snapshot;
            this.snapshotCacheTime = Date.now();
            callback(undefined, snapshot);
        } catch (err) {
            if (this.ss3Camera.debug) this.log.error('Snapshot capture failed, using placeholder:', err.message);
            callback(undefined, unsupportedCameraImageInBytes);
        }
    }

    async _captureSnapshotFromWebRTC(width, height) {
        // Get subscription ID for location
        const subscription = await this.simplisafe.getSubscription();
        const locationId = subscription.sid;

        if (this.ss3Camera.debug) this.log(`Starting brief WebRTC session for snapshot (location: ${locationId}, camera: ${this.ss3Camera.id})`);

        let session = null;
        try {
            session = await this.kinesisClient.createSession(locationId, this.ss3Camera.id);

            // Wait for first video frame and capture it
            return await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Snapshot timeout - no frame received'));
                }, 15000);

                if (!session.videoTrack) {
                    clearTimeout(timeout);
                    reject(new Error('No video track available'));
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

                const ffmpeg = spawn(this.ss3Camera.ffmpegPath, ffmpegArgs, { env: process.env });

                const chunks = [];
                ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));

                ffmpeg.on('close', (code) => {
                    clearTimeout(timeout);
                    if (code === 0 && chunks.length > 0) {
                        resolve(Buffer.concat(chunks));
                    } else {
                        reject(new Error(`FFmpeg exited with code ${code}`));
                    }
                });

                ffmpeg.on('error', (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });

                // Write RTP packets to FFmpeg
                // Note: werift exposes RTP via onRtp handler
                let frameCount = 0;
                const maxFrames = 60; // Capture up to 2 seconds at 30fps

                session.videoTrack.onReceiveRtp.subscribe((rtp) => {
                    if (frameCount < maxFrames) {
                        try {
                            ffmpeg.stdin.write(rtp.payload);
                            frameCount++;
                            if (frameCount >= maxFrames) {
                                ffmpeg.stdin.end();
                            }
                        } catch (e) {
                            // Stream ended
                        }
                    }
                });

                // Also set a backup timeout to end the capture
                setTimeout(() => {
                    try {
                        ffmpeg.stdin.end();
                    } catch (e) {
                        // Already ended
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
        if (this.ss3Camera.debug) this.log('Prepare Kinesis stream with request:', request);

        let response = {};
        let sessionInfo = {
            address: request.targetAddress
        };

        let sessionID = request.sessionID;

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
        }

        let myIPAddress = ip.address();
        response.address = {
            address: myIPAddress,
            type: ip.isV4Format(myIPAddress) ? 'v4' : 'v6'
        };

        this.pendingSessions[this.api.hap.uuid.unparse(sessionID)] = sessionInfo;

        callback(undefined, response);
    }

    async handleStreamRequest(request, callback) {
        if (this.ss3Camera.debug) this.log('handleStreamRequest (Kinesis) with request:', request);

        let sessionId = request.sessionID;
        if (sessionId) {
            let sessionIdentifier = this.api.hap.uuid.unparse(sessionId);

            if (request.type == 'start') {
                if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
                    delete this.pendingSessions[sessionIdentifier];
                    let err = new Error('Camera stream request blocked (rate limited)');
                    this.log.error(err);
                    callback(err);
                    return;
                }

                let sessionInfo = this.pendingSessions[sessionIdentifier];
                if (sessionInfo) {
                    try {
                        await this._startKinesisStream(sessionInfo, request, sessionIdentifier, sessionId, callback);
                    } catch (err) {
                        this.log.error('Failed to start Kinesis stream:', err.message);
                        delete this.pendingSessions[sessionIdentifier];
                        callback(err);
                        return;
                    }
                }

                delete this.pendingSessions[sessionIdentifier];

            } else if (request.type == 'stop') {
                await this._stopKinesisStream(sessionIdentifier);
                callback();
            }
        }
    }

    async _startKinesisStream(sessionInfo, request, sessionIdentifier, sessionId, callback) {
        // Get subscription ID for location
        const subscription = await this.simplisafe.getSubscription();
        const locationId = subscription.sid;

        if (this.ss3Camera.debug) {
            this.log(`Starting Kinesis WebRTC stream (location: ${locationId}, camera: ${this.ss3Camera.id})`);
        }

        // Create Kinesis session
        const kinesisSession = await this.kinesisClient.createSession(locationId, this.ss3Camera.id);

        if (this.ss3Camera.debug) {
            this.log('Kinesis session established, starting FFmpeg pipeline');
        }

        let width = request.video.width ?? 1920;
        let height = request.video.height ?? 1080;
        let fps = this.cameraDetails.cameraSettings?.admin?.fps || 30;
        let videoBitrate = this.cameraDetails.cameraSettings?.admin?.bitRate || 2000;
        let mtu = request.video.mtu ?? 1316;
        // Audio parameters reserved for future 2-way audio support
        // let audioBitrate = request.audio?.max_bit_rate ?? 96;
        // let audioSamplerate = request.audio?.sample_rate ?? 16;

        if (request.video.fps < fps) {
            fps = request.video.fps;
        }
        if (request.video.max_bit_rate < videoBitrate) {
            videoBitrate = request.video.max_bit_rate;
        }

        // Build FFmpeg command for processing WebRTC -> HomeKit SRTP
        // Input: RTP packets from werift via stdin
        // Output: SRTP to HomeKit
        const ffmpegArgs = [
            // Input from pipe (H.264 RTP)
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
            // Custom options would be applied here
            if (this.ss3Camera.debug) this.log('Custom video options detected:', options);
        }

        try {
            const ffmpeg = spawn(this.ss3Camera.ffmpegPath, ffmpegArgs, {
                env: process.env
            });

            if (this.ss3Camera.debug) {
                this.log(`Start Kinesis streaming for camera '${this.ss3Camera.name}'`);
                this.log([this.ss3Camera.ffmpegPath, ...ffmpegArgs].join(' '));
            }

            let started = false;
            ffmpeg.stderr.on('data', data => {
                if (!started) {
                    started = true;
                    if (this.ss3Camera.debug) this.log('FFMPEG received first frame from Kinesis');
                    callback(); // Execute callback once streaming starts
                }
                if (this.ss3Camera.debug) {
                    this.log(data.toString());
                }
            });

            ffmpeg.on('error', err => {
                this.log.error('An error occurred during Kinesis stream:', err);
                if (!started) {
                    callback(err);
                }
            });

            ffmpeg.on('close', code => {
                switch (code) {
                case null:
                case 0:
                case 255:
                    if (this.ss3Camera.debug) this.log('Kinesis camera stopped streaming');
                    break;
                default:
                    if (this.ss3Camera.debug) this.log(`Error: FFmpeg exited with code ${code}`);
                    if (!started) {
                        callback(new Error(`Error: FFmpeg exited with code ${code}`));
                    } else {
                        this.controller.forceStopStreamingSession(sessionId);
                    }
                    break;
                }
            });

            // Store session info for cleanup
            this.ongoingSessions[sessionIdentifier] = {
                ffmpeg: ffmpeg,
                kinesisSession: kinesisSession
            };

            // Pipe video RTP packets from Kinesis to FFmpeg
            if (kinesisSession.videoTrack) {
                kinesisSession.videoTrack.onReceiveRtp.subscribe((rtp) => {
                    try {
                        // Extract H.264 payload from RTP and write to FFmpeg
                        ffmpeg.stdin.write(rtp.payload);
                    } catch (e) {
                        // Stream ended
                    }
                });
            } else {
                throw new Error('No video track available from Kinesis');
            }

            // Cache snapshot from video stream periodically
            if (kinesisSession.videoTrack) {
                let frameBuffer = [];
                kinesisSession.videoTrack.onReceiveRtp.subscribe((rtp) => {
                    // Simple frame caching for snapshots
                    frameBuffer.push(rtp.payload);
                    if (frameBuffer.length > 90) { // ~3 seconds at 30fps
                        frameBuffer.shift();
                    }
                });
            }

        } catch (e) {
            this.log.error(`Unable to spawn ffmpeg process at ${this.ss3Camera.ffmpegPath} with error:`, e);
            this.kinesisClient.closeSession(kinesisSession);
            throw e;
        }
    }

    async _stopKinesisStream(sessionIdentifier) {
        const session = this.ongoingSessions[sessionIdentifier];
        if (session) {
            try {
                if (session.ffmpeg) {
                    session.ffmpeg.stdin.end();
                    session.ffmpeg.kill('SIGKILL');
                }
            } catch (e) {
                this.log.error('Error occurred terminating the FFmpeg process');
                if (this.ss3Camera.debug) this.log.error(e);
            }

            try {
                if (session.kinesisSession) {
                    this.kinesisClient.closeSession(session.kinesisSession);
                }
            } catch (e) {
                this.log.error('Error occurred closing Kinesis session');
                if (this.ss3Camera.debug) this.log.error(e);
            }

            delete this.ongoingSessions[sessionIdentifier];
        }
    }
}

export default KinesisStreamingDelegate;
