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

    if (api) {
      this.api = api;
      this.api.on('didFinishLaunching', function () {
        _this.log('DidFinishLaunching');
      });
    }

    this.simplisafe = new _simpilsafe["default"]();
    this.simplisafe.login(config.auth.username, config.auth.password, true).then(function () {
      _this.log('Logged in!');

      if (config.subscriptionId) {
        _this.simplisafe.setDefaultSubscription(config.subscriptionId);
      }

      return _this.refreshAccessories();
    })["catch"](function (err) {
      _this.log('SS3 init failed');

      _this.log(err);
    });
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
        var subscription, uuid, alarm, alarmAccessory;
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
                } // Add other sensors here


                _context.next = 14;
                break;

              case 10:
                _context.prev = 10;
                _context.t0 = _context["catch"](1);
                this.log('An error occurred while refreshing accessories');
                this.log(_context.t0);

              case 14:
              case "end":
                return _context.stop();
            }
          }
        }, _callee, this, [[1, 10]]);
      }));

      function refreshAccessories() {
        return _refreshAccessories.apply(this, arguments);
      }

      return refreshAccessories;
    }()
  }, {
    key: "updateAccessoriesReachability",
    value: function updateAccessoriesReachability() {
      var _iteratorNormalCompletion = true;
      var _didIteratorError = false;
      var _iteratorError = undefined;

      try {
        for (var _iterator = this.accessories[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
          var accessory = _step.value;
          accessory.updateReachability();
        }
      } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion && _iterator["return"] != null) {
            _iterator["return"]();
          }
        } finally {
          if (_didIteratorError) {
            throw _iteratorError;
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