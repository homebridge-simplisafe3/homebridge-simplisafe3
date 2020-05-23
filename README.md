# Homebridge Plugin for SimpliSafe 3
Created by [Niccolò Zapponi](https://twitter.com/nzapponi) and [Michael Shamoon](https://github.com/nikonratm).

A complete (unofficial) Homebridge plugin to integrate the SimpliSafe 3 home security system with HomeKit.

## Requirements
You must sign up to a SimpliSafe monitoring plan that enables you to use the mobile app for this plugin to work. The monitoring plan enables API access to SimpliSafe.

**NOTE:** *As of version 1.5.0 of this plugin, Homebridge v1.0.0 or greater is required. Because of [significant changes to Homebridge](https://github.com/homebridge/homebridge/releases/tag/1.0.0) the plugin may not work properly with older versions of Homebridge. The last version of this plugin to officially support Homebridge 0.4.53 was version 1.4.12 which can still be installed using a command like `sudo npm install -g --unsafe-perm homebridge-simplisafe3@1.4.12`.*

## Features
Supercharge your SimpliSafe system and integrate with HomeKit the right way!
This plugin supports
- Real time event streaming: get immediate notifications anytime the alarm is armed / disarmed / goes off.
- Sensors: always be on top of your home with immediate access to the sensor status. Create smart automations directly from the Home app (e.g. when the front door is opened, turn the lights on).
- Cameras: view your SimpliCams directly from the Home app.
- Battery monitoring: the Home app will notify you if the battery level of one of your sensors is low

Here are some examples of how the set up looks like:
![Sensor Status](/docs/sensors.png)
![Arm/disarm](/docs/arm.png)


## Usage

This plugin supports installation and changing settings (for `config.js`) via the popular [Config UI X plugin](https://github.com/oznu/homebridge-config-ui-x).

Ensure you are running Node v10.17.0 or higher (this version is required by Homebridge v1.0.0). You can check by using `node -v`.

Either install and configure using Config UI X or you can manually install the plugin by running:

```
npm install -g homebridge-simplisafe3
```

if you run into issues when starting the plugin and Homebridge displays errors, then reinstall the plugin using the following command instead:
```
npm install -g --unsafe-perm homebridge-simplisafe3
```

Then, add the following configuration to the `platforms` array in your Homebridge `config.json`.


```
{
    "platform": "homebridge-simplisafe3.SimpliSafe 3",
    "name": "Home Alarm",
    "auth": {
        "username": "YOUR_USERNAME",
        "password": "YOUR_PASSWORD"
    },
    "cameras": false
}
```

Here is an example:
```
{
    "bridge": {
        "name": "Homebridge",
        "username": "CC:22:3D:E3:CE:30",
        "port": 51826,
        "pin": "031-45-154"
    },
    "accessories": [],
    "platforms": [
        {
            "platform": "homebridge-simplisafe3.SimpliSafe 3",
            "name": "Home Alarm",
            "auth": {
                "username": "YOUR_USERNAME",
                "password": "YOUR_PASSWORD"
            },
            "cameras": false
        }
    ]
}
```

That's it! The plugin will automatically load all your sensors into Homebridge.

### Optional Parameters

#### `cameras` and `cameraOptions`
These enable camera support. See [Camera Support](#camera-support) for more details.

#### `debug`
Type: boolean (default `false`)

Switch this on to get more details around your sensors in your Homebridge logs. To see all messages the Homebridge debug (`-D`) option must also be enabled.

#### `subscriptionId`
Type: string

Add this parameter in case you have multiple protected locations or accounts with SimpliSafe. The `subscriptionId` can be found at the bottom of your base unit.

#### `persistAccessories`
Type: boolean (default `false`)

By default, the plugin will remove old accessories that no longer exist in SimpliSafe from the Home app. If you are running into issues with your accessories randomly disappearing from Home, and you don't want to remove old accessories, set this to `true`.

#### `resetSimpliSafeId`
Type: boolean (default `false`)

Upon first start, the plugin generates an ID which it uses to identify itself with SimpliSafe. If you wish to reset it, set this to `true`.

## Supported Devices

Device             | Supported          | Notes
------------------ | ------------------ | -------------------------------------------------
Alarm arm/disarm   | :white_check_mark: | Home, away and off modes
SimpliCam          | :white_check_mark: | Audio, video, motion*, no microphone
Doorbell           | :white_check_mark: | Audio, video, motion, no microphone
Smart lock         | :white_check_mark: |
Entry sensor       | :white_check_mark: |
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

All devices also support low battery warnings.

To provide sample data, add `"debug": true` to the platform configuration inside `config.json`, for example:
```
{
    "platform": "homebridge-simplisafe3.SimpliSafe 3",
    "name": "Home Alarm",
    "auth": {
        "username": "YOUR_USERNAME",
        "password": "YOUR_PASSWORD"
    },
    "cameras": false,
    "sensorRefresh" : 15,
    "debug": true
}
```

This will print the data about all the sensors found.

### Camera Support
To enable camera support, simply switch `"cameras": true` in your `config.json` (or set via Config UI X admin).

**As of version v1.5.0 (which requires Homebridge v1.0.0 or later) cameras do not need to be added separately. Bridged cameras in v1.5.0 or later will not function properly with versions of Homebridge below 1.0.0. See [Migrating External Cameras to Bridged Cameras](#migrating-external-cameras-to-bridged-cameras) below.**

#### Migrating External Cameras to Bridged Cameras
After upgrading to v1.5.0, old (external) cameras will cease to function. This also means any existing HomeKit automations containing the camera will need to be updated. We recommend the following steps to avoid losing automations:

1. After updating the plugin you will see your new cameras automatically, if you are unsure which is which, click **Edit** on the camera in the Home app to view its settings and at the bottom you will see a button to **Remove Camera From Home** under an *old* external camera whereas new ones will show a link to the Bridge (and no remove button).
1. Before removing the old camera, update any automations that you have to replace any relevant parts with the new camera.
1. You can now safely remove your old camera from the Home app.

#### Camera Options
For advanced scenarios, you can set `"cameraOptions"` in Config UI X or manually in `config.json`\*:

```
"cameraOptions": {
    "ffmpegPath": "/path/to/custom/ffmpeg",
    "sourceOptions": "-format: flv ... (any other ffmpeg argument)",
    "videoOptions": "-vcodec h264_omx -tune false ... (any other ffmpeg argument)",
    "audioOptions": "-ar 256k ... (any other ffmpeg argument)"
}
```
\* *Note that the format of `"cameraOptions"` changed as of version 1.4.3. Old config files should continue work but your settings may need to be re-entered if you are switching to using Config UI X*

Here, `ffmpegPath` allows to specify a specific ffmpeg binary to be used, a useful feature for the use of hardware acceleration on the Raspberry Pi, for example.

Any arguments provided in `sourceOptions`, `videoOptions` and `audioOptions` will be added to the list of arguments passed to ffmpeg, or will replace the default ones if these already exist.
To add an argument that requires no additional parameter, e.g. `-re`, then add it as `"-re "`.
To remove a default argument, define it with `false` as its value, e.g. `"-re false"`.

Here is a sample configuration to use a locally installed ffmpeg binary:
```
{
    "platform": "homebridge-simplisafe3.SimpliSafe 3",
    "name": "Home Alarm",
    "auth": {
        "username": "YOUR_USERNAME",
        "password": "YOUR_PASSWORD"
    },
    "cameras": true,
    "cameraOptions": {
        "ffmpegPath": "/usr/local/bin/ffmpeg"
    }
}
```

And here is a sample configuration to use the Raspberry Pi H.264 hardware acceleration:
```
{
    "platform": "homebridge-simplisafe3.SimpliSafe 3",
    "name": "Home Alarm",
    "auth": {
        "username": "YOUR_USERNAME",
        "password": "YOUR_PASSWORD"
    },
    "cameras": true,
    "cameraOptions": {
        "ffmpegPath": "/usr/local/bin/ffmpeg",
        "sourceOptions": "-vcodec h264_mmal",
        "videoOptions": "-vcodec h264_omx -tune false -preset false"
    }
}
```
See [Compiling FFmpeg and Codecs from Source Code: All-in-One Script](https://retroresolution.com/compiling-ffmpeg-from-source-code-all-in-one-script/) and [Raspberry Pi FFmpeg Hardware Acceleration](/docs/raspberry-pi-ffmpeg.md) on how to compile ffmpeg to support hardware acceleration on Raspberry Pi 3 and 4.

#### Known Issues
- If you are running Homebridge [oznu/docker-homebridge](https://github.com/oznu/docker-homebridge) camera streaming is limited to 720px wide.

Any feedback is appreciated.

## Help & Support
This has been tested on Homebridge running on a Raspberry Pi 3, using both native Homebridge and [oznu/docker-homebridge](https://github.com/oznu/docker-homebridge).

Thank you very much!
