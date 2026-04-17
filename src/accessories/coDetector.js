import SimpliSafe3Accessory from './ss3Accessory';

class SS3CODetector extends SimpliSafe3Accessory {

    constructor(name, id, log, debug, simplisafe, api) {
        super(name, id, log, debug, simplisafe, api);
        this.reachable = true;
        this.services.push(this.api.hap.Service.CarbonMonoxideSensor);

        this.startListening();
    }

    // CO detector uses StatusFault for sensor malfunction (updated in its
    // subscription loop). Skip base-class auth-fault wiring to avoid conflicts.
    _primaryServiceForFault() {
        return null;
    }

    setAccessory(accessory) {
        super.setAccessory(accessory);

        this.accessory.getService(this.api.hap.Service.AccessoryInformation)
            .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'SimpliSafe')
            .setCharacteristic(this.api.hap.Characteristic.Model, 'Carbon Monoxide Detector')
            .setCharacteristic(this.api.hap.Characteristic.SerialNumber, this.id);

        this.service = this.accessory.getService(this.api.hap.Service.CarbonMonoxideSensor);
        this.service.getCharacteristic(this.api.hap.Characteristic.CarbonMonoxideDetected)
            .onGet(() => this.getState('triggered'));

        this.service.getCharacteristic(this.api.hap.Characteristic.StatusTampered)
            .onGet(() => this.getState('tamper'));

        this.service.getCharacteristic(this.api.hap.Characteristic.StatusFault)
            .onGet(() => this.getState('malfunction'));

        this.service.getCharacteristic(this.api.hap.Characteristic.StatusLowBattery)
            .onGet(() => this.getBatteryStatus());

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
            throw new Error('An error occurred while getting sensor:', err.toJSON ? err.toJSON() : err);
        }
    }

    async getState(parameter = 'triggered', forceRefresh = false) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }

        if (!forceRefresh) {
            if (parameter == 'triggered') return this.service.getCharacteristic(this.api.hap.Characteristic.CarbonMonoxideDetected).value;
            if (parameter == 'tamper') return this.service.getCharacteristic(this.api.hap.Characteristic.StatusTampered).value;
            if (parameter == 'malfunction') return this.service.getCharacteristic(this.api.hap.Characteristic.StatusFault).value;
            throw new Error('Requested data type not understood');
        }

        try {
            let sensor = await this.getSensorInformation();

            if (!sensor.status) {
                throw new Error('Sensor response not understood');
            }

            if (parameter == 'triggered') {
                return sensor.status.triggered ? this.api.hap.Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL : this.api.hap.Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL;
            }
            if (parameter == 'tamper') {
                return sensor.status.tamper ? this.api.hap.Characteristic.StatusTampered.TAMPERED : this.api.hap.Characteristic.StatusTampered.NOT_TAMPERED;
            }
            if (parameter == 'malfunction') {
                return sensor.status.malfunction ? this.api.hap.Characteristic.StatusFault.GENERAL_FAULT : this.api.hap.Characteristic.StatusFault.NO_FAULT;
            }
            throw new Error('Requested data type not understood');
        } catch (err) {
            this.log.error(`An error occurred while getting sensor state for ${this.name}: ${err}`);
            throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
    }

    getBatteryStatus() {
        // No need to ping API for this and HomeKit is not very patient when waiting for it
        return this.service.getCharacteristic(this.api.hap.Characteristic.StatusLowBattery).value;
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
