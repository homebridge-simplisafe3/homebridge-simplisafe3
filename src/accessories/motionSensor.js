import SimpliSafe3Accessory from './ss3Accessory.js';

import {
    EVENT_TYPES,
    RateLimitError,
    SOCKET_RETRY_INTERVAL
} from '../simplisafe';

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
            .on('get', callback => this.getState(callback));

        this.service.getCharacteristic(this.api.hap.Characteristic.StatusLowBattery)
            .on('get', async callback => this.getBatteryStatus(callback));
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
            throw new Error(`An error occurred while getting sensor: ${err}`);
        }
    }

    getState(callback) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            return callback(new Error('Request blocked (rate limited)'));
        }

        let characteristic = this.service.getCharacteristic(this.api.hap.Characteristic.MotionDetected);
        return callback(null, characteristic.value);
    }

    async getBatteryStatus(callback) {
        // No need to ping API for this and HomeKit is not very patient when waiting for it
        let characteristic = this.service.getCharacteristic(this.api.hap.Characteristic.StatusLowBattery);
        return callback(null, characteristic.value);
    }

    async startListening() {
        if (this.debug && this.simplisafe.isSocketConnected()) this.log(`${this.name} motion sensor now listening for real time events.`);
        try {
            await this.simplisafe.subscribeToEvents((event, data) => {
                switch (event) {
                // Socket events
                case EVENT_TYPES.CONNECTED:
                    if (this.debug) this.log(`${this.name} motion sensor now listening for real time events.`);
                    this.nSocketConnectFailures = 0;
                    break;
                case EVENT_TYPES.DISCONNECT:
                    if (this.debug) this.log(`${this.name} motion sensor real time events disconnected.`);
                    break;
                case EVENT_TYPES.CONNECTION_LOST:
                    if (this.debug && this.nSocketConnectFailures == 0) this.log(`${this.name} motion sensor real time events connection lost. Attempting to reconnect...`);
                    setTimeout(async () => {
                        await this.startListening();
                    }, SOCKET_RETRY_INTERVAL);
                    break;
                }

                if (data && this.id == data.sensorSerial) {
                    // Motion sensor events
                    if (this.debug) this.log(`${this.name} motion sensor received event: ${event}`);
                    switch (event) {
                    case EVENT_TYPES.MOTION:
                        this.accessory.getService(this.api.hap.Service.MotionSensor).updateCharacteristic(this.api.hap.Characteristic.MotionDetected, true);
                        setTimeout(() => {
                            this.accessory.getService(this.api.hap.Service.MotionSensor).updateCharacteristic(this.api.hap.Characteristic.MotionDetected, false);
                        }, 10000);
                        break;
                    default:
                        if (this.debug) this.log(`Motion sensor ${this.id} received unknown event '${event}' with data:`, data);
                        break;
                    }
                }
            });
        } catch (err) {
            if (err instanceof RateLimitError) {
                let retryInterval = (2 ** this.nSocketConnectFailures) * SOCKET_RETRY_INTERVAL;
                if (this.debug) this.log(`${this.name} motion sensor caught RateLimitError, waiting ${retryInterval/1000}s to retry...`);
                setTimeout(async () => {
                    await this.startListening();
                }, retryInterval);
                this.nSocketConnectFailures++;
            }
        }
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

}

export default SS3MotionSensor;
