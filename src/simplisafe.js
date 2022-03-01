import axios from 'axios';
import axiosRetry from 'axios-retry';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';
import { clearInterval } from 'timers';

export const VALID_ALARM_STATES = [
    'off',
    'home',
    'away'
];

export const VALD_LOCK_STATES = [
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

const subscriptionCacheTime = 3000; // ms
const sensorCacheTime = 3000; // ms
const internalConfigFileName = 'simplisafe3config.json';
const rateLimitInitialInterval = 60000; // ms
const rateLimitMaxInterval = 2 * 60 * 60 * 1000; // ms
const sensorRefreshLockoutDuration = 20000; // ms
const errorSuppressionDuration = 5 * 60 * 1000; // ms
const alarmRefreshInterval = 62000; // ms, avoid overlap with sensor refresh

const wsUrl = 'wss://socketlink.prd.aser.simplisafe.com';
const socketRetryInterval = 1000; //ms
const socketHeartbeatInterval = 60 * 1000; //ms

const ssApi = axios.create({
    baseURL: 'https://api.simplisafe.com/v1'
});
axiosRetry(ssApi, { retries: 2 });

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
    alarmRefreshIntervalID;
    alarmSubscriptions = [];
    sensorRefreshIntervalID;
    sensorRefreshTime;
    refreshLockoutTimeoutID;
    refreshLockoutEnabled = false;
    sensorSubscriptions = [];
    errorSupperessionTimeoutID;
    nSuppressedErrors;
    ssId;
    storagePath;
    nSocketConnectFailures = 0;
    socketHeartbeatIntervalID;
    socketIsAlive;
    isAwaitingSocketReconnect;
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

        this.resetRateLimitHandler();
    }

    resetRateLimitHandler() {
        this.isBlocked = false;
        this.nextBlockInterval = rateLimitInitialInterval;
    }

    setRateLimitHandler() {
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
            this.resetRateLimitHandler();
            return response.data;
        } catch (err) {
            if (!err.response) {
                let rateLimitError = new RateLimitError(err);
                this.log.error('SSAPI request failed, request blocked (rate limit?).');
                this.setRateLimitHandler();
                throw rateLimitError;
            }

            let statusCode = err.response.status;
            if (statusCode == 401 && !tokenRefreshed) {
                try {
                    await this.authManager.refreshCredentials();
                    if (this.debug) this.log('Credentials refreshed successfully after failed request');
                    return this.request(params, true);
                } catch (err) {
                    this.setRateLimitHandler();
                    if (this.debug) this.log.error('Credentials refresh failed with error:', err);
                    throw err;
                }
            } else if (statusCode == 403) {
                this.log.error('SSAPI request failed, request blocked (rate limit?).');
                if (this.debug) this.log.error('SSAPI request received a response error with code 403:', err.response);
                this.setRateLimitHandler();
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

        if (VALID_ALARM_STATES.indexOf(state) == -1) {
            throw new Error('Invalid target state');
        }

        if (!this.subId) {
            await this.getSubscription();
        }

        let data = await this.request({
            method: 'POST',
            url: `/ss3/subscriptions/${this.subId}/state/${state}`
        });

        this.handleSensorRefreshLockout();
        
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

        if (VALD_LOCK_STATES.indexOf(state) == -1) {
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
            this.socket = new WebSocket(wsUrl);
            let userId = await this.getUserId();

            this.socket.on('open', () => {
                if (this.debug) this.log('SSAPI socket `open`');
                this.socket.send(JSON.stringify({
                    'datacontenttype': 'application/json',
                    'type': 'com.simplisafe.connection.identify',
                    'time': new Date().toISOString(),
                    'id': `ts:${Date.now()}`,
                    'specversion': '1.0',
                    'source': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
                    'data': {
                        'auth': {
                            'schema': 'bearer',
                            'token': this.authManager.accessToken,
                        },
                        'join': [`uid:${userId}`]
                    }
                }));
            });

            this.socket.on('close', () => {
                if (this.debug) this.log.error('SSAPI socket `closed`');
                this.log.warn('SimpliSafe real time events disconnected');
                this.handleSocketConnectionFailure();
            });

            this.socket.on('error', (err) => {
                if (this.debug) this.log.error('SSAPI socket `error`:', err);
                this.log.warn('SimpliSafe real time events disconnected');
                this.handleSocketConnectionFailure();
            });

            this.socket.on('unexpected-response', (reason) => {
                if (this.debug) this.log('SSAPI socket received unexpected-response:', reason);
                this.handleSocketConnectionFailure();
            });

            this.socket.on('pong', () => {
                if (this.debug) this.log('SSAPI socket `heartbeat`');
                this.socketIsAlive = true;
            });

            this.socket.on('message', (message) => {
                message = JSON.parse(message);

                if (this.debug && !['service', 'messagequeue'].includes(message.source)) this.log('SSAPI socket received message:', message);

                if (message.source == 'service') {
                    switch (message.type) {
                    case 'com.simplisafe.service.hello':
                        if (this.debug) this.log('SSAPI socket `hello`');
                        break;
                    case 'com.simplisafe.service.registered':
                        if (this.debug) this.log('SSAPI socket `registered`');
                        break;
                    case 'com.simplisafe.namespace.subscribed':
                        if (this.debug) this.log('SSAPI socket `subscribed`');
                        this.log('Listening for real time SimpliSafe events.');
                        this.nSocketConnectFailures = 0;
                        this.socketIsAlive = true;
                        
                        // heartbeat
                        this.socketHeartbeatIntervalID = setInterval(() => {
                            if (!this.socketIsAlive) {
                                if (this.debug) this.log('SSAPI socket heartbeat lost');
                                this.handleSocketConnectionFailure();
                                return;
                            } else {
                                this.socketIsAlive = false;
                                this.socket.ping();
                            }
                        }, socketHeartbeatInterval);
                        break;
                    default:
                        if (this.debug) this.log('Received unknown service message:', message)
                    }
                } else if (message.source == 'messagequeue') {
                    let data = message.data;
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
                    case 'cameraStatus':
                        // nothing to do
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
                            this.handleSensorRefreshLockout();
                            break;
                        case 1406:
                            this.emit(EVENT_TYPES.ALARM_CANCEL, data);
                            this.handleSensorRefreshLockout();
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
                            this.handleSensorRefreshLockout();
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
                            this.handleSensorRefreshLockout();
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
                }
            });
        }
    }

    handleSocketConnectionFailure() {
        if (this.isAwaitingSocketReconnect) return; // a reconnect attempt is pending

        this.socket.removeAllListeners();
        this.socket.terminate();
        this.socket = null;

        clearTimeout(this.socketHeartbeatIntervalID);
        this.socketIsAlive = false;

        let retryInterval = (2 ** this.nSocketConnectFailures) * socketRetryInterval;
        if (this.debug) this.log(`SSAPI socket connection lost. Next attempt will be in ${retryInterval/1000}s.`);
        setTimeout(async () => {
            this.isAwaitingSocketReconnect = false;
            await this.startListening();
        }, retryInterval);
        this.nSocketConnectFailures++;
        this.isAwaitingSocketReconnect = true;
    }

    subscribeToSensor(id, callback) {
        if (!this.sensorRefreshIntervalID) {
            this.sensorRefreshIntervalID = setInterval(async () => {
                if (this.sensorSubscriptions.length == 0) {
                    return;
                }
        
                if (this.refreshLockoutTimeoutID) {
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
                            this.handleErrorSuppression();
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
            clearInterval(this.sensorRefreshIntervalID);
        }
    }

    subscribeToAlarmSystem(id, callback) {
        if (!this.alarmRefreshIntervalID) {
            this.alarmRefreshIntervalID = setInterval(async () => {
                if (this.refreshLockoutTimeoutID) {
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
                            this.handleErrorSuppression();
                        }
                    }
                }

            }, alarmRefreshInterval);

        }

        this.alarmSubscriptions.push({
            id: id,
            callback: callback
        });
    }

    handleErrorSuppression() {
        if (!this.errorSupperessionTimeoutID) {
            this.nSuppressedErrors = 1;
            this.errorSupperessionTimeoutID = setTimeout(() => {
                if (!this.debug && this.nSuppressedErrors > 0) this.log.warn(`${this.nSuppressedErrors} error${this.nSuppressedErrors > 1 ? 's were' : ' was'} received from the SimpliSafe API while refereshing sensors in the last ${errorSuppressionDuration / 60000} minutes. Enable debug logging for detailed output.`);
                clearTimeout(this.errorSupperessionTimeoutID);
                this.errorSupperessionTimeoutID = undefined;
            }, errorSuppressionDuration);
        } else {
            this.nSuppressedErrors++;
        }
    }

    handleSensorRefreshLockout() {
        if (!this.refreshLockoutEnabled) return;
        // avoid "smart lock not responding" error with refresh lockout, see issue #134
        clearTimeout(this.refreshLockoutTimeoutID);
        this.refreshLockoutTimeoutID = setTimeout(() => {
            this.refreshLockoutTimeoutID = undefined;
        }, sensorRefreshLockoutDuration);
    }

}

export default SimpliSafe3;
