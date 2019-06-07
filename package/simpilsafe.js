"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _axios = _interopRequireDefault(require("axios"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

// Do not touch these - they allow the client to make requests to the SimpliSafe API
const clientUsername = '4df55627-46b2-4e2c-866b-1521b395ded2.1-28-0.WebApp.simplisafe.com';
const clientPassword = '';

const ssApi = _axios.default.create({
  baseURL: 'https://api.simplisafe.com/v1'
});

const validAlarmStates = ['off', 'home', 'away'];

class SimpliSafe3 {
  constructor() {
    _defineProperty(this, "token", void 0);

    _defineProperty(this, "rToken", void 0);

    _defineProperty(this, "tokenType", void 0);

    _defineProperty(this, "expiry", void 0);

    _defineProperty(this, "username", void 0);

    _defineProperty(this, "password", void 0);

    _defineProperty(this, "userId", void 0);

    _defineProperty(this, "subId", void 0);
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
      let response = err.response && err.response ? err.response : err;
      this.logout(storeCredentials);
      throw response;
    }
  }

  _storeLogin(tokenResponse) {
    this.token = tokenResponse.access_token;
    this.rToken = tokenResponse.refresh_token;
    this.tokenType = tokenResponse.token_type;
    this.expiry = Date.now() + tokenResponse.expires_in * 1000;
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
    return this.refreshToken !== null || this.token !== null && Date.now() < this.expiry;
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
      let response = err.response ? err.response : err;
      this.logout(this.username != null);
      throw response;
    }
  }

  async request(params, tokenRefreshed = false) {
    if (!this.isLoggedIn) {
      return Promise.reject('User is not logged in');
    }

    try {
      const response = await ssApi.request({ ...params,
        headers: { ...params.headers,
          Authorization: `${this.tokenType} ${this.token}`
        }
      });
      return response.data;
    } catch (err) {
      let statusCode = err.response.status;

      if (statusCode == 401 && !tokenRefreshed) {
        return this.refreshToken().then(() => {
          return this.request(params, true);
        }).catch(async err => {
          let statusCode = err.status;

          if ((statusCode == 401 || statusCode == 403) && this.username && this.password) {
            try {
              await this.login(this.username, this.password, true);
              return this.request(params, true);
            } catch (err) {
              throw err;
            }
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

    try {
      let data = await this.request({
        method: 'GET',
        url: '/api/authCheck'
      });
      this.userId = data.userId;
      return this.userId;
    } catch (err) {
      throw err;
    }
  }

  async getUserInfo() {
    try {
      let userId = await this.getUserId();
      let data = await this.request({
        method: 'GET',
        url: `/users/${userId}/loginInfo`
      });
      return data.loginInfo;
    } catch (err) {
      throw err;
    }
  }

  async getSubscriptions() {
    try {
      let userId = await this.getUserId();
      let data = await this.request({
        method: 'GET',
        url: `/users/${userId}/subscriptions?activeOnly=false`
      });
      let subscriptions = data.subscriptions;

      if (subscriptions.length == 1) {
        this.subId = subscriptions[0].sid;
      }

      return subscriptions;
    } catch (err) {
      throw err;
    }
  }

  async getSubscription(subId = null) {
    try {
      let subscriptionId = subId;

      if (!subscriptionId) {
        subscriptionId = this.subId;

        if (!subscriptionId) {
          let subs = await this.getSubscriptions();

          if (subs.length == 1) {
            subscriptionId = subs[0].sid;
          } else {
            throw new Error('Subscription ID is ambiguous');
          }
        }
      }

      let data = await this.request({
        method: 'GET',
        url: `/subscriptions/${subscriptionId}/`
      });
      return data.subscription;
    } catch (err) {
      throw err;
    }
  }

  setDefaultSubscription(subId) {
    if (!subId) {
      throw new Error('Subscription ID not defined');
    }

    this.subId = subId;
  }

  async getAlarmState() {
    try {
      let subscription = await this.getSubscription();

      if (subscription.location && subscription.location.system) {
        // OFF, HOME, AWAY, AWAY_COUNT, HOME_COUNT, ALARM_COUNT, ALARM
        return subscription.location.system.isAlarming ? 'ALARM' : subscription.location.system.alarmState;
      } else {
        throw new Error('Subscription format not understood');
      }
    } catch (err) {
      throw err;
    }
  }

  async setAlarmState(newState) {
    let state = newState.toLowerCase();

    if (validAlarmStates.indexOf(state) == -1) {
      throw new Error('Invalid target state');
    }

    try {
      if (!this.subId) {
        await this.getSubscription();
      }

      let data = await this.request({
        method: 'POST',
        url: `/ss3/subscriptions/${this.subId}/state/${state}`
      });
      return data;
    } catch (err) {
      throw err;
    }
  }

  async getEvents(number = 10) {
    try {
      if (!this.subId) {
        await this.getSubscription();
      }

      let data = await this.request({
        method: 'GET',
        url: `/subscriptions/${this.subId}/events?numEvents=${number}`
      });
      let events = data.events;
      return events;
    } catch (err) {
      throw err;
    }
  }

  async getSensors(forceUpdate = false) {
    try {
      if (!this.subId) {
        await this.getSubscription();
      }

      let data = await this.request({
        method: 'GET',
        url: `/ss3/subscriptions/${this.subId}/sensors?forceUpdate=${forceUpdate ? 'true' : 'false'}`
      });
      return data.sensors;
    } catch (err) {
      throw err;
    }
  }

}

var _default = SimpliSafe3;
exports.default = _default;