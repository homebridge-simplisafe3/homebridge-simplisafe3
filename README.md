# Homebridge Plugin for SimpliSafe 3
Created by [Niccolò Zapponi](https://twitter.com/nzapponi)

A complete (unofficial) plugin to integrate the SimpliSafe 3 home security system with HomeKit.

Inspired by the work by [chowielin/homebridge-simplisafe-security-system](https://github.com/chowielin/homebridge-simplisafe-security-system).

## Requirements


## Features

real time event streaming
sensor status
battery level
screenshots

## Usage

typical config file

```
{
    "bridge": {
        "name": "Homebridge",
        "username": "CC:22:3D:E3:CE:31",
        "port": 51826,
        "pin": "031-45-154"
    },
    "description": "This is an example configuration file. You can use this as a template for creating your own configuration file containing devices you actually own.",
    "accessories": [],
    "platforms": [
        {
            "platform": "homebridge-simplisafe3.SimpliSafe 3",
            "name": "Home Alarm",
            "auth": {
                "username": "nzapponi@gmail.com",
                "password": "riqhy1-tirbob-fewsaN"
            },
            "cameras": true
        }
    ]
}
```

camera set up

## Supported Devices
- [x] Alarm arm/disarm (home, away, off)
- [x] SimpliCam (audio & video, no microphone)
- [x] Entry sensors
- [ ] Motion sensors -- state not provided by SimpliSafe
- [ ] Smoke detector -- log an issue and provide sample data!
- [ ] Water sensor -- log an issue and provide sample data!
- [ ] Glassbreak sensor -- log an issue and provide sample data!
- [ ] Freeze sensor -- log an issue and provide sample data!

## Video Support

## Help & Support


## Donations
