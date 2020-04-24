import crypto from 'crypto';
import ip from 'ip';
import dns from 'dns';
import { promisify } from 'util';
import { spawn } from 'child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

import {
    EVENT_TYPES,
    RateLimitError
} from '../simplisafe';

const dnsLookup = promisify(dns.lookup);
const eventSubscribeRetryInterval = 10000; // ms

class SS3SimpliCam {

    constructor(name, id, cameraDetails, cameraOptions, log, simplisafe, Service, Characteristic, UUIDGen, StreamController) {
        this.Characteristic = Characteristic;
        this.Service = Service;
        this.UUIDGen = UUIDGen;
        this.StreamController = StreamController;
        this.id = id;
        this.cameraDetails = cameraDetails;
        this.cameraOptions = cameraOptions;
        this.log = log;
        this.name = name;
        this.simplisafe = simplisafe;
        this.uuid = UUIDGen.generate(id);
        this.reachable = true;

        this.services = [];
        this.cameraSource = null;

        this.startListening();
    }

    identify(paired, callback) {
        this.log(`Identify request for ${this.name}, paired: ${paired}`);
        callback();
    }

    setAccessory(accessory) {
        this.accessory = accessory;
        this.accessory.on('identify', (paired, callback) => this.identify(paired, callback));

        this.accessory.getService(this.Service.AccessoryInformation)
            .setCharacteristic(this.Characteristic.Manufacturer, 'SimpliSafe')
            .setCharacteristic(this.Characteristic.Model, this.cameraDetails.model)
            .setCharacteristic(this.Characteristic.SerialNumber, this.id)
            .setCharacteristic(this.Characteristic.FirmwareRevision, this.cameraDetails.cameraSettings.admin.firmwareVersion);

        this.services.push(this.accessory.getService(this.Service.CameraControl));
        this.services.push(this.accessory.getService(this.Service.Microphone));

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

        // Clear cached stream controllers
        this.accessory.services
            .filter(service => service.UUID === this.Service.CameraRTPStreamManagement.UUID)
            .map(service => {
                this.accessory.removeService(service);
            });

        this.cameraSource = new CameraSource(
            this.cameraDetails,
            this.cameraOptions,
            this.Service,
            this.Characteristic,
            this.UUIDGen,
            this.StreamController,
            this.simplisafe,
            this.log
        );

        this.accessory.configureCameraSource(this.cameraSource);
        this.cameraSource.services = this.services;
    }

    getState(callback, service, characteristic) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            return callback(new Error('Request blocked (rate limited)'));
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
            this.log(`An error occurred while updating reachability for ${this.name}`);
            this.log(err);
        }
    }

    async startListening() {
        try {
           await this.simplisafe.subscribeToEvents((event, data) => {
               if (!this.accessory) {
                   // Camera is not yet initialized
                   return;
               }
               let eventCameraId;
               if (data && (data.sensorSerial || data.internal)) {
                   eventCameraId = data.sensorSerial ? data.sensorSerial : data.internal.mainCamera;
               }

               switch (event) {
                   case EVENT_TYPES.CAMERA_MOTION:
                       if (eventCameraId == this.id) {
                           this.accessory.getService(this.Service.MotionSensor).updateCharacteristic(this.Characteristic.MotionDetected, true);
                           this.cameraSource.motionIsTriggered = true;
                           setTimeout(() => {
                               this.accessory.getService(this.Service.MotionSensor).updateCharacteristic(this.Characteristic.MotionDetected, false);
                               this.cameraSource.motionIsTriggered = false;
                           }, 5000);
                       }
                       break;
                   case EVENT_TYPES.DOORBELL:
                       if (eventCameraId == this.id) {
                           this.accessory.getService(this.Service.Doorbell).getCharacteristic(this.Characteristic.ProgrammableSwitchEvent).setValue(0);
                       }
                       break;
                   case EVENT_TYPES.CONNECTED:
                       this.log(`${this.name} camera now listening for real time events.`);
                       break;
                   case EVENT_TYPES.DISCONNECT:
                       this.log(`${this.name} camera real time events disconnected.`);
                       break;
                   case EVENT_TYPES.RECONNECT:
                       this.log(this.name + ' camera real time events re-connected.');
                       break;
                   case EVENT_TYPES.CONNECTION_LOST:
                       this.log(this.name + ' camera real time events connection lost. Attempting to restart...');
                       this.startListening();
                       break;
                   default:
                       if (eventCameraId === this.id) {
                           this.log(`${this.name} camera ignoring unhandled event: ${event}`);
                       }
                       break;
               }
           });
           if (this.simplisafe.isSocketConnected()) this.log(`${this.name} camera now listening for real time events.`);
        } catch (err) {
            if (err instanceof RateLimitError) {
                this.log(`${this.name} camera caught RateLimitError, waiting to retry...`);
                setTimeout(async () => {
                    await this.startListening();
                }, eventSubscribeRetryInterval);
            }
        }
    }

}

class CameraSource {

    constructor(cameraConfig, cameraOptions, Service, Characteristic, UUIDGen, StreamController, simplisafe, log) {
        this.cameraConfig = cameraConfig;
        this.cameraOptions = cameraOptions;
        this.serverIpAddress = null;
        this.Service = Service;
        this.Characteristic = Characteristic;
        this.UUIDGen = UUIDGen;
        this.StreamController = StreamController;
        this.simplisafe = simplisafe;
        this.log = log;

        this.services = [];
        this.streamControllers = [];
        this.pendingSessions = {};
        this.ongoingSessions = {};

        let fps = cameraConfig.cameraSettings.admin.fps;
        this.options = {
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

        let resolution = cameraConfig.cameraSettings.pictureQuality;
        let maxSupportedHeight = +(resolution.split('p')[0]);
        this.options.video.resolutions = this.options.video.resolutions.filter(r => r[1] <= maxSupportedHeight);

        this.createStreamControllers(2, this.options);
    }

    handleCloseConnection(connId) {
        this.streamControllers.forEach(controller => {
            controller.handleCloseConnection(connId);
        });
    }

    async handleSnapshotRequest(request, callback) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            return callback(new Error('Request blocked (rate limited)'));
        }

        let ffmpegPath = ffmpeg.path;
        if (this.cameraOptions && this.cameraOptions.ffmpegPath) {
            ffmpegPath = this.cameraOptions.ffmpegPath;
        }
        let resolution = `${request.width}x${request.height}`;
        this.log(`Handling snapshot for ${this.cameraConfig.cameraSettings.cameraName} at ${resolution}`);

        if (!this.motionIsTriggered && this.cameraConfig.model == 'SS001') { // Model(s) with privacy shutter
            // Because if privacy shutter is closed we dont want snapshots triggering it to open
            let alarmState = await this.simplisafe.getAlarmState();
            switch (alarmState) {
                case 'OFF':
                    if (this.cameraConfig.cameraSettings.shutterOff !== 'open') {
                        this.log(`SnapshotRequest ignored, ${this.cameraConfig.cameraSettings.cameraName} privacy shutter closed`);
                        callback(new Error('Privacy shutter closed'));
                        return;
                    }
                    break;

                case 'HOME':
                    if (this.cameraConfig.cameraSettings.shutterHome !== 'open') {
                        this.log(`SnapshotRequest ignored, ${this.cameraConfig.cameraSettings.cameraName} privacy shutter closed`);
                        callback(new Error('Privacy shutter closed'));
                        return;
                    }
                    break;

                case 'AWAY':
                    if (this.cameraConfig.cameraSettings.shutterAway !== 'open') {
                        this.log(`SnapshotRequest ignored, ${this.cameraConfig.cameraSettings.cameraName} privacy shutter closed`);
                        callback(new Error('Privacy shutter closed'));
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
                callback(new Error('Could not resolve hostname for media.simplisafe.com'));
                return;
            }
        }

        let sourceArgs = [
            ['-re'],
            ['-headers', `Authorization: Bearer ${this.simplisafe.token}`],
            ['-i', `https://${this.serverIpAddress}/v1/${this.cameraConfig.uuid}/flv?x=${request.width}`],
            ['-t', 1],
            ['-s', resolution],
            ['-f', 'image2'],
            ['-vframes', 1],
            ['-']
        ];

        let source = [].concat(...sourceArgs.map(arg => arg.map(a => typeof a == 'string' ? a.trim() : a)));

        let ffmpegCmd = spawn(ffmpegPath, [
            ...source,
        ], {
            env: process.env
        });
        this.log(ffmpegPath + source);

        let imageBuffer = Buffer.alloc(0);

        ffmpegCmd.stdout.on('data', data => {
            imageBuffer = Buffer.concat([imageBuffer, data]);
        });
        ffmpegCmd.on('error', error => {
            this.log('An error occurred while making snapshot request:', error);
            callback(error);
        });
        ffmpegCmd.on('close', () => {
            this.log(`Close ${this.cameraConfig.cameraSettings.cameraName} stream with image of length: ${imageBuffer.length}`);
            callback(null, imageBuffer);
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

        callback(response);
    }

    handleStreamRequest = async (request) => {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            return callback(new Error('Request blocked (rate limited)'));
        }

        let sessionId = request.sessionID;

        if (sessionId) {
            let sessionIdentifier = this.UUIDGen.unparse(sessionId);

            if (request.type == 'start') {
                let sessionInfo = this.pendingSessions[sessionIdentifier];
                if (sessionInfo) {
                    let width = 1920;
                    let height = 1080;
                    let fps = this.cameraConfig.cameraSettings.admin.fps;
                    let videoBitrate = this.cameraConfig.cameraSettings.admin.bitRate;
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
                            throw new Error('Could not resolve hostname for media.simplisafe.com');
                        }
                    }

                    let sourceArgs = [
                        ['-re'],
                        ['-headers', `Authorization: Bearer ${this.simplisafe.token}`],
                        ['-i', `https://${this.serverIpAddress}/v1/${this.cameraConfig.uuid}/flv?x=${width}`]
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
                            let options = (typeof this.cameraOptions.sourceOptions === 'string') ? this.cameraOptions.sourceOptions.split('-').filter(x => x).map(arg => '-' + arg).map(a => a.split(' ').filter(x => x))
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
                            let options = (typeof this.cameraOptions.videoOptions === 'string') ? this.cameraOptions.videoOptions.split('-').filter(x => x).map(arg => '-' + arg).map(a => a.split(' ').filter(x => x))
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
                            let options = (typeof this.cameraOptions.audioOptions === 'string') ? this.cameraOptions.audioOptions.split('-').filter(x => x).map(arg => '-' + arg).map(a => a.split(' ').filter(x => x))
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

                    this.log(`Start streaming video from ${this.cameraConfig.cameraSettings.cameraName}`);

                    cmd.stderr.on('data', data => {
                        this.log(data.toString());
                    });

                    cmd.on('error', err => {
                        this.log('An error occurred while making stream request');
                        this.log(err);
                    });

                    cmd.on('close', code => {
                        switch (code) {
                            case null:
                            case 0:
                            case 255:
                                this.log('Stopped streaming');
                                break;
                            default:
                                this.log(`Error: FFmpeg exited with code ${code}`);
                                this.streamControllers
                                    .filter(stream => stream.sessionIdentifier === sessionId)
                                    .map(stream => stream.forceStop());
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
    };

    createStreamControllers(maxStreams, options) {
        for (let i = 0; i < maxStreams; i++) {
            let streamController = new this.StreamController(i, options, this);
            this.services.push(streamController.service);
            this.streamControllers.push(streamController);
        }
    }

}

export default SS3SimpliCam;
