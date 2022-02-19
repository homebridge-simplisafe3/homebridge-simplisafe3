import SimpliSafe3Accessory from './ss3Accessory';
import { EVENT_TYPES } from '../simplisafe';

class SS3DoorLock extends SimpliSafe3Accessory {

    constructor(name, id, log, debug, simplisafe, api) {
        super(name, id, log, debug, simplisafe, api);
        this.services.push(this.api.hap.Service.LockMechanism);

        this.SS3_TO_HOMEKIT_CURRENT = {
            0: this.api.hap.Characteristic.LockCurrentState.UNSECURED, // may not exist
            1: this.api.hap.Characteristic.LockCurrentState.SECURED,
            2: this.api.hap.Characteristic.LockCurrentState.UNSECURED,
            99: this.api.hap.Characteristic.LockCurrentState.UNKNOWN
        };

        this.SS3_TO_HOMEKIT_TARGET = {
            0: this.api.hap.Characteristic.LockTargetState.UNSECURED, // may not exist
            1: this.api.hap.Characteristic.LockTargetState.SECURED,
            2: this.api.hap.Characteristic.LockTargetState.UNSECURED,
            99: this.api.hap.Characteristic.LockTargetState.UNSECURED
        };

        this.HOMEKIT_TARGET_TO_SS3 = {
            [this.api.hap.Characteristic.LockTargetState.SECURED]: 'lock',
            [this.api.hap.Characteristic.LockTargetState.UNSECURED]: 'unlock'
        };

        this.startListening();

        this.simplisafe.subscribeToSensor(this.id, lock => {
            if (this.service) {
                let batteryStatus = lock.flags && lock.flags.lowBattery ? this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
                this.service.updateCharacteristic(this.api.hap.Characteristic.StatusLowBattery, batteryStatus);
            }
        });
    }

    setAccessory(accessory) {
        super.setAccessory(accessory);

        this.accessory.getService(this.api.hap.Service.AccessoryInformation)
            .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'SimpliSafe')
            .setCharacteristic(this.api.hap.Characteristic.Model, 'Smart Lock')
            .setCharacteristic(this.api.hap.Characteristic.SerialNumber, this.id);

        this.service = this.accessory.getService(this.api.hap.Service.LockMechanism);

        this.service.getCharacteristic(this.api.hap.Characteristic.LockCurrentState)
            .on('get', async callback => this.getCurrentState(callback));
        this.service.getCharacteristic(this.api.hap.Characteristic.LockTargetState)
            .on('get', async callback => this.getTargetState(callback))
            .on('set', async (state, callback) => this.setTargetState(state, callback));

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
            this.log.error(`An error occurred while updating reachability for ${this.name}`);
            this.log.error(err);
        }
    }

    async getLockInformation() {
        try {
            let locks = await this.simplisafe.getLocks();
            let lock = locks.find(l => l.serial === this.id);

            if (!lock) {
                throw new Error(`Could not find lock ${this.name}`);
            }

            return lock;
        } catch (err) {
            throw new Error(`An error occurred while getting '${this.name}' lock information from SS: ${err}`);
        }
    }

    async getCurrentState(callback, forceRefresh = false) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            return callback(new Error('Request blocked (rate limited)'));
        }

        if (!forceRefresh) {
            let characteristic = this.service.getCharacteristic(this.api.hap.Characteristic.LockCurrentState);
            return callback(null, characteristic.value);
        }

        try {
            let lock = await this.getLockInformation();
            let state = lock.status.lockState;
            let homekitState = this.SS3_TO_HOMEKIT_CURRENT[state];

            if (lock.status.lockJamState) {
                homekitState = this.api.hap.Characteristic.LockCurrentState.JAMMED;
            }

            if (lock.status.lockDisabled) {
                homekitState = this.api.hap.Characteristic.LockCurrentState.UNKNOWN;
            }

            if (this.debug) this.log(`Current '${this.name}' lock state is: ${state}, ${homekitState}`);
            callback(null, homekitState);
        } catch (err) {
            callback(new Error(`An error occurred while getting the current door lock state: ${err}`));
        }

    }

    async getTargetState(callback, forceRefresh = false) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            return callback(new Error('Request blocked (rate limited)'));
        }

        if (!forceRefresh) {
            let characteristic = this.service.getCharacteristic(this.api.hap.Characteristic.LockTargetState);
            return callback(null, characteristic.value);
        }

        try {
            let lock = await this.getLockInformation();
            let state = lock.status.lockState;
            let homekitState = this.SS3_TO_HOMEKIT_TARGET[state];
            if (this.debug) this.log(`Target '${this.name}' lock state is: ${state}, ${homekitState}`);
            callback(null, homekitState);
        } catch (err) {
            callback(new Error(`An error occurred while getting the '${this.name}' target door lock state: ${err}`));
        }
    }

    async setTargetState(homekitState, callback) {
        let state = this.HOMEKIT_TARGET_TO_SS3[homekitState];
        if (this.debug) this.log(`Setting '${this.name}' target lock state to ${state}, ${homekitState}`);

        if (!this.service) {
            callback(new Error('Lock not linked to Homebridge service'));
            return;
        }

        try {
            await this.simplisafe.setLockState(this.id, state);
            if (this.debug) this.log(`Updated SS lock state for '${this.name}': ${state}`);
            // techincally this should be LockTargetState but this feels faster and has no apparent side-effects
            this.service.updateCharacteristic(this.api.hap.Characteristic.LockCurrentState, homekitState);
            callback(null);
        } catch (err) {
            callback(new Error(`An error occurred while setting the '${this.name}' target door lock state: ${err}`));
        }
    }

    startListening() {
        this.simplisafe.on(EVENT_TYPES.DOORLOCK_UNLOCKED, (data) => {
            if (!this._validateEvent(EVENT_TYPES.DOORLOCK_UNLOCKED, data)) return;
            this.service.updateCharacteristic(this.api.hap.Characteristic.LockTargetState, this.api.hap.Characteristic.LockTargetState.UNSECURED);
            this.service.updateCharacteristic(this.api.hap.Characteristic.LockCurrentState, this.api.hap.Characteristic.LockCurrentState.UNSECURED);
        });

        this.simplisafe.on(EVENT_TYPES.DOORLOCK_LOCKED, (data) => {
            if (!this._validateEvent(EVENT_TYPES.DOORLOCK_LOCKED, data)) return;
            this.service.updateCharacteristic(this.api.hap.Characteristic.LockTargetState, this.api.hap.Characteristic.LockTargetState.SECURED);
            this.service.updateCharacteristic(this.api.hap.Characteristic.LockCurrentState, this.api.hap.Characteristic.LockCurrentState.SECURED);
        });

        this.simplisafe.on(EVENT_TYPES.DOORLOCK_ERROR, (data) => {
            if (!this._validateEvent(EVENT_TYPES.DOORLOCK_ERROR, data)) return;
            try {
                this.getLockInformation().then((lock) => {
                    if (lock.status.lockJamState) {
                        this.service.updateCharacteristic(this.api.hap.Characteristic.LockCurrentState, this.api.hap.Characteristic.LockCurrentState.JAMMED);
                    } else if (lock.status.lockDisabled) {
                        this.service.updateCharacteristic(this.api.hap.Characteristic.LockCurrentState, this.api.hap.Characteristic.LockCurrentState.UNKNOWN);
                    }
                });
            } catch (err) {
                this.log.error(`An error occurred while updating '${this.name}' lock error state: ${err}`);
            }
        });
    }

    _validateEvent(event, data) {
        let valid = this.service && data && data.sensorSerial && data.sensorSerial == this.id;
        if (this.debug && valid) this.log(`Lock '${this.name}' received event: ${event}`);
        return valid;
    }

    async refreshState() {
        if (this.debug) this.log(`Refreshing '${this.name}' door lock state`);
        try {
            let lock = await this.getLockInformation();
            let state = lock.status.lockState;
            let homekitCurrentState = this.SS3_TO_HOMEKIT_CURRENT[state];
            if (lock.status.lockJamState) homekitCurrentState = this.api.hap.Characteristic.LockCurrentState.JAMMED;
            let homekitTargetState = this.SS3_TO_HOMEKIT_TARGET[state];
            this.service.updateCharacteristic(this.api.hap.Characteristic.LockCurrentState, homekitCurrentState);
            this.service.updateCharacteristic(this.api.hap.Characteristic.LockTargetState, homekitTargetState);

            let homekitBatteryState = lock.flags && lock.flags.lowBattery ? this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
            this.service.updateCharacteristic(this.api.hap.Characteristic.StatusLowBattery, homekitBatteryState);

            if (this.debug) this.log(`Updated current state, target state, battery status for lock ${this.name}: ${homekitCurrentState}, ${homekitTargetState}, ${homekitBatteryState}`);
        } catch (err) {
            this.log.error('An error occurred while refreshing state');
            this.log.error(err);
        }
    }

}

export default SS3DoorLock;
