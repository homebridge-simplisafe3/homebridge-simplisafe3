class SS3MotionSensor {

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
            .setCharacteristic(this.Characteristic.Model, 'Motion Sensor')
            .setCharacteristic(this.Characteristic.SerialNumber, this.id);

        this.accessory.getService(this.Service.MotionSensor).getCharacteristic(this.Characteristic.StatusLowBattery)
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
        this.simplisafe.subscribeToEvents((event, data) => {
            if (this.id !== data.sensorSerial) return;

            switch (event) {
                case 'MOTION':
                    this.accessory.getService(this.Service.MotionSensor).setCharacteristic(this.Characteristic.MotionDetected, true);
                    setTimeout(() => {
                        this.accessory.getService(this.Service.MotionSensor).setCharacteristic(this.Characteristic.MotionDetected, false);
                    }, 10000);
                    break;
                default:
                    this.log(`Motion sensor ${this.id} received unknown event '${event}' with data:`, data);
                    break;
            }
        });
        this.simplisafe.subscribeToSensor(this.id, sensor => {
            if (sensor.flags) {
                if (sensor.flags.lowBattery) {
                    this.accessory.getService(this.Service.MotionSensor).setCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
                } else {
                    this.accessory.getService(this.Service.MotionSensor).setCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                }
            }
        });
    }

}

export default SS3MotionSensor;
