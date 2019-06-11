class SS3Alarm {

    constructor(name, id, log, simplisafe, Service, Characteristic, Accessory, UUIDGen) {

        this.Characteristic = Characteristic;
        this.log = log;
        this.name = name;
        this.simplisafe = simplisafe;
        this.uuid = UUIDGen.generate(id);

        this.CURRENT_SS3_TO_HOMEKIT = {
            'OFF': Characteristic.SecuritySystemCurrentState.DISARMED,
            'HOME': Characteristic.SecuritySystemCurrentState.STAY_ARM,
            'AWAY': Characteristic.SecuritySystemCurrentState.AWAY_ARM,
            'HOME_COUNT': Characteristic.SecuritySystemCurrentState.DISARMED,
            'AWAY_COUNT': Characteristic.SecuritySystemCurrentState.DISARMED,
            'ALARM_COUNT': Characteristic.SecuritySystemCurrentState.AWAY_ARM,
            'ALARM': Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
        };

        this.TARGET_SS3_TO_HOMEKIT = {
            'OFF': Characteristic.SecuritySystemTargetState.DISARM,
            'HOME': Characteristic.SecuritySystemTargetState.STAY_ARM,
            'AWAY': Characteristic.SecuritySystemTargetState.AWAY_ARM,
            'HOME_COUNT': Characteristic.SecuritySystemTargetState.STAY_ARM,
            'AWAY_COUNT': Characteristic.SecuritySystemTargetState.AWAY_ARM
        };

        this.TARGET_HOMEKIT_TO_SS3 = {
            [Characteristic.SecuritySystemTargetState.DISARM]: 'OFF',
            [Characteristic.SecuritySystemTargetState.STAY_ARM]: 'HOME',
            [Characteristic.SecuritySystemTargetState.AWAY_ARM]: 'AWAY'
        };

        this.VALID_CURRENT_STATE_VALUES = [
            Characteristic.SecuritySystemCurrentState.STAY_ARM,
            Characteristic.SecuritySystemCurrentState.AWAY_ARM,
            Characteristic.SecuritySystemCurrentState.DISARMED,
            Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
        ];

        this.VALID_TARGET_STATE_VALUES = [
            Characteristic.SecuritySystemTargetState.STAY_ARM,
            Characteristic.SecuritySystemTargetState.AWAY_ARM,
            Characteristic.SecuritySystemTargetState.DISARM
        ];

        this.accessory = new Accessory(name, this.uuid);
        this.accessory.on('identify', (paired, callback) => this.identify(paired, callback));

        this.accessory.addService(Service.SecuritySystem, 'Alarm');
        this.accessory.getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, 'SimpliSafe')
            .setCharacteristic(Characteristic.Model, 'SimpliSafe 3')
            .setCharacteristic(Characteristic.SerialNumber, id);

        this.service = this.accessory.getService('Alarm');

        this.service.getCharacteristic(Characteristic.SecuritySystemCurrentState)
            .setProps({ validValues: this.VALID_CURRENT_STATE_VALUES })
            .on('get', async callback => this.getCurrentState(callback));
        this.service.getCharacteristic(Characteristic.SecuritySystemTargetState)
            .setProps({ validValues: this.VALID_TARGET_STATE_VALUES })
            .on('get', async callback => this.getTargetState(callback))
            .on('set', async (state, callback) => this.setTargetState(state, callback));

        this.startListening();
    }

    identify(paired, callback) {
        this.log(`Identify request for ${this.name}, paired: ${paired}`);
        callback();
    }

    async updateReachability() {
        try {
            let subscription = await this.simplisafe.getSubscription();
            let connType = subscription.location.system.connType;
            this.reachable = connType == 'wifi' || connType == 'cell';
            this.log(`Reachability updated for ${this.name}: ${this.reachable}`);
        } catch (err) {
            this.log(`An error occurred while updating reachability for ${this.name}`);
            this.log(err);
        }
    }

    async getState(stateType = 'current') {
        try {
            let state = await this.simplisafe.getAlarmState();

            let homekitState = this.CURRENT_SS3_TO_HOMEKIT[state];
            if (stateType == 'target') {
                homekitState = this.TARGET_SS3_TO_HOMEKIT[state];
            }

            this.log(`Received new alarm state from SimpliSafe: ${state}, ${homekitState}`);

            return homekitState;
        } catch (err) {
            throw err;
        }
    }

    async getCurrentState(callback) {
        this.log('Getting current state...');
        try {
            let homekitState = await this.getState('current');
            this.log(`Current state is: ${homekitState}`);
            callback(null, homekitState);
        } catch (err) {
            callback(new Error(`An error occurred while getting the current alarm state: ${err}`));
        }
    }

    async getTargetState(callback) {
        this.log('Getting target state...');
        try {
            let homekitState = await this.getState('target');
            this.log(`Target state is: ${homekitState}`);
            callback(null, homekitState);
        } catch (err) {
            callback(new Error(`An error occurred while getting the target alarm state: ${err}`));
        }
    }

    async setTargetState(homekitState, callback) {
        let state = this.TARGET_HOMEKIT_TO_SS3[homekitState];
        this.log(`Setting target state to ${state}, ${homekitState}`);

        try {
            let data = await this.simplisafe.setAlarmState(state);
            this.log(`Updated alarm state: ${JSON.stringify(data)}`);
            if (data.exitDelay && data.exitDelay > 0) {
                setTimeout(async () => {
                    await this.getCurrentState(() => {});
                }, data.exitDelay * 1000);
            }
            callback(null);
        } catch (err) {
            callback(new Error(`An error occurred while setting the alarm state: ${err}`));
        }
    }

    startListening() {
        this.log('Listening to alarm events...');
        this.simplisafe.subscribeToEvents(event => {
            this.log(`Received new event from alarm: ${event}`);
            switch (event) {
                case 'DISARM':
                case 'CANCEL':
                case 'OFF':
                    this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, this.Characteristic.SecuritySystemCurrentState.DISARMED);
                    this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, this.Characteristic.SecuritySystemTargetState.DISARM);
                    break;
                case 'HOME_ARM':
                    this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, this.Characteristic.SecuritySystemCurrentState.STAY_ARM);
                    this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, this.Characteristic.SecuritySystemTargetState.STAY_ARM);
                    break;
                case 'AWAY_ARM':
                    this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, this.Characteristic.SecuritySystemCurrentState.AWAY_ARM);
                    this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, this.Characteristic.SecuritySystemTargetState.AWAY_ARM);
                    break;
                case 'HOME_EXIT_DELAY':
                    this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, this.homekitState);
                    this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, this.Characteristic.SecuritySystemTargetState.STAY_ARM);
                    break;
                case 'AWAY_EXIT_DELAY':
                    this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, this.homekitState);
                    this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, this.Characteristic.SecuritySystemTargetState.AWAY_ARM);
                    break;
                default:
                    break;
            }
        });
    }

    // startRefreshState(interval = 10000) {
    //     if (this.refreshInterval) {
    //         this.stopRefreshState();
    //     }

    //     this.refreshInterval = setInterval(() => {
    //         this.refreshState();
    //     }, interval);
    // }

    // stopRefreshState() {
    //     if (this.refreshInterval) {
    //         clearInterval(this.refreshInterval);
    //         this.refreshInterval = null;
    //     }
    // }

    // async refreshState() {
    //     try {
    //         let state = await this.simplisafe.getAlarmState();
    //         let homekitState = this.CURRENT_SS3_TO_HOMEKIT[state];
    //         if (homekitState !== this.currentState) {
    //             this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, homekitState);
    //             this.currentState = homekitState;
    //             this.log(`Updated current state for ${this.name}: ${state}`);
    //         }
    //     } catch (err) {
    //         this.log('An error occurred while refreshing state');
    //         this.log(err);
    //     }
    // }

}

export default SS3Alarm;