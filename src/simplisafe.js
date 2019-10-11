// © 2019 Niccolò Zapponi
// SimpliSafe 3 API Wrapper

import axios from 'axios';
import io from 'socket.io-client';

// Do not touch these - they allow the client to make requests to the SimpliSafe API
const clientUsername = '4df55627-46b2-4e2c-866b-1521b395ded2.1-28-0.WebApp.simplisafe.com';
const clientPassword = '';
const subscriptionCacheTime = 3000; // ms
const sensorCacheTime = 3000; // ms

const ssApi = axios.create({
    baseURL: 'https://api.simplisafe.com/v1'
});

const validAlarmStates = [
    'off',
    'home',
    'away'
];

class SimpliSafe3 {

    token;
    rToken;
    tokenType;
    expiry;
    username;
    password;
    userId;
    subId;
    accountNumber;
    socket;
    lastSubscriptionRequest;
    lastSensorRequest;
    sensorRefreshInterval;
    sensorRefreshTime;
    sensorSubscriptions = [];

    constructor(sensorRefreshTime = 15000) {
        this.sensorRefreshTime = sensorRefreshTime;
    }

    async login(username, password, storeCredentials = false) {

        if (storeCredentials) {
            this.username = username;
            this.password = password;
        }

        try {
            const response = await ssApi.post('/api/token', {
                username: username,
                password: password,
                grant_type: 'password'
            }, {
                auth: {
                    username: clientUsername,
                    password: clientPassword
                }
            });

            let data = response.data;
            this._storeLogin(data);
        } catch (err) {
            let response = (err.response && err.response) ? err.response : err;
            this.logout(storeCredentials);

            throw response;
        }
    }

    _storeLogin(tokenResponse) {
        this.token = tokenResponse.access_token;
        this.rToken = tokenResponse.refresh_token;
        this.tokenType = tokenResponse.token_type;
        this.expiry = Date.now() + (tokenResponse.expires_in * 1000);
    }

    logout(keepCredentials = false) {
        this.token = null;
        this.rToken = null;
        this.tokenType = null;
        this.expiry = null;
        if (!keepCredentials) {
            this.username = null;
            this.password = null;
        }
    }

    isLoggedIn() {
        return this.refreshToken !== null || (this.token !== null && Date.now() < this.expiry);
    }

    async refreshToken() {
        if (!this.isLoggedIn() || !this.refreshToken) {
            return Promise.reject('User is not logged in');
        }

        try {
            const response = await ssApi.post('/api/token', {
                refresh_token: this.rToken,
                grant_type: 'refresh_token'
            }, {
                auth: {
                    username: clientUsername,
                    password: clientPassword
                }
            });

            let data = response.data;
            this._storeLogin(data);

        } catch (err) {
            let response = (err.response) ? err.response : err;
            this.logout(this.username != null);

            throw response;
        }
    }

    async request(params, tokenRefreshed = false) {
        if (!this.isLoggedIn) {
            return Promise.reject('User is not logged in');
        }

        try {
            const response = await ssApi.request({
                ...params,
                headers: {
                    ...params.headers,
                    Authorization: `${this.tokenType} ${this.token}`
                }
            });
            return response.data;
        } catch (err) {
            let statusCode = err.response.status;
            if (statusCode == 401 && !tokenRefreshed) {
                return this.refreshToken()
                    .then(() => {
                        return this.request(params, true);
                    })
                    .catch(async err => {
                        let statusCode = err.status;
                        if ((statusCode == 401 || statusCode == 403) && this.username && this.password) {
                            await this.login(this.username, this.password, true);
                            return this.request(params, true);
                        } else {
                            throw err;
                        }
                    });
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

    async getUserInfo() {
        let userId = await this.getUserId();

        let data = await this.request({
            method: 'GET',
            url: `/users/${userId}/loginInfo`
        });

        return data.loginInfo;
    }

    async getSubscriptions() {
        let userId = await this.getUserId();
        let data = await this.request({
            method: 'GET',
            url: `/users/${userId}/subscriptions?activeOnly=false`
        });

        let subscriptions = data.subscriptions.filter(s => s.sStatus === 10 || s.sStatus === 20);

        if (this.accountNumber) {
            subscriptions = subscriptions.filter(s => s.location.account === this.accountNumber);
        }

        if (subscriptions.length == 1) {
            this.subId = subscriptions[0].sid;
        }

        return subscriptions;
    }

    async getSubscription(subId = null) {
        let subscriptionId = subId;

        if (!subscriptionId) {
            subscriptionId = this.subId;

            if (!subscriptionId) {
                let subs = await this.getSubscriptions();
                if (subs.length == 1) {
                    subscriptionId = subs[0].sid;
                } else if (subs.length == 0) {
                    throw new Error('No matching subscriptions found. Check your account and ensure you have an active subscription.');
                } else {
                    let accountNumbers = subs.map(s => s.location.account);
                    throw new Error(`Multiple subscriptions found. Edit your config.json file and add a parameter called "subscriptionId": "YOUR ACCOUNT NUMBER". The account numbers found were: ${accountNumbers.join(', ')}.`);
                }
            }
        }

        let data = await this.request({
            method: 'GET',
            url: `/subscriptions/${subscriptionId}/`
        });

        return data.subscription;
    }

    setDefaultSubscription(accountNumber) {
        if (!accountNumber) {
            throw new Error('Account Number not defined');
        }

        this.accountNumber = accountNumber;
    }

    async getAlarmState(forceRefresh = false, retry = false) {
        if (forceRefresh || !this.lastSubscriptionRequest) {
            this.lastSubscriptionRequest = this.getSubscription()
                .then(sub => {
                    return sub;
                })
                .catch(err => {
                    throw err;
                })
                .finally(() => {
                    setTimeout(() => {
                        this.lastSubscriptionRequest = null;
                    }, subscriptionCacheTime);
                });
        }
        let subscription = await this.lastSubscriptionRequest;

        if (subscription.location && subscription.location.system) {
            if (subscription.location.system.isAlarming) {
                return 'ALARM';
            }

            const validStates = ['OFF', 'HOME', 'AWAY', 'AWAY_COUNT', 'HOME_COUNT', 'ALARM_COUNT', 'ALARM'];
            let alarmState = subscription.location.system.alarmState;
            if (!validStates.includes(alarmState)) {
                if (!retry) {
                    let retriedState = await this.getAlarmState(true, true);
                    return retriedState;
                } else {
                    throw new Error('Alarm state not understood');
                }
            }

            return alarmState;
        } else {
            throw new Error('Subscription format not understood');
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
        return data;
    }

    async getEvents(params) {

        if (!this.subId) {
            await this.getSubscription();
        }

        let url = `/subscriptions/${this.subId}/events`;
        if (Object.keys(params).length > 0) {
            let query = Object.keys(params).map(key => `${key}=${params[key]}`);
            url = `${url}?${query.join('&')}`;
        }

        let data = await this.request({
            method: 'GET',
            url: url
        });

        let events = data.events;
        return events;
    }

    async getSensors(forceUpdate = false, forceRefresh = false) {

        if (!this.subId) {
            await this.getSubscription();
        }

        if (forceRefresh || !this.lastSensorRequest) {
            this.lastSensorRequest = this.request({
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

        let data = await this.lastSensorRequest;
        return data.sensors;
    }

    async getCameras(forceRefresh = false) {
        if (forceRefresh || !this.lastSubscriptionRequest) {
            this.lastSubscriptionRequest = this.getSubscription()
                .then(sub => {
                    return sub;
                })
                .catch(err => {
                    throw err;
                })
                .finally(() => {
                    setTimeout(() => {
                        this.lastSubscriptionRequest = null;
                    }, subscriptionCacheTime);
                });
        }
        let subscription = await this.lastSubscriptionRequest;

        if (subscription.location && subscription.location.system && subscription.location.system.cameras) {
            return subscription.location.system.cameras;
        } else {
            throw new Error('Subscription format not understood');
        }
    }

    async subscribeToEvents(callback) {

        let _socketCallback = data => {
            switch (data.eventType) {
                case 'alarm':
                    callback('ALARM', data);
                    break;
                case 'alarmCancel':
                    callback('OFF', data);
                    break;
                case 'activity':
                case 'activityQuiet':
                default:
                    // if it's not an alarm event, check by eventCid
                    switch (data.eventCid) {
                        case 1400:
                        case 1407:
                            // 1400 is disarmed with Master PIN, 1407 is disarmed with Remote
                            callback('DISARM', data);
                            break;
                        case 1406:
                            callback('CANCEL', data);
                            break;
                        case 9441:
                            callback('HOME_EXIT_DELAY', data);
                            break;
                        case 3441:
                        case 3491:
                            callback('HOME_ARM', data);
                            break;
                        case 9401:
                        case 9407:
                            // 9401 is for Keypad, 9407 is for Remote
                            callback('AWAY_EXIT_DELAY', data);
                            break;
                        case 3401:
                        case 3407:
                        case 3487:
                        case 3481:
                            // 3401 is for Keypad, 3407 is for Remote
                            callback('AWAY_ARM', data);
                            break;
                        case 1429:
                            callback('ENTRY', data);
                            break;
                        case 1110:
                        case 1154:
                        case 1159:
                        case 1162:
                        case 1132:
                        case 1134:
                        case 1120:
                            callback('ALARM', data);
                            break;
                        case 1170:
                            callback('CAMERA_MOTION', data);
                            break;
                        case 1458:
                            callback('DOORBELL', data);
                            break;
                        case 1602:
                            // Automatic test
                            break;
                        default:
                            callback(null, data);
                            break;
                    }
                    break;
            }
        };

        if (this.socket) {
            this.socket.on('event', _socketCallback);
        } else {
            let userId = await this.getUserId();

            this.socket = io(`https://api.simplisafe.com/v1/user/${userId}`, {
                path: '/socket.io',
                query: {
                    ns: `/v1/user/${userId}`,
                    accessToken: this.token
                },
                transports: ['websocket', 'polling']
            });

            this.socket.on('connect', () => {
                // console.log('Connect');
            });

            this.socket.on('connect_error', () => {
                // console.log('Connect_error', err);
                this.socket = null;
            });

            this.socket.on('connect_timeout', () => {
                // console.log('Connect_timeout');
                this.socket = null;
            });

            this.socket.on('error', err => {
                if (err === 'Not authorized') {
                    callback('DISCONNECT');
                }
                this.socket = null;
            });

            this.socket.on('disconnect', reason => {
                if (reason === 'transport close') {
                    callback('DISCONNECT');
                }
                this.socket = null;
            });

            this.socket.on('reconnect_failed', () => {
                // console.log('Reconnect_failed');
                this.socket = null;
            });

            this.socket.on('event', _socketCallback);
        }

    }

    isSocketConnected() {
        return this.socket && this.socket.connected;
    }

    unsubscribeFromEvents() {
        if (this.socket) {
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

                try {
                    let sensors = await this.getSensors(true);
                    for (let sensor of sensors) {
                        this.sensorSubscriptions
                            .filter(sub => sub.id === sensor.serial)
                            .map(sub => sub.callback(sensor));
                    }
                } catch (err) {
                    // console.log(err);
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

}

export default SimpliSafe3;
