import {
    EVENT_TYPES,
    RateLimitError,
    SOCKET_RETRY_INTERVAL
} from '../simplisafe';

const targetStateMaxRetries = 5;

class SS3Alarm {

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
            .setCharacteristic(this.Characteristic.Model, 'SimpliSafe 3')
            .setCharacteristic(this.Characteristic.SerialNumber, this.id);

        this.service = this.accessory.getService(this.Service.SecuritySystem);

        this.service.getCharacteristic(this.Characteristic.SecuritySystemCurrentState)
            .setProps({ validValues: this.VALID_CURRENT_STATE_VALUES })
            .on('get', async callback => this.getCurrentState(callback));
        this.service.getCharacteristic(this.Characteristic.SecuritySystemTargetState)
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
            this.log(`An error occurred while updating reachability for ${this.name}`);
            this.log(err);
        }
    }

    async getCurrentState(callback, forceRefresh = false) {
        if (this.simplisafe.isBlocked && Date.now() < this.simplisafe.nextAttempt) {
            return callback(new Error('Request blocked (rate limited)'));
        }

        if (!forceRefresh) {
            let state = this.service.getCharacteristic(this.Characteristic.SecuritySystemCurrentState);
            return callback(null, state);
        }

        try {
            let state = await this.simplisafe.getAlarmState();
            let homekitState = this.CURRENT_SS3_TO_HOMEKIT[state];
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
            let state = this.service.getCharacteristic(this.Characteristic.SecuritySystemTargetState);
            return callback(null, state);
        }

        try {
            let state = await this.simplisafe.getAlarmState();
            let homekitState = this.TARGET_SS3_TO_HOMEKIT[state];
            if (this.debug) this.log(`Target alarm state is: ${homekitState}`);
            callback(null, homekitState);
        } catch (err) {
            callback(new Error(`An error occurred while getting the target alarm state: ${err}`));
        }
    }

    async setTargetState(homekitState, callback) {
        let state = this.TARGET_HOMEKIT_TO_SS3[homekitState];
        if (this.debug) this.log(`Setting target state to ${state}, ${homekitState}`);

        if (!this.service) {
            this.log('Alarm not linked to Homebridge service');
            callback(new Error('Alarm not linked to Homebridge service'));
            return;
        }

        try {
            let data = await this.simplisafe.setAlarmState(state);
            if (this.debug) this.log(`Updated alarm state: ${JSON.stringify(data)}`);
            if (data.state == 'OFF') {
                this.service.updateCharacteristic(this.Characteristic.SecuritySystemCurrentState, this.Characteristic.SecuritySystemCurrentState.DISARMED);
            } else if (data.exitDelay && data.exitDelay > 0) {
                setTimeout(async () => {
                    await this.refreshState();
                }, data.exitDelay * 1000);
            }
            this.nRetries = 0;
            callback(null);
        } catch (err) {
            this.log('Error while setting alarm state:', err, 'nRetries:', this.nRetries);
            if (err.type == 'SettingsInProgress' && this.nRetries < targetStateMaxRetries) {
                this.nRetries++;
                setTimeout(async () => {
                    this.console.log('Retrying setTargetState...');
                    await this.setTargetState(homekitState, callback);
                }, 1000); // wait 1  second and try again
            } else {
                this.nRetries = 0;
                callback(new Error(`An error occurred while setting the alarm state: ${err}`));
            }
        }
    }

    async startListening() {
        if (this.debug && this.simplisafe.isSocketConnected()) this.log('Alarm now listening for real time events.');
        try {
            await this.simplisafe.subscribeToEvents((event, data) => {
                switch (event) {
                    // Socket events
                    case EVENT_TYPES.CONNECTED:
                        if (this.debug) this.log('Alarm now listening for real time events.');
                        this.nSocketConnectFailures = 0;
                        break;
                    case EVENT_TYPES.DISCONNECT:
                        if (this.debug) this.log('Alarm real time events disconnected.');
                        break;
                    case EVENT_TYPES.CONNECTION_LOST:
                        if (this.debug && this.nSocketConnectFailures == 0) this.log('Alarm real time events connection lost. Attempting to reconnect...');
                        setTimeout(async () => {
                            await this.startListening();
                        }, SOCKET_RETRY_INTERVAL);
                        break;
                }
                if (this.service && data && (data.sensorType == 0 || data.sensorType == 1 || data.sensorType == 2)) {
                    // Alarm events (0 = app, 1 = keypad, 2 = fob)
                    if (this.debug) this.log('Alarm received event:', event);
                    switch (event) {
                        case EVENT_TYPES.ALARM_DISARM:
                        case EVENT_TYPES.ALARM_CANCEL:
                        case EVENT_TYPES.ALARM_OFF:
                            this.service.updateCharacteristic(this.Characteristic.SecuritySystemCurrentState, this.Characteristic.SecuritySystemCurrentState.DISARMED);
                            this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, this.Characteristic.SecuritySystemTargetState.DISARM);
                            break;
                        case EVENT_TYPES.HOME_ARM:
                            this.service.updateCharacteristic(this.Characteristic.SecuritySystemCurrentState, this.Characteristic.SecuritySystemCurrentState.STAY_ARM);
                            this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, this.Characteristic.SecuritySystemTargetState.STAY_ARM);
                            break;
                        case EVENT_TYPES.AWAY_ARM:
                            this.service.updateCharacteristic(this.Characteristic.SecuritySystemCurrentState, this.Characteristic.SecuritySystemCurrentState.AWAY_ARM);
                            this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, this.Characteristic.SecuritySystemTargetState.AWAY_ARM);
                            break;
                        case EVENT_TYPES.HOME_EXIT_DELAY:
                            this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, this.Characteristic.SecuritySystemTargetState.STAY_ARM);
                            break;
                        case EVENT_TYPES.AWAY_EXIT_DELAY:
                            this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, this.Characteristic.SecuritySystemTargetState.AWAY_ARM);
                            break;
                        default:
                            if (this.debug) this.log(`Alarm ignoring unhandled event: ${event}`);
                            break;
                    }
                }
            });
        } catch (err) {
            if (err instanceof RateLimitError) {
                let retryInterval = (2 ** this.nSocketConnectFailures) * SOCKET_RETRY_INTERVAL;
                if (this.debug) this.log(`${this.name} alarm caught RateLimitError, waiting ${retryInterval/1000}s to retry...`);
                setTimeout(async () => {
                    await this.startListening();
                }, retryInterval);
                this.nSocketConnectFailures++;
            }
        }
    }

    async refreshState() {
        if (this.debug) this.log('Refreshing alarm state');
        try {
            let state = await this.simplisafe.getAlarmState();
            let currentHomekitState = this.CURRENT_SS3_TO_HOMEKIT[state];
            let targetHomekitState = this.TARGET_SS3_TO_HOMEKIT[state];
            this.service.updateCharacteristic(this.Characteristic.SecuritySystemCurrentState, currentHomekitState);
            this.service.updateCharacteristic(this.Characteristic.SecuritySystemTargetState, targetHomekitState);
            if (this.debug) this.log(`Updated current state for ${this.name}: ${state}`);
        } catch (err) {
            this.log('An error occurred while refreshing state');
            this.log(err);
        }
    }

}

export default SS3Alarm;
