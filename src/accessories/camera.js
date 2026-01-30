/**
 * SimpliSafe Camera Accessory
 *
 * Supports three streaming modes based on camera type:
 * - Standard FLV streaming (indoor cameras, doorbell): Uses streamingDelegate.js
 * - Kinesis WebRTC (outdoor cameras with KVS provider): Uses kinesisStreamingDelegate.js
 * - LiveKit WebRTC (outdoor cameras with MIST provider): Uses liveKitStreamingDelegate.js
 *
 * The streaming delegate is selected based on cameraDetails.currentState.webrtcProvider:
 * - 'KVS' -> Kinesis (AWS Kinesis Video Streams WebRTC)
 * - 'MIST' -> LiveKit (SimpliSafe's LiveKit deployment)
 * - null/undefined -> Standard FLV streaming
 */

import ffmpegPath from 'ffmpeg-for-homebridge';
import isDocker from 'is-docker';

import SimpliSafe3Accessory from './ss3Accessory';
import { EVENT_TYPES } from '../simplisafe';

import StreamingDelegate from '../lib/streamingDelegate';
import KinesisStreamingDelegate from '../lib/kinesisStreamingDelegate';
import LiveKitStreamingDelegate from '../lib/liveKitStreamingDelegate';

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

        // Select appropriate streaming delegate based on camera's WebRTC provider
        let delegate;
        const webrtcProvider = this._getWebRTCProvider();

        if (webrtcProvider === 'KVS') {
            delegate = new KinesisStreamingDelegate(this);
            if (this.debug) this.log(`Camera '${name}' using Kinesis WebRTC streaming`);
        } else if (webrtcProvider === 'MIST') {
            delegate = new LiveKitStreamingDelegate(this);
            if (this.debug) this.log(`Camera '${name}' using LiveKit streaming`);
        } else {
            delegate = new StreamingDelegate(this);
            if (this.debug) this.log(`Camera '${name}' using standard FLV streaming`);
        }

        this.controller = delegate.controller;

        this.startListening();
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
            .on('get', callback => this.getState(callback, this.accessory.getService(this.api.hap.Service.MotionSensor), this.api.hap.Characteristic.MotionDetected));

        // add doorbell after configureController as HKSV creates it own linked motion service
        if (this.cameraDetails.model == 'SS002') { // SSO02 is doorbell cam
            if (!this.accessory.getService(this.api.hap.Service.Doorbell)) this.accessory.addService(this.api.hap.Service.Doorbell);
            this.accessory.getService(this.api.hap.Service.Doorbell)
                .getCharacteristic(this.api.hap.Characteristic.ProgrammableSwitchEvent)
                .on('get', callback => this.getState(callback, this.accessory.getService(this.api.hap.Service.Doorbell), this.api.hap.Characteristic.ProgrammableSwitchEvent));
        }
    }

    getState(callback, service, characteristicType) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            callback(new Error('Request blocked (rate limited)'));
            return;
        }
        let characteristic = service.getCharacteristic(characteristicType);
        callback(null, characteristic.value);
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
        // Outdoor cameras are now supported via Kinesis WebRTC
        // Only return true for cameras with unknown/unsupported providers
        return false;
    }

    _getWebRTCProvider() {
        // Get the WebRTC provider from camera details
        // KVS = AWS Kinesis Video Streams (outdoor cameras)
        // MIST = LiveKit (some outdoor cameras)
        // null/undefined = standard FLV streaming (indoor cameras)
        return this.cameraDetails.currentState?.webrtcProvider?.toUpperCase() || null;
    }

    _isKinesisCamera() {
        return this._getWebRTCProvider() === 'KVS';
    }

    _isLiveKitCamera() {
        return this._getWebRTCProvider() === 'MIST';
    }

    startListening() {
        this.simplisafe.on(EVENT_TYPES.CAMERA_MOTION, (data) => {
            if (!this._validateEvent(EVENT_TYPES.CAMERA_MOTION, data)) return;
            this.accessory.getService(this.api.hap.Service.MotionSensor).updateCharacteristic(this.api.hap.Characteristic.MotionDetected, true);
            this.motionIsTriggered = true;
            setTimeout(() => {
                this.accessory.getService(this.api.hap.Service.MotionSensor).updateCharacteristic(this.api.hap.Characteristic.MotionDetected, false);
                this.motionIsTriggered = false;
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
