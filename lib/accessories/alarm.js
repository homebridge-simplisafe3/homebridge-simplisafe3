"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

var _TARGET_HOMEKIT_TO_SS;

function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }

function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

var CURRENT_SS3_TO_HOMEKIT = {
  'OFF': (void 0).Characteristic.SecuritySystemCurrentState.DISARM,
  'HOME': (void 0).Characteristic.SecuritySystemCurrentState.STAY_ARM,
  'AWAY': (void 0).Characteristic.SecuritySystemCurrentState.AWAY_ARM,
  'HOME_COUNT': (void 0).Characteristic.SecuritySystemCurrentState.DISARM,
  'AWAY_COUNT': (void 0).Characteristic.SecuritySystemCurrentState.DISARM,
  'ALARM_COUNT': (void 0).Characteristic.SecuritySystemCurrentState.AWAY_ARM,
  'ALARM': (void 0).Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
};
var TARGET_SS3_TO_HOMEKIT = {
  'OFF': (void 0).Characteristic.SecuritySystemTargetState.DISARM,
  'HOME': (void 0).Characteristic.SecuritySystemTargetState.STAY_ARM,
  'AWAY': (void 0).Characteristic.SecuritySystemTargetState.AWAY_ARM,
  'HOME_COUNT': (void 0).Characteristic.SecuritySystemTargetState.STAY_ARM,
  'AWAY_COUNT': (void 0).Characteristic.SecuritySystemTargetState.AWAY_ARM
};
var TARGET_HOMEKIT_TO_SS3 = (_TARGET_HOMEKIT_TO_SS = {}, _defineProperty(_TARGET_HOMEKIT_TO_SS, (void 0).Characteristic.SecuritySystemTargetState.DISARM, 'OFF'), _defineProperty(_TARGET_HOMEKIT_TO_SS, (void 0).Characteristic.SecuritySystemTargetState.STAY_ARM, 'HOME'), _defineProperty(_TARGET_HOMEKIT_TO_SS, (void 0).Characteristic.SecuritySystemTargetState.AWAY_ARM, 'AWAY'), _TARGET_HOMEKIT_TO_SS);

var SS3Alarm =
/*#__PURE__*/
function () {
  function SS3Alarm(name, id, log, simplisafe, Service, Characteristic, Accessory, UUIDGen) {
    var _this = this;

    _classCallCheck(this, SS3Alarm);

    this.Characteristic = Characteristic;
    this.log = log;
    this.name = name;
    this.simplisafe = simplisafe;
    this.uuid = UUIDGen.generate(id);
    this.currentState = null;
    this.accessory = new Accessory(name, this.uuid);
    this.accessory.on('identify', function (paired, callback) {
      return _this.identify(paired, callback);
    });
    this.service = new Service.SecuritySystem('Alarm System');
    this.service.getCharacteristic(Characteristic.SecuritySystemCurrentState).on('get', function (callback) {
      return _this.getCurrentState(callback);
    });
    this.service.getCharacteristic(Characteristic.SecuritySystemTargetState).on('get', function (callback) {
      return _this.getTargetState(callback);
    }).on('set', function (state, callback) {
      return _this.setTargetState(state, callback);
    });
    this.startRefreshState();
  }

  _createClass(SS3Alarm, [{
    key: "identify",
    value: function identify(paired, callback) {
      this.log("Identify request for ".concat(this.name, ", paired: ").concat(paired));
      callback();
    }
  }, {
    key: "updateReachability",
    value: function () {
      var _updateReachability = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee() {
        var subscription, connType;
        return regeneratorRuntime.wrap(function _callee$(_context) {
          while (1) {
            switch (_context.prev = _context.next) {
              case 0:
                _context.prev = 0;
                _context.next = 3;
                return this.simplisafe.getSubscription();

              case 3:
                subscription = _context.sent;
                connType = subscription.location.system.connType;
                this.reachable = connType == 'wifi' || connType == 'cell';
                this.log("Reachability updated for ".concat(this.name, ": ").concat(this.reachable));
                _context.next = 13;
                break;

              case 9:
                _context.prev = 9;
                _context.t0 = _context["catch"](0);
                this.log("An error occurred while updating reachability for ".concat(this.name));
                this.log(_context.t0);

              case 13:
              case "end":
                return _context.stop();
            }
          }
        }, _callee, this, [[0, 9]]);
      }));

      function updateReachability() {
        return _updateReachability.apply(this, arguments);
      }

      return updateReachability;
    }()
  }, {
    key: "getServices",
    value: function getServices() {
      return [this.service];
    }
  }, {
    key: "getState",
    value: function () {
      var _getState = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee2() {
        var stateType,
            state,
            homekitState,
            _args2 = arguments;
        return regeneratorRuntime.wrap(function _callee2$(_context2) {
          while (1) {
            switch (_context2.prev = _context2.next) {
              case 0:
                stateType = _args2.length > 0 && _args2[0] !== undefined ? _args2[0] : 'current';
                _context2.prev = 1;
                _context2.next = 4;
                return this.simplisafe.getAlarmState();

              case 4:
                state = _context2.sent;
                this.log("Received new alarm state from SimpliSafe: ".concat(state));
                homekitState = CURRENT_SS3_TO_HOMEKIT[state];

                if (stateType == 'target') {
                  homekitState = TARGET_SS3_TO_HOMEKIT[state];
                }

                if (!this.currentState || this.currentState !== homekitState) {
                  this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, homekitState);
                }

                return _context2.abrupt("return", homekitState);

              case 12:
                _context2.prev = 12;
                _context2.t0 = _context2["catch"](1);
                throw _context2.t0;

              case 15:
              case "end":
                return _context2.stop();
            }
          }
        }, _callee2, this, [[1, 12]]);
      }));

      function getState() {
        return _getState.apply(this, arguments);
      }

      return getState;
    }()
  }, {
    key: "getCurrentState",
    value: function getCurrentState(callback) {
      this.getState('current').then(function (homekitState) {
        callback(null, homekitState);
      })["catch"](function (err) {
        callback(new Error("An error occurred while getting the alarm state: ".concat(err)));
      });
    }
  }, {
    key: "getTargetState",
    value: function getTargetState(callback) {
      this.getState('target').then(function (homekitState) {
        callback(null, homekitState);
      })["catch"](function (err) {
        callback(new Error("An error occurred while getting the alarm state: ".concat(err)));
      });
    }
  }, {
    key: "setTargetState",
    value: function setTargetState(homekitState, callback) {
      var _this2 = this;

      var state = TARGET_HOMEKIT_TO_SS3[homekitState];
      this.simplisafe.setAlarmState(state).then(function (data) {
        _this2.log("Updated alarm state: ".concat(JSON.stringify(data)));

        _this2.service.setCharacteristic(_this2.Characteristic.SecuritySystemCurrentState, homekitState);

        _this2.currentState = homekitState;
        callback(null);
      })["catch"](function (err) {
        callback(new Error("An error occurred while setting the alarm state: ".concat(err)));
      });
    }
  }, {
    key: "startRefreshState",
    value: function startRefreshState() {
      var _this3 = this;

      var interval = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 10000;
      this.stopRefreshState();
      this.refreshInterval = setInterval(
      /*#__PURE__*/
      _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee3() {
        return regeneratorRuntime.wrap(function _callee3$(_context3) {
          while (1) {
            switch (_context3.prev = _context3.next) {
              case 0:
                _context3.next = 2;
                return _this3.refreshState();

              case 2:
              case "end":
                return _context3.stop();
            }
          }
        }, _callee3);
      })), interval);
    }
  }, {
    key: "stopRefreshState",
    value: function stopRefreshState() {
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
        this.refreshInterval = null;
      }
    }
  }, {
    key: "refreshState",
    value: function () {
      var _refreshState = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee4() {
        var state, homekitState;
        return regeneratorRuntime.wrap(function _callee4$(_context4) {
          while (1) {
            switch (_context4.prev = _context4.next) {
              case 0:
                try {
                  state = this.simplisafe.getAlarmState();
                  homekitState = CURRENT_SS3_TO_HOMEKIT[state];

                  if (homekitState !== this.currentState) {
                    this.service.setCharacteristic(this.Characteristic.SecuritySystemCurrentState, homekitState);
                    this.currentState = homekitState;
                    this.log("Updated current state for ".concat(this.name, ": ").concat(state));
                  }
                } catch (err) {
                  this.log('An error occurred while refreshing state');
                  this.log(err);
                }

              case 1:
              case "end":
                return _context4.stop();
            }
          }
        }, _callee4, this);
      }));

      function refreshState() {
        return _refreshState.apply(this, arguments);
      }

      return refreshState;
    }()
  }]);

  return SS3Alarm;
}();

var _default = SS3Alarm;
exports["default"] = _default;