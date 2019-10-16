# Homebridge Plugin for SimpliSafe 3
Created by [Niccolò Zapponi](https://twitter.com/nzapponi)

A complete (unofficial) Homebridge plugin to integrate the SimpliSafe 3 home security system with HomeKit.

Inspired by the work by [chowielin/homebridge-simplisafe-security-system](https://github.com/chowielin/homebridge-simplisafe-security-system).

## Requirements
You must sign up to a SimpliSafe monitoring plan that enables you to use the mobile app for this plugin to work.
The monitoring plan enables API access to SimpliSafe.

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

Ensure you are running Node v8 or higher. You can check by using `node -v`.

Install the plugin by running:

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

Switch this on to get more details around your sensors in your Homebridge logs.

#### `subscriptionId`
Type: string

Add this parameter in case you have multiple protected locations or accounts with SimpliSafe. The `subscriptionId` can be found at the bottom of your base unit.

## Supported Devices

Device             | Supported          | Notes
------------------ | ------------------ | -------------------------------------------------
Alarm arm/disarm   | :white_check_mark: | Home, away and off modes
SimpliCam          | :white_check_mark: | Audio, video, motion when armed, no microphone
Doorbell           | :white_check_mark: | Audio, video, motion, no microphone
Entry sensor       | :white_check_mark: | 
Smoke detector     | :white_check_mark: | Includes support for tamper & fault
Water sensor       | :white_check_mark: |
Freeze sensor      | :white_check_mark: | Supports temperature readings, not sensor trigger
Glassbreak sensor  | :x:                | State not provided by SimpliSafe
Motion sensor      | :x:                | State not provided by SimpliSafe
Keypad             | :x:                | State not provided by SimpliSafe
Panic button       | :x:                | State not provided by SimpliSafe

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
Camera support is experimental and may not work. To enable it, simply switch `"cameras": true` in your `config.json`.

For advanced scenarios, you can add the `"cameraOptions"` dictionary to the platform configuration object in `config.json` (all keys are optional):

```
"cameraOptions": {
    "ffmpegPath": "/path/to/custom/ffmpeg",
    "sourceOptions": {
        "-format": "flv",
        ... (any other ffmpeg argument)
    },
    "videoOptions": {
        "-vcodec": "h264_omx",
        ... (any other ffmpeg argument)
    },
    "audioOptions": {
        "-ar": "256k",
        ... (any other ffmpeg argument)
    }  
}
```
Here, `ffmpegPath` allows to specify a specific ffmpeg binary to be used, a useful feature for the use of hardware acceleration on the Raspberry Pi, for example.

Any arguments provided in `sourceOptions`, `videoOptions` and `audioOptions` will be added to the list of arguments passed to ffmpeg, or will replace the default ones if these already exist.
To add an argument that requires no additional parameter, e.g. `-re`, then add it as `"-re": ""`.
To remove a default argument, define it with `false` as its value, e.g. `"-re": false`.

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
        "sourceOptions": {
            "-vcodec": "h264_mmal"
        },
        "videoOptions": {
            "-vcodec": "h264_omx",
            "-tune": false,
            "-preset": false
        }
    }
}
```
See [Raspberry Pi FFmpeg Hardware Acceleration](/docs/raspberry-pi-ffmpeg.md) on how to compile ffmpeg to support hardware acceleration on Raspberry Pi 3 and 4.

#### Camera Support Known Issues
- If you are running Homebridge on Docker (for example using [oznu/docker-homebridge](https://github.com/oznu/docker-homebridge)), a "No Response" error will appear when trying to view the camera on the local network. The cause is still unknown. Remote camera access appears to be working fine.
- Camera support requires a considerable amount of computing power and may not work on very small machines, e.g. Raspberry Pi Zero and similar.

Any feedback is appreciated.

## Help & Support
This has been tested on Homebridge running on a Raspberry Pi 3, using both native Homebridge and [oznu/docker-homebridge](https://github.com/oznu/docker-homebridge).

## Donations
Want to show your support? Consider making a donation!
- [Donate Now with PayPal](https://paypal.me/nzapponi?locale.x=en_GB)
- Donate with Bitcoin: 3GYS4ybqjjVUEyohFXaEk5HsG8onrsQKDi

![Bitcoin](/docs/bitcoin.png)

Thank you very much!
