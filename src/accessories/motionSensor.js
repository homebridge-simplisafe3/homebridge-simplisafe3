import SimpliSafe3Accessory from './ss3Accessory';
import { EVENT_TYPES } from '../simplisafe';

class SS3MotionSensor extends SimpliSafe3Accessory {

    constructor(name, id, log, debug, simplisafe, api) {
        super(name, id, log, debug, simplisafe, api);
        this.reachable = true;
        this.services.push(this.api.hap.Service.MotionSensor);

        this.startListening();
    }

    setAccessory(accessory) {
        super.setAccessory(accessory);

        this.accessory.getService(this.api.hap.Service.AccessoryInformation)
            .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'SimpliSafe')
            .setCharacteristic(this.api.hap.Characteristic.Model, 'Motion Sensor')
            .setCharacteristic(this.api.hap.Characteristic.SerialNumber, this.id);

        this.service = this.accessory.getService(this.api.hap.Service.MotionSensor);
        this.service.getCharacteristic(this.api.hap.Characteristic.MotionDetected)
            .onGet(() => this.getState());

        this.service.getCharacteristic(this.api.hap.Characteristic.StatusLowBattery)
            .onGet(() => this.getBatteryStatus());
    }

    async updateReachability() {
        try {
            let sensors = await this.simplisafe.getSensors();
            let sensor = sensors.find(sen => sen.serial === this.id);
            if (!sensor) {
                this.reachable = false;
            } else {
                if (sensor.flags) {
                    this.reachable = !sensor.flags.offline;
                } else {
                    this.reachable = false;
                }
            }

            return this.reachable;
        } catch (err) {
            this.log.error(`An error occurred while updating reachability for ${this.name}`);
            this.log.error(err);
        }
    }

    async getSensorInformation() {
        try {
            let sensors = await this.simplisafe.getSensors(true);
            let sensor = sensors.find(sen => sen.serial === this.id);

            if (!sensor) {
                throw new Error('Could not find sensor');
            }

            return sensor;
        } catch (err) {
            throw new Error('An error occurred while getting sensor:', err.toJSON ? err.toJSON() : err);
        }
    }

    getState() {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
        return this.service.getCharacteristic(this.api.hap.Characteristic.MotionDetected).value;
    }

    getBatteryStatus() {
        // No need to ping API for this and HomeKit is not very patient when waiting for it
        return this.service.getCharacteristic(this.api.hap.Characteristic.StatusLowBattery).value;
    }

    startListening() {
        this.simplisafe.on(EVENT_TYPES.MOTION, (data) => {
            if (!this._validateEvent(EVENT_TYPES.MOTION, data)) return;
            this.accessory.getService(this.api.hap.Service.MotionSensor).updateCharacteristic(this.api.hap.Characteristic.MotionDetected, true);
            // Clear any pending reset so rapid-fire motion events don't race and
            // leave MotionDetected stuck on after the last event ends.
            if (this._motionResetTimer) clearTimeout(this._motionResetTimer);
            this._motionResetTimer = setTimeout(() => {
                this.accessory.getService(this.api.hap.Service.MotionSensor).updateCharacteristic(this.api.hap.Characteristic.MotionDetected, false);
                this._motionResetTimer = undefined;
            }, 10000);
        });

        this.simplisafe.subscribeToSensor(this.id, sensor => {
            if (sensor.flags) {
                if (sensor.flags.lowBattery) {
                    this.accessory.getService(this.api.hap.Service.MotionSensor).updateCharacteristic(this.api.hap.Characteristic.StatusLowBattery, this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
                } else {
                    this.accessory.getService(this.api.hap.Service.MotionSensor).updateCharacteristic(this.api.hap.Characteristic.StatusLowBattery, this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                }
            }
        });
    }

    _validateEvent(event, data) {
        let valid = this.service && data && data.sensorSerial && data.sensorSerial == this.id;
        if (this.debug && valid) this.log(`Motion sensor '${this.name}' received event: ${event}`);
        return valid;
    }
}

export default SS3MotionSensor;
