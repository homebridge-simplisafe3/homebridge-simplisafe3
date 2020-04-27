import {
    EVENT_TYPES,
    RateLimitError,
    SOCKET_RETRY_INTERVAL
} from '../simplisafe';

class SS3MotionSensor {

    constructor(name, id, log, debug, simplisafe, Service, Characteristic, UUIDGen) {

        this.Characteristic = Characteristic;
        this.Service = Service;
        this.id = id;
        this.log = log;
        this.debug = debug;
        this.name = name;
        this.simplisafe = simplisafe;
        this.uuid = UUIDGen.generate(id);
        this.reachable = true;

        this.startListening();
    }

    identify(callback) {
        if (this.debug) this.log(`Identify request for ${this.name}`);
        callback();
    }

    setAccessory(accessory) {
        this.accessory = accessory;
        this.accessory.on('identify', (callback) => this.identify(callback));

        this.accessory.getService(this.Service.AccessoryInformation)
            .setCharacteristic(this.Characteristic.Manufacturer, 'SimpliSafe')
            .setCharacteristic(this.Characteristic.Model, 'Motion Sensor')
            .setCharacteristic(this.Characteristic.SerialNumber, this.id);

        this.service = this.accessory.getService(this.Service.MotionSensor);
        this.service.getCharacteristic(this.Characteristic.MotionDetected)
            .on('get', callback => this.getState(callback));

        this.service.getCharacteristic(this.Characteristic.StatusLowBattery)
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
            this.log(`An error occurred while updating reachability for ${this.name}`);
            this.log(err);
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

        let state = this.service.getCharacteristic(this.Characteristic.MotionDetected);
        return callback(null, state);
    }

    async getBatteryStatus(callback) {
        try {
            let sensor = await this.getSensorInformation();

            if (!sensor.flags) {
                throw new Error('Sensor response not understood');
            }

            let batteryLow = sensor.flags.lowBattery;
            let homekitState = batteryLow ? this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
            callback(null, homekitState);

        } catch (err) {
            callback(new Error(`An error occurred while getting sensor battery level: ${err}`));
        }
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
                            this.accessory.getService(this.Service.MotionSensor).updateCharacteristic(this.Characteristic.MotionDetected, true);
                            setTimeout(() => {
                                this.accessory.getService(this.Service.MotionSensor).updateCharacteristic(this.Characteristic.MotionDetected, false);
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
                    this.accessory.getService(this.Service.MotionSensor).updateCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
                } else {
                    this.accessory.getService(this.Service.MotionSensor).updateCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                }
            }
        });
    }

}

export default SS3MotionSensor;
