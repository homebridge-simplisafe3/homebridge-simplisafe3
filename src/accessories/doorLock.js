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

        // SimpliSafe events
        this.startListening();

        this.simplisafe.subscribeToSensor(this.id, lock => {
            if (this.service) {
                this.refreshState(lock);
            }
        });
    }

    // LockMechanism is not spec'd with StatusFault; skip base-class wiring.
    _primaryServiceForFault() {
        return null;
    }

    setAccessory(accessory) {
        super.setAccessory(accessory);

        this.accessory.getService(this.api.hap.Service.AccessoryInformation)
            .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'SimpliSafe')
            .setCharacteristic(this.api.hap.Characteristic.Model, 'Smart Lock')
            .setCharacteristic(this.api.hap.Characteristic.SerialNumber, this.id);

        this.service = this.accessory.getService(this.api.hap.Service.LockMechanism);

        this.service.getCharacteristic(this.api.hap.Characteristic.LockCurrentState)
            .onGet(() => this.getCurrentState());
        this.service.getCharacteristic(this.api.hap.Characteristic.LockTargetState)
            .onGet(() => this.getTargetState())
            .onSet(value => this.setTargetState(value));

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

    async getCurrentState(forceRefresh = false) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }

        if (!forceRefresh) {
            return this.service.getCharacteristic(this.api.hap.Characteristic.LockCurrentState).value;
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
            return homekitState;
        } catch (err) {
            this.log.error(`An error occurred while getting the current door lock state: ${err}`);
            throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
    }

    async getTargetState(forceRefresh = false) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }

        if (!forceRefresh) {
            return this.service.getCharacteristic(this.api.hap.Characteristic.LockTargetState).value;
        }

        try {
            let lock = await this.getLockInformation();
            let state = lock.status.lockState;
            let homekitState = this.SS3_TO_HOMEKIT_TARGET[state];
            if (this.debug) this.log(`Target '${this.name}' lock state is: ${state}, ${homekitState}`);
            return homekitState;
        } catch (err) {
            this.log.error(`An error occurred while getting the '${this.name}' target door lock state: ${err}`);
            throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
    }

    async setTargetState(homekitState) {
        let state = this.HOMEKIT_TARGET_TO_SS3[homekitState];
        if (this.debug) this.log(`Setting '${this.name}' target lock state to ${state}, ${homekitState}`);

        if (!this.service) {
            throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }

        try {
            await this.simplisafe.setLockState(this.id, state);
            if (this.debug) this.log(`Updated SS lock state for '${this.name}': ${state}`);
            // techincally this should be LockTargetState but this feels faster and has no apparent side-effects
            this.service.updateCharacteristic(this.api.hap.Characteristic.LockCurrentState, homekitState);
        } catch (err) {
            this.log.error(`An error occurred while setting the '${this.name}' target door lock state: ${err}`);
            throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
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

    async refreshState(lock = undefined) {
        if (this.debug && !lock) this.log(`Refreshing '${this.name}' door lock state`);
        try {
            if (lock == undefined) lock = await this.getLockInformation();
            let state = lock.status.lockState;
            let homekitCurrentState = this.SS3_TO_HOMEKIT_CURRENT[state];
            if (lock.status.lockJamState) homekitCurrentState = this.api.hap.Characteristic.LockCurrentState.JAMMED;
            let homekitTargetState = this.SS3_TO_HOMEKIT_TARGET[state];
            this.service.updateCharacteristic(this.api.hap.Characteristic.LockCurrentState, homekitCurrentState);
            this.service.updateCharacteristic(this.api.hap.Characteristic.LockTargetState, homekitTargetState);

            let homekitBatteryState = lock.flags && lock.flags.lowBattery ? this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
            this.service.updateCharacteristic(this.api.hap.Characteristic.StatusLowBattery, homekitBatteryState);

            if (this.debug && !lock) this.log(`Updated current state, target state, battery status for lock ${this.name}: ${homekitCurrentState}, ${homekitTargetState}, ${homekitBatteryState}`);
        } catch (err) {
            this.log.error('An error occurred while refreshing state');
            this.log.error(err);
        }
    }

}

export default SS3DoorLock;
