# Change Log
All notable changes are documented here.

## 1.6.13 (2020-12-06)
- Allow for excluding devices from HomeKit (issue #161 and #79)
- Made persistAccessories default to true

## 1.6.12 (2020-11-17)
- Improves reliability of HomeKit notifications (issue #158)

## 1.6.11 (2020-10-12)
- Fixes an issue where locks would initially show as "Unlocking..." (issue #151)

## 1.6.10 (2020-10-12)
- Fixes an issue where initially setting up the plugin could cause the user to become blocked by SimpliSafe servers (issue #145)

## 1.6.9 (2020-10-08)
- Improved rate-limiting recovery
- Increased verbosity of error output to help with debugging

## 1.6.8 (2020-09-21)
- Minor improvements to error handling with incorrect login details

## 1.6.7 (2020-07-06)
- Fixes a SimpliSafe bug that caused the system to report smart locks are "not responding" even though they were (issue #134)

## 1.6.5 (2020-06-11)
- AAC audio is now supported for improved performance (issue #127). Note that you may need to disable and re-enable your cameras or re-add the system to HomeKit to use the improved codec support.
- Resolves an issue that could cause accessory removal to fail.
- Minor bug fixes.

## 1.6.4 (2020-06-10)
- Fixes an issue where motion alerts stopped working due to a SS API change (issue #130).

## 1.6.3 (2020-06-03)
- Fixes an issue that could cause HomeKit to show an incorrect alarm status if alarm is disarmed using a door lock (issue #128).

## 1.6.2 (2020-05-27)
- Fixes a bug that could cause Homebridge to crash when setting up the system (issue #123).

## 1.6.1 (2020-05-22)
- Feature: The plugin now includes [ffmpeg-for-homebridge](https://github.com/homebridge/ffmpeg-for-homebridge) which includes hardware acceleration on supported RPi models. See the [updated README](https://github.com/nzapponi/homebridge-simplisafe3#ffmpeg-hardware-acceleration) for more information on how to enable this.
- Camera settings have been separated in the config UI
- Feature: camera snapshots now appear faster
- Fixed a long-standing issue where cameras did not stream on docker installs (issue #118). The fix for this requires limiting cameras to 720px wide.

## 1.5.3 (2020-05-17)
- Fixed incorrect parsing of ffmpeg arguments (issue #111).
- Fixed an issue that could cause the plugin to fail to set alarm state after first starting (issue #108).
- Other minor bug fixes.

## v1.5.0 (2020-05-06)
- PLEASE NOTE: This version of the plugin requires Homebridge v1.0.0 or later and includes breaking changes. Only install this update when you are ready to update Homebridge (or already have).
- Support for Homebridge v1.0.0 including `CameraController API` support. See the [updated README](https://github.com/nzapponi/homebridge-simplisafe3#migrating-external-cameras-to-bridged-cameras) for more information.
- Improved logging.
- Minor bug fixes.

## v1.4.12
- Minor bug fixes

## v1.4.11
- Bug fixes
- Improved logging

## v1.4.10
- Bug fixes

## v1.4.9
- Updated dependencies to fix vulnerabilities

## v1.4.8
- Resolved a bug that would cause arming/disarming to fail silently (#85)

## v1.4.7
- Bug fixes to support empty events, added logging to identify root cause

## v1.4.6
- Bug fixes

## v1.4.5
- Bug fixes

## v1.4.4
- Bug fixes

## v1.4.3
- Added support for Homebridge Config UI X settings plugin
- Improved performance of alarm and sensor state requests
- Plugin now handles rate limiting by automatically stopping outgoing requests and recovering when rate limiting is over
- Improved management of loss of connectivity
- Changed the default behavior of `persistAccessories`. Old accessories are now automatically removed

## v1.4.2
- Reverted the default behavior of `persistAccessories` while we implement a workaround for the rate limiting that SimpliSafe imposes.

## v1.4.1
- Changed the default behavior of `persistAccessories`. Old accessories are now automatically removed.

## v1.4.0
- Added support for motion sensors with secret alerts

## v1.3.5
- Improved support for rich notifications

## v1.3.4
- Added smart lock support
- Improved camera resolution support to honor max resolution available
- Bug fixes

## v1.3.3 and v1.3.2
- Bug fixes to camera support

## v1.3.1
- Improved support for accessory removal

## v1.3.0
- Added support for rich notifications from doorbell and cameras

## v1.2.10
- Added support for CO detector

## v1.2.9 and v1.2.8
- Bug fixes on camera event handling

## v1.2.7
- Fixed an issue that would notify the wrong property of the alarm going off for users with multiple properties
- Other minor bug fixes

## v1.2.6
- Added support to camera and doorbell motion events

## v1.2.5
- Bug fix

## v1.2.4
- Improved support for accounts with inactive subscriptions

## v1.2.3
- Improved support for accounts with multiple locations

## v1.2.2
- Added support for additional events

## v1.2.1
- Added debug mode for accessory data

## v1.2.0
- Added support for smoke detector, water sensor and freeze sensor
- Updated developer dependencies

## v1.1.5
- Critical vulnerability fix

## v1.1.4
- Bug fix

## v1.1.3
- Added configurable sensor refresh time

## v1.1.2
- Added support for Node v8
- Fixed a bug that would cause the HomeKit accessory configuration to be lost on reset

## v1.1.1
- Dependency updates, including security fixes

## v1.1.0
- Added support for custom camera configurations

## v1.0.5
- Updated dependencies

## v1.0.4
- Fixed a bug which caused loss of connection to real time event stream after a few days

## v1.0.3, v1.0.2, v1.0.1
- Minor bug fixes

## v1.0.0
- First public release of the plugin
- Supports alarm, entry sensors, cameras (experimental)
