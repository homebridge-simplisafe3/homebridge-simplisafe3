class SS3DoorLock {

    constructor(name, id, log, simplisafe, Service, Characteristic, UUIDGen) {

        this.Characteristic = Characteristic;
        this.Service = Service;
        this.id = id;
        this.log = log;
        this.name = name;
        this.simplisafe = simplisafe;
        this.uuid = UUIDGen.generate(id);

        // this.CURRENT_SS3_TO_HOMEKIT = {
        //     'OFF': Characteristic.SecuritySystemCurrentState.DISARMED,
        //     'HOME': Characteristic.SecuritySystemCurrentState.STAY_ARM,
        //     'AWAY': Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        //     'HOME_COUNT': Characteristic.SecuritySystemCurrentState.DISARMED,
        //     'AWAY_COUNT': Characteristic.SecuritySystemCurrentState.DISARMED,
        //     'ALARM_COUNT': Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        //     'ALARM': Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
        // };

        // this.TARGET_SS3_TO_HOMEKIT = {
        //     'OFF': Characteristic.SecuritySystemTargetState.DISARM,
        //     'HOME': Characteristic.SecuritySystemTargetState.STAY_ARM,
        //     'AWAY': Characteristic.SecuritySystemTargetState.AWAY_ARM,
        //     'HOME_COUNT': Characteristic.SecuritySystemTargetState.STAY_ARM,
        //     'AWAY_COUNT': Characteristic.SecuritySystemTargetState.AWAY_ARM
        // };

        // this.TARGET_HOMEKIT_TO_SS3 = {
        //     [Characteristic.SecuritySystemTargetState.DISARM]: 'OFF',
        //     [Characteristic.SecuritySystemTargetState.STAY_ARM]: 'HOME',
        //     [Characteristic.SecuritySystemTargetState.AWAY_ARM]: 'AWAY'
        // };

        // this.VALID_CURRENT_STATE_VALUES = [
        //     Characteristic.SecuritySystemCurrentState.STAY_ARM,
        //     Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        //     Characteristic.SecuritySystemCurrentState.DISARMED,
        //     Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
        // ];

        // this.VALID_TARGET_STATE_VALUES = [
        //     Characteristic.SecuritySystemTargetState.STAY_ARM,
        //     Characteristic.SecuritySystemTargetState.AWAY_ARM,
        //     Characteristic.SecuritySystemTargetState.DISARM
        // ];

        this.startListening();
    }

    identify(paired, callback) {
        this.log(`Identify request for ${this.name}, paired: ${paired}`);
        callback();
    }

    setAccessory(accessory) {
        this.accessory = accessory;
        this.accessory.on('identify', (paired, callback) => this.identify(paired, callback));

        // this.accessory.getService(this.Service.AccessoryInformation)
        //     .setCharacteristic(this.Characteristic.Manufacturer, 'SimpliSafe')
        //     .setCharacteristic(this.Characteristic.Model, 'Door Lock')
        //     .setCharacteristic(this.Characteristic.SerialNumber, this.id);

        // this.service = this.accessory.getService(this.Service.SecuritySystem);

        // this.service.getCharacteristic(this.Characteristic.SecuritySystemCurrentState)
        //     .setProps({ validValues: this.VALID_CURRENT_STATE_VALUES })
        //     .on('get', async callback => this.getCurrentState(callback));
        // this.service.getCharacteristic(this.Characteristic.SecuritySystemTargetState)
        //     .setProps({ validValues: this.VALID_TARGET_STATE_VALUES })
        //     .on('get', async callback => this.getTargetState(callback))
        //     .on('set', async (state, callback) => this.setTargetState(state, callback));

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

    async getCurrentState(callback) {
        this.log('Getting current state...');
        try {
            // let state = await this.simplisafe.getAlarmState();
            // let homekitState = this.CURRENT_SS3_TO_HOMEKIT[state];
            // this.log(`Current alarm state is: ${homekitState}`);
            // callback(null, homekitState);
        } catch (err) {
            callback(new Error(`An error occurred while getting the current door lock state: ${err}`));
        }
    }

    async getTargetState(callback) {
        this.log('Getting target state...');
        try {
            // let state = await this.simplisafe.getAlarmState();
            // let homekitState = this.TARGET_SS3_TO_HOMEKIT[state];
            // this.log(`Target alarm state is: ${homekitState}`);
            // callback(null, homekitState);
        } catch (err) {
            callback(new Error(`An error occurred while getting the target door lock state: ${err}`));
        }
    }

    async setTargetState(homekitState, callback) {
        // let state = this.TARGET_HOMEKIT_TO_SS3[homekitState];
        // this.log(`Setting target state to ${state}, ${homekitState}`);

        // if (!this.service) {
        //     callback(new Error('Alarm not linked to Homebridge service'));
        //     return;
        // }

        try {
            // let data = await this.simplisafe.setAlarmState(state);
            // this.log(`Updated alarm state: ${JSON.stringify(data)}`);
            // if (data.state == 'OFF') {
            //     this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, this.Characteristic.SecuritySystemCurrentState.DISARMED);
            // } else if (data.exitDelay && data.exitDelay > 0) {
            //     setTimeout(async () => {
            //         await this.refreshState();
            //     }, data.exitDelay * 1000);
            // }
            callback(null);
        } catch (err) {
            callback(new Error(`An error occurred while setting the door lock state: ${err}`));
        }
    }

    startListening() {
        this.log('Listening to door lock events...');
        // this.simplisafe.subscribeToEvents(event => {
        //     this.log(`Received new event from alarm: ${event}`);
        //     if (this.service) {
        //         switch (event) {
        //             case 'DISARM':
        //             case 'CANCEL':
        //             case 'OFF':
        //                 this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, this.Characteristic.SecuritySystemCurrentState.DISARMED);
        //                 this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, this.Characteristic.SecuritySystemTargetState.DISARM);
        //                 break;
        //             case 'HOME_ARM':
        //                 this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, this.Characteristic.SecuritySystemCurrentState.STAY_ARM);
        //                 this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, this.Characteristic.SecuritySystemTargetState.STAY_ARM);
        //                 break;
        //             case 'AWAY_ARM':
        //                 this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, this.Characteristic.SecuritySystemCurrentState.AWAY_ARM);
        //                 this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, this.Characteristic.SecuritySystemTargetState.AWAY_ARM);
        //                 break;
        //             case 'HOME_EXIT_DELAY':
        //                 this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, this.Characteristic.SecuritySystemTargetState.STAY_ARM);
        //                 break;
        //             case 'AWAY_EXIT_DELAY':
        //                 this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, this.Characteristic.SecuritySystemTargetState.AWAY_ARM);
        //                 break;
        //             case 'DISCONNECT':
        //                 this.log('Real time events disconnected.');
        //                 this.startListening();
        //                 break;
        //             default:
        //                 this.log(`Unknown event received: ${event}`);
        //                 break;
        //         }
        //     }
        // });
    }

    async refreshState() {
        this.log('Refreshing door lock state');
        try {
            // let state = await this.simplisafe.getAlarmState();
            // let homekitState = this.CURRENT_SS3_TO_HOMEKIT[state];
            // this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, homekitState);
            // this.log(`Updated current state for ${this.name}: ${state}`);
        } catch (err) {
            this.log('An error occurred while refreshing state');
            this.log(err);
        }
    }

}

export default SS3DoorLock;