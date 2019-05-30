"use strict";

var _simpilsafe = _interopRequireDefault(require("./simpilsafe"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }

function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }

var simplisafe = new _simpilsafe["default"]();

var tryLogIn =
/*#__PURE__*/
function () {
  var _ref = _asyncToGenerator(
  /*#__PURE__*/
  regeneratorRuntime.mark(function _callee() {
    var sensors;
    return regeneratorRuntime.wrap(function _callee$(_context) {
      while (1) {
        switch (_context.prev = _context.next) {
          case 0:
            _context.prev = 0;
            _context.next = 3;
            return simplisafe.login('nzapponi@gmail.com', 'riqhy1-tirbob-fewsaN', true);

          case 3:
            console.log("Token is ".concat(simplisafe.token)); // await simplisafe.refreshToken();
            // console.log(`Token refreshed. It is now ${simplisafe.token}`);
            // simplisafe.token = simplisafe.token + '1';
            // simplisafe.rToken = simplisafe.rToken + '1';
            // simplisafe.request({
            //     method: 'GET',
            //     url: '/authCheck'
            // })
            //     .then(data => {
            //         console.log(data);
            //     })
            //     .catch(err => {
            //         console.error(err);
            //     });
            // let userId = await simplisafe.getUserId();
            // console.log(userId);
            // let events = await simplisafe.getEvents();
            // console.log(events);

            _context.next = 6;
            return simplisafe.getSensors();

          case 6:
            sensors = _context.sent;
            console.log(sensors);
            _context.next = 13;
            break;

          case 10:
            _context.prev = 10;
            _context.t0 = _context["catch"](0);
            console.error('An error occurred', _context.t0);

          case 13:
          case "end":
            return _context.stop();
        }
      }
    }, _callee, null, [[0, 10]]);
  }));

  return function tryLogIn() {
    return _ref.apply(this, arguments);
  };
}();

tryLogIn();