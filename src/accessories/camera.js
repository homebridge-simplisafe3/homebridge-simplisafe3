import ffmpegPath from 'ffmpeg-for-homebridge';
import isDocker from 'is-docker';

import SimpliSafe3Accessory from './ss3Accessory';
import { EVENT_TYPES } from '../simplisafe';

import StreamingDelegate from '../lib/streamingDelegate';

class SS3Camera extends SimpliSafe3Accessory {
    constructor(name, id, cameraDetails, cameraOptions, log, debug, simplisafe, authManager, api) {
        super(name, id, log, debug, simplisafe, api);
        this.cameraDetails = cameraDetails;
        this.cameraOptions = cameraOptions;
        this.authManager = authManager;
        this.reachable = true;
        this.nSocketConnectFailures = 0;

        this.ffmpegPath = isDocker() ? 'ffmpeg' : ffmpegPath;
        if (this.debug && isDocker()) this.log('Detected running in docker, initializing with docker-bundled ffmpeg');
        if (this.cameraOptions && this.cameraOptions.ffmpegPath) {
            this.ffmpegPath = this.cameraOptions.ffmpegPath;
        }

        const delegate = new StreamingDelegate(this);
        this.controller = delegate.controller;

        this.startListening();
    }

    // Cameras use CameraController + separate motion/doorbell services; there's no
    // single "primary" service to attach an auth-fault indicator to. Skip auto-wiring.
    _primaryServiceForFault() {
        return null;
    }

    setAccessory(accessory) {
        super.setAccessory(accessory);

        this.accessory.getService(this.api.hap.Service.AccessoryInformation)
            .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'SimpliSafe')
            .setCharacteristic(this.api.hap.Characteristic.Model, this.cameraDetails.model)
            .setCharacteristic(this.api.hap.Characteristic.SerialNumber, this.id)
            .setCharacteristic(this.api.hap.Characteristic.FirmwareRevision, this.cameraDetails.cameraSettings.admin.firmwareVersion);

        this.accessory.configureController(this.controller);

        // add motion sensor after configureController as HKSV creates it own linked motion service
        if (!this.accessory.getService(this.api.hap.Service.MotionSensor)) this.accessory.addService(this.api.hap.Service.MotionSensor);
        this.accessory.getService(this.api.hap.Service.MotionSensor)
            .getCharacteristic(this.api.hap.Characteristic.MotionDetected)
            .onGet(() => this.getState(this.accessory.getService(this.api.hap.Service.MotionSensor), this.api.hap.Characteristic.MotionDetected));

        // add doorbell after configureController as HKSV creates it own linked motion service
        if (this.cameraDetails.model == 'SS002') { // SSO02 is doorbell cam
            if (!this.accessory.getService(this.api.hap.Service.Doorbell)) this.accessory.addService(this.api.hap.Service.Doorbell);
            this.accessory.getService(this.api.hap.Service.Doorbell)
                .getCharacteristic(this.api.hap.Characteristic.ProgrammableSwitchEvent)
                .onGet(() => this.getState(this.accessory.getService(this.api.hap.Service.Doorbell), this.api.hap.Characteristic.ProgrammableSwitchEvent));
        }
    }

    getState(service, characteristicType) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
        return service.getCharacteristic(characteristicType).value;
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

    supportsPrivacyShutter() {
        // so far SS001 & SS003
        return this.cameraDetails.supportedFeatures && this.cameraDetails.supportedFeatures.privacyShutter;
    }

    isUnsupported() {
        // so far SSOBCM4
        return this.cameraDetails.supportedFeatures && this.cameraDetails.supportedFeatures.providers && this.cameraDetails.supportedFeatures.providers.recording !== 'simplisafe';
    }

    startListening() {
        this.simplisafe.on(EVENT_TYPES.CAMERA_MOTION, (data) => {
            if (!this._validateEvent(EVENT_TYPES.CAMERA_MOTION, data)) return;
            this.accessory.getService(this.api.hap.Service.MotionSensor).updateCharacteristic(this.api.hap.Characteristic.MotionDetected, true);
            this.motionIsTriggered = true;
            // Clear any pending reset so overlapping motion events don't race.
            if (this._motionResetTimer) clearTimeout(this._motionResetTimer);
            this._motionResetTimer = setTimeout(() => {
                this.accessory.getService(this.api.hap.Service.MotionSensor).updateCharacteristic(this.api.hap.Characteristic.MotionDetected, false);
                this.motionIsTriggered = false;
                this._motionResetTimer = undefined;
            }, 5000);
        });
        this.simplisafe.on(EVENT_TYPES.DOORBELL, (data) => {
            if (!this._validateEvent(EVENT_TYPES.DOORBELL, data)) return;
            this.accessory.getService(this.api.hap.Service.Doorbell).getCharacteristic(this.api.hap.Characteristic.ProgrammableSwitchEvent).setValue(0);
        });
    }

    _validateEvent(event, data) {
        let valid;
        if (!this.accessory || !data) valid = false;
        else {
            let eventCameraIds = [data.sensorSerial];
            if (data.internal) eventCameraIds.push(data.internal.mainCamera);
            valid = eventCameraIds.indexOf(this.id) > -1;
        }

        if (this.debug && valid) this.log(`${this.name} camera received event: ${event}`);
        return valid;
    }
}

export default SS3Camera;
