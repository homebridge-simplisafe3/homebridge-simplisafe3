# Change Log
All notable changes are documented here.

## 1.10.5 (2022-05-18)
- This release adds support for SimpliSafe "Test mode" i.e. it no longer triggers a (false) alarm, see #341.

## 1.10.4 (2022-04-21)
- This release fixes an issue that prevented upgrading for some users, see #335.

## 1.10.3 (2022-04-14)
- This release updates a dependency used to install `ffmpeg` which was not properly installing itself in previous versions.

## 1.10.2 (2022-04-08)
- This release brings "automatic" authorization, meaning you can just enter your SimpliSafe username and password using the UI or command line and the plug-in will take care of the rest! Supports SMS and email verification.
- Various fixes for authentication refresh failures.
- Lots of dependency updates.

## 1.9.11 (2022-03-11)
- Fixes (another) issue with subscription filtering. Thanks to @bigchrisatx for reporting.

## 1.9.10 (2022-03-07)
- Addresses an error that could cause Homebridge to crash when events connection fails. See #317. Thanks to @lmcquade for reporting
- Adds a fallback for retrieving door lock state if a 'real-time' event was missed.
- Other minor improvements to log output

## 1.9.9 (2022-03-03)
- This release implements a siginificant rewrite of the way the plugin receives 'real-time' events. The old method is expected to be deprecated soon. This change was tested as much as possible, thank you for your patience with this release. As always, consider taking a backup first. Please note that logging will be quite verbose if you have `debug` enabled.
- The `simplisafe3config.json` file and `resetSimpliSafeId` config option are no longer used.

## 1.9.8 (2022-03-01)
- Fixes (another) issue with subscription filtering. Thanks to @chowielin for reporting.

## 1.9.7 (2022-02-27)
- Better handle using the authentication command on Docker, see #311. Thanks to @warrengottlieb for reporting.
- Handle unsupported cameras better (still not supported =)
- Support privacy shutter for new model 'SS003' of indoor camera. Thanks to @jdmtv001 for reporting.
- Modifies a change that prevented free plans from working, see #315. Thanks to @ampilogov for reporting.

## 1.9.5 (2022-02-22)
- Fixes an issue that prevented the plugin from finding the correct account for users with expired free trials, see #308. Thanks @nmagati for reporting.
- Clarify error message when multiple accounts are found.

## 1.9.4 (2022-02-19)
- Fixes an issue that prevented motion sensors from triggering, see #303. Thanks @betabob for reporting.
- Other small improvements.

## 1.9.3 (2022-02-13)
- PLEASE NOTE: this release contains significant changes to the inner workings of this plugin. You may want to delay updating and / or consider taking a backup of your Homebridge and HomeKit installations (e.g. using the Controller+ app). Thank you for your patience!
- Show a 'privacy shutter closed' image for cameras with the shutter closed.
- Door locks now properly update battery status and startup status.
- The plugin now sets the 'Tampered' property of the alarm when it detects a power failure.
- Improve rate limit handling, re-authorization failures.
- Real-time event handling has been reworked and should recover more gracefully.
- Addresses critical security vulnerabilities, see #281 #292, #293 and #394.

## 1.8.8 (2021-12-18)
- Fixes an issue that could prevent alarm triggering in HomeKit.

## 1.8.6 (2021-12-16)
- Fixes an issue that could cause the authentication command line tool to fail.
- Addresses a security vulnerability.

## 1.8.5 (2021-12-13)
- The plugin now sets the 'General Fault' property of the alarm when it detects authentication failure. See #264.
- Documentation and settings UI updated to clarify `subscriptionId` property. See #201

## 1.8.4 (2021-10-03)
- The plugin no longer requires setting the `-D` debug option for homebridge to display all debug messages (the `debug` option is still used).

## 1.8.2 (2021-09-29)
- The plugin has been updated to use a new authentication method that will be required by SimpliSafe on or after December 2021. Please update your credentials as soon as possible, see the [README](https://github.com/homebridge-simplisafe3/homebridge-simplisafe3/blob/master/README.md#simplisafe-authentication) for more info. Issue #231.

## 1.7.2 (2021-09-29)
- Security fixes.

## 1.7.1 (2021-09-07)
- Fixes possible incorrect door lock state on startup. See #237. Thanks to @ljensen51 for raising the issue.
- Security fixes. See #235

## 1.7.0 (2021-08-15)
- Adds support for self-monitoring plans (issue #229). Thanks to @ASpehler
- Security fixes. See #216, #221

## 1.6.22 (2021-05-10)
- Security release. See #214

## 1.6.19 (2021-02-26)
- Less noisy default logging of SimpliSafe API errors (issue #192)

## 1.6.18 (2021-02-24)
- Fixes an issue that caused incompatibility with node version 15.3.0 (issue #189). Thanks to @lmcquade

## 1.6.17 (2021-02-18)
- Fixes some Homebridge v1.3.x characteristic warnings (issue #187)

## 1.6.16 (2021-01-05)
- Fixes a reported issue with camera snapshots (issue #172)
- Updates one of the plugins dependencies which had a critical security flaw (PR #176)

## 1.6.15 (2020-12-22)
- Fixes a compatibility issue with upcoming Homebridge releases (issue #167)

## 1.6.14 (2020-12-15)
- Clearer language for error logging (issue #163)
- Fixes an authentication failure edge case

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
