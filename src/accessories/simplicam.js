import crypto from 'crypto';
import ip from 'ip';
import dns from 'dns';
import { promisify } from 'util';
import { spawn } from 'child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import jpegExtract from 'jpeg-extract';

import {
    EVENT_TYPES,
    RateLimitError,
    SOCKET_RETRY_INTERVAL
} from '../simplisafe';

const dnsLookup = promisify(dns.lookup);

class SS3SimpliCam {

    constructor(name, id, cameraDetails, cameraOptions, log, debug, simplisafe, Service, Characteristic, UUIDGen, CameraController) {
        this.Characteristic = Characteristic;
        this.Service = Service;
        this.UUIDGen = UUIDGen;
        this.id = id;
        this.cameraDetails = cameraDetails;
        this.cameraOptions = cameraOptions;
        this.log = log;
        this.debug = debug;
        this.name = name;
        this.simplisafe = simplisafe;
        this.uuid = UUIDGen.generate(id);
        this.reachable = true;

        this.services = [];

        this.controller;
        this.pendingSessions = {};
        this.ongoingSessions = {};

        let fps = this.cameraDetails.cameraSettings.admin.fps;
        let streamingOptions = {
            proxy: false,
            srtp: true,
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
                    profiles: [0, 1, 2],
                    levels: [0, 1, 2]
                }
            },
            audio: {
                codecs: [
                    {
                        type: 'OPUS',
                        samplerate: 16
                    }
                ]
            }
        };

        let resolution = this.cameraDetails.cameraSettings.pictureQuality;
        let maxSupportedHeight = +(resolution.split('p')[0]);
        streamingOptions.video.resolutions = streamingOptions.video.resolutions.filter(r => r[1] <= maxSupportedHeight);

        const cameraController = new CameraController({
            cameraStreamCount: 2,
            delegate: this,
            streamingOptions: streamingOptions
        });

        this.controller = cameraController;

        this.startListening();
    }

    identify(callback) {
        if (this.debug) this.log.debug(`Identify request for ${this.name}`);
        callback();
    }

    setAccessory(accessory) {
        this.accessory = accessory;
        this.accessory.on('identify', (callback) => this.identify(callback));

        this.accessory.getService(this.Service.AccessoryInformation)
            .setCharacteristic(this.Characteristic.Manufacturer, 'SimpliSafe')
            .setCharacteristic(this.Characteristic.Model, this.cameraDetails.model)
            .setCharacteristic(this.Characteristic.SerialNumber, this.id)
            .setCharacteristic(this.Characteristic.FirmwareRevision, this.cameraDetails.cameraSettings.admin.firmwareVersion);

        let motionSensor = this.accessory.getService(this.Service.MotionSensor)
            .getCharacteristic(this.Characteristic.MotionDetected)
            .on('get', callback => this.getState(callback, this.accessory.getService(this.Service.MotionSensor), this.Characteristic.MotionDetected));
        this.services.push(motionSensor);

        if (this.accessory.getService(this.Service.Doorbell)) {
            let doorbell = this.accessory.getService(this.Service.Doorbell)
                .getCharacteristic(this.Characteristic.ProgrammableSwitchEvent)
                .on('get', callback => this.getState(callback, this.accessory.getService(this.Service.Doorbell), this.Characteristic.ProgrammableSwitchEvent));
            this.services.push(doorbell);
        }

        this.accessory.configureController(this.controller);
    }

    getState(callback, service, characteristic) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            callback(new Error('Request blocked (rate limited)'));
            return;
        }

        let state = service.getCharacteristic(characteristic);
        callback(null, state);
    }

    async updateReachability() {
        try {
            let cameras = await this.simplisafe.getCameras();
            let camera = cameras.find(cam => cam.uuid === this.id);
            if (!camera) {
                this.reachable = false;
            } else {
                this.reachable = camera.status == 'online';
            }

            return this.reachable;
        } catch (err) {
            this.log.error(`An error occurred while updating reachability for ${this.name}`);
            this.log.error(err);
        }
    }

    async startListening() {
        if (this.debug && this.simplisafe.isSocketConnected()) this.log.debug(`${this.name} camera now listening for real time events.`);
        try {
            await this.simplisafe.subscribeToEvents((event, data) => {
                switch (event) {
                    // Socket events
                    case EVENT_TYPES.CONNECTED:
                        if (this.debug) this.log.debug(`${this.name} camera now listening for real time events.`);
                        this.nSocketConnectFailures = 0;
                        break;
                    case EVENT_TYPES.DISCONNECT:
                        if (this.debug) this.log.debug(`${this.name} camera real time events disconnected.`);
                        break;
                    case EVENT_TYPES.CONNECTION_LOST:
                        if (this.debug && this.nSocketConnectFailures == 0) this.log.debug(`${this.name} camera real time events connection lost. Attempting to reconnect...`);
                        setTimeout(async () => {
                            await this.startListening();
                        }, SOCKET_RETRY_INTERVAL);
                        break;
                }

                if (this.accessory) {
                    let eventCameraId;
                    if (data && (data.sensorSerial || data.internal)) {
                        eventCameraId = data.sensorSerial ? data.sensorSerial : data.internal.mainCamera;
                    }

                    if (eventCameraId == this.id) {
                        // Camera events
                        if (this.debug) this.log.debug(`${this.name} camera received event: ${event}`);
                        switch (event) {
                            case EVENT_TYPES.CAMERA_MOTION:
                                this.accessory.getService(this.Service.MotionSensor).updateCharacteristic(this.Characteristic.MotionDetected, true);
                                this.motionIsTriggered = true;
                                setTimeout(() => {
                                    this.accessory.getService(this.Service.MotionSensor).updateCharacteristic(this.Characteristic.MotionDetected, false);
                                    this.motionIsTriggered = false;
                                }, 5000);
                                break;
                            case EVENT_TYPES.DOORBELL:
                                this.accessory.getService(this.Service.Doorbell).getCharacteristic(this.Characteristic.ProgrammableSwitchEvent).setValue(0);
                                break;
                            default:
                                if (this.debug) this.log.debug(`${this.name} camera ignoring unhandled event: ${event}`);
                                break;
                        }
                    }
                }
            });
        } catch (err) {
            if (err instanceof RateLimitError) {
                let retryInterval = (2 ** this.nSocketConnectFailures) * SOCKET_RETRY_INTERVAL;
                if (this.debug) this.log.debug(`${this.name} camera caught RateLimitError, waiting ${retryInterval/1000}s to retry...`);
                setTimeout(async () => {
                    await this.startListening();
                }, retryInterval);
                this.nSocketConnectFailures++;
            }
        }
    }

    async handleSnapshotRequest(request, callback) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            callback(new Error('Camera snapshot request blocked (rate limited)'));
            return;
        }

        let resolution = `${request.width}x${request.height}`;
        if (this.debug) this.log.debug(`Handling camera snapshot for '${this.cameraDetails.cameraSettings.cameraName}' at ${resolution}`);

        if (!this.motionIsTriggered && this.cameraDetails.model == 'SS001') { // Model(s) with privacy shutter
            // Because if privacy shutter is closed we dont want snapshots triggering it to open
            let alarmState = await this.simplisafe.getAlarmState();
            switch (alarmState) {
                case 'OFF':
                    if (this.cameraDetails.cameraSettings.shutterOff !== 'open') {
                        if (this.debug) this.log.debug(`Camera snapshot request ignored, '${this.cameraDetails.cameraSettings.cameraName}' privacy shutter closed`);
                        callback(new Error('Privacy shutter closed'));
                        return;
                    }
                    break;

                case 'HOME':
                    if (this.cameraDetails.cameraSettings.shutterHome !== 'open') {
                        if (this.debug) this.log.debug(`Camera snapshot request ignored, '${this.cameraDetails.cameraSettings.cameraName}' privacy shutter closed`);
                        callback(new Error('Privacy shutter closed'));
                        return;
                    }
                    break;

                case 'AWAY':
                    if (this.cameraDetails.cameraSettings.shutterAway !== 'open') {
                        if (this.debug) this.log.debug(`Camera snapshot request ignored, '${this.cameraDetails.cameraSettings.cameraName}' privacy shutter closed`);
                        callback(new Error('Privacy shutter closed'));
                        return;
                    }
                    break;
            }
        }

        const url = {
            url: `https://media.simplisafe.com/v1/${this.cameraDetails.uuid}/mjpg?x=${request.width}&fr=1`,
            headers: {
                'Authorization': `Bearer ${this.simplisafe.token}`
            }
        };
        jpegExtract(url, (err, img) => {
            if (!err) {
                if (this.debug) this.log.debug(`Closed '${this.cameraDetails.cameraSettings.cameraName}' snapshot request with ${Math.round(img.length/1000)}kB image`);
                callback(undefined, img);
            } else {
                this.log.error('An error occurred while making snapshot request:', err.statusCode ? err.statusCode : '', err.statusMessage ? err.statusMessage : '');
                if (this.debug) this.log.error(err);
                callback(err);
            }
        });
    }

    prepareStream(request, callback) {
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

        this.pendingSessions[this.UUIDGen.unparse(sessionID)] = sessionInfo;

        callback(undefined, response);
    }

    async handleStreamRequest(request, callback) {
        let sessionId = request.sessionID;
        if (sessionId) {
            let sessionIdentifier = this.UUIDGen.unparse(sessionId);

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
                    let width = 1920;
                    let height = 1080;
                    let fps = this.cameraDetails.cameraSettings.admin.fps;
                    let videoBitrate = this.cameraDetails.cameraSettings.admin.bitRate;
                    let audioBitrate = 32;
                    let audioSamplerate = 24;

                    if (request.video) {
                        width = request.video.width;
                        height = request.video.height;
                        if (request.video.fps < fps) {
                            fps = request.video.fps;
                        }
                        if (request.video.max_bit_rate < videoBitrate) {
                            videoBitrate = request.video.max_bit_rate;
                        }
                    }

                    if (request.audio) {
                        audioBitrate = request.audio.max_bit_rate;
                        audioSamplerate = request.audio.sample_rate;
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
                        ['-headers', `Authorization: Bearer ${this.simplisafe.token}`],
                        ['-i', `https://${this.serverIpAddress}/v1/${this.cameraDetails.uuid}/flv?x=${width}`]
                    ];

                    let videoArgs = [
                        ['-map', '0:0'],
                        ['-vcodec', 'libx264'],
                        ['-tune', 'zerolatency'],
                        ['-preset', 'superfast'],
                        ['-pix_fmt', 'yuv420p'],
                        ['-r', fps],
                        ['-f', 'rawvideo'],
                        ['-vf', `scale=${width}:${height}`],
                        ['-b:v', `${videoBitrate}k`],
                        ['-bufsize', `${videoBitrate}k`],
                        ['-maxrate', `${videoBitrate}k`],
                        ['-payload_type', 99],
                        ['-ssrc', sessionInfo.video_ssrc],
                        ['-f', 'rtp'],
                        ['-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80'],
                        ['-srtp_out_params', sessionInfo.video_srtp.toString('base64')],
                        [`srtp://${sessionInfo.address}:${sessionInfo.video_port}?rtcpport=${sessionInfo.video_port}&localrtcpport=${sessionInfo.video_port}&pkt_size=1316`]
                    ];

                    let audioArgs = [
                        ['-map', '0:1'],
                        ['-acodec', 'libopus'],
                        ['-flags', '+global_header'],
                        ['-f', 'null'],
                        ['-ar', `${audioSamplerate}k`],
                        ['-b:a', `${audioBitrate}k`],
                        ['-bufsize', `${audioBitrate}k`],
                        ['-payload_type', 110],
                        ['-ssrc', sessionInfo.audio_ssrc],
                        ['-f', 'rtp'],
                        ['-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80'],
                        ['-srtp_out_params', sessionInfo.audio_srtp.toString('base64')],
                        [`srtp://${sessionInfo.address}:${sessionInfo.audio_port}?rtcpport=${sessionInfo.audio_port}&localrtcpport=${sessionInfo.audio_port}&pkt_size=1316`]
                    ];

                    // Choose the correct ffmpeg path (default or custom provided)
                    let ffmpegPath = ffmpeg.path;

                    if (this.cameraOptions) {
                        if (this.cameraOptions.ffmpegPath) {
                            ffmpegPath = this.cameraOptions.ffmpegPath;
                        }

                        if (this.cameraOptions.sourceOptions) {
                            let options = (typeof this.cameraOptions.sourceOptions === 'string') ? Object.fromEntries(this.cameraOptions.sourceOptions.split('-').filter(x => x).map(arg => '-' + arg).map(a => a.split(' ').filter(x => x)))
                                : this.cameraOptions.sourceOptions; // support old config schema
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

                        if (this.cameraOptions.videoOptions) {
                            let options = (typeof this.cameraOptions.videoOptions === 'string') ? Object.fromEntries(this.cameraOptions.videoOptions.split('-').filter(x => x).map(arg => '-' + arg).map(a => a.split(' ').filter(x => x)))
                                : this.cameraOptions.videoOptions; // support old config schema
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

                        if (this.cameraOptions.audioOptions) {
                            let options = (typeof this.cameraOptions.audioOptions === 'string') ? Object.fromEntries(this.cameraOptions.audioOptions.split('-').filter(x => x).map(arg => '-' + arg).map(a => a.split(' ').filter(x => x)))
                                : this.cameraOptions.audioOptions; // support old config schema
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

                    let cmd = spawn(ffmpegPath, [
                        ...source,
                        ...video,
                        ...audio
                    ], {
                        env: process.env
                    });

                    if (this.debug) this.log.debug(`Start streaming video for camera '${this.cameraDetails.cameraSettings.cameraName}'`);

                    let started = false;
                    cmd.stderr.on('data', data => {
                        if (!started) {
                            started = true;
                            if (this.debug) this.log.debug('FFMPEG received first frame');
                            callback(); // do not forget to execute callback once set up
                        }
                        if (this.debug) {
                            this.log.debug(data.toString());
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
                                if (this.debug) this.log.debug('Camera stopped streaming');
                                break;
                            default:
                                if (this.debug) this.log.debug(`Error: FFmpeg exited with code ${code}`);
                                if (!started) {
                                    callback(new Error(`Error: FFmpeg exited with code ${code}`));
                                } else {
                                    this.controller.forceStopStreamingSession(sessionId);
                                }
                                break;
                        }
                    });

                    this.ongoingSessions[sessionIdentifier] = cmd;
                }

                delete this.pendingSessions[sessionIdentifier];

            } else if (request.type == 'stop') {
                let cmd = this.ongoingSessions[sessionIdentifier];
                if (cmd) {
                    cmd.kill('SIGTERM');
                }

                delete this.ongoingSessions[sessionIdentifier];
            }
        }
    }
}

export default SS3SimpliCam;
