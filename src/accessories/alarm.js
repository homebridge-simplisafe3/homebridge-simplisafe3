const CURRENT_SS3_TO_HOMEKIT = {
    'OFF': this.Characteristic.SecuritySystemCurrentState.DISARM,
    'HOME': this.Characteristic.SecuritySystemCurrentState.STAY_ARM,
    'AWAY': this.Characteristic.SecuritySystemCurrentState.AWAY_ARM,
    'HOME_COUNT': this.Characteristic.SecuritySystemCurrentState.DISARM,
    'AWAY_COUNT': this.Characteristic.SecuritySystemCurrentState.DISARM,
    'ALARM_COUNT': this.Characteristic.SecuritySystemCurrentState.AWAY_ARM,
    'ALARM': this.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
};

const TARGET_SS3_TO_HOMEKIT = {
    'OFF': this.Characteristic.SecuritySystemTargetState.DISARM,
    'HOME': this.Characteristic.SecuritySystemTargetState.STAY_ARM,
    'AWAY': this.Characteristic.SecuritySystemTargetState.AWAY_ARM,
    'HOME_COUNT': this.Characteristic.SecuritySystemTargetState.STAY_ARM,
    'AWAY_COUNT': this.Characteristic.SecuritySystemTargetState.AWAY_ARM
};

const TARGET_HOMEKIT_TO_SS3 = {
    [this.Characteristic.SecuritySystemTargetState.DISARM]: 'OFF',
    [this.Characteristic.SecuritySystemTargetState.STAY_ARM]: 'HOME',
    [this.Characteristic.SecuritySystemTargetState.AWAY_ARM]: 'AWAY'
};

class SS3Alarm {

    constructor(name, id, log, simplisafe, Service, Characteristic, Accessory, UUIDGen) {

        this.Characteristic = Characteristic;
        this.log = log;
        this.name = name;
        this.simplisafe = simplisafe;
        this.uuid = UUIDGen.generate(id);
        
        this.currentState = null;

        this.accessory = new Accessory(name, this.uuid);
        this.accessory.on('identify', (paired, callback) => this.identify(paired, callback));

        this.service = new Service.SecuritySystem('Alarm System');
        this.service.getCharacteristic(Characteristic.SecuritySystemCurrentState)
            .on('get', callback => this.getCurrentState(callback));
        this.service.getCharacteristic(Characteristic.SecuritySystemTargetState)
            .on('get', callback => this.getTargetState(callback))
            .on('set', (state, callback) => this.setTargetState(state, callback));

        this.startRefreshState();
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

    getServices() {
        return [this.service];
    }

    async getState(stateType = 'current') {
        try {
            let state = await this.simplisafe.getAlarmState();
            this.log(`Received new alarm state from SimpliSafe: ${state}`);

            let homekitState = CURRENT_SS3_TO_HOMEKIT[state];
            if (stateType == 'target') {
                homekitState = TARGET_SS3_TO_HOMEKIT[state];
            }

            if (!this.currentState || this.currentState !== homekitState) {
                this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, homekitState);
            }

            return homekitState;
        } catch (err) {
            throw err;
        }
    }

    getCurrentState(callback) {
        this.getState('current')
            .then(homekitState => {
                callback(null, homekitState);
            })
            .catch(err => {
                callback(new Error(`An error occurred while getting the alarm state: ${err}`));
            });
    }

    getTargetState(callback) {
        this.getState('target')
            .then(homekitState => {
                callback(null, homekitState);
            })
            .catch(err => {
                callback(new Error(`An error occurred while getting the alarm state: ${err}`));
            });
    }

    setTargetState(homekitState, callback) {
        let state = TARGET_HOMEKIT_TO_SS3[homekitState];

        this.simplisafe.setAlarmState(state)
            .then(data => {
                this.log(`Updated alarm state: ${JSON.stringify(data)}`);

                this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, homekitState);
                this.currentState = homekitState;
                callback(null);
            })
            .catch(err => {
                callback(new Error(`An error occurred while setting the alarm state: ${err}`));
            });
    }

    startRefreshState(interval = 10000) {
        this.stopRefreshState();

        this.refreshInterval = setInterval(async () => {
            await this.refreshState();
        }, interval);
    }

    stopRefreshState() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    async refreshState() {
        try {
            let state = this.simplisafe.getAlarmState();
            let homekitState = CURRENT_SS3_TO_HOMEKIT[state];
            if (homekitState !== this.currentState) {
                this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, homekitState);
                this.currentState = homekitState;
                this.log(`Updated current state for ${this.name}: ${state}`);
            }
        } catch (err) {
            this.log('An error occurred while refreshing state');
            this.log(err);
        }
    }

}

export default SS3Alarm;