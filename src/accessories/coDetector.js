import SimpliSafe3Accessory from './ss3Accessory.js';

class SS3CODetector extends SimpliSafe3Accessory {

    constructor(name, id, log, debug, simplisafe, api) {
        super(name, id, log, debug, simplisafe, api);
        this.reachable = true;
        this.services.push(this.api.hap.Service.CarbonMonoxideSensor);

        this.startListening();
    }

    setAccessory(accessory) {
        super.setAccessory(accessory);

        this.accessory.getService(this.api.hap.Service.AccessoryInformation)
            .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'SimpliSafe')
            .setCharacteristic(this.api.hap.Characteristic.Model, 'Carbon Monoxide Detector')
            .setCharacteristic(this.api.hap.Characteristic.SerialNumber, this.id);

        this.service = this.accessory.getService(this.api.hap.Service.CarbonMonoxideSensor);
        this.service.getCharacteristic(this.api.hap.Characteristic.CarbonMonoxideDetected)
            .on('get', async callback => this.getState(callback, 'triggered'));

        this.service.getCharacteristic(this.api.hap.Characteristic.StatusTampered)
            .on('get', async callback => this.getState(callback, 'tamper'));

        this.service.getCharacteristic(this.api.hap.Characteristic.StatusFault)
            .on('get', async callback => this.getState(callback, 'malfunction'));

        this.service.getCharacteristic(this.api.hap.Characteristic.StatusLowBattery)
            .on('get', async callback => this.getBatteryStatus(callback));

        this.refreshState();
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

    async getState(callback, parameter = 'triggered', forceRefresh = false) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            return callback(new Error('Request blocked (rate limited)'));
        }

        if (!forceRefresh) {
            let characteristic = null;

            if (parameter == 'triggered') {
                characteristic = this.service.getCharacteristic(this.api.hap.Characteristic.CarbonMonoxideDetected);
            } else if (parameter == 'tamper') {
                characteristic = this.service.getCharacteristic(this.api.hap.Characteristic.StatusTampered);
            } else if (parameter == 'malfunction') {
                characteristic = this.service.getCharacteristic(this.api.hap.Characteristic.StatusFault);
            } else {
                throw new Error('Requested data type not understood');
            }

            return callback(null, characteristic.value);
        }

        try {
            let sensor = await this.getSensorInformation();

            if (!sensor.status) {
                throw new Error('Sensor response not understood');
            }

            let homekitState = null;

            if (parameter == 'triggered') {
                homekitState = sensor.status.triggered ? this.api.hap.Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL : this.api.hap.Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL;
            } else if (parameter == 'tamper') {
                homekitState = sensor.status.tamper ? this.api.hap.Characteristic.StatusTampered.TAMPERED : this.api.hap.Characteristic.StatusTampered.NOT_TAMPERED;
            } else if (parameter == 'malfunction') {
                homekitState = sensor.status.malfunction ? this.api.hap.Characteristic.StatusFault.GENERAL_FAULT : this.api.hap.Characteristic.StatusFault.NO_FAULT;
            } else {
                throw new Error('Requested data type not understood');
            }

            callback(null, homekitState);

        } catch (err) {
            callback(new Error(`An error occurred while getting sensor state: ${err}`));
        }
    }

    async getBatteryStatus(callback) {
        // No need to ping API for this and HomeKit is not very patient when waiting for it
        let characteristic = this.service.getCharacteristic(this.api.hap.Characteristic.StatusLowBattery);
        return callback(null, characteristic.value);
    }

    startListening() {
        this.simplisafe.subscribeToSensor(this.id, sensor => {
            if (this.service) {
                if (sensor.status) {
                    if (sensor.status.triggered) {
                        this.service.updateCharacteristic(this.api.hap.Characteristic.CarbonMonoxideDetected, this.api.hap.Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL);
                    } else {
                        this.service.updateCharacteristic(this.api.hap.Characteristic.CarbonMonoxideDetected, this.api.hap.Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL);
                    }

                    if (sensor.status.tamper) {
                        this.service.updateCharacteristic(this.api.hap.Characteristic.StatusTampered, this.api.hap.Characteristic.StatusTampered.TAMPERED);
                    } else {
                        this.service.updateCharacteristic(this.api.hap.Characteristic.StatusTampered, this.api.hap.Characteristic.StatusTampered.NOT_TAMPERED);
                    }

                    if (sensor.status.malfunction) {
                        this.service.updateCharacteristic(this.api.hap.Characteristic.StatusFault, this.api.hap.Characteristic.StatusFault.GENERAL_FAULT);
                    } else {
                        this.service.updateCharacteristic(this.api.hap.Characteristic.StatusFault, this.api.hap.Characteristic.StatusFault.NO_FAULT);
                    }
                }

                if (sensor.flags) {
                    if (sensor.flags.lowBattery) {
                        this.service.updateCharacteristic(this.api.hap.Characteristic.StatusLowBattery, this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
                    } else {
                        this.service.updateCharacteristic(this.api.hap.Characteristic.StatusLowBattery, this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                    }
                }
            }
        });
    }

    async refreshState() {
        if (this.debug) this.log('Refreshing sensor state');
        try {
            let sensor = await this.getSensorInformation();
            if (!sensor.status || !sensor.flags) {
                throw new Error('Sensor response not understood');
            }

            let homekitTriggeredState = sensor.status.triggered ? this.api.hap.Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL : this.api.hap.Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL;
            let homekitTamperState = sensor.status.tamper ? this.api.hap.Characteristic.StatusTampered.TAMPERED : this.api.hap.Characteristic.StatusTampered.NOT_TAMPERED;
            let homekitFaultState = sensor.status.malfunction ? this.api.hap.Characteristic.StatusFault.GENERAL_FAULT : this.api.hap.Characteristic.StatusFault.NO_FAULT;

            let batteryLow = sensor.flags.lowBattery;
            let homekitBatteryState = batteryLow ? this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;

            this.service.updateCharacteristic(this.api.hap.Characteristic.CarbonMonoxideDetected, homekitTriggeredState);
            this.service.updateCharacteristic(this.api.hap.Characteristic.StatusTampered, homekitTamperState);
            this.service.updateCharacteristic(this.api.hap.Characteristic.StatusFault, homekitFaultState);
            this.service.updateCharacteristic(this.api.hap.Characteristic.StatusLowBattery, homekitBatteryState);

            if (this.debug) this.log(`Updated current triggered, tamper, fault, battery state for ${this.name}: ${sensor.status.triggered}, ${sensor.status.tamper}, ${sensor.status.malfunction}, ${batteryLow}`);

        } catch (err) {
            this.log.error('An error occurred while refreshing state');
            this.log.error(err);
        }
    }

}

export default SS3CODetector;
