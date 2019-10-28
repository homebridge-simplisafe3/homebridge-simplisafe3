class SS3DoorLock {

    constructor(name, id, log, simplisafe, Service, Characteristic, UUIDGen) {

        this.Characteristic = Characteristic;
        this.Service = Service;
        this.id = id;
        this.log = log;
        this.name = name;
        this.simplisafe = simplisafe;
        this.uuid = UUIDGen.generate(id);

        this.CURRENT_SS3_TO_HOMEKIT = {
            1: Characteristic.LockCurrentState.SECURED,
            0: Characteristic.LockCurrentState.UNSECURED
        };

        this.TARGET_SS3_TO_HOMEKIT = {
            1: Characteristic.LockTargetState.SECURED,
            0: Characteristic.LockTargetState.UNSECURED
        };

        this.TARGET_HOMEKIT_TO_SS3 = {
            [Characteristic.LockTargetState.SECURED]: 1,
            [Characteristic.LockTargetState.UNSECURED]: 0
        };

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
            .setCharacteristic(this.Characteristic.Model, 'Door Lock')
            .setCharacteristic(this.Characteristic.SerialNumber, this.id);

        this.service = this.accessory.getService(this.Service.LockMechanism);

        this.service.getCharacteristic(this.Characteristic.LockCurrentState)
            .on('get', async callback => this.getCurrentState(callback));
        this.service.getCharacteristic(this.Characteristic.LockTargetState)
            .on('get', async callback => this.getTargetState(callback))
            .on('set', async (state, callback) => this.setTargetState(state, callback));

        this.service.getCharacteristic(this.Characteristic.StatusLowBattery)
            .on('get', async callback => this.getBatteryStatus(callback));

        this.refreshState();
    }

    async updateReachability() {
        try {
            let lock = await this.getLockInformation();
            if (!lock) {
                this.reachable = false;
            } else {
                if (lock.flags) {
                    this.reachable = !lock.flags.offline;
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

    async getLockInformation() {
        try {
            let locks = await this.simplisafe.getLocks();
            let lock = locks.find(l => l.serial === this.id);

            if (!lock) {
                throw new Error('Could not find lock');
            }

            return lock;
        } catch (err) {
            throw new Error(`An error occurred while getting lock: ${err}`);
        }
    }

    async getCurrentState(callback) {
        this.log('Getting current lock state...');
        try {
            let lock = await this.getLockInformation();
            let state = lock.status.lockState;
            let homekitState = this.TARGET_SS3_TO_HOMEKIT[state];

            if (lock.status.lockJamState) {
                homekitState = this.Characteristic.LockCurrentState.JAMMED;
            }

            if (lock.status.lockDisabled) {
                homekitState = this.Characteristic.LockCurrentState.UNKNOWN;
            }

            this.log(`Current lock state is: ${homekitState}`);
            callback(null, homekitState);
        } catch (err) {
            callback(new Error(`An error occurred while getting the current door lock state: ${err}`));
        }
    }

    async getTargetState(callback) {
        this.log('Getting target lock state...');
        try {
            let lock = await this.getLockInformation();
            let state = lock.status.lockState;
            let homekitState = this.TARGET_SS3_TO_HOMEKIT[state];
            this.log(`Target lock state is: ${homekitState}`);
            callback(null, homekitState);
        } catch (err) {
            callback(new Error(`An error occurred while getting the target door lock state: ${err}`));
        }
    }

    async setTargetState(homekitState, callback) {
        let state = this.TARGET_HOMEKIT_TO_SS3[homekitState];
        this.log(`Setting target lock state to ${state}, ${homekitState}`);

        if (!this.service) {
            callback(new Error('Lock not linked to Homebridge service'));
            return;
        }

        try {
            let data = await this.simplisafe.setLockState(this.id, state);
            this.log(`Updated lock state: ${JSON.stringify(data)}`);

            // Need to set the characteristic here... depends on response body

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

    async getBatteryStatus(callback) {
        try {
            let lock = await this.getLockInformation();

            if (!lock.flags || !lock.status) {
                throw new Error('Lock response not understood');
            }

            let batteryLow = lock.flags.lowBattery || lock.status.lockLowBattery;
            let homekitState = batteryLow ? this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
            callback(null, homekitState);

        } catch (err) {
            callback(new Error(`An error occurred while getting lock battery level: ${err}`));
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