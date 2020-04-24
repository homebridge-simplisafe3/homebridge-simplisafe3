import {
    EVENT_TYPES,
    RateLimitError
} from '../simplisafe';

const eventSubscribeRetryInterval = 10000; // ms

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
            [Characteristic.LockTargetState.SECURED]: 'lock',
            [Characteristic.LockTargetState.UNSECURED]: 'unlock'
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
            .setCharacteristic(this.Characteristic.Model, 'Smart Lock')
            .setCharacteristic(this.Characteristic.SerialNumber, this.id);

        this.service = this.accessory.getService(this.Service.LockMechanism);

        this.service.getCharacteristic(this.Characteristic.LockCurrentState)
            .on('get', async callback => this.getCurrentState(callback));
        this.service.getCharacteristic(this.Characteristic.LockTargetState)
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

    async getCurrentState(callback, forceRefresh = false) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            return callback(new Error('Request blocked (rate limited)'));
        }

        if (!forceRefresh) {
            let state = this.service.getCharacteristic(this.Characteristic.LockCurrentState);
            return callback(null, state);
        }

        try {
            let lock = await this.getLockInformation();
            let state = lock.status.lockState;
            let homekitState = this.CURRENT_SS3_TO_HOMEKIT[state];

            if (lock.status.lockJamState) {
                homekitState = this.Characteristic.LockCurrentState.JAMMED;
            }

            if (lock.status.lockDisabled) {
                homekitState = this.Characteristic.LockCurrentState.UNKNOWN;
            }

            this.log(`Current lock state is: ${state}, ${homekitState}`);
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
            let state = this.service.getCharacteristic(this.Characteristic.LockTargetState);
            return callback(null, state);
        }

        try {
            let lock = await this.getLockInformation();
            let state = lock.status.lockState;
            let homekitState = this.TARGET_SS3_TO_HOMEKIT[state];
            this.log(`Target lock state is: ${state}, ${homekitState}`);
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
            await this.simplisafe.setLockState(this.id, state);
            this.log(`Updated lock state: ${state}`);
            this.service.updateCharacteristic(this.Characteristic.LockCurrentState, homekitState);
            callback(null);
        } catch (err) {
            callback(new Error(`An error occurred while setting the door lock state: ${err}`));
        }
    }

    async startListening() {
        try {
           if (this.simplisafe.isSocketConnected()) this.log(`${this.name} lock now listening for real time events.`);
           this.simplisafe.subscribeToEvents(async (event, data) => {
               switch (event) {
                  // Socket events
                   case EVENT_TYPES.CONNECTED:
                       this.log(`${this.name} lock now listening for real time events.`);
                     break;
                   case EVENT_TYPES.DISCONNECT:
                       this.log(`${this.name} lock real time events disconnected.`);
                     break;
                   case EVENT_TYPES.CONNECTION_LOST:
                       this.log(`${this.name} lock real time events connection lost. Attempting to restart...`);
                       this.startListening();
                       break;
               }

               if (this.service) {
                   if (data && data.sensorSerial && data.sensorSerial == this.id) {
                       // this.log(`${this.name} lock received new door lock event: ${event}`);
                       switch (event) {
                           case EVENT_TYPES.DOORLOCK_UNLOCKED:
                               this.service.updateCharacteristic(this.Characteristic.LockCurrentState, this.Characteristic.LockCurrentState.UNSECURED);
                               this.service.updateCharacteristic(this.Characteristic.LockTargetState, this.Characteristic.LockTargetState.UNSECURED);
                               break;
                           case EVENT_TYPES.DOORLOCK_LOCKED:
                               this.service.updateCharacteristic(this.Characteristic.LockCurrentState, this.Characteristic.LockCurrentState.SECURED);
                               this.service.updateCharacteristic(this.Characteristic.LockTargetState, this.Characteristic.LockTargetState.SECURED);
                               break;
                           case EVENT_TYPES.DOORLOCK_ERROR:
                               try {
                                   let lock = await this.getLockInformation();

                                   if (lock.status.lockJamState) {
                                       this.service.updateCharacteristic(this.Characteristic.LockCurrentState, this.Characteristic.LockCurrentState.JAMMED);
                                   } else if (lock.status.lockDisabled) {
                                       this.service.updateCharacteristic(this.Characteristic.LockCurrentState, this.Characteristic.LockCurrentState.UNKNOWN);
                                   }
                               } catch (err) {
                                   this.log(`An error occurred while updating ${this.name} lock error state: ${err}`);
                               }
                               break;
                           default:
                               this.log(`${this.name} lock ignoring unhandled event: ${event}`);
                               break;
                       }
                   }
               }
           });
        } catch (err) {
            if (err instanceof RateLimitError) {
                this.log(`${this.name} lock caught RateLimitError, waiting to retry...`);
                setTimeout(async () => {
                    await this.startListening();
                }, eventSubscribeRetryInterval);
            }
        }
    }

    async refreshState() {
        this.log('Refreshing door lock state');
        try {
            let lock = await this.getLockInformation();
            let state = lock.status.lockState;
            let homekitState = this.CURRENT_SS3_TO_HOMEKIT[state];
            this.service.updateCharacteristic(this.Characteristic.LockCurrentState, homekitState);
        } catch (err) {
            this.log('An error occurred while refreshing state');
            this.log(err);
        }
    }

}

export default SS3DoorLock;
