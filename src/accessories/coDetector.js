class SS3CODetector {

    constructor(name, id, log, simplisafe, Service, Characteristic, UUIDGen) {

        this.Characteristic = Characteristic;
        this.Service = Service;
        this.id = id;
        this.log = log;
        this.name = name;
        this.simplisafe = simplisafe;
        this.uuid = UUIDGen.generate(id);
        this.reachable = true;

        this.startListening();
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
            .setCharacteristic(this.Characteristic.Model, 'Carbon Monoxide Detector')
            .setCharacteristic(this.Characteristic.SerialNumber, this.id);

        this.service = this.accessory.getService(this.Service.CarbonMonoxideSensor);
        this.service.getCharacteristic(this.Characteristic.CarbonMonoxideDetected)
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

    async getState(callback, parameter = 'triggered') {
        if (this.simplisafe.isBlocked) {
            callback(new Error('Request blocked (rate limited)'));
        }

        try {
            let sensor = await this.getSensorInformation();

            if (!sensor.status) {
                throw new Error('Sensor response not understood');
            }

            let homekitState = null;

            if (parameter == 'triggered') {
                homekitState = sensor.status.triggered ? this.Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL : this.Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL;
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
                        this.service.setCharacteristic(this.Characteristic.CarbonMonoxideDetected, this.Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL);
                    } else {
                        this.service.setCharacteristic(this.Characteristic.CarbonMonoxideDetected, this.Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL);
                    }

                    if (sensor.status.tamper) {
                        this.service.setCharacteristic(this.Characteristic.StatusTampered, this.Characteristic.StatusTampered.TAMPERED);
                    } else {
                        this.service.setCharacteristic(this.Characteristic.StatusTampered, this.Characteristic.StatusTampered.NOT_TAMPERED);
                    }

                    if (sensor.status.malfunction) {
                        this.service.setCharacteristic(this.Characteristic.StatusFault, this.Characteristic.StatusFault.GENERAL_FAULT);
                    } else {
                        this.service.setCharacteristic(this.Characteristic.StatusFault, this.Characteristic.StatusFault.NO_FAULT);
                    }
                }

                if (sensor.flags) {
                    if (sensor.flags.lowBattery) {
                        this.service.setCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
                    } else {
                        this.service.setCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                    }
                }
            }
        });
    }

    async refreshState() {
        this.log('Refreshing sensor state');
        try {
            let sensor = await this.getSensorInformation();
            if (!sensor.status || !sensor.flags) {
                throw new Error('Sensor response not understood');
            }

            let homekitTriggeredState = sensor.status.triggered ? this.Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL : this.Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL;
            let homekitTamperState = sensor.status.tamper ? this.Characteristic.StatusTampered.TAMPERED : this.Characteristic.StatusTampered.NOT_TAMPERED;
            let homekitFaultState = sensor.status.malfunction ? this.Characteristic.StatusFault.GENERAL_FAULT : this.Characteristic.StatusFault.NO_FAULT;

            let batteryLow = sensor.flags.lowBattery;
            let homekitBatteryState = batteryLow ? this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;

            this.service.setCharacteristic(this.Characteristic.CarbonMonoxideDetected, homekitTriggeredState);
            this.service.setCharacteristic(this.Characteristic.StatusTampered, homekitTamperState);
            this.service.setCharacteristic(this.Characteristic.StatusFault, homekitFaultState);
            this.service.setCharacteristic(this.Characteristic.StatusLowBattery, homekitBatteryState);

            this.log(`Updated current state for ${this.name}: ${sensor.status.triggered}, ${sensor.status.tamper}, ${sensor.status.malfunction}, ${batteryLow}`);

        } catch (err) {
            this.log('An error occurred while refreshing state');
            this.log(err);
        }
    }

}

export default SS3CODetector;
