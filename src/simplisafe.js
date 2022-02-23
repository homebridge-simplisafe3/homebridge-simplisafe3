import axios from 'axios';
import axiosRetry from 'axios-retry';
import io from 'socket.io-client';
import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';

const subscriptionCacheTime = 3000; // ms
const sensorCacheTime = 3000; // ms
const internalConfigFileName = 'simplisafe3config.json';
const rateLimitInitialInterval = 60000; // ms
const rateLimitMaxInterval = 2 * 60 * 60 * 1000; // ms
const sensorRefreshLockoutDuration = 20000; // ms
const errorSuppressionDuration = 5 * 60 * 1000; // ms
const alarmRefreshTime = 62000; // ms, avoid overlap with sensor refresh

const ssApi = axios.create({
    baseURL: 'https://api.simplisafe.com/v1'
});
axiosRetry(ssApi, { retries: 2 });

const validAlarmStates = [
    'off',
    'home',
    'away'
];

const validLockStates = [
    'lock',
    'unlock'
];

export const SENSOR_TYPES = {
    'APP': 0,
    'KEYPAD': 1,
    'KEYCHAIN': 2,
    'PANIC_BUTTON': 3,
    'MOTION_SENSOR': 4,
    'ENTRY_SENSOR': 5,
    'GLASSBREAK_SENSOR': 6,
    'CO_SENSOR': 7,
    'SMOKE_SENSOR': 8,
    'WATER_SENSOR': 9,
    'FREEZE_SENSOR': 10,
    'SIREN': 11,
    'SIREN_2': 13,
    'DOORLOCK': 16,
    'DOORLOCK_2': 253
};

export const EVENT_TYPES = {
    ALARM_TRIGGER: 'ALARM_TRIGGER',
    ALARM_OFF: 'ALARM_OFF',
    ALARM_DISARM: 'ALARM_DISARM',
    ALARM_CANCEL: 'ALARM_CANCEL',
    HOME_EXIT_DELAY: 'HOME_EXIT_DELAY',
    HOME_ARM: 'HOME_ARM',
    AWAY_EXIT_DELAY: 'AWAY_EXIT_DELAY',
    AWAY_ARM: 'AWAY_ARM',
    MOTION: 'MOTION',
    ENTRY: 'ENTRY',
    CAMERA_MOTION: 'CAMERA_MOTION',
    DOORBELL: 'DOORBELL',
    DOORLOCK_LOCKED: 'DOORLOCK_LOCKED',
    DOORLOCK_UNLOCKED: 'DOORLOCK_UNLOCKED',
    DOORLOCK_ERROR: 'DOORLOCK_ERROR',
    POWER_OUTAGE: 'POWER_OUTAGE',
    POWER_RESTORED: 'POWER_RESTORED'
};

export class RateLimitError extends Error {
    constructor(...params) {
        super(...params);
        // Maintains proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, RateLimitError);
        }
        this.name = 'RateLimitError';
    }
}

export const SOCKET_RETRY_INTERVAL = 1000; //ms

const generateSimplisafeId = () => {
    const supportedCharacters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz0123456789';
    let id = [];
    while (id.length < 10) {
        id.push(supportedCharacters[Math.floor(Math.random() * supportedCharacters.length)]);
    }

    id = id.join('');

    return `${id.substring(0, 5)}-${id.substring(5)}`;
};

class SimpliSafe3 extends EventEmitter {

    authManager;
    userId;
    subId;
    accountNumber;
    socket;
    lastSubscriptionRequests = {};
    lastSensorRequest;
    lastLockRequest;
    alarmRefreshInterval;
    alarmSubscriptions = [];
    sensorRefreshInterval;
    sensorRefreshTime;
    refreshLockoutTimeout;
    refreshLockoutEnabled = false;
    sensorSubscriptions = [];
    errorSupperessionTimeout;
    nSuppressedErrors;
    ssId;
    storagePath;
    nSocketConnectFailures = 0;

    isBlocked;
    nextBlockInterval = rateLimitInitialInterval;
    nextAttempt = 0;

    constructor(sensorRefreshTime = 15000, resetConfig = false, authManager, storagePath, log, debug) {
        super();
        this.sensorRefreshTime = sensorRefreshTime;
        this.log = log || console.log;
        this.debug = debug;
        this.storagePath = storagePath;
        this.authManager = authManager;

        let internalConfigFile = path.join(this.storagePath, internalConfigFileName);
        if (fs.existsSync(internalConfigFile) && resetConfig) {
            fs.unlinkSync(internalConfigFile);
        }

        // Load IDs from internal config file
        if (fs.existsSync(internalConfigFile)) {
            let configFile = fs.readFileSync(internalConfigFile);
            let config = JSON.parse(configFile);
            this.ssId = config.ssId;
        } else {
            this.ssId = generateSimplisafeId();

            try {
                fs.writeFileSync(internalConfigFile, JSON.stringify({
                    ssId: this.ssId
                }));
            } catch (err) {
                this.log.warn('Warning: could not save SS config file. SS-ID will vary');
            }
        }

        this._resetRateLimitHandler();
    }

    _resetRateLimitHandler() {
        this.isBlocked = false;
        this.nextBlockInterval = rateLimitInitialInterval;
    }

    _setRateLimitHandler() {
        this.isBlocked = true;
        this.nextAttempt = Date.now() + this.nextBlockInterval;
        if (this.nextBlockInterval < rateLimitMaxInterval) {
            this.nextBlockInterval = this.nextBlockInterval * 2;
        }
    }

    async request(params, tokenRefreshed = false) {
        if (this.isBlocked && Date.now() < this.nextAttempt) {
            let err = new RateLimitError('Blocking request: rate limited');
            throw err;
        }

        try {
            const response = await ssApi.request({
                ...params,
                headers: {
                    ...params.headers,
                    Authorization: `${this.authManager.tokenType} ${this.authManager.accessToken}`
                }
            });
            this._resetRateLimitHandler();
            return response.data;
        } catch (err) {
            if (!err.response) {
                let rateLimitError = new RateLimitError(err);
                this.log.error('SSAPI request failed, request blocked (rate limit?).');
                this._setRateLimitHandler();
                throw rateLimitError;
            }

            let statusCode = err.response.status;
            if (statusCode == 401 && !tokenRefreshed) {
                try {
                    await this.authManager.refreshCredentials();
                    if (this.debug) this.log('Credentials refreshed successfully after failed request');
                    return this.request(params, true);
                } catch (err) {
                    this._setRateLimitHandler();
                    if (this.debug) this.log.error('Credentials refresh failed with error:', err);
                    throw err;
                }
            } else if (statusCode == 403) {
                this.log.error('SSAPI request failed, request blocked (rate limit?).');
                if (this.debug) this.log.error('SSAPI request received a response error with code 403:', err.response);
                this._setRateLimitHandler();
                throw new RateLimitError(err.response.data);
            } else {
                throw err.response.data;
            }
        }
    }

    async getUserId() {
        if (this.userId) {
            return this.userId;
        }

        let data = await this.request({
            method: 'GET',
            url: '/api/authCheck'
        });
        this.userId = data.userId;
        return this.userId;
    }

    async getSubscriptions() {
        let userId = await this.getUserId();
        let data = await this.request({
            method: 'GET',
            url: `/users/${userId}/subscriptions?activeOnly=false`
        });

        // sStatus 7: Self-Monitoring with Camera Recording (5 cameras)
        let subscriptions = data.subscriptions.filter(s => [7, 10, 20].includes(s.sStatus) && s.activated > 0);

        if (this.accountNumber) {
            subscriptions = subscriptions.filter(s => s.location.account === this.accountNumber);
        }

        if (subscriptions.length == 1) {
            this.subId = subscriptions[0].sid;
        }

        return subscriptions;
    }

    async getSubscription(forceRefresh = false) {
        let subscriptionId = this.subId;

        if (!subscriptionId) {
            let subs = await this.getSubscriptions();
            if (subs.length == 1) {
                subscriptionId = subs[0].sid;
            } else if (subs.length == 0) {
                throw new Error('No matching monitoring plans found. Check your account and ensure you have an active plan.');
            } else {
                let accountNumbers = subs.map(s => s.location.account);
                throw new Error(`Multiple accounts found. You must specify an account number in the plugin settings. See README https://github.com/homebridge-simplisafe3/homebridge-simplisafe3#subscriptionid-account-number for more info. The account numbers found were: ${accountNumbers.join(', ')}.`);
            }
        }

        if (forceRefresh || !this.lastSubscriptionRequests[subscriptionId]) {
            this.lastSubscriptionRequests[subscriptionId] = await this.request({
                method: 'GET',
                url: `/subscriptions/${subscriptionId}/`
            })
                .then(sub => {
                    return sub;
                })
                .catch(err => {
                    throw err;
                })
                .finally(() => {
                    setTimeout(() => {
                        this.lastSubscriptionRequests[subscriptionId] = null;
                    }, subscriptionCacheTime);
                });
        }

        let data = this.lastSubscriptionRequests[subscriptionId];
        return data.subscription;
    }

    setDefaultSubscription(accountNumber) {
        if (!accountNumber) {
            throw new Error('Account Number not defined');
        }

        this.accountNumber = accountNumber;
    }

    async getAlarmSystem(forceRefresh = false) {
        let subscription = await this.getSubscription(forceRefresh);

        if (subscription.location && subscription.location.system) {
            return subscription.location.system;
        } else {
            throw new Error('Subscription format not understood:', subscription);
        }
    }

    async setAlarmState(newState) {
        let state = newState.toLowerCase();

        if (validAlarmStates.indexOf(state) == -1) {
            throw new Error('Invalid target state');
        }

        if (!this.subId) {
            await this.getSubscription();
        }

        let data = await this.request({
            method: 'POST',
            url: `/ss3/subscriptions/${this.subId}/state/${state}`
        });
        this._handleSensorRefreshLockout();
        return data;
    }

    async getSensors(forceUpdate = false, forceRefresh = false) {
        if (!this.subId) {
            await this.getSubscription();
        }

        if (forceRefresh || !this.lastSensorRequest) {
            this.lastSensorRequest = await this.request({
                method: 'GET',
                url: `/ss3/subscriptions/${this.subId}/sensors?forceUpdate=${forceUpdate ? 'true' : 'false'}`
            })
                .then(data => {
                    return data;
                })
                .catch(err => {
                    throw err;
                })
                .finally(() => {
                    setTimeout(() => {
                        this.lastSensorRequest = null;
                    }, sensorCacheTime);
                });
        }

        let data = this.lastSensorRequest;
        return data.sensors;
    }

    async getCameras(forceRefresh = false) {
        let system = await this.getAlarmSystem(forceRefresh);

        if (system.cameras) {
            return system.cameras;
        } else {
            throw new Error('Error getting alarm system');
        }
    }

    async getLocks(forceRefresh) {
        if (!this.subId) {
            await this.getSubscription();
        }

        if (forceRefresh || !this.lastLockRequest) {
            this.lastLockRequest = await this.request({
                method: 'GET',
                url: `/doorlock/${this.subId}`
            })
                .then(data => {
                    return data;
                })
                .catch(err => {
                    throw err;
                })
                .finally(() => {
                    setTimeout(() => {
                        this.lastLockRequest = null;
                    }, sensorCacheTime);
                });
        }

        let data = this.lastLockRequest;
        this.refreshLockoutEnabled = data.length > 0;
        return data;

    }

    async setLockState(lockId, newState) {
        let state = newState.toLowerCase();

        if (validLockStates.indexOf(state) == -1) {
            throw new Error('Invalid target state');
        }

        if (!this.subId) {
            await this.getSubscription();
        }

        let data = await this.request({
            method: 'POST',
            url: `/doorlock/${this.subId}/${lockId}/state`,
            data: {
                state: state
            }
        });
        return data;
    }

    async startListening() {
        if (!this.socket) {
            let userId = await this.getUserId();

            this.socket = io(`https://api.simplisafe.com/v1/user/${userId}`, {
                path: '/socket.io',
                query: {
                    ns: `/v1/user/${userId}`,
                    accessToken: this.authManager.accessToken
                },
                transports: ['websocket', 'polling'],
                pfx: [],
                reconnectionAttempts: 5, // we need a limit in case authentication has changed and need to create a new socket
                reconnectionDelayMax: 30000
            });

        }

        // for debugging
        if (this.debug) {
            this.socket.on('reconnect_attempt', (attemptNumber) => {
                this.log(`SSAPI socket reconnect_attempt #${attemptNumber}`);
            });

            this.socket.on('reconnect', () => {
                this.log('SSAPI socket reconnected');
            });

            this.socket.on('connect_error', (err) => {
                this.log.error(`SSAPI socket connect_error${err.type && err.message ? ' ' + err.type + ': ' + err.message : ': ' + err}`);
            });

            this.socket.on('connect_timeout', () => {
                this.log('SSAPI socket connect_timeout');
            });

            this.socket.on('error', (err) => {
                if (err.message == 'Not authorized') { //edge case
                    this.isBlocked = true;
                }
                this.log.error(`SSAPI socket error${err.type && err.message ? ' ' + err.type + ': ' + err.message : ': ' + err}`);
            });

            this.socket.on('reconnect_failed', () => {
                this.log.error('SSAPI socket reconnect_failed');
            });

            this.socket.on('disconnect', (reason) => {
                this.log('SSAPI socket disconnect reason:', reason);
            });
        }

        this.socket.on('connect', () => {
            this.log('Now listening for real time SimpliSafe events.');
            this.nSocketConnectFailures = 0;
        });

        this.socket.on('error', (err) => {
            if (err) {
                this._destroySocket();
                this._handleSocketConnectionFailure();
            }
        });

        this.socket.on('reconnect_failed', () => {
            this._destroySocket();
            this._handleSocketConnectionFailure();
        });

        this.socket.on('disconnect', (reason) => {
            if (reason === 'io server disconnect') {
                // the disconnection was initiated by the server, you need to reconnect manually
                this._destroySocket();
                this._handleSocketConnectionFailure();
            } else {
                this.log.warn('SimpliSafe real time events disconnected.');
            }
        });

        this.socket.on('event', (data) => {
            if (data.sid != this.subId) {
                // Ignore event as it doesn't relate to this account
                return;
            }

            switch (data.eventType) {
            case 'alarm':
                this.emit(EVENT_TYPES.ALARM_TRIGGER, data);
                break;
            case 'alarmCancel':
                this.emit(EVENT_TYPES.ALARM_OFF, data);
                break;
            case 'activity':
            case 'activityQuiet':
            default:
                // if it's not an alarm event, check by eventCid
                switch (data.eventCid) {
                case 1400:
                case 1407:
                    // 1400 is disarmed with Master PIN, 1407 is disarmed with Remote
                    this.emit(EVENT_TYPES.ALARM_DISARM, data);
                    this._handleSensorRefreshLockout();
                    break;
                case 1406:
                    this.emit(EVENT_TYPES.ALARM_CANCEL, data);
                    this._handleSensorRefreshLockout();
                    break;
                case 1409:
                    this.emit(EVENT_TYPES.MOTION, data);
                    break;
                case 9441:
                    this.emit(EVENT_TYPES.HOME_EXIT_DELAY, data);
                    break;
                case 3441:
                case 3491:
                    this.emit(EVENT_TYPES.HOME_ARM, data);
                    this._handleSensorRefreshLockout();
                    break;
                case 9401:
                case 9407:
                    // 9401 is for Keypad, 9407 is for Remote
                    this.emit(EVENT_TYPES.AWAY_EXIT_DELAY, data);
                    break;
                case 3401:
                case 3407:
                case 3487:
                case 3481:
                    // 3401 is for Keypad, 3407 is for Remote
                    this.emit(EVENT_TYPES.AWAY_ARM, data);
                    this._handleSensorRefreshLockout();
                    break;
                case 1429:
                    this.emit(EVENT_TYPES.ENTRY, data);
                    break;
                case 1110:
                case 1154:
                case 1159:
                case 1162:
                case 1132:
                case 1134:
                case 1120:
                    this.emit(EVENT_TYPES.ALARM_TRIGGER, data);
                    break;
                case 1170:
                    this.emit(EVENT_TYPES.CAMERA_MOTION, data);
                    break;
                case 1301:
                    this.emit(EVENT_TYPES.POWER_OUTAGE, data);
                    break;
                case 3301:
                    this.emit(EVENT_TYPES.POWER_RESTORED, data);
                    break;
                case 1458:
                    this.emit(EVENT_TYPES.DOORBELL, data);
                    break;
                case 9700:
                    this.emit(EVENT_TYPES.DOORLOCK_UNLOCKED, data);
                    break;
                case 9701:
                    this.emit(EVENT_TYPES.DOORLOCK_LOCKED, data);
                    break;
                case 9703:
                    this.emit(EVENT_TYPES.DOORLOCK_ERROR, data);
                    break;
                case 1350:
                    this.log.error('Base station WiFi lost, this plugin cannot communicate with the base station until it is restored.');
                    break;
                case 3350:
                    this.log.warn('Base station WiFi restored.');
                    break;
                case 1602:
                    // Automatic test
                    break;
                default:
                    // Unknown event
                    if (this.debug) this.log('Unknown SSAPI event:', data);
                    break;
                }
                break;
            }
        });

    }

    _handleSocketConnectionFailure() {
        let retryInterval = (2 ** this.nSocketConnectFailures) * SOCKET_RETRY_INTERVAL;
        if (this.debug) this.log(`SimpliSafe real time events connection lost. Next attempt will be in ${retryInterval/1000}s.`);
        setTimeout(async () => {
            await this.startListening();
        }, retryInterval);
        this.nSocketConnectFailures++;
    }

    _destroySocket() {
        if (this.socket) {
            this.socket.off();
            this.socket.close();
            this.socket = null;
        }
    }

    subscribeToSensor(id, callback) {
        if (!this.sensorRefreshInterval) {
            this.sensorRefreshInterval = setInterval(async () => {
                if (this.sensorSubscriptions.length == 0) {
                    return;
                }

                if (this.refreshLockoutTimeout) {
                    if (this.debug) this.log('Sensor refresh lockout in effect, refresh blocked.');
                    return;
                }

                try {
                    let sensors = await this.getSensors(true);
                    for (let sensor of sensors) {
                        this.sensorSubscriptions
                            .filter(sub => sub.id === sensor.serial)
                            .map(sub => sub.callback(sensor));
                    }
                } catch (err) {
                    if (!(err instanceof RateLimitError)) { // never log rate limit errors as they are handled elsewhere
                        if (this.debug) {
                            this.log.error('Sensor refresh received an error from the SimpliSafe API:', err);
                        } else {
                            this._handleErrorSuppression();
                        }
                    }
                }

            }, this.sensorRefreshTime);

        }

        this.sensorSubscriptions.push({
            id: id,
            callback: callback
        });
    }

    unsubscribeFromSensor(id) {
        this.sensorSubscriptions = this.sensorSubscriptions.filter(sub => sub.id !== id);
        if (this.sensorSubscriptions.length == 0) {
            clearInterval(this.sensorRefreshInterval);
        }
    }

    subscribeToAlarmSystem(id, callback) {
        if (!this.alarmRefreshInterval) {
            this.alarmRefreshInterval = setInterval(async () => {
                if (this.refreshLockoutTimeout) {
                    if (this.debug) this.log('Refresh lockout in effect, alarm system refresh blocked.');
                    return;
                }

                try {
                    let system = await this.getAlarmSystem(true);
                    this.alarmSubscriptions
                        .filter(sub => sub.id === system.serial)
                        .map(sub => sub.callback(system));
                } catch (err) {
                    if (!(err instanceof RateLimitError)) { // never log rate limit errors as they are handled elsewhere
                        if (this.debug) {
                            this.log.error('Alarm system refresh received an error from the SimpliSafe API:', err);
                        } else {
                            this._handleErrorSuppression();
                        }
                    }
                }

            }, alarmRefreshTime);

        }

        this.alarmSubscriptions.push({
            id: id,
            callback: callback
        });
    }

    _handleErrorSuppression() {
        if (!this.errorSupperessionTimeout) {
            this.nSuppressedErrors = 1;
            this.errorSupperessionTimeout = setTimeout(() => {
                if (!this.debug && this.nSuppressedErrors > 0) this.log.warn(`${this.nSuppressedErrors} error${this.nSuppressedErrors > 1 ? 's were' : ' was'} received from the SimpliSafe API while refereshing sensors in the last ${errorSuppressionDuration / 60000} minutes. Enable debug logging for detailed output.`);
                clearTimeout(this.errorSupperessionTimeout);
                this.errorSupperessionTimeout = undefined;
            }, errorSuppressionDuration);
        } else {
            this.nSuppressedErrors++;
        }
    }

    _handleSensorRefreshLockout() {
        if (!this.refreshLockoutEnabled) return;
        // avoid "smart lock not responding" error with refresh lockout, see issue #134
        clearTimeout(this.refreshLockoutTimeout);
        this.refreshLockoutTimeout = setTimeout(() => {
            this.refreshLockoutTimeout = undefined;
        }, sensorRefreshLockoutDuration);
    }

}

export default SimpliSafe3;
