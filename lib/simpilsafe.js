"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

var _axios = _interopRequireDefault(require("axios"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }

function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

// Do not touch these - they allow the client to make requests to the SimpliSafe API
var clientUsername = '4df55627-46b2-4e2c-866b-1521b395ded2.1-28-0.WebApp.simplisafe.com';
var clientPassword = '';

var ssApi = _axios["default"].create({
  baseURL: 'https://api.simplisafe.com/v1'
});

var validAlarmStates = ['off', 'home', 'away'];

var SimpliSafe3 =
/*#__PURE__*/
function () {
  function SimpliSafe3() {
    _classCallCheck(this, SimpliSafe3);

    _defineProperty(this, "token", void 0);

    _defineProperty(this, "rToken", void 0);

    _defineProperty(this, "tokenType", void 0);

    _defineProperty(this, "expiry", void 0);

    _defineProperty(this, "username", void 0);

    _defineProperty(this, "password", void 0);

    _defineProperty(this, "userId", void 0);

    _defineProperty(this, "subId", void 0);
  }

  _createClass(SimpliSafe3, [{
    key: "login",
    value: function () {
      var _login = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee(username, password) {
        var storeCredentials,
            response,
            data,
            _response,
            _args = arguments;

        return regeneratorRuntime.wrap(function _callee$(_context) {
          while (1) {
            switch (_context.prev = _context.next) {
              case 0:
                storeCredentials = _args.length > 2 && _args[2] !== undefined ? _args[2] : false;

                if (storeCredentials) {
                  this.username = username;
                  this.password = password;
                }

                _context.prev = 2;
                _context.next = 5;
                return ssApi.post('/api/token', {
                  username: username,
                  password: password,
                  grant_type: 'password'
                }, {
                  auth: {
                    username: clientUsername,
                    password: clientPassword
                  }
                });

              case 5:
                response = _context.sent;
                data = response.data;

                this._storeLogin(data);

                _context.next = 15;
                break;

              case 10:
                _context.prev = 10;
                _context.t0 = _context["catch"](2);
                _response = _context.t0.response && _context.t0.response ? _context.t0.response : _context.t0;
                this.logout(storeCredentials);
                throw _response;

              case 15:
              case "end":
                return _context.stop();
            }
          }
        }, _callee, this, [[2, 10]]);
      }));

      function login(_x, _x2) {
        return _login.apply(this, arguments);
      }

      return login;
    }()
  }, {
    key: "_storeLogin",
    value: function _storeLogin(tokenResponse) {
      this.token = tokenResponse.access_token;
      this.rToken = tokenResponse.refresh_token;
      this.tokenType = tokenResponse.token_type;
      this.expiry = Date.now() + tokenResponse.expires_in * 1000;
    }
  }, {
    key: "logout",
    value: function logout() {
      var keepCredentials = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
      this.token = null;
      this.rToken = null;
      this.tokenType = null;
      this.expiry = null;

      if (!keepCredentials) {
        this.username = null;
        this.password = null;
      }
    }
  }, {
    key: "isLoggedIn",
    value: function isLoggedIn() {
      return this.refreshToken !== null || this.token !== null && Date.now() < this.expiry;
    }
  }, {
    key: "refreshToken",
    value: function () {
      var _refreshToken = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee2() {
        var response, data, _response2;

        return regeneratorRuntime.wrap(function _callee2$(_context2) {
          while (1) {
            switch (_context2.prev = _context2.next) {
              case 0:
                if (!(!this.isLoggedIn() || !this.refreshToken)) {
                  _context2.next = 2;
                  break;
                }

                return _context2.abrupt("return", Promise.reject('User is not logged in'));

              case 2:
                _context2.prev = 2;
                _context2.next = 5;
                return ssApi.post('/api/token', {
                  refresh_token: this.rToken,
                  grant_type: 'refresh_token'
                }, {
                  auth: {
                    username: clientUsername,
                    password: clientPassword
                  }
                });

              case 5:
                response = _context2.sent;
                data = response.data;

                this._storeLogin(data);

                _context2.next = 15;
                break;

              case 10:
                _context2.prev = 10;
                _context2.t0 = _context2["catch"](2);
                _response2 = _context2.t0.response ? _context2.t0.response : _context2.t0;
                this.logout(this.username != null);
                throw _response2;

              case 15:
              case "end":
                return _context2.stop();
            }
          }
        }, _callee2, this, [[2, 10]]);
      }));

      function refreshToken() {
        return _refreshToken.apply(this, arguments);
      }

      return refreshToken;
    }()
  }, {
    key: "request",
    value: function () {
      var _request = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee4(params) {
        var _this = this;

        var tokenRefreshed,
            response,
            statusCode,
            _args4 = arguments;
        return regeneratorRuntime.wrap(function _callee4$(_context4) {
          while (1) {
            switch (_context4.prev = _context4.next) {
              case 0:
                tokenRefreshed = _args4.length > 1 && _args4[1] !== undefined ? _args4[1] : false;

                if (this.isLoggedIn) {
                  _context4.next = 3;
                  break;
                }

                return _context4.abrupt("return", Promise.reject('User is not logged in'));

              case 3:
                _context4.prev = 3;
                _context4.next = 6;
                return ssApi.request(_objectSpread({}, params, {
                  headers: _objectSpread({}, params.headers, {
                    Authorization: "".concat(this.tokenType, " ").concat(this.token)
                  })
                }));

              case 6:
                response = _context4.sent;
                return _context4.abrupt("return", response.data);

              case 10:
                _context4.prev = 10;
                _context4.t0 = _context4["catch"](3);
                statusCode = _context4.t0.response.status;

                if (!(statusCode == 401 && !tokenRefreshed)) {
                  _context4.next = 17;
                  break;
                }

                return _context4.abrupt("return", this.refreshToken().then(function () {
                  return _this.request(params, true);
                })["catch"](
                /*#__PURE__*/
                function () {
                  var _ref = _asyncToGenerator(
                  /*#__PURE__*/
                  regeneratorRuntime.mark(function _callee3(err) {
                    var statusCode;
                    return regeneratorRuntime.wrap(function _callee3$(_context3) {
                      while (1) {
                        switch (_context3.prev = _context3.next) {
                          case 0:
                            statusCode = err.status;

                            if (!((statusCode == 401 || statusCode == 403) && _this.username && _this.password)) {
                              _context3.next = 13;
                              break;
                            }

                            _context3.prev = 2;
                            _context3.next = 5;
                            return _this.login(_this.username, _this.password, true);

                          case 5:
                            return _context3.abrupt("return", _this.request(params, true));

                          case 8:
                            _context3.prev = 8;
                            _context3.t0 = _context3["catch"](2);
                            throw _context3.t0;

                          case 11:
                            _context3.next = 14;
                            break;

                          case 13:
                            throw err;

                          case 14:
                          case "end":
                            return _context3.stop();
                        }
                      }
                    }, _callee3, null, [[2, 8]]);
                  }));

                  return function (_x4) {
                    return _ref.apply(this, arguments);
                  };
                }()));

              case 17:
                throw _context4.t0.response.data;

              case 18:
              case "end":
                return _context4.stop();
            }
          }
        }, _callee4, this, [[3, 10]]);
      }));

      function request(_x3) {
        return _request.apply(this, arguments);
      }

      return request;
    }()
  }, {
    key: "getUserId",
    value: function () {
      var _getUserId = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee5() {
        var data;
        return regeneratorRuntime.wrap(function _callee5$(_context5) {
          while (1) {
            switch (_context5.prev = _context5.next) {
              case 0:
                if (!this.userId) {
                  _context5.next = 2;
                  break;
                }

                return _context5.abrupt("return", this.userId);

              case 2:
                _context5.prev = 2;
                _context5.next = 5;
                return this.request({
                  method: 'GET',
                  url: '/api/authCheck'
                });

              case 5:
                data = _context5.sent;
                this.userId = data.userId;
                return _context5.abrupt("return", this.userId);

              case 10:
                _context5.prev = 10;
                _context5.t0 = _context5["catch"](2);
                throw _context5.t0;

              case 13:
              case "end":
                return _context5.stop();
            }
          }
        }, _callee5, this, [[2, 10]]);
      }));

      function getUserId() {
        return _getUserId.apply(this, arguments);
      }

      return getUserId;
    }()
  }, {
    key: "getUserInfo",
    value: function () {
      var _getUserInfo = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee6() {
        var userId, data;
        return regeneratorRuntime.wrap(function _callee6$(_context6) {
          while (1) {
            switch (_context6.prev = _context6.next) {
              case 0:
                _context6.prev = 0;
                _context6.next = 3;
                return this.getUserId();

              case 3:
                userId = _context6.sent;
                _context6.next = 6;
                return this.request({
                  method: 'GET',
                  url: "/users/".concat(userId, "/loginInfo")
                });

              case 6:
                data = _context6.sent;
                return _context6.abrupt("return", data.loginInfo);

              case 10:
                _context6.prev = 10;
                _context6.t0 = _context6["catch"](0);
                throw _context6.t0;

              case 13:
              case "end":
                return _context6.stop();
            }
          }
        }, _callee6, this, [[0, 10]]);
      }));

      function getUserInfo() {
        return _getUserInfo.apply(this, arguments);
      }

      return getUserInfo;
    }()
  }, {
    key: "getSubscriptions",
    value: function () {
      var _getSubscriptions = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee7() {
        var userId, data, subscriptions;
        return regeneratorRuntime.wrap(function _callee7$(_context7) {
          while (1) {
            switch (_context7.prev = _context7.next) {
              case 0:
                _context7.prev = 0;
                _context7.next = 3;
                return this.getUserId();

              case 3:
                userId = _context7.sent;
                _context7.next = 6;
                return this.request({
                  method: 'GET',
                  url: "/users/".concat(userId, "/subscriptions?activeOnly=false")
                });

              case 6:
                data = _context7.sent;
                subscriptions = data.subscriptions;

                if (subscriptions.length == 1) {
                  this.subId = subscriptions[0].sid;
                }

                return _context7.abrupt("return", subscriptions);

              case 12:
                _context7.prev = 12;
                _context7.t0 = _context7["catch"](0);
                throw _context7.t0;

              case 15:
              case "end":
                return _context7.stop();
            }
          }
        }, _callee7, this, [[0, 12]]);
      }));

      function getSubscriptions() {
        return _getSubscriptions.apply(this, arguments);
      }

      return getSubscriptions;
    }()
  }, {
    key: "getSubscription",
    value: function () {
      var _getSubscription = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee8() {
        var subId,
            subscriptionId,
            subs,
            data,
            _args8 = arguments;
        return regeneratorRuntime.wrap(function _callee8$(_context8) {
          while (1) {
            switch (_context8.prev = _context8.next) {
              case 0:
                subId = _args8.length > 0 && _args8[0] !== undefined ? _args8[0] : null;
                _context8.prev = 1;
                subscriptionId = subId;

                if (subscriptionId) {
                  _context8.next = 14;
                  break;
                }

                subscriptionId = this.subId;

                if (subscriptionId) {
                  _context8.next = 14;
                  break;
                }

                _context8.next = 8;
                return this.getSubscriptions();

              case 8:
                subs = _context8.sent;

                if (!(subs.length == 1)) {
                  _context8.next = 13;
                  break;
                }

                subscriptionId = subs[0].sid;
                _context8.next = 14;
                break;

              case 13:
                throw new Error('Subscription ID is ambiguous');

              case 14:
                _context8.next = 16;
                return this.request({
                  method: 'GET',
                  url: "/subscriptions/".concat(subscriptionId, "/")
                });

              case 16:
                data = _context8.sent;
                return _context8.abrupt("return", data.subscription);

              case 20:
                _context8.prev = 20;
                _context8.t0 = _context8["catch"](1);
                throw _context8.t0;

              case 23:
              case "end":
                return _context8.stop();
            }
          }
        }, _callee8, this, [[1, 20]]);
      }));

      function getSubscription() {
        return _getSubscription.apply(this, arguments);
      }

      return getSubscription;
    }()
  }, {
    key: "setDefaultSubscription",
    value: function setDefaultSubscription(subId) {
      if (!subId) {
        throw new Error('Subscription ID not defined');
      }

      this.subId = subId;
    }
  }, {
    key: "getAlarmState",
    value: function () {
      var _getAlarmState = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee9() {
        var subscription;
        return regeneratorRuntime.wrap(function _callee9$(_context9) {
          while (1) {
            switch (_context9.prev = _context9.next) {
              case 0:
                _context9.prev = 0;
                _context9.next = 3;
                return this.getSubscription();

              case 3:
                subscription = _context9.sent;

                if (!(subscription.location && subscription.location.system)) {
                  _context9.next = 8;
                  break;
                }

                return _context9.abrupt("return", subscription.location.system.isAlarming ? 'ALARM' : subscription.location.system.alarmState);

              case 8:
                throw new Error('Subscription format not understood');

              case 9:
                _context9.next = 14;
                break;

              case 11:
                _context9.prev = 11;
                _context9.t0 = _context9["catch"](0);
                throw _context9.t0;

              case 14:
              case "end":
                return _context9.stop();
            }
          }
        }, _callee9, this, [[0, 11]]);
      }));

      function getAlarmState() {
        return _getAlarmState.apply(this, arguments);
      }

      return getAlarmState;
    }()
  }, {
    key: "setAlarmState",
    value: function () {
      var _setAlarmState = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee10(newState) {
        var state, data;
        return regeneratorRuntime.wrap(function _callee10$(_context10) {
          while (1) {
            switch (_context10.prev = _context10.next) {
              case 0:
                state = newState.toLowerCase();

                if (!(validAlarmStates.indexOf(state) == -1)) {
                  _context10.next = 3;
                  break;
                }

                throw new Error('Invalid target state');

              case 3:
                _context10.prev = 3;

                if (this.subId) {
                  _context10.next = 7;
                  break;
                }

                _context10.next = 7;
                return this.getSubscription();

              case 7:
                _context10.next = 9;
                return this.request({
                  method: 'POST',
                  url: "/ss3/subscriptions/".concat(this.subId, "/state/").concat(state)
                });

              case 9:
                data = _context10.sent;
                return _context10.abrupt("return", data);

              case 13:
                _context10.prev = 13;
                _context10.t0 = _context10["catch"](3);
                throw _context10.t0;

              case 16:
              case "end":
                return _context10.stop();
            }
          }
        }, _callee10, this, [[3, 13]]);
      }));

      function setAlarmState(_x5) {
        return _setAlarmState.apply(this, arguments);
      }

      return setAlarmState;
    }()
  }, {
    key: "getEvents",
    value: function () {
      var _getEvents = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee11() {
        var number,
            data,
            events,
            _args11 = arguments;
        return regeneratorRuntime.wrap(function _callee11$(_context11) {
          while (1) {
            switch (_context11.prev = _context11.next) {
              case 0:
                number = _args11.length > 0 && _args11[0] !== undefined ? _args11[0] : 10;
                _context11.prev = 1;

                if (this.subId) {
                  _context11.next = 5;
                  break;
                }

                _context11.next = 5;
                return this.getSubscription();

              case 5:
                _context11.next = 7;
                return this.request({
                  method: 'GET',
                  url: "/subscriptions/".concat(this.subId, "/events?numEvents=").concat(number)
                });

              case 7:
                data = _context11.sent;
                events = data.events;
                return _context11.abrupt("return", events);

              case 12:
                _context11.prev = 12;
                _context11.t0 = _context11["catch"](1);
                throw _context11.t0;

              case 15:
              case "end":
                return _context11.stop();
            }
          }
        }, _callee11, this, [[1, 12]]);
      }));

      function getEvents() {
        return _getEvents.apply(this, arguments);
      }

      return getEvents;
    }()
  }, {
    key: "getSensors",
    value: function () {
      var _getSensors = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee12() {
        var forceUpdate,
            data,
            _args12 = arguments;
        return regeneratorRuntime.wrap(function _callee12$(_context12) {
          while (1) {
            switch (_context12.prev = _context12.next) {
              case 0:
                forceUpdate = _args12.length > 0 && _args12[0] !== undefined ? _args12[0] : false;
                _context12.prev = 1;

                if (this.subId) {
                  _context12.next = 5;
                  break;
                }

                _context12.next = 5;
                return this.getSubscription();

              case 5:
                _context12.next = 7;
                return this.request({
                  method: 'GET',
                  url: "/ss3/subscriptions/".concat(this.subId, "/sensors?forceUpdate=").concat(forceUpdate ? 'true' : 'false')
                });

              case 7:
                data = _context12.sent;
                return _context12.abrupt("return", data.sensors);

              case 11:
                _context12.prev = 11;
                _context12.t0 = _context12["catch"](1);
                throw _context12.t0;

              case 14:
              case "end":
                return _context12.stop();
            }
          }
        }, _callee12, this, [[1, 11]]);
      }));

      function getSensors() {
        return _getSensors.apply(this, arguments);
      }

      return getSensors;
    }()
  }]);

  return SimpliSafe3;
}();

var _default = SimpliSafe3;
exports["default"] = _default;