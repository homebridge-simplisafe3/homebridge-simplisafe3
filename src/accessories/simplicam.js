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

    constructor(cameraConfig, controlService, microphoneService, Service, Characteristic, UUIDGen, StreamController, log) {
        this.cameraConfig = cameraConfig;
        this.Service = Service;
        this.Characteristic = Characteristic;
        this.UUIDGen = UUIDGen;
        this.StreamController = StreamController;
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

    }

    handleStreamRequest(request) {

    }

    createStreamControllers(maxStreams, options) {
        for (let i = 0; i < maxStreams; i++) {
            let streamController = new this.StreamController(i, options, this);
            this.services.push(streamController.service);
            this.streamControllers.push(streamController);
        }
    }

}

export default SS3SimpliCam;