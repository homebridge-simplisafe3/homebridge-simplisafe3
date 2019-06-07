"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

var _simpilsafe = _interopRequireDefault(require("./simpilsafe"));

var _alarm = _interopRequireDefault(require("./accessories/alarm"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }

function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var PLUGIN_NAME = 'homebridge-simplisafe3';
var PLATFORM_NAME = 'SimpliSafe 3';
var Accessory, Service, Characteristic, UUIDGen;

var SS3Platform =
/*#__PURE__*/
function () {
  function SS3Platform(log, config, api) {
    var _this = this;

    _classCallCheck(this, SS3Platform);

    this.log = log;
    this.name = config.name;
    this.accessories = [];
    this.simplisafe = new _simpilsafe["default"]();

    if (api) {
      this.api = api;
      this.api.on('didFinishLaunching', function () {
        _this.log('DidFinishLaunching');

        _this.simplisafe.login(config.auth.username, config.auth.password, true).then(function () {
          _this.log('Logged in!');

          if (config.subscriptionId) {
            _this.simplisafe.setDefaultSubscription(config.subscriptionId);
          }

          return _this.refreshAccessories();
        })["catch"](function (err) {
          _this.log('SS3 init failed');

          _this.log(err);
        });
      });
    }
  }

  _createClass(SS3Platform, [{
    key: "addAccessory",
    value: function addAccessory(accessory) {
      this.log('Add accessory');
      this.accessories.push(accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory.accessory]);
    }
  }, {
    key: "configureAccessory",
    value: function configureAccessory(accessory) {
      this.log('Configure accessory');
      this.log(accessory);
    }
  }, {
    key: "refreshAccessories",
    value: function () {
      var _refreshAccessories = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee() {
        var subscription, uuid, alarm, alarmAccessory, sensors, _iteratorNormalCompletion, _didIteratorError, _iteratorError, _iterator, _step, sensor;

        return regeneratorRuntime.wrap(function _callee$(_context) {
          while (1) {
            switch (_context.prev = _context.next) {
              case 0:
                this.log('Refreshing accessories');
                _context.prev = 1;
                _context.next = 4;
                return this.simplisafe.getSubscription();

              case 4:
                subscription = _context.sent;
                uuid = UUIDGen.generate(subscription.location.system.serial);
                alarm = this.accessories.find(function (acc) {
                  return acc.uuid === uuid;
                });

                if (!alarm) {
                  this.log('Alarm not found, adding...');
                  alarmAccessory = new _alarm["default"]('SimpliSafe3 Alarm', subscription.location.system.serial, this.log, this.simplisafe, Service, Characteristic, Accessory, UUIDGen);
                  this.addAccessory(alarmAccessory);
                }

                _context.next = 10;
                return this.simplisafe.getSensors();

              case 10:
                sensors = _context.sent;
                _iteratorNormalCompletion = true;
                _didIteratorError = false;
                _iteratorError = undefined;
                _context.prev = 14;
                _iterator = sensors[Symbol.iterator]();

              case 16:
                if (_iteratorNormalCompletion = (_step = _iterator.next()).done) {
                  _context.next = 26;
                  break;
                }

                sensor = _step.value;
                _context.t0 = sensor.type;
                _context.next = _context.t0 === 5 ? 21 : 22;
                break;

              case 21:
                return _context.abrupt("break", 23);

              case 22:
                this.log("Sensor not (yet) supported: ".concat(sensor.name));

              case 23:
                _iteratorNormalCompletion = true;
                _context.next = 16;
                break;

              case 26:
                _context.next = 32;
                break;

              case 28:
                _context.prev = 28;
                _context.t1 = _context["catch"](14);
                _didIteratorError = true;
                _iteratorError = _context.t1;

              case 32:
                _context.prev = 32;
                _context.prev = 33;

                if (!_iteratorNormalCompletion && _iterator["return"] != null) {
                  _iterator["return"]();
                }

              case 35:
                _context.prev = 35;

                if (!_didIteratorError) {
                  _context.next = 38;
                  break;
                }

                throw _iteratorError;

              case 38:
                return _context.finish(35);

              case 39:
                return _context.finish(32);

              case 40:
                _context.next = 46;
                break;

              case 42:
                _context.prev = 42;
                _context.t2 = _context["catch"](1);
                this.log('An error occurred while refreshing accessories');
                this.log(_context.t2);

              case 46:
              case "end":
                return _context.stop();
            }
          }
        }, _callee, this, [[1, 42], [14, 28, 32, 40], [33,, 35, 39]]);
      }));

      function refreshAccessories() {
        return _refreshAccessories.apply(this, arguments);
      }

      return refreshAccessories;
    }()
  }, {
    key: "updateAccessoriesReachability",
    value: function updateAccessoriesReachability() {
      var _iteratorNormalCompletion2 = true;
      var _didIteratorError2 = false;
      var _iteratorError2 = undefined;

      try {
        for (var _iterator2 = this.accessories[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
          var accessory = _step2.value;
          accessory.updateReachability();
        }
      } catch (err) {
        _didIteratorError2 = true;
        _iteratorError2 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion2 && _iterator2["return"] != null) {
            _iterator2["return"]();
          }
        } finally {
          if (_didIteratorError2) {
            throw _iteratorError2;
          }
        }
      }
    }
  }]);

  return SS3Platform;
}();

var homebridge = function homebridge(_homebridge) {
  Accessory = _homebridge.platformAccessory;
  Service = _homebridge.hap.Service;
  Characteristic = _homebridge.hap.Characteristic;
  UUIDGen = _homebridge.hap.uuid;

  _homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SS3Platform, true);
};

var _default = homebridge;
exports["default"] = _default;