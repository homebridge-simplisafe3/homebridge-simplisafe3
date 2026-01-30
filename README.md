<span align="center">

<a href="https://github.com/homebridge/homebridge/wiki/Verified-Plugins"><img alt="homebridge-verified" src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-color-round.png" width="80px"></a>
<img alt="SimpliSafe Logo" src="https://raw.githubusercontent.com/homebridge-simplisafe3/homebridge-simplisafe3/master/.github/simplisafe_logo_wplus.png" width="380px" />

# Homebridge SimpliSafe 3
Created by [Niccolò Zapponi](https://twitter.com/nzapponi) and [Michael Shamoon](https://github.com/shamoon).

[![npm-version](https://badgen.net/npm/v/homebridge-simplisafe3)](https://www.npmjs.com/package/homebridge-simplisafe3)
[![npm-downloads](https://badgen.net/npm/dt/homebridge-simplisafe3)](https://www.npmjs.com/package/homebridge-simplisafe3)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

An [unofficial] [Homebridge](https://github.com/homebridge/homebridge) plugin to integrate the SimpliSafe 3 home security system with HomeKit.

</span>

## Requirements
- Works with native Homebridge and [oznu/docker-homebridge](https://github.com/oznu/docker-homebridge).
- Compatible with the official [Config UI X plugin](https://github.com/oznu/homebridge-config-ui-x) which is **recommended for easiest usage**.

## Features
Supercharge your SimpliSafe system and integrate with HomeKit the right way!
This plugin supports:
- **Real time event streaming:** get immediate notifications anytime the alarm is armed / disarmed / triggered.
- **Sensors:** always be on top of your home with immediate access to the sensor status. Create smart automations directly from the Home app (e.g. when the front door is opened, turn the lights on).
- **Door locks:** lock, unlock and monitor the battery status of your smart door locks.
- **Cameras:** view your indoor or doorbell cameras directly from the Home app, receive doorbell notifications and motion snapshots.
- **Battery monitoring:** the Home app will notify you if the battery level of one of your sensors is low.

Here are some example screenshots:

<img alt="Sensors" src="https://raw.githubusercontent.com/nzapponi/homebridge-simplisafe3/master/docs/sensors.png" width="50%"><img alt="Alarm controls" src="https://raw.githubusercontent.com/nzapponi/homebridge-simplisafe3/master/docs/arm.png" width="50%">

## Usage

This plugin supports installation and changing settings (for `config.js`) via the popular [Config UI X plugin](https://github.com/oznu/homebridge-config-ui-x) which is recommended for easiest usage.

Either install and configure using Config UI X or you can manually install the plugin by running:

```
npm install -g --unsafe-perm homebridge-simplisafe3
```

If installing manually, add the following configuration to the `platforms` array in your Homebridge `config.json` and then proceed with <a href="#simplisafe-authentication">authentication</a>.


```
{
    "platform": "homebridge-simplisafe3.SimpliSafe 3",
    "name": "Home Alarm"
}
```

### SimpliSafe Authentication

In 2021, SimpliSafe transitioned to only supporting a protocol called OAuth for authentication. This requires the user to authenticate in a browser and it is not possible to circumvent this and authenticate directly against the API. This plugin provides two ways to obtain credentials:

 1. Users of [Config UI X](https://github.com/oznu/homebridge-config-ui-x) (which is included in many Homebridge installations) can initiate this process from the plugin settings. A button will launch the authentication process and you will have to copy and paste the final URL back into the plugin settings. This process involves a few steps:
     1. Upon clicking the "Launch SimpliSafe Login" button you are taken to the SimpliSafe login page. If you are already logged in this step is skipped.
     2. You will be redirected to a page requesting you to approve the login, either via email or 2FA.
     3. After approval, most browsers will not redirect you to the final URL (begins with *com.SimpliSafe.mobile://*) but will show an error in the console from which you will need to copy & paste the URL back into the Homebridge settings UI. See notes below about using certain browsers / platforms.

    - :information_source: **Many browsers (e.g. Chrome) will not redirect you and will only show an error in the Console** (e.g. View > Developer Tools > Javascript Console) and you will have to copy and paste the URL from the error message.
    - Safari v15.1+ neither displays the URL in the console nor visually in the URL bar and thus is not recommended for this process.
    - Also note that this process cannot be performed on a mobile device.

 1. Alternatively the plugin provides a command-line method for authenticating. The process works the same as above and can be run using `homebridge-simplisafe3 login`. If you are using a non-standard storage location for Homebridge pass the `-d` argument e.g. `homebridge-simplisafe3 login -d /path/to/storage/`.

#### Error & Authentication Failure Notifications

- The plugin is designed to persistently and proactively maintain authentication with SimpliSafe but obviously this is not perfect. When authentication with SimpliSafe fails, the plugin sets the [**Status Fault** property](https://developers.homebridge.io/#/characteristic/StatusFault) of the Alarm to `true`. Though you are not able to see this property in the Home app, it can be viewed in other HomeKit apps and you can create automations based on this, for example to send you an email or notification when this happens using the excellent [homebridge-messenger plugin](https://github.com/potrudeau/homebridge-messenger). For more details on an example notification setup see [this discussion](https://github.com/homebridge-simplisafe3/homebridge-simplisafe3/discussions/285#discussioncomment-2008529).
- The [**Status Fault** property](https://developers.homebridge.io/#/characteristic/StatusFault) will also be set in the event of the plugin failing to set an alarm state either because of auth failure or for example errors communicating with the SimpliSafe API. This can help alert you if the alarm state did not successfully change.

### Optional Parameters

#### `cameras` and `cameraOptions`
These enable camera support. See [Camera Support](#camera-support) for more details.

#### `debug`
Type: boolean (default `false`)

Switch this on to get more details about your sensors and plugin behavior in your Homebridge logs. This can be useful if you are having trouble or need to report an issue.

#### `subscriptionId` (aka Account Number)
Type: string

Add this parameter in case you have multiple protected locations or accounts with SimpliSafe, this is your "account number" in Simplisafe. The best way to ensure you have the correct number is to check under the [SimpliSafe web control panel > View Account](https://webapp.simplisafe.com/#/account) and look for **account #** next to the correct plan. For most users this is the same as the serial number at the bottom of your base unit.

#### `sensorRefresh`
Type: integer (default `15` seconds)

The frequency with which the plugin will poll sensors (e.g. Entry sensors), since entry sensor changes (opening/closing) are not pushed from SimpliSafe. Warning: setting this value too low will likely lead to your IP address being (temporarily) blocked by SimpliSafe.

#### `persistAccessories`
Type: boolean (default `true`)

By default, the plugin will persist accessories to avoid losing automations etc. Set this to `false` to remove old accessories that no longer exist in SimpliSafe from HomeKit.

#### `excludedDevices`
Type: array

Accepts a list of SimpliSafe device serial numbers (which can be found in the SS app) and excludes these devices from HomeKit.

### Supported Devices

Device             | Supported          | Notes
------------------ | ------------------ | -------------------------------------------------
Alarm              | :white_check_mark: | Arming/disarming to home, away and off modes. Sets tamper property on power outage
SimpliCam          | :white_check_mark: | Audio, video, motion*, no microphone
Doorbell           | :white_check_mark: | Audio, video, motion, no microphone
Outdoor Camera     | :white_check_mark: | Video, motion. Uses Kinesis WebRTC (higher latency due to battery camera wake-up)***
Smart lock         | :white_check_mark: | Fully supports locking, unlocking
Entry sensor       | :white_check_mark: | Status not provided as 'push' by SS so is polled based on `sensorRefresh`
Smoke detector     | :white_check_mark: | Includes support for tamper & fault
CO detector        | :white_check_mark: | Includes support for tamper & fault
Water sensor       | :white_check_mark: |
Freeze sensor      | :white_check_mark: | Supports temperature readings, not sensor trigger
Motion sensor      | :white_check_mark: | Requires motion sensor set to "Secret Alert" or "Alarm" in SimpliSafe settings**
Glassbreak sensor  | :x:                | State not provided by SimpliSafe
Keypad             | :x:                | State not provided by SimpliSafe
Panic button       | :x:                | State not provided by SimpliSafe

\* SimpliCams provide motion notifications only if the privacy shutter is open.

\** The default SimpliSafe settings for motion sensors are "Disabled" when alarm is "Off" or "Home", in which case motion events will not be accurate since they won't always trigger. For consistency of the Home app, motion sensors need to be switched to either "Secret Alert" or "Alarm" in **every** alarm mode for the sensors to appear in the app.
For example, setting the motion sensor to Secret Alert in Off and Home mode and Alarm in Away mode **will** display it in the Home app, whereas setting it to Disabled in Off mode, Secret Alert in Home mode and Alarm in Away mode **won't**, since the sensor state and automations in the Home app would be inaccurate.
Using the "Secret Alert" setting will allow for motion events at all times but note that [this will also record a video clip](https://simplisafe.com/forum/customer-support-forum/installing-and-using-simplisafe/secret-alert-triggers-camera) when motion events are triggered.

\*** Outdoor cameras are battery-powered and sleep aggressively. Initial stream startup can take 4-10 seconds as the camera wakes up and establishes a WebRTC connection. For best results, set the camera shutter to "Open" in the SimpliSafe app settings.

All devices also support low battery warnings.

### Camera Support
To enable camera support, simply switch `"cameras": true` in your `config.json` (or set via Config UI X admin). Currently only the SimpliCam and Video Doorbell Pro are supported.

#### Camera Options
This plugin includes [ffmpeg-for-homebridge](https://github.com/homebridge/ffmpeg-for-homebridge) to automatically include a compatible build of ffmpeg and thus the plugin works "out of the box" without requiring a custom ffmpeg build.

For advanced scenarios including specifying a custom ffmpeg build or command line arguments, you can set them via plugin settings in Config UI X or manually in `config.json`\*:

```
"cameraOptions": {
    "ffmpegPath": "/path/to/custom/ffmpeg",
    "sourceOptions": "-format: flv ... (any other ffmpeg argument)",
    "videoOptions": "-vcodec h264_omx -tune false ... (any other ffmpeg argument)",
    "audioOptions": "-ar 256k ... (any other ffmpeg argument)"
}
```

Any arguments provided in `sourceOptions`, `videoOptions` and `audioOptions` will be added to the list of arguments passed to ffmpeg, or will replace the default ones if these already exist.
To add an argument that requires no additional parameter, e.g. `-re`, then add it as `"-re"`.
To remove a default argument, define it with `false` as its value, e.g. `"-tune false"`.

#### FFMPEG Hardware Acceleration
 The bundled build of ffmpeg *includes* hardware acceleration on supported Raspberry Pi models (disabled as of Raspberry Pi 5) but in order to enable this you must check the setting **Advanced Camera Settings** > **Enable Hardware Acceleration for Raspberry Pi** (or set `"enableHwaccelRpi"` under `"cameraOptions"` to `true` in `config.json`).

*Note that enabling this option assumes you are using the bundled version of ffmpeg and thus may not work if you specify a custom one.*

## Known Issues
- If you are running Homebridge [oznu/docker-homebridge](https://github.com/oznu/docker-homebridge) camera streaming is limited to 720px wide.
- Due to transcoding requirements, when using a Raspberry Pi 3b video feeds will disconnect after ~20 seconds. RPi 4 or newer is recommended. See [issue #147](https://github.com/nzapponi/homebridge-simplisafe3/issues/147)

## Help & Support
All feedback is welcomed. For bugs please open an issue here. For feature requests or questions please use discussions.

The official [Homebridge Discord server](https://discord.gg/kqNCe2D) and [Reddit community](https://www.reddit.com/r/homebridge/) are other great places to ask for help.
