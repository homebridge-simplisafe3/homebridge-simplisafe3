import crypto from 'crypto';
import ip from 'ip';
import dns from 'dns';
import { promisify } from 'util';
import { spawn } from 'child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

const dnsLookup = promisify(dns.lookup);

class SS3SimpliCam {

    constructor(name, id, cameraDetails, log, simplisafe, Service, Characteristic, UUIDGen, StreamController) {
        this.Characteristic = Characteristic;
        this.Service = Service;
        this.UUIDGen = UUIDGen;
        this.StreamController = StreamController;
        this.id = id;
        this.cameraDetails = cameraDetails;
        this.log = log;
        this.name = name;
        this.simplisafe = simplisafe;
        this.uuid = UUIDGen.generate(id);
        this.reachable = true;

        this.services = [];
        this.cameraSource = null;
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
            .setCharacteristic(this.Characteristic.SerialNumber, this.id);

        this.services = [
            this.accessory.getService(this.Service.CameraControl),
            this.accessory.getService(this.Service.Microphone)
        ];

        this.cameraSource = new CameraSource(
            this.cameraDetails,
            this.accessory.getService(this.Service.CameraControl),
            this.accessory.getService(this.Service.Microphone),
            this.Service,
            this.Characteristic,
            this.UUIDGen,
            this.StreamController,
            this.simplisafe,
            this.log
        );
        this.accessory.configureCameraSource(this.cameraSource);
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

}

class CameraSource {

    constructor(cameraConfig, controlService, microphoneService, Service, Characteristic, UUIDGen, StreamController, simplisafe, log) {
        this.cameraConfig = cameraConfig;
        this.serverIpAddress = null;
        this.Service = Service;
        this.Characteristic = Characteristic;
        this.UUIDGen = UUIDGen;
        this.StreamController = StreamController;
        this.simplisafe = simplisafe;
        this.log = log;

        this.services = [
            controlService,
            microphoneService
        ];
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
                    [1280, 720, fps]
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
                        samplerate: 24
                    },
                    {
                        type: 'AAC-eld',
                        samplerate: 16
                    }
                ]
            }
        };

        this.createStreamControllers(2, this.options);
    }

    handleCloseConnection(connId) {
        this.streamControllers.forEach(controller => {
            controller.handleCloseConnection(connId);
        });
    }

    handleSnapshotRequest(request, callback) {
        this.log('Snapshot request. Not yet supported');
        callback(new Error('Snapshots not yet supported'));
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
        let sessionId = request.sessionID;

        if (sessionId) {
            let sessionIdentifier = this.UUIDGen.unparse(sessionId);
            
            if (request.type == 'start') {
                let sessionInfo = this.pendingSessions[sessionIdentifier];
                if (sessionInfo) {
                    let width = 1280;
                    let height = 720;
                    let fps = this.cameraConfig.cameraSettings.admin.fps;
                    let videoBitrate = this.cameraConfig.cameraSettings.admin.bitRate;
                    let audioBitrate = 32;
                    let audioSamplerate = 16;

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
                        this.serverIpAddress = await dnsLookup('media.simplisafe.com');
                    } catch (err) {
                        if (!this.serverIpAddress) {
                            throw new Error('Could not resolve hostname for media.simplisafe.com');
                        }
                    }

                    let sourceArgs = [
                        '-re',
                        '-headers', `Authorization: Bearer ${this.simplisafe.token}`,
                        '-i', `https://${this.serverIpAddress}/v1/${this.cameraConfig.uuid}/flv?x=${width}`
                    ];

                    let videoArgs = [
                        '-map', '0:0',
                        '-vcodec', 'libx264',
                        '-pix_fmt', 'yuv420p',
                        '-r', fps,
                        '-f', 'rawvideo',
                        '-vf', ` scale=${width}:${height}`,
                        '-b:v', `${videoBitrate}k`,
                        '-bufsize', `${videoBitrate}k`,
                        '-maxrate', `${videoBitrate}k`,
                        '-payload_type', 99,
                        '-ssrc', sessionInfo.video_ssrc,
                        '-f', 'rtp',
                        '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
                        '-srtp_out_params', sessionInfo.video_srtp.toString('base64'),
                        `srtp://${sessionInfo.address}:${sessionInfo.video_port}?rtcpport=${sessionInfo.video_port}&localrtcpport=${sessionInfo.video_port}&pkt_size=1316`
                    ];

                    let audioArgs = [
                        '-map', '0:1',
                        '-acodec', 'libfdk_aac',
                        '-profile:a', 'aac_eld',
                        '-flags', '+global_header',
                        '-f', 'null',
                        '-ar', `${audioSamplerate}k`,
                        '-b:a', `${audioBitrate}k`,
                        '-bufsize', `${audioBitrate}k`,
                        '-ac', 1,
                        '-payload_type', 110,
                        '-ssrc', sessionInfo.audio_ssrc,
                        '-f', 'rtp',
                        '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
                        '-srtp_out_params', sessionInfo.audio_srtp.toString('base64'),
                        `srtp://${sessionInfo.address}:${sessionInfo.audio_port}?rtcpport=${sessionInfo.audio_port}&localrtcpport=${sessionInfo.audio_port}&pkt_size=1316`
                    ];

                    let cmd = spawn(ffmpeg.path, [
                        ...sourceArgs,
                        ...videoArgs,
                        ...audioArgs,
                        '-loglevel', 'debug'
                    ], {
                        env: process.env
                    });

                    this.log(`Start streaming video from ${this.cameraConfig.cameraSettings.camraName}`);
                    this.log([
                        ffmpeg.path,
                        ...sourceArgs,
                        ...videoArgs,
                        ...audioArgs
                    ].join(' '));

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