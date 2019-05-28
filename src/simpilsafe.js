import axios from 'axios';

// Do not touch these - they allow the client to make requests to the SimpliSafe API
const clientUsername = '4df55627-46b2-4e2c-866b-1521b395ded2.1-28-0.WebApp.simplisafe.com';
const clientPassword = '';

const ssApi = axios.create({
    baseURL: 'https://api.simplisafe.com/v1'
});

class SimpliSafe {

    token;
    rToken;
    tokenType;
    expiry;
    username;
    password;
    userId;
    subId;

    async login(username, password, storeCredentials = false) {

        if (storeCredentials) {
            this.username = username;
            this.password = password;
        }

        try {
            const response = await ssApi.post('/api/token', {
                username: username,
                password: password,
                grant_type: 'password'
            }, {
                    auth: {
                        username: clientUsername,
                        password: clientPassword
                    }
                });

            let data = response.data;
            this._storeLogin(data);
        } catch (err) {
            let response = (err.response && err.response) ? err.response : err;
            this.logout(storeCredentials);

            throw response;
        }
    }

    _storeLogin(tokenResponse) {
        this.token = tokenResponse.access_token;
        this.rToken = tokenResponse.refresh_token;
        this.tokenType = tokenResponse.token_type;
        this.expiry = Date.now() + (tokenResponse.expires_in * 1000);
    }

    logout(keepCredentials = false) {
        this.token = null;
        this.rToken = null;
        this.tokenType = null;
        this.expiry = null;
        if (!keepCredentials) {
            this.username = null;
            this.password = null;
        }
    }

    isLoggedIn() {
        return this.refreshToken !== null || (this.token !== null && Date.now() < expiry);
    }

    async refreshToken() {
        if (!this.isLoggedIn() || !this.refreshToken) {
            return Promise.reject('User is not logged in');
        }

        try {
            const response = await ssApi.post('/api/token', {
                refresh_token: this.rToken,
                grant_type: 'refresh_token'
            }, {
                    auth: {
                        username: clientUsername,
                        password: clientPassword
                    }
                });

            let data = response.data;
            this._storeLogin(data);

        } catch (err) {
            let response = (err.response) ? err.response : err;
            this.logout(this.username != null);

            throw response;
        }
    }

    async request(params, tokenRefreshed = false) {
        if (!this.isLoggedIn) {
            return Promise.reject('User is not logged in');
        }

        try {
            const response = await ssApi.request({
                ...params,
                headers: {
                    ...params.headers,
                    Authorization: `${this.tokenType} ${this.token}`
                }
            });
            return response.data;
        } catch (err) {
            let statusCode = err.response.status;
            if (statusCode == 401 && !tokenRefreshed) {
                return this.refreshToken()
                    .then(() => {
                        return this.request(params, true);
                    })
                    .catch(async err => {
                        let statusCode = err.status;
                        if ((statusCode == 401 || statusCode == 403) && this.username && this.password) {
                            try {
                                await this.login(this.username, this.password, true);
                                return this.request(params, true);
                            }
                            catch (err) {
                                throw err;
                            }
                        } else {
                            throw err;
                        }
                    });
            } else {
                throw err.response.data;
            }
        }
    }

    async getUserId() {
        if (this.userId) {
            return this.userId;
        }

        try {
            let data = await this.request({
                method: 'GET',
                url: '/api/authCheck'
            });
            this.userId = data.userId;
            return this.userId;
        } catch (err) {
            throw err;
        }
    }

    async getUserInfo() {
        try {
            let userId = await this.getUserId();

            let data = await this.request({
                method: 'GET',
                url: `/users/${userId}/loginInfo`
            });

            return data.loginInfo;
        } catch (err) {
            throw err;
        }
    }

    async getSubscriptions() {
        try {
            let userId = await this.getUserId();
            let data = await this.request({
                method: 'GET',
                url: `/users/${userId}/subscriptions?activeOnly=false`
            });

            let subscriptions = data.subscriptions;

            if (subscriptions.length == 1) {
                this.subId = subscriptions[0].sid;
            }

            return subscriptions;
        } catch (err) {
            throw err;
        }
    }

    async getSubscription(subId = null) {
        try {

            let subscriptionId = subId;
            
            if (!subscriptionId) {
                subscriptionId = this.subId;
                
                if (!subscriptionId) {
                    let subs = await this.getSubscriptions();
                    if (subs.length == 1) {
                        subscriptionId = subs[0].sid;
                    } else {
                        throw new Error('Subscription ID is ambiguous');
                    }
                }
            }
            
            let data = await this.request({
                method: 'GET',
                url: `/subscriptions/${subscriptionId}/`
            });

            return data.subscription;
        } catch (err) {
            throw err;
        }
    }

    async getAlarmState(subId = null) {
        try {
            let subscription = await this.getSubscription();

            if (subId) {
                this.subId = subId;
            }

            if (subscription.location && subscription.location.system) {
                // OFF, HOME, AWAY, AWAY_COUNT, HOME_COUNT, SOUNDING
                return subscription.location.system.isAlarming ? 'SOUNDING' : subscription.location.system.alarmState;
            } else {
                throw new Error('Subscription format not understood');
            }

        } catch (err) {
            throw err;
        }
    }

    async getEvents(number = 10) {
        try {
            let subId = this.subId;
            if (!subId) {
                let subscription = await this.getSubscription();
                subId = subscription.sid;
            }

            let data = await this.request({
                method: 'GET',
                url: `/subscriptions/${subId}/events?numEvents=${number}`
            });

            let events = data.events;
            return events;
            
        } catch (err) {
            throw err;
        }
    }

}

export default SimpliSafe;




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