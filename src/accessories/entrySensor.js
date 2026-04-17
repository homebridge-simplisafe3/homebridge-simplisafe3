import SimpliSafe3Accessory from './ss3Accessory';

class SS3EntrySensor extends SimpliSafe3Accessory {

    constructor(name, id, log, debug, simplisafe, api) {
        super(name, id, log, debug, simplisafe, api);
        this.reachable = true;
        this.services.push(this.api.hap.Service.ContactSensor);

        this.startListening();
    }

    setAccessory(accessory) {
        super.setAccessory(accessory);

        this.accessory.getService(this.api.hap.Service.AccessoryInformation)
            .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'SimpliSafe')
            .setCharacteristic(this.api.hap.Characteristic.Model, 'Entry Sensor')
            .setCharacteristic(this.api.hap.Characteristic.SerialNumber, this.id);

        this.service = this.accessory.getService(this.api.hap.Service.ContactSensor);
        this.service.getCharacteristic(this.api.hap.Characteristic.ContactSensorState)
            .onGet(() => this.getState());

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

    async getState(forceRefresh = false) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }

        if (!forceRefresh) {
            return this.service.getCharacteristic(this.api.hap.Characteristic.ContactSensorState).value;
        }

        try {
            let sensor = await this.getSensorInformation();

            if (!sensor.status) {
                throw new Error('Sensor response not understood');
            }

            let open = sensor.status.triggered;
            return open ? this.api.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : this.api.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
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
                        this.service.updateCharacteristic(this.api.hap.Characteristic.ContactSensorState, this.api.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
                    } else {
                        this.service.updateCharacteristic(this.api.hap.Characteristic.ContactSensorState, this.api.hap.Characteristic.ContactSensorState.CONTACT_DETECTED);
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

            let open = sensor.status.triggered;
            let homekitSensorState = open ? this.api.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : this.api.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;

            let batteryLow = sensor.flags.lowBattery;
            let homekitBatteryState = batteryLow ? this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;

            this.service.updateCharacteristic(this.api.hap.Characteristic.ContactSensorState, homekitSensorState);
            this.service.updateCharacteristic(this.api.hap.Characteristic.StatusLowBattery, homekitBatteryState);

            if (this.debug) this.log(`Updated current open, battery state for ${this.name}: ${open}, ${batteryLow}`);
        } catch (err) {
            this.log.error('An error occurred while refreshing state');
            this.log.error(err);
        }
    }

}

export default SS3EntrySensor;
