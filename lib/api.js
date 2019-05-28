"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

var _axios = _interopRequireDefault(require("axios"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }

function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

var ssApi = _axios["default"].create({
  baseURL: 'https://api.simplisafe.com/v1/api'
});

var SimpliSafe =
/*#__PURE__*/
function () {
  function SimpliSafe() {
    _classCallCheck(this, SimpliSafe);

    _defineProperty(this, "token", null);

    _defineProperty(this, "refreshToken", null);

    _defineProperty(this, "tokenType", null);

    _defineProperty(this, "expiry", null);
  }

  _createClass(SimpliSafe, [{
    key: "login",
    value: function () {
      var _login = _asyncToGenerator(
      /*#__PURE__*/
      regeneratorRuntime.mark(function _callee(username, password) {
        var response, data, _data;

        return regeneratorRuntime.wrap(function _callee$(_context) {
          while (1) {
            switch (_context.prev = _context.next) {
              case 0:
                _context.prev = 0;
                _context.next = 3;
                return ssApi.post('/token', {
                  username: username,
                  password: password,
                  grant_type: 'password'
                }, {
                  headers: {
                    Authorization: 'Basic NGRmNTU2MjctNDZiMi00ZTJjLTg2NmItMTUyMWIzOTVkZWQyLjEtMjgtMC5XZWJBcHAuc2ltcGxpc2FmZS5jb206'
                  }
                });

              case 3:
                response = _context.sent;
                data = response.data;
                this.token = data.access_token;
                this.refreshToken = data.refresh_token;
                this.tokenType = data.token_type;
                this.expiry = Date.now() + data.expires_in * 1000;
                _context.next = 19;
                break;

              case 11:
                _context.prev = 11;
                _context.t0 = _context["catch"](0);
                _data = _context.t0.response.data;
                this.token = null;
                this.refreshToken = null;
                this.tokenType = null;
                this.expiry = null;
                throw _data;

              case 19:
              case "end":
                return _context.stop();
            }
          }
        }, _callee, this, [[0, 11]]);
      }));

      function login(_x, _x2) {
        return _login.apply(this, arguments);
      }

      return login;
    }()
  }, {
    key: "isLoggedIn",
    value: function isLoggedIn() {
      return this.refreshToken !== null || this.token !== null && Date.now() < expiry;
    }
  }, {
    key: "request",
    value: function request() {}
  }]);

  return SimpliSafe;
}();

var _default = SimpliSafe; // :method: POST
// :scheme: https
// :authority: api.simplisafe.com
// :path: /v1/api/token
// Accept: application/json, text/plain, */*
// Content-Type: application/json;charset=UTF-8
// Origin: https://webapp.simplisafe.co.uk
// Authorization: Basic: NGRmNTU2MjctNDZiMi00ZTJjLTg2NmItMTUyMWIzOTVkZWQyLjEtMjgtMC5XZWJBcHAuc2ltcGxpc2FmZS5jb206
// Referer: https://webapp.simplisafe.co.uk/
// Content-Length: 294
// Host: api.simplisafe.com
// Accept-Language: en-us
// User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.1 Safari/605.1.15
// Accept-Encoding: br, gzip, deflate
// Connection: keep-alive
// Request
// {"grant_type":"password","username":"nzapponi@gmail.com","password":"riqhy1-tirbob-fewsaN","device_id":"WebApp; useragent=\"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.1 Safari/605.1.15\"; uuid=\"4df55627-46b2-4e2c-866b-1521b395ded2\""}
// Response
// {
//     "access_token": "hNW1qfWeiirjAFVIMTuRD+fKk6g2vqoUwWn6i6ei06k=",
//     "expires_in": 3600,
//     "token_type": "Bearer"
// }
// :method: GET
// :scheme: https
// :authority: api.simplisafe.com
// :path: /v1/api/authCheck
// Accept: application/json, text/plain, */*
// Origin: https://webapp.simplisafe.co.uk
// Referer: https://webapp.simplisafe.co.uk/
// Accept-Language: en-us
// Host: api.simplisafe.com
// User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.1 Safari/605.1.15
// Authorization: Bearer hNW1qfWeiirjAFVIMTuRD+fKk6g2vqoUwWn6i6ei06k=
// Accept-Encoding: br, gzip, deflate
// Connection: keep-alive
// Response
// {
//     "userId": 2290758,
//     "isAdmin": false
// }
// :method: GET
// :scheme: https
// :authority: api.simplisafe.com
// :path: /v1/users/2290758/loginInfo
// Accept: application/json, text/plain, */*
// Origin: https://webapp.simplisafe.co.uk
// Referer: https://webapp.simplisafe.co.uk/
// Accept-Language: en-us
// Host: api.simplisafe.com
// User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.1 Safari/605.1.15
// Authorization: Bearer hNW1qfWeiirjAFVIMTuRD+fKk6g2vqoUwWn6i6ei06k=
// Accept-Encoding: br, gzip, deflate
// Connection: keep-alive
// Response
// {
//     "loginInfo": {
//         "username": "nzapponi",
//         "email": "nzapponi@gmail.com",
//         "country": "GB"
//     }
// }
// :method: GET
// :scheme: https
// :authority: api.simplisafe.com
// :path: /v1/users/2290758/subscriptions?activeOnly=false
// Accept: application/json, text/plain, */*
// Origin: https://webapp.simplisafe.co.uk
// Referer: https://webapp.simplisafe.co.uk/
// Accept-Language: en-us
// Host: api.simplisafe.com
// User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.1 Safari/605.1.15
// Authorization: Bearer hNW1qfWeiirjAFVIMTuRD+fKk6g2vqoUwWn6i6ei06k=
// Accept-Encoding: br, gzip, deflate
// Connection: keep-alive
// Response
// {
//     "subscriptions": [
//         {
//             "uid": 2290758,
//             "sid": 2305642,
//             "sStatus": 10,
//             "activated": 1558738735,
//             "planSku": "SSEDSM2_GB",
//             "planName": "Pro Premium",
//             "pinUnlocked": true,
//             "location": {
//                 "sid": 2305642,
//                 "uid": 2290758,
//                 "account": "0005EE1E",
//                 "street1": "Flat 12, Empire Reach",
//                 "street2": "4 Dowells Street",
//                 "locationName": "Home",
//                 "city": "London",
//                 "county": "London",
//                 "state": "LDN",
//                 "zip": "SE10 9EB",
//                 "country": "GB",
//                 "notes": "The flat is on the 2nd floor - NCQ Concierge can help with access to the building if necessary.",
//                 "residenceType": 1,
//                 "numAdults": 2,
//                 "numChildren": 0,
//                 "safeWord": "duchessina",
//                 "signature": "Niccolo Zapponi",
//                 "timeZone": 8,
//                 "primaryContacts": [
//                     {
//                         "name": "Niccolo Zapponi",
//                         "phone": "07547791310"
//                     },
//                     {
//                         "name": "",
//                         "phone": "07747763897"
//                     }
//                 ],
//                 "secondaryContacts": [
//                     {
//                         "name": "Ludovica  Di Canio",
//                         "phone": "07552434440"
//                     },
//                     {
//                         "name": "",
//                         "phone": ""
//                     },
//                     {
//                         "name": "",
//                         "phone": ""
//                     },
//                     {
//                         "name": "",
//                         "phone": ""
//                     },
//                     {
//                         "name": "",
//                         "phone": ""
//                     }
//                 ],
//                 "copsOptIn": true,
//                 "smashSafeOptIn": false,
//                 "certificateUri": "https://simplisafe.com/account2/2290758/alarm-certificate/2305642",
//                 "locationOffset": 60,
//                 "nestStructureId": "",
//                 "system": {
//                     "serial": "0005EE1E",
//                     "alarmState": "OFF",
//                     "alarmStateTimestamp": 0,
//                     "isAlarming": false,
//                     "version": 3,
//                     "temperature": null,
//                     "exitDelayRemaining": 60,
//                     "cameras": [
//                         {
//                             "uuid": "1fe89fb1e73405eb7011cd48e006960f",
//                             "uid": 2290758,
//                             "sid": 2305642,
//                             "cameraSettings": {
//                                 "admin": {
//                                     "wlanMac": "6c:21:a2:0b:c3:87",
//                                     "odEnableVideoAnalyticsWhileStreaming": false,
//                                     "odClassifierQualityProfile": 1,
//                                     "odBackgroundLearnStationarySpeed": 15,
//                                     "odBackgroundLearnStationary": true,
//                                     "odCameraFOV": 2,
//                                     "odCameraView": 3,
//                                     "odSceneType": 1,
//                                     "odVideoScaleFactor": 1,
//                                     "odFGExtractorMode": 2,
//                                     "odLuxSamplingFrequency": 30,
//                                     "odLuxHysteresisLow": 4,
//                                     "odLuxHysteresisHigh": 4,
//                                     "odLuxThreshold": 445,
//                                     "odEventObjectMask": 2,
//                                     "odSensitivity": 85,
//                                     "odAnalyticsLib": 1,
//                                     "odEnableOverlay": false,
//                                     "odClassificationConfidenceThreshold": 0.95,
//                                     "odClassificationMask": 22,
//                                     "odEnableObjectDetection": true,
//                                     "odObjectMinHeightPercent": 16,
//                                     "odObjectMinWidthPercent": 8,
//                                     "odProcessingFps": 8,
//                                     "sarlaccDebugLogTypes": 0,
//                                     "statsPeriod": 3600000,
//                                     "wifiDriverReloads": 0,
//                                     "wifiDisconnects": 0,
//                                     "uptime": 0,
//                                     "resSet": 0,
//                                     "vmUse": 0,
//                                     "dbm": 0,
//                                     "battery": [],
//                                     "rssi": [],
//                                     "irThreshold3x": 260,
//                                     "irThreshold2x": 335,
//                                     "irThreshold1x": 388,
//                                     "irCloseDelay": 3,
//                                     "irOpenDelay": 3,
//                                     "irCloseThreshold": 840,
//                                     "irOpenThreshold": 445,
//                                     "firmwareGroup": "public",
//                                     "logQDepth": 20,
//                                     "logLevel": 3,
//                                     "logEnabled": true,
//                                     "pirFilterCoefficient": 1,
//                                     "pirHysteresisLow": 10,
//                                     "pirHysteresisHigh": 2,
//                                     "pirSampleRateMs": 800,
//                                     "lastLogout": 1558880474,
//                                     "lastLogin": 1558881460,
//                                     "camAgentVersion": "2.2.5.39",
//                                     "netConfigVersion": "2.2.5.39",
//                                     "firmwareVersion": "2.2.5.39",
//                                     "fps": 25,
//                                     "idr": 1,
//                                     "gopLength": 50,
//                                     "kframe": 1,
//                                     "longPress": 2000,
//                                     "bitRate": 284,
//                                     "audioDirection": 0,
//                                     "audioThreshold": 50,
//                                     "audioSensitivity": 50,
//                                     "audioSampleFormat": 3,
//                                     "audioChunkBytes": 2048,
//                                     "audioSampleRate": 16000,
//                                     "audioChannelNum": 2,
//                                     "audioDetectionEnabled": false,
//                                     "levelChangeDelayOne": 10,
//                                     "levelChangeDelayZero": 30,
//                                     "motionThresholdOne": 10000,
//                                     "motionThresholdZero": 0,
//                                     "motionDetectionEnabled": false,
//                                     "lux": "lowLux",
//                                     "statusLEDState": 1,
//                                     "pirSens": 0,
//                                     "IRLED": 0,
//                                     "ivLicense": ""
//                                 },
//                                 "hdr": false,
//                                 "privacyEnable": false,
//                                 "enableDoorbellNotification": true,
//                                 "notificationsEnable": false,
//                                 "vaEnable": true,
//                                 "pirEnable": true,
//                                 "canRecord": false,
//                                 "canStream": false,
//                                 "wifiSsid": "Ludolò",
//                                 "shutterOff": "closedAlarmOnly",
//                                 "shutterAway": "open",
//                                 "shutterHome": "closedAlarmOnly",
//                                 "motionSensitivity": 0,
//                                 "speakerVolume": 75,
//                                 "micEnable": true,
//                                 "micSensitivity": 100,
//                                 "statusLight": "off",
//                                 "nightVision": "auto",
//                                 "pictureQuality": "720p",
//                                 "cameraName": "Living Room",
//                                 "pirLevel": "medium",
//                                 "odLevel": "custom"
//                             },
//                             "__v": 0,
//                             "model": "SS001",
//                             "upgradeWhitelisted": false,
//                             "staleSettingsTypes": [],
//                             "subscription": {
//                                 "enabled": true,
//                                 "freeTrialUsed": true,
//                                 "freeTrialEnds": 1561410665,
//                                 "planSku": "SSVM1",
//                                 "price": 0,
//                                 "expires": 1561410665,
//                                 "storageDays": 30
//                             },
//                             "status": "online"
//                         }
//                     ],
//                     "connType": "wifi",
//                     "stateUpdated": 1558944899,
//                     "messages": []
//                 }
//             },
//             "price": 19.99,
//             "currency": "GBP",
//             "country": "GB",
//             "billDate": 1558997935,
//             "features": {
//                 "monitoring": true,
//                 "alerts": true,
//                 "online": true,
//                 "hazard": false,
//                 "video": true,
//                 "cameras": 10,
//                 "dispatch": false,
//                 "proInstall": false,
//                 "discount": 0,
//                 "vipCS": false,
//                 "medical": false,
//                 "careVisit": false,
//                 "storageDays": 30
//             },
//             "creditCard": {
//                 "type": "Visa",
//                 "lastFour": "2009"
//             },
//             "pinUnlockedBy": "pin"
//         }
//     ]
// }
// :method: GET
// :scheme: https
// :authority: api.simplisafe.com
// :path: /v1/subscriptions/2305642/events?numEvents=50
// Accept: application/json, text/plain, */*
// Origin: https://webapp.simplisafe.co.uk
// Referer: https://webapp.simplisafe.co.uk/
// Accept-Language: en-us
// Host: api.simplisafe.com
// User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.1 Safari/605.1.15
// Authorization: Bearer hNW1qfWeiirjAFVIMTuRD+fKk6g2vqoUwWn6i6ei06k=
// Accept-Encoding: br, gzip, deflate
// Connection: keep-alive
// Response
// {
//     "numEvents": 50,
//     "lastEventTimestamp": 1558783891,
//     "events": [
//         {
//             "eventId": 5168628639,
//             "eventTimestamp": 1558944899,
//             "eventCid": 1407,
//             "zoneCid": "0",
//             "sensorType": 0,
//             "sensorSerial": "",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Disarmed by Remote",
//             "pinName": "",
//             "sensorName": "",
//             "messageSubject": "SimpliSafe System Disarmed",
//             "messageBody": "System Disarmed: Your SimpliSafe security system was disarmed by Remote at Home on 5-27-19 at 9:14 am",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1397360217,
//                     "preroll": 5,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5165726807,
//             "eventTimestamp": 1558911773,
//             "eventCid": 3441,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Armed (Home) by Keypad Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "SimpliSafe System Armed (home mode)",
//             "messageBody": "System Armed (home mode): Your SimpliSafe System was armed (home) at Home on 5-27-19 at 12:02 am",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1395691867,
//                     "preroll": 0,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5165723121,
//             "eventTimestamp": 1558911744,
//             "eventCid": 9441,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Exit Delay Countdown Triggered for Home Mode by Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "internal": {
//                 "shouldNotify": false
//             },
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1395689623,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5165240745,
//             "eventTimestamp": 1558907990,
//             "eventCid": 1602,
//             "zoneCid": "0",
//             "sensorType": 0,
//             "sensorSerial": "",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Automatic Test",
//             "pinName": "",
//             "sensorName": "",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "auto",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {}
//         },
//         {
//             "eventId": 5164006737,
//             "eventTimestamp": 1558898538,
//             "eventCid": 1400,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Disarmed by Master PIN",
//             "pinName": "Master PIN",
//             "sensorName": "Keypad",
//             "messageSubject": "SimpliSafe System Disarmed",
//             "messageBody": "System Disarmed: Your SimpliSafe security system was disarmed by Keypad Master PIN at Home on 5-26-19 at 8:22 pm",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1394609319,
//                     "preroll": 5,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5164005905,
//             "eventTimestamp": 1558898532,
//             "eventCid": 1429,
//             "zoneCid": "0",
//             "sensorType": 5,
//             "sensorSerial": "00466502",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Entry Detected by Sensor:  Front Door",
//             "pinName": "",
//             "sensorName": "Front Door",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1394608785,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5163071451,
//             "eventTimestamp": 1558891723,
//             "eventCid": 3401,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Armed (Away) by Keypad Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "SimpliSafe System Armed (away mode)",
//             "messageBody": "System Armed (away mode): Your SimpliSafe System was armed (away) at Home on 5-26-19 at 6:28 pm",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1394010923,
//                     "preroll": 0,
//                     "postroll": 75,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5163064063,
//             "eventTimestamp": 1558891673,
//             "eventCid": 9401,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Exit Delay Countdown Triggered for Away Mode by Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "internal": {
//                 "shouldNotify": false
//             },
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1394006059,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5162894293,
//             "eventTimestamp": 1558890493,
//             "eventCid": 1400,
//             "zoneCid": "8",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Exit Delay Countdown Cancelled - System Disarmed",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "internal": {
//                 "shouldNotify": false
//             },
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1393896699,
//                     "preroll": 5,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5162893439,
//             "eventTimestamp": 1558890487,
//             "eventCid": 9401,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Exit Delay Countdown Triggered for Away Mode by Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "internal": {
//                 "shouldNotify": false
//             },
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1393896175,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5162693233,
//             "eventTimestamp": 1558889099,
//             "eventCid": 1170,
//             "zoneCid": "0",
//             "sensorType": 12,
//             "sensorSerial": "",
//             "account": "0005EE1E",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Camera Detected Motion",
//             "pinName": "",
//             "sensorName": "Living Room",
//             "messageSubject": "Camera Detected Motion",
//             "messageBody": "Camera Detected Motion on 5-26-19 at 5:44 pm",
//             "eventType": "activityCam",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "1fe89fb1e73405eb7011cd48e006960f",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1393769845,
//                     "preroll": 5,
//                     "postroll": 60,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5162688497,
//             "eventTimestamp": 1558889066,
//             "eventCid": 1400,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Disarmed by Master PIN",
//             "pinName": "Master PIN",
//             "sensorName": "Keypad",
//             "messageSubject": "SimpliSafe System Disarmed",
//             "messageBody": "System Disarmed: Your SimpliSafe security system was disarmed by Keypad Master PIN at Home on 5-26-19 at 5:44 pm",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1393766867,
//                     "preroll": 5,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5162686963,
//             "eventTimestamp": 1558889055,
//             "eventCid": 1429,
//             "zoneCid": "0",
//             "sensorType": 5,
//             "sensorSerial": "00466502",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Entry Detected by Sensor:  Front Door",
//             "pinName": "",
//             "sensorName": "Front Door",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1393765815,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5162534731,
//             "eventTimestamp": 1558888000,
//             "eventCid": 3401,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Armed (Away) by Keypad Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "SimpliSafe System Armed (away mode)",
//             "messageBody": "System Armed (away mode): Your SimpliSafe System was armed (away) at Home on 5-26-19 at 5:26 pm",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1393669597,
//                     "preroll": 0,
//                     "postroll": 75,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5162527753,
//             "eventTimestamp": 1558887951,
//             "eventCid": 9401,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Exit Delay Countdown Triggered for Away Mode by Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "internal": {
//                 "shouldNotify": false
//             },
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1393665203,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5160334391,
//             "eventTimestamp": 1558868992,
//             "eventCid": 1170,
//             "zoneCid": "0",
//             "sensorType": 12,
//             "sensorSerial": "",
//             "account": "0005EE1E",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Camera Detected Motion",
//             "pinName": "",
//             "sensorName": "Living Room",
//             "messageSubject": "Camera Detected Motion",
//             "messageBody": "Camera Detected Motion on 5-26-19 at 12:09 pm",
//             "eventType": "activityCam",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "1fe89fb1e73405eb7011cd48e006960f",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1392380621,
//                     "preroll": 5,
//                     "postroll": 153,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5160331919,
//             "eventTimestamp": 1558868954,
//             "eventCid": 1400,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Disarmed by Master PIN",
//             "pinName": "Master PIN",
//             "sensorName": "Keypad",
//             "messageSubject": "SimpliSafe System Disarmed",
//             "messageBody": "System Disarmed: Your SimpliSafe security system was disarmed by Keypad Master PIN at Home on 5-26-19 at 12:09 pm",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1392379323,
//                     "preroll": 5,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5160331259,
//             "eventTimestamp": 1558868943,
//             "eventCid": 1429,
//             "zoneCid": "0",
//             "sensorType": 5,
//             "sensorSerial": "00466502",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Entry Detected by Sensor:  Front Door",
//             "pinName": "",
//             "sensorName": "Front Door",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1392378951,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5160173689,
//             "eventTimestamp": 1558865687,
//             "eventCid": 3401,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Armed (Away) by Keypad Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "SimpliSafe System Armed (away mode)",
//             "messageBody": "System Armed (away mode): Your SimpliSafe System was armed (away) at Home on 5-26-19 at 11:14 am",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1392296145,
//                     "preroll": 0,
//                     "postroll": 75,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5160171833,
//             "eventTimestamp": 1558865635,
//             "eventCid": 9401,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Exit Delay Countdown Triggered for Away Mode by Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "internal": {
//                 "shouldNotify": false
//             },
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1392295217,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5159875635,
//             "eventTimestamp": 1558853433,
//             "eventCid": 1407,
//             "zoneCid": "0",
//             "sensorType": 0,
//             "sensorSerial": "",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Disarmed by Remote",
//             "pinName": "",
//             "sensorName": "",
//             "messageSubject": "SimpliSafe System Disarmed",
//             "messageBody": "System Disarmed: Your SimpliSafe security system was disarmed by Remote at Home on 5-26-19 at 7:50 am",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1392132919,
//                     "preroll": 5,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5157304267,
//             "eventTimestamp": 1558827505,
//             "eventCid": 3441,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Armed (Home) by Keypad Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "SimpliSafe System Armed (home mode)",
//             "messageBody": "System Armed (home mode): Your SimpliSafe System was armed (home) at Home on 5-26-19 at 12:38 am",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1390661989,
//                     "preroll": 0,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5157301841,
//             "eventTimestamp": 1558827487,
//             "eventCid": 1170,
//             "zoneCid": "0",
//             "sensorType": 12,
//             "sensorSerial": "",
//             "account": "0005EE1E",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Camera Detected Motion",
//             "pinName": "",
//             "sensorName": "Living Room",
//             "messageSubject": "Camera Detected Motion",
//             "messageBody": "Camera Detected Motion on 5-26-19 at 12:38 am",
//             "eventType": "activityCam",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "1fe89fb1e73405eb7011cd48e006960f",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1390660547,
//                     "preroll": 5,
//                     "postroll": 60,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5157300365,
//             "eventTimestamp": 1558827476,
//             "eventCid": 9441,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Exit Delay Countdown Triggered for Home Mode by Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "internal": {
//                 "shouldNotify": false
//             },
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1390659573,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5156509149,
//             "eventTimestamp": 1558821587,
//             "eventCid": 1602,
//             "zoneCid": "0",
//             "sensorType": 0,
//             "sensorSerial": "",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Automatic Test",
//             "pinName": "",
//             "sensorName": "",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "auto",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {}
//         },
//         {
//             "eventId": 5155730947,
//             "eventTimestamp": 1558816031,
//             "eventCid": 1407,
//             "zoneCid": "0",
//             "sensorType": 0,
//             "sensorSerial": "",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Disarmed by Remote",
//             "pinName": "",
//             "sensorName": "",
//             "messageSubject": "SimpliSafe System Disarmed",
//             "messageBody": "System Disarmed: Your SimpliSafe security system was disarmed by Remote at Home on 5-25-19 at 9:27 pm",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1389670381,
//                     "preroll": 5,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5155660051,
//             "eventTimestamp": 1558815530,
//             "eventCid": 3441,
//             "zoneCid": "3",
//             "sensorType": 0,
//             "sensorSerial": "",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Armed (Home) by Remote Management",
//             "pinName": "",
//             "sensorName": "",
//             "messageSubject": "SimpliSafe System Armed (home mode)",
//             "messageBody": "System Armed (home mode): Your SimpliSafe System was armed (home) at Home on 5-25-19 at 9:18 pm",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1389624661,
//                     "preroll": 0,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5155655985,
//             "eventTimestamp": 1558815501,
//             "eventCid": 9441,
//             "zoneCid": "3",
//             "sensorType": 0,
//             "sensorSerial": "",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Exit Delay Countdown Triggered for Home Mode",
//             "pinName": "",
//             "sensorName": "",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "internal": {
//                 "shouldNotify": false
//             },
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1389622013,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5155595523,
//             "eventTimestamp": 1558815070,
//             "eventCid": 1407,
//             "zoneCid": "0",
//             "sensorType": 0,
//             "sensorSerial": "",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Disarmed by Remote",
//             "pinName": "",
//             "sensorName": "",
//             "messageSubject": "SimpliSafe System Disarmed",
//             "messageBody": "System Disarmed: Your SimpliSafe security system was disarmed by Remote at Home on 5-25-19 at 9:11 pm",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1389583153,
//                     "preroll": 5,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5155474623,
//             "eventTimestamp": 1558814220,
//             "eventCid": 3441,
//             "zoneCid": "3",
//             "sensorType": 0,
//             "sensorSerial": "",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Armed (Home) by Remote Management",
//             "pinName": "",
//             "sensorName": "",
//             "messageSubject": "SimpliSafe System Armed (home mode)",
//             "messageBody": "System Armed (home mode): Your SimpliSafe System was armed (home) at Home on 5-25-19 at 8:57 pm",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1389505235,
//                     "preroll": 0,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5155470797,
//             "eventTimestamp": 1558814194,
//             "eventCid": 1170,
//             "zoneCid": "0",
//             "sensorType": 12,
//             "sensorSerial": "",
//             "account": "0005EE1E",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Camera Detected Motion",
//             "pinName": "",
//             "sensorName": "Living Room",
//             "messageSubject": "Camera Detected Motion",
//             "messageBody": "Camera Detected Motion on 5-25-19 at 8:56 pm",
//             "eventType": "activityCam",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "1fe89fb1e73405eb7011cd48e006960f",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1389502733,
//                     "preroll": 5,
//                     "postroll": 60,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5155470331,
//             "eventTimestamp": 1558814191,
//             "eventCid": 9441,
//             "zoneCid": "3",
//             "sensorType": 0,
//             "sensorSerial": "",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Exit Delay Countdown Triggered for Home Mode",
//             "pinName": "",
//             "sensorName": "",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "internal": {
//                 "shouldNotify": false
//             },
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1389502461,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5155464813,
//             "eventTimestamp": 1558814152,
//             "eventCid": 1400,
//             "zoneCid": "8",
//             "sensorType": 0,
//             "sensorSerial": "",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Exit Delay Countdown Cancelled - System Disarmed",
//             "pinName": "",
//             "sensorName": "",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "internal": {
//                 "shouldNotify": false
//             },
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1389498915,
//                     "preroll": 5,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5155461539,
//             "eventTimestamp": 1558814130,
//             "eventCid": 9441,
//             "zoneCid": "3",
//             "sensorType": 0,
//             "sensorSerial": "",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Exit Delay Countdown Triggered for Home Mode",
//             "pinName": "",
//             "sensorName": "",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "internal": {
//                 "shouldNotify": false
//             },
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1389496911,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5154323505,
//             "eventTimestamp": 1558806279,
//             "eventCid": 1170,
//             "zoneCid": "0",
//             "sensorType": 12,
//             "sensorSerial": "",
//             "account": "0005EE1E",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Camera Detected Motion",
//             "pinName": "",
//             "sensorName": "Living Room",
//             "messageSubject": "Camera Detected Motion",
//             "messageBody": "Camera Detected Motion on 5-25-19 at 6:44 pm",
//             "eventType": "activityCam",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "1fe89fb1e73405eb7011cd48e006960f",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1388759853,
//                     "preroll": 5,
//                     "postroll": 101,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5154313699,
//             "eventTimestamp": 1558806214,
//             "eventCid": 1170,
//             "zoneCid": "0",
//             "sensorType": 12,
//             "sensorSerial": "",
//             "account": "0005EE1E",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Camera Detected Motion",
//             "pinName": "",
//             "sensorName": "Living Room",
//             "messageSubject": "Camera Detected Motion",
//             "messageBody": "Camera Detected Motion on 5-25-19 at 6:43 pm",
//             "eventType": "activityCam",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "1fe89fb1e73405eb7011cd48e006960f",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1388753517,
//                     "preroll": 5,
//                     "postroll": 60,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5154304733,
//             "eventTimestamp": 1558806153,
//             "eventCid": 1170,
//             "zoneCid": "0",
//             "sensorType": 12,
//             "sensorSerial": "",
//             "account": "0005EE1E",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Camera Detected Motion",
//             "pinName": "",
//             "sensorName": "Living Room",
//             "messageSubject": "Camera Detected Motion",
//             "messageBody": "Camera Detected Motion on 5-25-19 at 6:42 pm",
//             "eventType": "activityCam",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "1fe89fb1e73405eb7011cd48e006960f",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1388747663,
//                     "preroll": 5,
//                     "postroll": 60,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5154302877,
//             "eventTimestamp": 1558806140,
//             "eventCid": 1400,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Disarmed by Master PIN",
//             "pinName": "Master PIN",
//             "sensorName": "Keypad",
//             "messageSubject": "SimpliSafe System Disarmed",
//             "messageBody": "System Disarmed: Your SimpliSafe security system was disarmed by Keypad Master PIN at Home on 5-25-19 at 6:42 pm",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1388746545,
//                     "preroll": 5,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5154301323,
//             "eventTimestamp": 1558806129,
//             "eventCid": 1429,
//             "zoneCid": "0",
//             "sensorType": 5,
//             "sensorSerial": "00466502",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Entry Detected by Sensor:  Front Door",
//             "pinName": "",
//             "sensorName": "Front Door",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1388745505,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5154194633,
//             "eventTimestamp": 1558805414,
//             "eventCid": 3401,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Armed (Away) by Keypad Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "SimpliSafe System Armed (away mode)",
//             "messageBody": "System Armed (away mode): Your SimpliSafe System was armed (away) at Home on 5-25-19 at 6:30 pm",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1388675983,
//                     "preroll": 0,
//                     "postroll": 75,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5154187205,
//             "eventTimestamp": 1558805364,
//             "eventCid": 9401,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Exit Delay Countdown Triggered for Away Mode by Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "internal": {
//                 "shouldNotify": false
//             },
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1388671159,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5153929349,
//             "eventTimestamp": 1558803654,
//             "eventCid": 1170,
//             "zoneCid": "0",
//             "sensorType": 12,
//             "sensorSerial": "",
//             "account": "0005EE1E",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Camera Detected Motion",
//             "pinName": "",
//             "sensorName": "Living Room",
//             "messageSubject": "Camera Detected Motion",
//             "messageBody": "Camera Detected Motion on 5-25-19 at 6:00 pm",
//             "eventType": "activityCam",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "1fe89fb1e73405eb7011cd48e006960f",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1388502527,
//                     "preroll": 5,
//                     "postroll": 60,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5153923197,
//             "eventTimestamp": 1558803615,
//             "eventCid": 1400,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Disarmed by Master PIN",
//             "pinName": "Master PIN",
//             "sensorName": "Keypad",
//             "messageSubject": "SimpliSafe System Disarmed",
//             "messageBody": "System Disarmed: Your SimpliSafe security system was disarmed by Keypad Master PIN at Home on 5-25-19 at 6:00 pm",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1388498577,
//                     "preroll": 5,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5153921961,
//             "eventTimestamp": 1558803607,
//             "eventCid": 1429,
//             "zoneCid": "0",
//             "sensorType": 5,
//             "sensorSerial": "00466502",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Entry Detected by Sensor:  Front Door",
//             "pinName": "",
//             "sensorName": "Front Door",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1388497833,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5152638435,
//             "eventTimestamp": 1558795182,
//             "eventCid": 3401,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "System Armed (Away) by Keypad Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "SimpliSafe System Armed (away mode)",
//             "messageBody": "System Armed (away mode): Your SimpliSafe System was armed (away) at Home on 5-25-19 at 3:39 pm",
//             "eventType": "activity",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1387677381,
//                     "preroll": 0,
//                     "postroll": 75,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5152630893,
//             "eventTimestamp": 1558795130,
//             "eventCid": 9401,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Exit Delay Countdown Triggered for Away Mode by Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "internal": {
//                 "shouldNotify": false
//             },
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1387672633,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5152612039,
//             "eventTimestamp": 1558795004,
//             "eventCid": 1400,
//             "zoneCid": "8",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Exit Delay Countdown Cancelled - System Disarmed",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "internal": {
//                 "shouldNotify": false
//             },
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1387661137,
//                     "preroll": 5,
//                     "postroll": 20,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5152610025,
//             "eventTimestamp": 1558794990,
//             "eventCid": 9401,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Exit Delay Countdown Triggered for Away Mode by Keypad",
//             "pinName": "",
//             "sensorName": "Keypad",
//             "messageSubject": "",
//             "messageBody": "",
//             "eventType": "activityQuiet",
//             "timezone": 8,
//             "locationOffset": 60,
//             "internal": {
//                 "shouldNotify": false
//             },
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1387659787,
//                     "preroll": 5,
//                     "postroll": 45,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5151267931,
//             "eventTimestamp": 1558784048,
//             "eventCid": 1170,
//             "zoneCid": "0",
//             "sensorType": 12,
//             "sensorSerial": "",
//             "account": "0005EE1E",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Camera Detected Motion",
//             "pinName": "",
//             "sensorName": "Living Room",
//             "messageSubject": "Camera Detected Motion",
//             "messageBody": "Camera Detected Motion on 5-25-19 at 12:34 pm",
//             "eventType": "activityCam",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "1fe89fb1e73405eb7011cd48e006960f",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1386868581,
//                     "preroll": 5,
//                     "postroll": 60,
//                     "cameraName": "Living Room"
//                 }
//             }
//         },
//         {
//             "eventId": 5151254145,
//             "eventTimestamp": 1558783891,
//             "eventCid": 1406,
//             "zoneCid": "1",
//             "sensorType": 1,
//             "sensorSerial": "004412bd",
//             "account": "0005ee1e",
//             "userId": 2290758,
//             "sid": 2305642,
//             "info": "Alarm Canceled by Master PIN",
//             "pinName": "Master PIN",
//             "sensorName": "Keypad",
//             "messageSubject": "SimpliSafe Alarm Canceled",
//             "messageBody": "Alarm canceled: A recent alarm was canceled by Keypad Master PIN at Home on 5-25-19 at 12:31 pm",
//             "eventType": "alarmCancel",
//             "timezone": 8,
//             "locationOffset": 60,
//             "videoStartedBy": "",
//             "video": {
//                 "1fe89fb1e73405eb7011cd48e006960f": {
//                     "clipId": 1386860919,
//                     "preroll": 5,
//                     "postroll": 30,
//                     "cameraName": "Living Room"
//                 }
//             }
//         }
//     ]
// }
// :method: GET
// :scheme: https
// :authority: api.simplisafe.com
// :path: /v1/ss3/subscriptions/2305642/sensors?forceUpdate=false
// Accept: application/json, text/plain, */*
// Origin: https://webapp.simplisafe.co.uk
// Referer: https://webapp.simplisafe.co.uk/
// Accept-Language: en-us
// If-None-Match: W/"4b2-d17vNaaatOmyEqdG8NgY6UJglOc"
// Host: api.simplisafe.com
// User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.1 Safari/605.1.15
// Authorization: Bearer hNW1qfWeiirjAFVIMTuRD+fKk6g2vqoUwWn6i6ei06k=
// Accept-Encoding: br, gzip, deflate
// Connection: keep-alive
// Response
// {
//     "account": "0005ee1e",
//     "success": true,
//     "sensors": [
//         {
//             "type": 1,
//             "serial": "004412bd",
//             "name": "Keypad",
//             "setting": {
//                 "lowPowerMode": false,
//                 "alarm": 1
//             },
//             "status": {},
//             "flags": {
//                 "swingerShutdown": false,
//                 "lowBattery": false,
//                 "offline": false
//             }
//         },
//         {
//             "type": 5,
//             "serial": "0046451b",
//             "name": "Guest Window",
//             "setting": {
//                 "instantTrigger": false,
//                 "away2": 1,
//                 "away": 1,
//                 "home2": 1,
//                 "home": 1,
//                 "off": 0
//             },
//             "status": {
//                 "triggered": false
//             },
//             "flags": {
//                 "swingerShutdown": false,
//                 "lowBattery": false,
//                 "offline": false
//             }
//         },
//         {
//             "type": 5,
//             "serial": "00466502",
//             "name": "Front Door",
//             "setting": {
//                 "instantTrigger": false,
//                 "away2": 1,
//                 "away": 1,
//                 "home2": 1,
//                 "home": 1,
//                 "off": 0
//             },
//             "status": {
//                 "triggered": false
//             },
//             "flags": {
//                 "swingerShutdown": false,
//                 "lowBattery": false,
//                 "offline": false
//             }
//         },
//         {
//             "type": 5,
//             "serial": "00465e84",
//             "name": "Balcony Door",
//             "setting": {
//                 "instantTrigger": true,
//                 "away2": 1,
//                 "away": 1,
//                 "home2": 1,
//                 "home": 1,
//                 "off": 0
//             },
//             "status": {
//                 "triggered": false
//             },
//             "flags": {
//                 "offline": false,
//                 "lowBattery": false,
//                 "swingerShutdown": false
//             }
//         },
//         {
//             "type": 4,
//             "serial": "006240aa",
//             "name": "Hallway",
//             "setting": {
//                 "instantTrigger": false,
//                 "away2": 1,
//                 "away": 1,
//                 "home2": 0,
//                 "home": 0,
//                 "off": 0
//             },
//             "status": {},
//             "flags": {
//                 "swingerShutdown": false,
//                 "lowBattery": false,
//                 "offline": false
//             }
//         }
//     ],
//     "lastUpdated": 1558783524,
//     "lastSynced": 1558776632,
//     "lastStatusUpdate": 1558776631
// }
// :method: GET
// :scheme: https
// :authority: api.simplisafe.com
// :path: /v1/subscriptions/2305642
// Accept: application/json, text/plain, */*
// Origin: https://webapp.simplisafe.co.uk
// Referer: https://webapp.simplisafe.co.uk/
// Accept-Language: en-us
// Host: api.simplisafe.com
// User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.1 Safari/605.1.15
// Authorization: Bearer hNW1qfWeiirjAFVIMTuRD+fKk6g2vqoUwWn6i6ei06k=
// Accept-Encoding: br, gzip, deflate
// Connection: keep-alive
// Response
// {
//     "subscription": {
//         "uid": 2290758,
//         "sid": 2305642,
//         "sStatus": 10,
//         "activated": 1558738735,
//         "planSku": "SSEDSM2_GB",
//         "planName": "Pro Premium",
//         "pinUnlocked": true,
//         "location": {
//             "sid": 2305642,
//             "uid": 2290758,
//             "account": "0005EE1E",
//             "street1": "Flat 12, Empire Reach",
//             "street2": "4 Dowells Street",
//             "locationName": "Home",
//             "city": "London",
//             "county": "London",
//             "state": "LDN",
//             "zip": "SE10 9EB",
//             "country": "GB",
//             "notes": "The flat is on the 2nd floor - NCQ Concierge can help with access to the building if necessary.",
//             "residenceType": 1,
//             "numAdults": 2,
//             "numChildren": 0,
//             "safeWord": "duchessina",
//             "signature": "Niccolo Zapponi",
//             "timeZone": 8,
//             "primaryContacts": [
//                 {
//                     "name": "Niccolo Zapponi",
//                     "phone": "07547791310"
//                 },
//                 {
//                     "name": "",
//                     "phone": "07747763897"
//                 }
//             ],
//             "secondaryContacts": [
//                 {
//                     "name": "Ludovica  Di Canio",
//                     "phone": "07552434440"
//                 },
//                 {
//                     "name": "",
//                     "phone": ""
//                 },
//                 {
//                     "name": "",
//                     "phone": ""
//                 },
//                 {
//                     "name": "",
//                     "phone": ""
//                 },
//                 {
//                     "name": "",
//                     "phone": ""
//                 }
//             ],
//             "copsOptIn": true,
//             "smashSafeOptIn": false,
//             "certificateUri": "https://simplisafe.com/account2/2290758/alarm-certificate/2305642",
//             "locationOffset": 60,
//             "nestStructureId": "",
//             "system": {
//                 "serial": "0005EE1E",
//                 "alarmState": "OFF",
//                 "alarmStateTimestamp": 0,
//                 "isAlarming": false,
//                 "version": 3,
//                 "temperature": null,
//                 "exitDelayRemaining": 60,
//                 "cameras": [
//                     {
//                         "uuid": "1fe89fb1e73405eb7011cd48e006960f",
//                         "uid": 2290758,
//                         "sid": 2305642,
//                         "cameraSettings": {
//                             "admin": {
//                                 "wlanMac": "6c:21:a2:0b:c3:87",
//                                 "odEnableVideoAnalyticsWhileStreaming": false,
//                                 "odClassifierQualityProfile": 1,
//                                 "odBackgroundLearnStationarySpeed": 15,
//                                 "odBackgroundLearnStationary": true,
//                                 "odCameraFOV": 2,
//                                 "odCameraView": 3,
//                                 "odSceneType": 1,
//                                 "odVideoScaleFactor": 1,
//                                 "odFGExtractorMode": 2,
//                                 "odLuxSamplingFrequency": 30,
//                                 "odLuxHysteresisLow": 4,
//                                 "odLuxHysteresisHigh": 4,
//                                 "odLuxThreshold": 445,
//                                 "odEventObjectMask": 2,
//                                 "odSensitivity": 85,
//                                 "odAnalyticsLib": 1,
//                                 "odEnableOverlay": false,
//                                 "odClassificationConfidenceThreshold": 0.95,
//                                 "odClassificationMask": 22,
//                                 "odEnableObjectDetection": true,
//                                 "odObjectMinHeightPercent": 16,
//                                 "odObjectMinWidthPercent": 8,
//                                 "odProcessingFps": 8,
//                                 "sarlaccDebugLogTypes": 0,
//                                 "statsPeriod": 3600000,
//                                 "wifiDriverReloads": 0,
//                                 "wifiDisconnects": 0,
//                                 "uptime": 0,
//                                 "resSet": 0,
//                                 "vmUse": 0,
//                                 "dbm": 0,
//                                 "battery": [],
//                                 "rssi": [],
//                                 "irThreshold3x": 260,
//                                 "irThreshold2x": 335,
//                                 "irThreshold1x": 388,
//                                 "irCloseDelay": 3,
//                                 "irOpenDelay": 3,
//                                 "irCloseThreshold": 840,
//                                 "irOpenThreshold": 445,
//                                 "firmwareGroup": "public",
//                                 "logQDepth": 20,
//                                 "logLevel": 3,
//                                 "logEnabled": true,
//                                 "pirFilterCoefficient": 1,
//                                 "pirHysteresisLow": 10,
//                                 "pirHysteresisHigh": 2,
//                                 "pirSampleRateMs": 800,
//                                 "lastLogout": 1558880474,
//                                 "lastLogin": 1558881460,
//                                 "camAgentVersion": "2.2.5.39",
//                                 "netConfigVersion": "2.2.5.39",
//                                 "firmwareVersion": "2.2.5.39",
//                                 "fps": 25,
//                                 "idr": 1,
//                                 "gopLength": 50,
//                                 "kframe": 1,
//                                 "longPress": 2000,
//                                 "bitRate": 284,
//                                 "audioDirection": 0,
//                                 "audioThreshold": 50,
//                                 "audioSensitivity": 50,
//                                 "audioSampleFormat": 3,
//                                 "audioChunkBytes": 2048,
//                                 "audioSampleRate": 16000,
//                                 "audioChannelNum": 2,
//                                 "audioDetectionEnabled": false,
//                                 "levelChangeDelayOne": 10,
//                                 "levelChangeDelayZero": 30,
//                                 "motionThresholdOne": 10000,
//                                 "motionThresholdZero": 0,
//                                 "motionDetectionEnabled": false,
//                                 "lux": "lowLux",
//                                 "statusLEDState": 1,
//                                 "pirSens": 0,
//                                 "IRLED": 0,
//                                 "ivLicense": ""
//                             },
//                             "hdr": false,
//                             "privacyEnable": false,
//                             "enableDoorbellNotification": true,
//                             "notificationsEnable": false,
//                             "vaEnable": true,
//                             "pirEnable": true,
//                             "canRecord": false,
//                             "canStream": false,
//                             "wifiSsid": "Ludolò",
//                             "shutterOff": "closedAlarmOnly",
//                             "shutterAway": "open",
//                             "shutterHome": "closedAlarmOnly",
//                             "motionSensitivity": 0,
//                             "speakerVolume": 75,
//                             "micEnable": true,
//                             "micSensitivity": 100,
//                             "statusLight": "off",
//                             "nightVision": "auto",
//                             "pictureQuality": "720p",
//                             "cameraName": "Living Room",
//                             "pirLevel": "medium",
//                             "odLevel": "custom"
//                         },
//                         "__v": 0,
//                         "model": "SS001",
//                         "upgradeWhitelisted": false,
//                         "staleSettingsTypes": [],
//                         "subscription": {
//                             "enabled": true,
//                             "freeTrialUsed": true,
//                             "freeTrialEnds": 1561410665,
//                             "planSku": "SSVM1",
//                             "price": 0,
//                             "expires": 1561410665,
//                             "storageDays": 30
//                         },
//                         "status": "online"
//                     }
//                 ],
//                 "connType": "wifi",
//                 "stateUpdated": 1558944899,
//                 "messages": []
//             }
//         },
//         "price": 19.99,
//         "currency": "GBP",
//         "country": "GB",
//         "billDate": 1558997935,
//         "features": {
//             "monitoring": true,
//             "alerts": true,
//             "online": true,
//             "hazard": false,
//             "video": true,
//             "cameras": 10,
//             "dispatch": false,
//             "proInstall": false,
//             "discount": 0,
//             "vipCS": false,
//             "medical": false,
//             "careVisit": false,
//             "storageDays": 30
//         },
//         "creditCard": {
//             "type": "Visa",
//             "lastFour": "2009"
//         },
//         "pinUnlockedBy": "pin"
//     }
// }

exports["default"] = _default;