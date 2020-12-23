class SS3SmokeDetector {

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
        if (this.debug) this.log.debug(`Identify request for ${this.name}`);
        callback();
    }

    setAccessory(accessory) {
        this.accessory = accessory;
        this.accessory.on('identify', (paired, callback) => this.identify(callback));

        this.accessory.getService(this.Service.AccessoryInformation)
            .setCharacteristic(this.Characteristic.Manufacturer, 'SimpliSafe')
            .setCharacteristic(this.Characteristic.Model, 'Smoke Detector')
            .setCharacteristic(this.Characteristic.SerialNumber, this.id);

        this.service = this.accessory.getService(this.Service.SmokeSensor);
        this.service.getCharacteristic(this.Characteristic.SmokeDetected)
            .on('get', async callback => this.getState(callback, 'triggered'));

        this.service.getCharacteristic(this.Characteristic.StatusTampered)
            .on('get', async callback => this.getState(callback, 'tamper'));

        this.service.getCharacteristic(this.Characteristic.StatusFault)
            .on('get', async callback => this.getState(callback, 'malfunction'));

        this.service.getCharacteristic(this.Characteristic.StatusLowBattery)
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
                characteristic = this.service.getCharacteristic(this.Characteristic.SmokeDetected);
            } else if (parameter == 'tamper') {
                characteristic = this.service.getCharacteristic(this.Characteristic.StatusTampered);
            } else if (parameter == 'malfunction') {
                characteristic = this.service.getCharacteristic(this.Characteristic.StatusFault);
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
                homekitState = sensor.status.triggered ? this.Characteristic.SmokeDetected.SMOKE_DETECTED : this.Characteristic.SmokeDetected.SMOKE_NOT_DETECTED;
            } else if (parameter == 'tamper') {
                homekitState = sensor.status.tamper ? this.Characteristic.StatusTampered.TAMPERED : this.Characteristic.StatusTampered.NOT_TAMPERED;
            } else if (parameter == 'malfunction') {
                homekitState = sensor.status.malfunction ? this.Characteristic.StatusFault.GENERAL_FAULT : this.Characteristic.StatusFault.NO_FAULT;
            } else {
                throw new Error('Requested data type not understood');
            }

            callback(null, homekitState);

        } catch (err) {
            callback(new Error(`An error occurred while getting sensor state: ${err}`));
        }
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

    startListening() {
        this.simplisafe.subscribeToSensor(this.id, sensor => {
            if (this.service) {
                if (sensor.status) {
                    if (sensor.status.triggered) {
                        this.service.updateCharacteristic(this.Characteristic.SmokeDetected, this.Characteristic.SmokeDetected.SMOKE_DETECTED);
                    } else {
                        this.service.updateCharacteristic(this.Characteristic.SmokeDetected, this.Characteristic.SmokeDetected.SMOKE_NOT_DETECTED);
                    }

                    if (sensor.status.tamper) {
                        this.service.updateCharacteristic(this.Characteristic.StatusTampered, this.Characteristic.StatusTampered.TAMPERED);
                    } else {
                        this.service.updateCharacteristic(this.Characteristic.StatusTampered, this.Characteristic.StatusTampered.NOT_TAMPERED);
                    }

                    if (sensor.status.malfunction) {
                        this.service.updateCharacteristic(this.Characteristic.StatusFault, this.Characteristic.StatusFault.GENERAL_FAULT);
                    } else {
                        this.service.updateCharacteristic(this.Characteristic.StatusFault, this.Characteristic.StatusFault.NO_FAULT);
                    }
                }

                if (sensor.flags) {
                    if (sensor.flags.lowBattery) {
                        this.service.updateCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
                    } else {
                        this.service.updateCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                    }
                }
            }
        });
    }

    async refreshState() {
        if (this.debug) this.log.debug('Refreshing sensor state');
        try {
            let sensor = await this.getSensorInformation();
            if (!sensor.status || !sensor.flags) {
                throw new Error('Sensor response not understood');
            }

            let homekitTriggeredState = sensor.status.triggered ? this.Characteristic.SmokeDetected.SMOKE_DETECTED : this.Characteristic.SmokeDetected.SMOKE_NOT_DETECTED;
            let homekitTamperState = sensor.status.tamper ? this.Characteristic.StatusTampered.TAMPERED : this.Characteristic.StatusTampered.NOT_TAMPERED;
            let homekitFaultState = sensor.status.malfunction ? this.Characteristic.StatusFault.GENERAL_FAULT : this.Characteristic.StatusFault.NO_FAULT;

            let batteryLow = sensor.flags.lowBattery;
            let homekitBatteryState = batteryLow ? this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;

            this.service.updateCharacteristic(this.Characteristic.SmokeDetected, homekitTriggeredState);
            this.service.updateCharacteristic(this.Characteristic.StatusTampered, homekitTamperState);
            this.service.updateCharacteristic(this.Characteristic.StatusFault, homekitFaultState);
            this.service.updateCharacteristic(this.Characteristic.StatusLowBattery, homekitBatteryState);

            if (this.debug) this.log.debug(`Updated current state for ${this.name}: ${sensor.status.triggered}, ${sensor.status.tamper}, ${sensor.status.malfunction}, ${batteryLow}`);

        } catch (err) {
            this.log.error('An error occurred while refreshing state');
            this.log.error(err);
        }
    }

}

export default SS3SmokeDetector;
