import { spawn } from 'child_process';
import jpegExtract from 'jpeg-extract';
import crypto from 'crypto';
import dns from 'dns';
import { promisify } from 'util';
import isDocker from 'is-docker';
import { localIPv4Address } from './network';
import path from 'path';
import fs from 'fs';
import dgram from 'dgram';
import { SrtpSession, ProtectionProfileAes128CmHmacSha1_80 } from 'werift';

import LiveKitSource from './liveKitSource';
import KeyframeCollector from './h264';

const dnsLookup = promisify(dns.lookup);

const videoPayloadType = 99;
const audioPayloadType = 110;
const snapshotCacheTime = 60000; // ms
const prepareTimeout = 20000; // ms, give up on a prepared session HomeKit never started
const keyframeTimeout = 15000; // ms, waiting for a keyframe to build a snapshot from

const privacyShutterImage = path.resolve(__dirname, '..', 'images', 'privacyshutter_snapshot.png');
const privacyShutterImageInBytes = fs.readFileSync(privacyShutterImage);
const unsupportedCameraImage = path.resolve(__dirname, '..', 'images', 'unsupportedcamera_snapshot.png');
const unsupportedCameraImageInBytes = fs.readFileSync(unsupportedCameraImage);

class StreamingDelegate {
    constructor(ss3Camera) {
        this.ss3Camera = ss3Camera;
        this.simplisafe = ss3Camera.simplisafe;
        this.log = ss3Camera.log;
        this.api = ss3Camera.api;
        this.cameraOptions = ss3Camera.cameraOptions;
        this.cameraDetails = ss3Camera.cameraDetails;

        this.pendingSessions = {};
        this.ongoingSessions = {};
        this.liveKitSessions = {};
        this.cachedSnapshot = null;
        this.cachedSnapshotExpires = 0;
        this.snapshotBusy = false;
        this.snapshotWarming = null;

        let fps = this.cameraDetails.cameraSettings.admin.fps;
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
                        type: this.api.hap.AudioStreamingCodecType.AAC_ELD,
                        samplerate: this.api.hap.AudioStreamingSamplerate.KHZ_16
                    }
                ]
            }
        };

        // LiveKit cameras publish Opus already, so ask HomeKit for it and forward the RTP
        if (this.ss3Camera.getStreamProvider() === 'livekit') {
            streamingOptions.audio.codecs = [
                {
                    type: this.api.hap.AudioStreamingCodecType.OPUS,
                    samplerate: this.api.hap.AudioStreamingSamplerate.KHZ_24
                }
            ];
        }

        // Series 2 doorbell is square, offer matching resolutions alongside the 4:3 / 16:9 defaults
        if (this.cameraDetails.supportedFeatures && this.cameraDetails.supportedFeatures.aspectRatio === '1:1') {
            streamingOptions.video.resolutions.push([640, 640, fps], [960, 960, fps], [1280, 1280, fps], [1536, 1536, fps]);
        }

        let resolution = this.cameraDetails.cameraSettings.pictureQuality;
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
        if (this.ss3Camera.debug) this.log(`Handling camera snapshot for '${this.cameraDetails.cameraSettings.cameraName}' at ${resolution}`);

        if (this.ss3Camera.getStreamProvider() === 'livekit') {
            this.handleLiveKitSnapshotRequest(callback);
            return;
        }

        if (this.ss3Camera.isUnsupported()) {
            this.handleUnsupportedCameraSnapshotRequest(callback);
            return;
        }

        if (!this.ss3Camera.motionIsTriggered && this.ss3Camera.supportsPrivacyShutter()) {
            // Because if privacy shutter is closed we dont want snapshots triggering it to open
            let alarmSystem = await this.simplisafe.getAlarmSystem();
            switch (alarmSystem.alarmState) {
            case 'OFF':
                if (this.cameraDetails.cameraSettings.shutterOff !== 'open') {
                    this.handlePrivacyShutterClosedSnapshotRequest(callback);
                    return;
                }
                break;

            case 'HOME':
                if (this.cameraDetails.cameraSettings.shutterHome !== 'open') {
                    this.handlePrivacyShutterClosedSnapshotRequest(callback);
                    return;
                }
                break;

            case 'AWAY':
                if (this.cameraDetails.cameraSettings.shutterAway !== 'open') {
                    this.handlePrivacyShutterClosedSnapshotRequest(callback);
                    return;
                }
                break;
            }
        }

        try {
            let newIpAddress = await dnsLookup('media.simplisafe.com');
            this.serverIpAddress = newIpAddress.address;
        } catch (err) {
            if (!this.serverIpAddress) {
                this.log.error('Could not resolve hostname for media.simplisafe.com');
            }
        }

        const url = {
            url: `https://${this.serverIpAddress}/v1/${this.ss3Camera.cameraDetails.uuid}/mjpg?x=${request.width}&fr=1`,
            headers: {
                'Authorization': `Bearer ${this.ss3Camera.authManager.accessToken}`
            },
            rejectUnauthorized: false // OK because we are using IP and just polled DNS
        };

        jpegExtract(url).then(img => {
            if (this.ss3Camera.debug) this.log(`Closed '${this.cameraDetails.cameraSettings.cameraName}' snapshot request with ${Math.round(img.length/1000)}kB image`);
            callback(undefined, img);
        }).catch(err => {
            this.log.error('An error occurred while making snapshot request:', err.statusCode ? err.statusCode : '', err.statusMessage ? err.statusMessage : '');
            if (this.ss3Camera.debug) this.log.error(err);
            callback(err);
        });
    }

    handlePrivacyShutterClosedSnapshotRequest(callback) {
        if (this.ss3Camera.debug) this.log(`Camera snapshot request ignored, '${this.cameraDetails.cameraSettings.cameraName}' privacy shutter closed`);
        callback(undefined, privacyShutterImageInBytes);
    }

    handleUnsupportedCameraSnapshotRequest(callback) {
        if (this.ss3Camera.debug) this.log(`Camera snapshot request ignored, '${this.cameraDetails.cameraSettings.cameraName}' is not supported`);
        callback(undefined, unsupportedCameraImageInBytes);
    }

    prepareStream(request, callback) {
        if (this.ss3Camera.debug) this.log('Prepare stream with request:', request);
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

        response.address = {
            address: localIPv4Address(),
            type: 'v4'
        };

        let sessionIdentifier = this.api.hap.uuid.unparse(sessionID);

        // Join now, the handshake takes several seconds which is too slow to run inside handleStreamRequest
        if (this.ss3Camera.getStreamProvider() === 'livekit') {
            sessionInfo.liveKitSource = new LiveKitSource(this.ss3Camera);
            sessionInfo.liveKitReady = sessionInfo.liveKitSource.connect();
            sessionInfo.liveKitReady.catch(() => {}); // handled in handleStreamRequest

            // HomeKit does not always follow up with a 'start', don't hold the room open waiting
            sessionInfo.prepareTimeoutID = setTimeout(() => {
                if (this.pendingSessions[sessionIdentifier] !== sessionInfo) return;
                delete this.pendingSessions[sessionIdentifier];
                sessionInfo.liveKitSource.close();
                if (this.ss3Camera.debug) this.log(`Closed LiveKit session for '${this.ss3Camera.name}' that was prepared but never started`);
            }, prepareTimeout);
        }

        this.pendingSessions[sessionIdentifier] = sessionInfo;

        callback(undefined, response);
    }

    async handleStreamRequest(request, callback) {
        if (this.ss3Camera.debug) this.log('handleStreamRequest with request:', request);

        if (this.ss3Camera.getStreamProvider() === 'livekit' && request.type == 'start') {
            let sessionIdentifier = this.api.hap.uuid.unparse(request.sessionID);
            let sessionInfo = this.pendingSessions[sessionIdentifier];
            delete this.pendingSessions[sessionIdentifier];

            if (!sessionInfo) {
                callback(new Error('No pending session for stream start'));
                return;
            }

            this.startLiveKitStream(request, sessionIdentifier, sessionInfo, callback);
            return;
        }

        if (this.ss3Camera.isUnsupported()) {
            let err = new Error(`Camera ${this.ss3Camera.name} is unsupported`);
            this.log.error(err);
            callback(err);
            return;
        }

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
                    let width = request.video.width ?? 1920;
                    let fps = this.cameraDetails.cameraSettings.admin.fps;
                    let videoBitrate = this.cameraDetails.cameraSettings.admin.bitRate;
                    let audioBitrate = request.audio.max_bit_rate ?? 96;
                    let audioSamplerate = request.audio.sample_rate ?? 16;
                    let mtu = request.video.mtu ?? 1316;

                    if (request.video.fps < fps) {
                        fps = request.video.fps;
                    }
                    if (request.video.max_bit_rate < videoBitrate) {
                        videoBitrate = request.video.max_bit_rate;
                    }

                    try {
                        let newIpAddress = await dnsLookup('media.simplisafe.com');
                        this.serverIpAddress = newIpAddress.address;
                    } catch (err) {
                        if (!this.serverIpAddress) {
                            delete this.pendingSessions[sessionIdentifier];
                            this.log.error('Camera stream request failed, could not resolve hostname for media.simplisafe.com', err);
                            callback(err);
                            return;
                        }
                    }

                    let sourceArgs = [
                        ['-re'],
                        ['-headers', `Authorization: Bearer ${this.ss3Camera.authManager.accessToken}`],
                        ['-i', `https://${this.serverIpAddress}/v1/${this.ss3Camera.cameraDetails.uuid}/flv?x=${width}&audioEncoding=AAC`]
                    ];

                    let videoArgs = [
                        ['-map', '0:0'],
                        ['-vcodec', 'libx264'],
                        ['-tune', 'zerolatency'],
                        ['-preset', 'superfast'],
                        ['-pix_fmt', 'yuv420p'],
                        ['-r', fps],
                        ['-f', 'rawvideo'],
                        ['-vf', `scale=${width}:-2`],
                        ['-b:v', `${videoBitrate}k`],
                        ['-bufsize', `${2*videoBitrate}k`],
                        ['-maxrate', `${videoBitrate}k`],
                        ['-payload_type', 99],
                        ['-ssrc', sessionInfo.video_ssrc],
                        ['-f', 'rtp'],
                        ['-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80'],
                        ['-srtp_out_params', sessionInfo.video_srtp.toString('base64')],
                        [`srtp://${sessionInfo.address}:${sessionInfo.video_port}?rtcpport=${sessionInfo.video_port}&localrtcpport=${sessionInfo.video_port}&pkt_size=${mtu}`]
                    ];

                    let audioArgs = [
                        ['-map', '0:1'],
                        ['-acodec', 'libfdk_aac'],
                        ['-flags', '+global_header'],
                        ['-profile:a', 'aac_eld'],
                        ['-ac', '1'],
                        ['-ar', `${audioSamplerate}k`],
                        ['-b:a', `${audioBitrate}k`],
                        ['-bufsize', `${2*audioBitrate}k`],
                        ['-payload_type', 110],
                        ['-ssrc', sessionInfo.audio_ssrc],
                        ['-f', 'rtp'],
                        ['-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80'],
                        ['-srtp_out_params', sessionInfo.audio_srtp.toString('base64')],
                        [`srtp://${sessionInfo.address}:${sessionInfo.audio_port}?rtcpport=${sessionInfo.audio_port}&localrtcpport=${sessionInfo.audio_port}&pkt_size=188`]
                    ];

                    if (isDocker() && (!this.ss3Camera.cameraOptions || !this.ss3Camera.cameraOptions.ffmpegPath)) { // if docker and no custom binary specified
                        if (this.ss3Camera.debug) this.log('Detected running in docker container with bundled binary, limiting to 720px wide');
                        width = Math.min(width, 720);
                        let vFilterArg = videoArgs.find(arg => arg[0] == '-vf');
                        vFilterArg[1] = `scale=${width}:-2`;
                    }

                    if (request.audio && request.audio.codec == 'OPUS') {
                        // Request is for OPUS codec, serve that
                        let iArg = sourceArgs.find(arg => arg[0] == '-i');
                        iArg[1] = iArg[1].replace('&audioEncoding=AAC', '');
                        let aCodecArg = audioArgs.find(arg => arg[0] == '-acodec');
                        aCodecArg[1] = 'libopus';
                        let profileArg = audioArgs.find(arg => arg[0] == '-profile:a');
                        audioArgs.splice(audioArgs.indexOf(profileArg), 1);
                    }

                    if (this.ss3Camera.cameraOptions) {
                        if (this.ss3Camera.cameraOptions.enableHwaccelRpi) {
                            let iArg = sourceArgs.find(arg => arg[0] == '-i');
                            sourceArgs.splice(sourceArgs.indexOf(iArg), 0, ['-vcodec', 'h264_mmal']);
                            let vCodecArg = videoArgs.find(arg => arg[0] == '-vcodec');
                            vCodecArg[1] = 'h264_omx';
                            videoArgs = videoArgs.filter(arg => arg[0] !== '-tune');
                            videoArgs = videoArgs.filter(arg => arg[0] !== '-preset');
                        }

                        if (this.ss3Camera.cameraOptions.sourceOptions) {
                            let options = (typeof this.ss3Camera.cameraOptions.sourceOptions === 'string') ? Object.fromEntries(this.ss3Camera.cameraOptions.sourceOptions.split('-').filter(x => x).map(arg => '-' + arg).map(a => a.split(' ').filter(x => x)))
                                : this.ss3Camera.cameraOptions.sourceOptions; // support old config schema
                            for (let key in options) {
                                let value = options[key];
                                let existingArg = sourceArgs.find(arg => arg[0] === key);
                                if (existingArg) {
                                    if (value === false) {
                                        sourceArgs = sourceArgs.filter(arg => arg[0] !== key);
                                    } else {
                                        existingArg[1] = options[key];
                                    }
                                } else {
                                    sourceArgs.unshift([key, options[key]]);
                                }
                            }
                        }

                        if (this.ss3Camera.cameraOptions.videoOptions) {
                            let options = (typeof this.ss3Camera.cameraOptions.videoOptions === 'string') ? Object.fromEntries(this.ss3Camera.cameraOptions.videoOptions.split('-').filter(x => x).map(arg => '-' + arg).map(a => a.split(' ').filter(x => x)))
                                : this.ss3Camera.cameraOptions.videoOptions; // support old config schema
                            for (let key in options) {
                                let value = options[key];
                                let existingArg = videoArgs.find(arg => arg[0] === key);
                                if (existingArg) {
                                    if (value === false) {
                                        videoArgs = videoArgs.filter(arg => arg[0] !== key);
                                    } else {
                                        existingArg[1] = options[key];
                                    }
                                } else {
                                    videoArgs.push([key, options[key]]);
                                }
                            }
                        }

                        if (this.ss3Camera.cameraOptions.audioOptions) {
                            let options = (typeof this.ss3Camera.cameraOptions.audioOptions === 'string') ? Object.fromEntries(this.ss3Camera.cameraOptions.audioOptions.split('-').filter(x => x).map(arg => '-' + arg).map(a => a.split(' ').filter(x => x)))
                                : this.ss3Camera.cameraOptions.audioOptions; // support old config schema
                            for (let key in options) {
                                let value = options[key];
                                let existingArg = audioArgs.find(arg => arg[0] === key);
                                if (existingArg) {
                                    if (value === false) {
                                        audioArgs = audioArgs.filter(arg => arg[0] !== key);
                                    } else {
                                        existingArg[1] = options[key];
                                    }
                                } else {
                                    audioArgs.push([key, options[key]]);
                                }
                            }
                        }
                    }

                    let source = [].concat(...sourceArgs.map(arg => arg.map(a => typeof a == 'string' ? a.trim() : a)));
                    let video = [].concat(...videoArgs.map(arg => arg.map(a => typeof a == 'string' ? a.trim() : a)));
                    let audio = [].concat(...audioArgs.map(arg => arg.map(a => typeof a == 'string' ? a.trim() : a)));

                    try {
                        let cmd = spawn(this.ss3Camera.ffmpegPath, [
                            ...source,
                            ...video,
                            ...audio
                        ], {
                            env: process.env
                        });
    
                        if (this.ss3Camera.debug) {
                            this.log(`Start streaming video for camera '${this.ss3Camera.name}'`);
                            this.log([this.ss3Camera.ffmpegPath, source.join(' '), video.join(' '), audio.join(' ')].join(' '));
                        }
    
                        let started = false;
                        cmd.stderr.on('data', data => {
                            if (!started) {
                                started = true;
                                if (this.ss3Camera.debug) this.log('FFMPEG received first frame');
                                callback(); // do not forget to execute callback once set up
                            }
                            if (this.ss3Camera.debug) {
                                this.log(data.toString());
                            }
                        });
    
                        cmd.on('error', err => {
                            this.log.error('An error occurred while making stream request:', err);
                            callback(err);
                        });
    
                        cmd.on('close', code => {
                            switch (code) {
                            case null:
                            case 0:
                            case 255:
                                if (this.ss3Camera.debug) this.log('Camera stopped streaming');
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
    
                        this.ongoingSessions[sessionIdentifier] = cmd;
                    } catch (e) {
                        this.log.error(`Unable to spawn ffmpeg process at ${this.ss3Camera.ffmpegPath} with error:`, e);
                        callback(e);
                    }
                }

                delete this.pendingSessions[sessionIdentifier];

            } else if (request.type == 'stop') {
                let cmd = this.ongoingSessions[sessionIdentifier];
                try {
                    if (cmd) {
                        cmd.kill('SIGKILL');
                    }
                } catch (e) {
                    this.log.error('Error occurred terminating the video process!');
                    if (this.ss3Camera.debug) this.log.error(e);
                }

                delete this.ongoingSessions[sessionIdentifier];
                this.stopLiveKitStream(sessionIdentifier);
                callback();
            } else {
                // 'reconfigure', nothing to change but HAP still needs the callback
                callback();
            }
        }
    }

    createSrtpSession(keyAndSalt) {
        return new SrtpSession({
            profile: ProtectionProfileAes128CmHmacSha1_80,
            keys: {
                localMasterKey: keyAndSalt.subarray(0, 16),
                localMasterSalt: keyAndSalt.subarray(16, 30),
                remoteMasterKey: keyAndSalt.subarray(0, 16),
                remoteMasterSalt: keyAndSalt.subarray(16, 30)
            }
        });
    }

    // Re-stamp RTP for HomeKit then encrypt with the keys it gave us in prepareStream
    forwardRtp(rtp, srtp, socket, payloadType, ssrc, port, address) {
        let header = rtp.header;
        header.payloadType = payloadType;
        header.ssrc = ssrc;
        header.extension = false;
        header.extensions = [];

        try {
            socket.send(srtp.encrypt(rtp.payload, header), port, address);
        } catch (e) {
            if (this.ss3Camera.debug) this.log.error('Error forwarding RTP to HomeKit:', e.message);
        }
    }

    jpegFromKeyframe(annexB) {
        return new Promise((resolve, reject) => {
            let cmd = spawn(this.ss3Camera.ffmpegPath, [
                '-hide_banner', '-loglevel', 'error',
                '-f', 'h264', '-i', 'pipe:0',
                '-frames:v', '1',
                '-vf', 'scale=\'min(1280,iw)\':-2',
                '-f', 'image2', '-vcodec', 'mjpeg', '-q:v', '5', 'pipe:1'
            ], { env: process.env });

            let chunks = [];
            let stderr = '';
            cmd.stdout.on('data', data => chunks.push(data));
            cmd.stderr.on('data', data => { stderr += data.toString(); });
            cmd.on('error', reject);
            cmd.on('close', code => {
                if (code === 0 && chunks.length) resolve(Buffer.concat(chunks));
                else reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-200)}`));
            });
            cmd.stdin.on('error', () => {}); // ignore EPIPE
            cmd.stdin.end(annexB);
        });
    }

    async handleLiveKitSnapshotRequest(callback) {
        if (this.cachedSnapshot && Date.now() < this.cachedSnapshotExpires) {
            callback(undefined, this.cachedSnapshot);
            return;
        }

        // A stream is already collecting keyframes, serve what we have rather than joining again
        if (this.cachedSnapshot && Object.keys(this.liveKitSessions).length) {
            callback(undefined, this.cachedSnapshot);
            return;
        }

        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            callback(new Error('Camera snapshot request blocked (rate limited)'));
            return;
        }

        try {
            if (!this.snapshotWarming) this.snapshotWarming = this.warmSnapshot();
            let snapshot = await this.snapshotWarming;
            callback(undefined, snapshot);
        } catch (err) {
            this.log.error(`Could not get snapshot for '${this.ss3Camera.name}':`, err.message);
            callback(err);
        }
    }

    // Briefly joins the room to grab a keyframe, used when nothing is streaming
    async warmSnapshot() {
        let source = new LiveKitSource(this.ss3Camera);
        let keyframe = new KeyframeCollector();

        let timeoutID;
        let captured = new Promise((resolve, reject) => {
            timeoutID = setTimeout(() => reject(new Error('Timed out waiting for a keyframe')), keyframeTimeout);
            source.onVideoRtp = rtp => {
                keyframe.push(rtp.payload, rtp.header);
                if (keyframe.complete) resolve(keyframe.annexB());
            };
        });
        // connect() may reject before this is ever awaited, so it always needs a handler
        captured.catch(() => {});

        try {
            await source.connect();
            let annexB = await captured;
            let jpeg = await this.jpegFromKeyframe(annexB);

            this.cachedSnapshot = jpeg;
            this.cachedSnapshotExpires = Date.now() + snapshotCacheTime;
            if (this.ss3Camera.debug) this.log(`Cached snapshot for '${this.ss3Camera.name}' (${Math.round(jpeg.length / 1000)}kB)`);
            return jpeg;
        } finally {
            clearTimeout(timeoutID);
            source.close();
            this.snapshotWarming = null;
        }
    }

    // Caches a snapshot from a stream already in flight, costs one decoded frame
    cacheSnapshotFromStream(keyframe) {
        if (this.snapshotBusy || Date.now() < this.cachedSnapshotExpires) return;

        this.snapshotBusy = true;
        let annexB = keyframe.annexB();
        keyframe.reset();

        this.jpegFromKeyframe(annexB)
            .then(jpeg => {
                this.cachedSnapshot = jpeg;
                this.cachedSnapshotExpires = Date.now() + snapshotCacheTime;
            })
            .catch(err => {
                if (this.ss3Camera.debug) this.log.error('Snapshot decode failed:', err.message);
            })
            .finally(() => { this.snapshotBusy = false; });
    }

    startLiveKitStream(request, sessionIdentifier, sessionInfo, callback) {
        clearTimeout(sessionInfo.prepareTimeoutID);

        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            sessionInfo.liveKitSource.close();
            let err = new Error('Camera stream request blocked (rate limited)');
            this.log.error(err);
            callback(err);
            return;
        }

        try {
            this.setupLiveKitStream(request, sessionIdentifier, sessionInfo, callback);
        } catch (err) {
            this.log.error(`Could not start LiveKit stream for '${this.ss3Camera.name}':`, err.message);
            this.stopLiveKitStream(sessionIdentifier);
            sessionInfo.liveKitSource.close();
            callback(err);
        }
    }

    setupLiveKitStream(request, sessionIdentifier, sessionInfo, callback) {
        let source = sessionInfo.liveKitSource;
        let socket = dgram.createSocket('udp4');
        let videoSrtp = this.createSrtpSession(sessionInfo.video_srtp);
        let keyframe = new KeyframeCollector();

        let session = { source: source, socket: socket, stopped: false };
        this.liveKitSessions[sessionIdentifier] = session;

        source.onVideoRtp = rtp => {
            if (!this.cachedSnapshot || Date.now() >= this.cachedSnapshotExpires) {
                keyframe.push(rtp.payload, rtp.header);
                if (keyframe.complete) this.cacheSnapshotFromStream(keyframe);
            }
            this.forwardRtp(rtp, videoSrtp, socket, videoPayloadType, sessionInfo.video_ssrc, sessionInfo.video_port, sessionInfo.address);
        };

        // Deferred until LiveKit has connected
        let startAudio = () => {
            if (!sessionInfo.audio_port || session.stopped) return;

            if (!request.audio || request.audio.codec !== 'OPUS') {
                this.log.warn(`HomeKit asked for ${request.audio && request.audio.codec} audio on '${this.ss3Camera.name}'. Remove and re-add the camera in the Home app to pick up Opus.`);
                return;
            }

            let audioSrtp = this.createSrtpSession(sessionInfo.audio_srtp);
            source.onAudioRtp = rtp => {
                this.forwardRtp(rtp, audioSrtp, socket, audioPayloadType, sessionInfo.audio_ssrc, sessionInfo.audio_port, sessionInfo.address);
            };
            if (this.ss3Camera.debug) this.log(`Audio: forwarding Opus to ${sessionInfo.address}:${sessionInfo.audio_port}`);
        };

        source.onSessionEnded = reason => {
            this.log.error(`LiveKit session for '${this.ss3Camera.name}' ended: ${reason}`);
            this.stopLiveKitStream(sessionIdentifier);
            try {
                this.controller.forceStopStreamingSession(request.sessionID);
            } catch (e) { /* session may already be gone */ }
        };

        // Media starts once the pre-warmed join finishes, HomeKit is acked now so it does not time out
        callback();

        sessionInfo.liveKitReady
            .then(() => {
                if (this.ss3Camera.debug) this.log(`Streaming '${this.ss3Camera.name}' from LiveKit without transcoding`);
                startAudio();
            })
            .catch(err => {
                this.log.error(`LiveKit stream failed for '${this.ss3Camera.name}':`, err.message);
                this.stopLiveKitStream(sessionIdentifier);
                try {
                    this.controller.forceStopStreamingSession(request.sessionID);
                } catch (e) { /* session may already be gone */ }
            });
    }





    stopLiveKitStream(sessionIdentifier) {
        let session = this.liveKitSessions[sessionIdentifier];
        if (!session) return;
        session.stopped = true;
        delete this.liveKitSessions[sessionIdentifier];

        try { session.source.close(); } catch (e) { /* already gone */ }
        try { session.socket.close(); } catch (e) { /* already gone */ }
    }
}

export default StreamingDelegate;
