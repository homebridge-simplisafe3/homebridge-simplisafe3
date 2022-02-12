import SimpliSafe3Accessory from './ss3Accessory';

import {
    EVENT_TYPES,
    SENSOR_TYPES
} from '../simplisafe';

import AUTH_EVENTS from '../lib/authManager';

const targetStateMaxRetries = 5;

class SS3Alarm extends SimpliSafe3Accessory {

    constructor(name, id, log, debug, simplisafe, api) {
        super(name, id, log, debug, simplisafe, api);
        this.nRetries = 0;
        this.nSocketConnectFailures = 0;
        this.services.push(this.api.hap.Service.SecuritySystem);

        this.SS3_TO_HOMEKIT_CURRENT = {
            'OFF': this.api.hap.Characteristic.SecuritySystemCurrentState.DISARMED,
            'HOME': this.api.hap.Characteristic.SecuritySystemCurrentState.STAY_ARM,
            'AWAY': this.api.hap.Characteristic.SecuritySystemCurrentState.AWAY_ARM,
            'HOME_COUNT': this.api.hap.Characteristic.SecuritySystemCurrentState.DISARMED,
            'AWAY_COUNT': this.api.hap.Characteristic.SecuritySystemCurrentState.DISARMED,
            'ALARM_COUNT': this.api.hap.Characteristic.SecuritySystemCurrentState.AWAY_ARM,
            'ALARM': this.api.hap.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
        };

        this.SS3_TO_HOMEKIT_TARGET = {
            'OFF': this.api.hap.Characteristic.SecuritySystemTargetState.DISARM,
            'HOME': this.api.hap.Characteristic.SecuritySystemTargetState.STAY_ARM,
            'AWAY': this.api.hap.Characteristic.SecuritySystemTargetState.AWAY_ARM,
            'HOME_COUNT': this.api.hap.Characteristic.SecuritySystemTargetState.STAY_ARM,
            'AWAY_COUNT': this.api.hap.Characteristic.SecuritySystemTargetState.AWAY_ARM
        };

        this.HOMEKIT_TARGET_TO_SS3 = {
            [this.api.hap.Characteristic.SecuritySystemTargetState.DISARM]: 'OFF',
            [this.api.hap.Characteristic.SecuritySystemTargetState.STAY_ARM]: 'HOME',
            [this.api.hap.Characteristic.SecuritySystemTargetState.AWAY_ARM]: 'AWAY'
        };

        this.VALID_CURRENT_STATE_VALUES = [
            this.api.hap.Characteristic.SecuritySystemCurrentState.STAY_ARM,
            this.api.hap.Characteristic.SecuritySystemCurrentState.AWAY_ARM,
            this.api.hap.Characteristic.SecuritySystemCurrentState.DISARMED,
            this.api.hap.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
        ];

        this.VALID_TARGET_STATE_VALUES = [
            this.api.hap.Characteristic.SecuritySystemTargetState.STAY_ARM,
            this.api.hap.Characteristic.SecuritySystemTargetState.AWAY_ARM,
            this.api.hap.Characteristic.SecuritySystemTargetState.DISARM
        ];

        // SimpliSafe events
        this.startListening();

        // handle authentication failures
        this.simplisafe.authManager.on(AUTH_EVENTS.REFRESH_CREDENTIALS_SUCCESS, () => {
            if (this.service) this.setFault(false);
        });
        this.simplisafe.authManager.on(AUTH_EVENTS.REFRESH_CREDENTIALS_FAILURE, () => {
            if (this.service) this.setFault();
        });

        this.simplisafe.subscribeToAlarmSystem(this.id, system => {
            // update power outage status in case event was never received i.e. wifi out
            this.service.updateCharacteristic(this.api.hap.Characteristic.StatusTampered, system.powerOutage ? this.api.hap.Characteristic.StatusTampered.TAMPERED : this.api.hap.Characteristic.StatusTampered.NOT_TAMPERED);
        });
    }

    setAccessory(accessory) {
        super.setAccessory(accessory);

        this.accessory.getService(this.api.hap.Service.AccessoryInformation)
            .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'SimpliSafe')
            .setCharacteristic(this.api.hap.Characteristic.Model, 'SimpliSafe 3')
            .setCharacteristic(this.api.hap.Characteristic.SerialNumber, this.id);

        this.service = this.accessory.getService(this.api.hap.Service.SecuritySystem);

        this.service.getCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState)
            .setProps({ validValues: this.VALID_CURRENT_STATE_VALUES })
            .on('get', async callback => this.getCurrentState(callback));
        this.service.getCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState)
            .setProps({ validValues: this.VALID_TARGET_STATE_VALUES })
            .on('get', async callback => this.getTargetState(callback))
            .on('set', async (state, callback) => this.setTargetState(state, callback));

        this.refreshState();
    }

    async updateReachability() {
        try {
            let subscription = await this.simplisafe.getSubscription();
            let connType = subscription.location.system.connType;
            this.reachable = connType == 'wifi' || connType == 'cell';
            if (this.debug) this.log(`Reachability updated for ${this.name}: ${this.reachable}`);
        } catch (err) {
            this.log.error(`An error occurred while updating reachability for ${this.name}`);
            this.log.error(err);
        }
    }

    async getCurrentState(callback, forceRefresh = false) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            return callback(new Error('Request blocked (rate limited)'));
        }

        if (!forceRefresh) {
            let characteristic = this.service.getCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState);
            return callback(null, characteristic.value);
        }

        try {
            let state = await this.getAlarmState();
            let homekitState = this.SS3_TO_HOMEKIT_CURRENT[state];
            if (this.debug) this.log(`Current alarm state is: ${homekitState}`);
            callback(null, homekitState);
        } catch (err) {
            callback(new Error(`An error occurred while getting the current alarm state: ${err}`));
        }
    }

    async getTargetState(callback, forceRefresh = false) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            return callback(new Error('Request blocked (rate limited)'));
        }

        if (!forceRefresh) {
            let characteristic = this.service.getCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState);
            return callback(null, characteristic.value);
        }

        try {
            let state = await this.getAlarmState();
            let homekitState = this.SS3_TO_HOMEKIT_TARGET[state];
            if (this.debug) this.log(`Target alarm state is: ${homekitState}`);
            callback(null, homekitState);
        } catch (err) {
            callback(new Error(`An error occurred while getting the target alarm state: ${err}`));
        }
    }

    async setTargetState(homekitState, callback) {
        let state = this.HOMEKIT_TARGET_TO_SS3[homekitState];
        if (this.debug) this.log(`Setting target state to ${state}, ${homekitState}`);

        if (!this.service) {
            this.log.error('Alarm not linked to Homebridge service');
            callback(new Error('Alarm not linked to Homebridge service'));
            return;
        }

        try {
            let data = await this.simplisafe.setAlarmState(state);
            if (this.debug) this.log(`Updated alarm state: ${JSON.stringify(data)}`);
            if (data.state == 'OFF') {
                this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState, this.api.hap.Characteristic.SecuritySystemCurrentState.DISARMED);
            } else if (data.exitDelay && data.exitDelay > 0) {
                setTimeout(async () => {
                    await this.refreshState();
                }, data.exitDelay * 1000);
            }
            this.nRetries = 0;
            this.setFault(false);
            callback(null);
        } catch (err) {
            if ([409, 504].indexOf(parseInt(err.statusCode)) !== -1 && this.nRetries < targetStateMaxRetries) { // 409 = SettingsInProgress, 504 = GatewayTimeout
                if (this.debug) this.log(`${err.type} error while setting alarm state. nRetries: ${this.nRetries}`);
                this.nRetries++;
                setTimeout(async () => {
                    if (this.debug) this.log('Retrying setTargetState.');
                    await this.setTargetState(homekitState, callback);
                }, 1000); // wait 1  second and try again
            } else {
                this.log.error('Error while setting alarm state:', err);
                this.nRetries = 0;
                this.setFault();
                callback(new Error(`An error occurred while setting the alarm state: ${err}`));
            }
        }
    }

    startListening() {
        this.simplisafe.on(EVENT_TYPES.ALARM_TRIGGER, (data) => {
            if (!this._validateEvent(EVENT_TYPES.ALARM_TRIGGER, data)) return;
            this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState, this.api.hap.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED);
        });

        this.simplisafe.on(EVENT_TYPES.ALARM_DISARM, (data) => {
            if (!this._validateEvent(EVENT_TYPES.ALARM_DISARM, data)) return;
            this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState, this.api.hap.Characteristic.SecuritySystemTargetState.DISARM);
            this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState, this.api.hap.Characteristic.SecuritySystemCurrentState.DISARMED);
        });

        this.simplisafe.on(EVENT_TYPES.ALARM_CANCEL, (data) => {
            if (!this._validateEvent(EVENT_TYPES.ALARM_CANCEL, data)) return;
            this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState, this.api.hap.Characteristic.SecuritySystemTargetState.DISARM);
            this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState, this.api.hap.Characteristic.SecuritySystemCurrentState.DISARMED);
        });

        this.simplisafe.on(EVENT_TYPES.HOME_ARM, (data) => {
            if (!this._validateEvent(EVENT_TYPES.HOME_ARM, data)) return;
            this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState, this.api.hap.Characteristic.SecuritySystemTargetState.STAY_ARM);
            this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState, this.api.hap.Characteristic.SecuritySystemCurrentState.STAY_ARM);
        });

        this.simplisafe.on(EVENT_TYPES.ALARM_OFF, (data) => {
            if (!this._validateEvent(EVENT_TYPES.ALARM_OFF, data)) return;
            this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState, this.api.hap.Characteristic.SecuritySystemTargetState.DISARM);
            this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState, this.api.hap.Characteristic.SecuritySystemCurrentState.DISARMED);
        });

        this.simplisafe.on(EVENT_TYPES.AWAY_ARM, (data) => {
            if (!this._validateEvent(EVENT_TYPES.AWAY_ARM, data)) return;
            this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState, this.api.hap.Characteristic.SecuritySystemTargetState.AWAY_ARM);
            this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState, this.api.hap.Characteristic.SecuritySystemCurrentState.AWAY_ARM);
        });

        this.simplisafe.on(EVENT_TYPES.HOME_EXIT_DELAY, (data) => {
            if (!this._validateEvent(EVENT_TYPES.HOME_EXIT_DELAY, data)) return;
            this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState, this.api.hap.Characteristic.SecuritySystemTargetState.STAY_ARM);
        });

        this.simplisafe.on(EVENT_TYPES.AWAY_EXIT_DELAY, (data) => {
            if (!this._validateEvent(EVENT_TYPES.AWAY_EXIT_DELAY, data)) return;
            this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState, this.api.hap.Characteristic.SecuritySystemTargetState.AWAY_ARM);
        });

        this.simplisafe.on(EVENT_TYPES.POWER_OUTAGE, (data) => {
            if (!this._validateEvent(EVENT_TYPES.POWER_OUTAGE, data)) return;
            this.service.updateCharacteristic(this.api.hap.Characteristic.StatusTampered, this.api.hap.Characteristic.StatusTampered.TAMPERED);
            if (data.messageBody) this.log.warn(data.messageBody);
        });

        this.simplisafe.on(EVENT_TYPES.POWER_RESTORED, (data) => {
            if (!this._validateEvent(EVENT_TYPES.POWER_RESTORED, data)) return;
            this.service.updateCharacteristic(this.api.hap.Characteristic.StatusTampered, this.api.hap.Characteristic.StatusTampered.NOT_TAMPERED);
            if (data.messageBody) this.log.warn(data.messageBody);
        });
    }

    _validateEvent(event, data) {
        if (this.debug) this.log('Alarm received event:', event);
        if (event == EVENT_TYPES.ALARM_TRIGGER) return !!this.service; // just make sure this.service
        else return this.service && data && (data.sensorType == SENSOR_TYPES.APP || data.sensorType == SENSOR_TYPES.KEYPAD || data.sensorType == SENSOR_TYPES.KEYCHAIN || data.sensorType == SENSOR_TYPES.DOORLOCK);
    }

    async refreshState() {
        if (this.debug) this.log('Refreshing alarm state');
        try {
            let state = await this.getAlarmState();
            let currentHomekitState = this.SS3_TO_HOMEKIT_CURRENT[state];
            let targetHomekitState = this.SS3_TO_HOMEKIT_TARGET[state];
            this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState, currentHomekitState);
            this.service.updateCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState, targetHomekitState);
            if (this.debug) this.log(`Updated current state for ${this.name}: ${state}`);
            this.setFault(false);
        } catch (err) {
            this.log.error('An error occurred while refreshing state');
            this.log.error(err);
            this.setFault();
        }
    }

    async getAlarmState(forceRefresh = false, retry = false) {
        let system = await this.simplisafe.getAlarmSystem(forceRefresh);
        this.setFault(false); // if above succeeded auth is working

        if (system.isAlarming) {
            return 'ALARM';
        }

        let alarmState = system.alarmState;
        if (!Object.keys(this.SS3_TO_HOMEKIT_CURRENT).includes(alarmState)) {
            if (!retry) {
                let retriedState = await this.getAlarmState(true, true);
                return retriedState;
            } else {
                throw new Error('Alarm state not understood');
            }
        }

        return alarmState;
    }

    setFault(fault = true) {
        this.service.updateCharacteristic(this.api.hap.Characteristic.StatusFault, fault ? this.api.hap.Characteristic.StatusFault.GENERAL_FAULT : this.api.hap.Characteristic.StatusFault.NO_FAULT);
    }

}

export default SS3Alarm;
