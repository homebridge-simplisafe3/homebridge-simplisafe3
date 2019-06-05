// © 2019 Niccolò Zapponi
// SimpliSafe 3 HomeBridge Plugin

import SimpliSafe3 from './simpilsafe';

let Service, Characteristic;
// OFF, HOME, AWAY, AWAY_COUNT, HOME_COUNT, SOUNDING

class SS3Accessory {

    CURRENT_SS3_TO_HOMEKIT = {
        'OFF': Characteristic.SecuritySystemCurrentState.DISARM,
        'HOME': Characteristic.SecuritySystemCurrentState.STAY_ARM,
        'AWAY': Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        'HOME_COUNT': Characteristic.SecuritySystemCurrentState.DISARM,
        'AWAY_COUNT': Characteristic.SecuritySystemCurrentState.DISARM,
        // 'SOUNDING': Characteristic.SecuritySystemCurrentState
    };

    TARGET_SS3_TO_HOMEKIT = {
        'OFF': Characteristic.SecuritySystemTargetState.DISARM,
        'HOME': Characteristic.SecuritySystemTargetState.STAY_ARM,
        'AWAY': Characteristic.SecuritySystemTargetState.AWAY_ARM
    };

    TARGET_HOMEKIT_TO_SS3 = {
        [Characteristic.SecuritySystemTargetState.DISARM]: 'OFF',
        [Characteristic.SecuritySystemTargetState.STAY_ARM]: 'HOME',
        [Characteristic.SecuritySystemTargetState.AWAY_ARM]: 'AWAY'
    };

    constructor(log, config) {
        this.log = log;
        this.name = config.name;
        this.services = {};

        this.simplisafe = new SimpliSafe3();

        this.simplisafe.login(config.auth.username, config.auth.password, true)
            .then(() => {
                this.log('Logged in!');

                if (config.subscriptionId) {
                    return this.simplisafe.getSubscription(config.subscriptionId);
                } else {
                    return this.simplisafe.getSubscription();
                }
            })
            .then(subscription => {
                this.log(`Subscription found: ${subscription.sid}`);

                this.services.alarm = new Service.SecuritySystem(this.name);
                this.services.alarm
                    .getCharacteristic(Characteristic.SecuritySystemCurrentState)
                    .on('get', callback => this.getCurrentAlarmState(callback));
                this.services.alarm
                    .getCharacteristic(Characteristic.SecuritySystemTargetState)
                    .on('get', callback => this.getTargetAlarmState(callback))
                    .on('set', (state, callback) => this.setTargetAlarmState(state, callback));

                // @TODO Load sensors
            })
            .catch(err => {
                this.log('Login failed');
                this.log(err);
            });
    }

    getCurrentAlarmState(callback) {
        this.simplisafe.getAlarmState()
            .then(state => {
                this.log(`Received new alarm state from SimpliSafe: ${state}`);
                // @TODO Convert to HomeKit state
                let homekitState = state;
                callback(null, homekitState);
            })
            .catch(err => {
                callback(new Error(`An error occurred while getting the alarm state: ${err}`));
            });
    }

    getTargetAlarmState(callback) {
        this.simplisafe.getAlarmState()
            .then(state => {
                this.log(`Received new alarm state from SimpliSafe: ${state}`);
                // @TODO Convert to HomeKit state
                // @TODO Probably need to adjust this so that we update the characteristic
                let homekitState = state;
                callback(null, homekitState);
            })
            .catch(err => {
                callback(new Error(`An error occurred while getting the alarm state: ${err}`));
            });
    }

    setTargetAlarmState(homekitState, callback) {
        // @TODO Convert to SS3 state
        let state = homekitState;

        this.simplisafe.setAlarmState(state)
            .then(data => {
                this.log(`Updated alarm state: ${JSON.stringify(data)}`);

                // @TODO Probably need to adjust this so that we set the target state and not the current state
                this.services.alarm.setCharacteristic(Characteristic.SecuritySystemCurrentState, state);
                callback(null);
            })
            .catch(err => {
                callback(new Error(`An error occurred while setting the alarm state: ${err}`));
            });
    }

    // getCurrentSensorState(sensor, callback) {

    // }

    // getTargetSensorState(sensor, callback) {

    // }

    // setTargetSensorState(sensor, state, callback) {

    // }

    identify(callback) {
        this.log('Identify!');
        callback();
    }

    getServices() {
        return Object.values(this.services);
    }

}

const homebridge = homebridge => {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    let accessory = new SS3Accessory();

    homebridge.registerAccessory('homebridge-simplisafe3', 'SimpliSafe 3', accessory);
};

module.exports = homebridge;
