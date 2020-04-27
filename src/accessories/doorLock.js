import {
    EVENT_TYPES,
    RateLimitError,
    SOCKET_RETRY_INTERVAL
} from '../simplisafe';

class SS3DoorLock {

    constructor(name, id, log, debug, simplisafe, Service, Characteristic, UUIDGen) {

        this.Characteristic = Characteristic;
        this.Service = Service;
        this.id = id;
        this.log = log;
        this.debug = debug;
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
        if (this.debug) this.log(`Identify request for ${this.name}, paired: ${paired}`);
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

            if (this.debug) this.log(`Current lock state is: ${state}, ${homekitState}`);
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
            if (this.debug) this.log(`Target lock state is: ${state}, ${homekitState}`);
            callback(null, homekitState);
        } catch (err) {
            callback(new Error(`An error occurred while getting the target door lock state: ${err}`));
        }
    }

    async setTargetState(homekitState, callback) {
        let state = this.TARGET_HOMEKIT_TO_SS3[homekitState];
        if (this.debug) this.log(`Setting target lock state to ${state}, ${homekitState}`);

        if (!this.service) {
            callback(new Error('Lock not linked to Homebridge service'));
            return;
        }

        try {
            await this.simplisafe.setLockState(this.id, state);
            if (this.debug) this.log(`Updated lock state: ${state}`);
            this.service.updateCharacteristic(this.Characteristic.LockCurrentState, homekitState);
            callback(null);
        } catch (err) {
            callback(new Error(`An error occurred while setting the door lock state: ${err}`));
        }
    }

    async startListening() {
        if (this.debug && this.simplisafe.isSocketConnected()) this.log(`${this.name} lock now listening for real time events.`);
        try {
           this.simplisafe.subscribeToEvents(async (event, data) => {
               switch (event) {
                  // Socket events
                   case EVENT_TYPES.CONNECTED:
                       if (this.debug) this.log(`${this.name} lock now listening for real time events.`);
                       this.nSocketConnectFailures = 0;
                       break;
                   case EVENT_TYPES.DISCONNECT:
                       if (this.debug) this.log(`${this.name} lock real time events disconnected.`);
                       break;
                   case EVENT_TYPES.CONNECTION_LOST:
                       if (this.debug && this.nSocketConnectFailures == 0) this.log(`${this.name} lock real time events connection lost. Attempting to reconnect...`);
                       setTimeout(async () => {
                           await this.startListening();
                       }, SOCKET_RETRY_INTERVAL);
                       break;
               }

               if (this.service) {
                   // Door lock events
                   if (data && data.sensorSerial && data.sensorSerial == this.id) {
                       if (this.debug) this.log(`${this.name} lock received event: ${event}`);
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
                               if (this.debug) this.log(`${this.name} lock ignoring unhandled event: ${event}`);
                               break;
                       }
                   }
               }
           });
        } catch (err) {
            if (err instanceof RateLimitError) {
                let retryInterval = (2 ** this.nSocketConnectFailures) * SOCKET_RETRY_INTERVAL;
                if (this.debug) this.log(`${this.name} lock caught RateLimitError, waiting ${retryInterval/1000}s to retry...`);
                setTimeout(async () => {
                    await this.startListening();
                }, retryInterval);
                this.nSocketConnectFailures++;
            }
        }
    }

    async refreshState() {
        if (this.debug) this.log('Refreshing door lock state');
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
