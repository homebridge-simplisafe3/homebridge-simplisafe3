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

Ensure you are running Node v10 or higher. You can check by using `node -v`.

Install the plugin by running:

```
npm install -g homebridge-simplisafe3
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

### Camera Support
Camera support is experimental and may not work perfectly. To enable it, simply switch `"cameras": true` in your `config.json`.

Any feedback is appreciated.

## Supported Devices
- [x] Alarm arm/disarm (home, away, off)
- [x] SimpliCam (audio & video, no microphone)
- [x] Entry sensors
- [ ] Motion sensors -- state not provided by SimpliSafe
- [ ] Glassbreak sensor -- state not provided by SimpliSafe
- [ ] Smoke detector -- log an issue and provide sample data!
- [ ] Water sensor -- log an issue and provide sample data!
- [ ] Freeze sensor -- log an issue and provide sample data!

## Help & Support
This has been tested on Homebridge running on a Raspberry Pi 3, using both native Homebridge and [oznu/docker-homebridge](https://github.com/oznu/docker-homebridge).

## Donations
Want to show your support? Consider making a donation!
- [Donate Now with PayPal](https://paypal.me/nzapponi?locale.x=en_GB)
- Donate with Bitcoin: 3GYS4ybqjjVUEyohFXaEk5HsG8onrsQKDi

![Bitcoin](/docs/bitcoin.png)

Thank you very much!