// © 2019 Niccolò Zapponi
// SimpliSafe 3 HomeBridge Plugin

import SimpliSafe3, { SENSOR_TYPES, RateLimitError } from './simplisafe';
import Alarm from './accessories/alarm';
import EntrySensor from './accessories/entrySensor';
import MotionSensor from './accessories/motionSensor';
import SmokeDetector from './accessories/smokeDetector';
import CODetector from './accessories/coDetector';
import WaterSensor from './accessories/waterSensor';
import FreezeSensor from './accessories/freezeSensor';
import DoorLock from './accessories/doorLock';
import Camera from './accessories/simplicam';
import UnreachableAccessory from './accessories/unreachableAccessory';

const PLUGIN_NAME = 'homebridge-simplisafe3';
const PLATFORM_NAME = 'SimpliSafe 3';

let Accessory, Service, Characteristic, UUIDGen, StreamController;

class SS3Platform {

    constructor(log, config, api) {
        this.log = log;
        this.name = config.name;
        this.enableCameras = config.cameras || false;
        this.cameraOptions = config.cameraOptions || null;
        this.debug = config.debug || false;
        this.persistAccessories = config.persistAccessories !== undefined ? config.persistAccessories : true;
        this.resetId = config.resetSimpliSafeId || false;
        this.devices = [];
        this.accessories = [];

        this.cachedAccessoryConfig = [];
        this.unreachableAccessories = [];

        let refreshInterval = 15000;
        if (config.sensorRefresh) {
            refreshInterval = config.sensorRefresh * 1000;
        }

        this.simplisafe = new SimpliSafe3(refreshInterval, this.resetId, log, this.debug);

        if (config.subscriptionId) {
            this.log(`Specifying account number: ${config.subscriptionId}`);
            this.simplisafe.setDefaultSubscription(config.subscriptionId);
        }

        this.initialLoad = this.simplisafe.login(config.auth.username, config.auth.password, true)
            .then(() => {
                this.log('Logged in!');
                return this.refreshAccessories(false);
            })
            .catch(err => {
                if (err instanceof RateLimitError) {
                    this.log('Log in failed due to rate limiting or connectivity, trying again later');
                    setTimeout(async () => {
                        await this.retryBlockedAccessories();
                    }, this.simplisafe.nextAttempt - Date.now());
                } else {
                    this.log('SS3 init failed');
                    this.log(err);
                }
            });

        if (api) {
            this.api = api;
            this.api.on('didFinishLaunching', () => {
                this.log(`Found ${this.cachedAccessoryConfig.length} cached accessories being configured`);

                this.initialLoad
                    .then(() => {
                        return Promise.all(this.cachedAccessoryConfig);
                    })
                    .then(() => {
                        return this.refreshAccessories();
                    })
                    .catch(err => {
                        this.log('SS3 refresh failed');
                        this.log(err);
                    });
            });
        }
    }

    addAccessory(device) {
        this.log('Add accessory');
        try {
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [device.accessory]);
            this.accessories.push(device.accessory);
        } catch (err) {
            this.log(`An error occurred while adding accessory: ${err}`);
        }
    }

    configureAccessory(accessory) {
        this.log(`Configure existing accessory ${accessory.UUID} ${accessory.displayName}`);

        let config = new Promise((resolve, reject) => {
            this.initialLoad
                .then(() => {

                    if (this.simplisafe.isBlocked) {
                        let unreachableAccessory = new UnreachableAccessory(accessory, Service, Characteristic);
                        this.unreachableAccessories.push(unreachableAccessory);

                        return resolve();
                    }

                    let device = this.devices.find(device => device.uuid === accessory.UUID);

                    if (device) {
                        this.log('Found device!');
                        device.setAccessory(accessory);
                        this.accessories.push(accessory);
                    } else {
                        this.log('Device not found!');
                        this.removeAccessory(accessory);
                    }

                    resolve();
                })
                .catch(err => {
                    reject(err);
                });
        });

        this.cachedAccessoryConfig.push(config);
    }

    removeAccessory(accessory) {
        this.log('Remove accessory');
        if (accessory) {
            if (!this.persistAccessories && !this.simplisafe.isBlocked) {
                this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            }
            if (this.accessories.indexOf(accessory) > -1) {
                this.accessories.splice(this.accessories.indexOf(accessory), 1);
            }
        }
    }

    async refreshAccessories(addAndRemove = true) {
        this.log(`Refreshing accessories (add and remove: ${addAndRemove})`);
        try {
            let subscription = await this.simplisafe.getSubscription();

            let uuid = UUIDGen.generate(subscription.location.system.serial);
            let alarm = this.accessories.find(acc => acc.UUID === uuid);

            if (!alarm) {
                this.log('Alarm not found, adding...');
                const alarmAccessory = new Alarm(
                    'SimpliSafe 3',
                    subscription.location.system.serial,
                    this.log,
                    this.debug,
                    this.simplisafe,
                    Service,
                    Characteristic,
                    UUIDGen
                );

                this.devices.push(alarmAccessory);

                if (addAndRemove) {
                    let newAccessory = new Accessory('SimpliSafe 3', UUIDGen.generate(subscription.location.system.serial));
                    newAccessory.addService(Service.SecuritySystem);
                    alarmAccessory.setAccessory(newAccessory);
                    this.addAccessory(alarmAccessory);
                }
            }

            let sensors = await this.simplisafe.getSensors();
            for (let sensor of sensors) {

                if (this.debug) {
                    this.log(`Discovered sensor: ${sensor.name}`);
                    this.log(sensor);
                }

                if (sensor.type == SENSOR_TYPES.KEYPAD ||
                    sensor.type == SENSOR_TYPES.KEYCHAIN ||
                    sensor.type == SENSOR_TYPES.PANIC_BUTTON ||
                    sensor.type == SENSOR_TYPES.GLASSBREAK_SENSOR ||
                    sensor.type == SENSOR_TYPES.SIREN ||
                    sensor.type == SENSOR_TYPES.SIREN_2 ||
                    sensor.type == SENSOR_TYPES.DOORLOCK ||
                    sensor.type == SENSOR_TYPES.DOORLOCK_2) {
                    // Ignore as no data is provided by SimpliSafe
                    // Door locks are configured below
                } else if (sensor.type == SENSOR_TYPES.ENTRY_SENSOR) {
                    let uuid = UUIDGen.generate(sensor.serial);
                    let accessory = this.accessories.find(acc => acc.UUID === uuid);

                    if (!accessory) {
                        this.log(`Sensor ${sensor.name} not found, adding...`);
                        const sensorAccessory = new EntrySensor(
                            sensor.name || 'Entry Sensor',
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            Service,
                            Characteristic,
                            UUIDGen
                        );

                        this.devices.push(sensorAccessory);

                        if (addAndRemove) {
                            let newAccessory = new Accessory(sensor.name || 'Entry Sensor', UUIDGen.generate(sensor.serial));
                            newAccessory.addService(Service.ContactSensor);
                            sensorAccessory.setAccessory(newAccessory);
                            this.addAccessory(sensorAccessory);
                        }
                    }
                } else if (sensor.type == SENSOR_TYPES.CO_SENSOR) {
                    let uuid = UUIDGen.generate(sensor.serial);
                    let accessory = this.accessories.find(acc => acc.UUID === uuid);

                    if (!accessory) {
                        this.log('Sensor not found, adding...');
                        const sensorAccessory = new CODetector(
                            sensor.name || 'CO Detector',
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            Service,
                            Characteristic,
                            UUIDGen
                        );

                        this.devices.push(sensorAccessory);

                        if (addAndRemove) {
                            let newAccessory = new Accessory(sensor.name || 'CO Detector', UUIDGen.generate(sensor.serial));
                            newAccessory.addService(Service.CarbonMonoxideSensor);
                            sensorAccessory.setAccessory(newAccessory);
                            this.addAccessory(sensorAccessory);
                        }
                    }
                } else if (sensor.type == SENSOR_TYPES.SMOKE_SENSOR) {
                    let uuid = UUIDGen.generate(sensor.serial);
                    let accessory = this.accessories.find(acc => acc.UUID === uuid);

                    if (!accessory) {
                        this.log(`Sensor ${sensor.name} not found, adding...`);
                        const sensorAccessory = new SmokeDetector(
                            sensor.name || 'Smoke Detector',
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            Service,
                            Characteristic,
                            UUIDGen
                        );

                        this.devices.push(sensorAccessory);

                        if (addAndRemove) {
                            let newAccessory = new Accessory(sensor.name || 'Smoke Detector', UUIDGen.generate(sensor.serial));
                            newAccessory.addService(Service.SmokeSensor);
                            sensorAccessory.setAccessory(newAccessory);
                            this.addAccessory(sensorAccessory);
                        }
                    }
                } else if (sensor.type == SENSOR_TYPES.WATER_SENSOR) {
                    let uuid = UUIDGen.generate(sensor.serial);
                    let accessory = this.accessories.find(acc => acc.UUID === uuid);

                    if (!accessory) {
                        this.log(`Sensor ${sensor.name} not found, adding...`);
                        const sensorAccessory = new WaterSensor(
                            sensor.name || 'Water Sensor',
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            Service,
                            Characteristic,
                            UUIDGen
                        );

                        this.devices.push(sensorAccessory);

                        if (addAndRemove) {
                            let newAccessory = new Accessory(sensor.name || 'Water Sensor', UUIDGen.generate(sensor.serial));
                            newAccessory.addService(Service.LeakSensor);
                            sensorAccessory.setAccessory(newAccessory);
                            this.addAccessory(sensorAccessory);
                        }
                    }
                } else if (sensor.type == SENSOR_TYPES.FREEZE_SENSOR) {
                    let uuid = UUIDGen.generate(sensor.serial);
                    let accessory = this.accessories.find(acc => acc.UUID === uuid);

                    if (!accessory) {
                        this.log(`Sensor ${sensor.name} not found, adding...`);
                        const sensorAccessory = new FreezeSensor(
                            sensor.name || 'Freeze Sensor',
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            Service,
                            Characteristic,
                            UUIDGen
                        );

                        this.devices.push(sensorAccessory);

                        if (addAndRemove) {
                            let newAccessory = new Accessory(sensor.name || 'Freeze Sensor', UUIDGen.generate(sensor.serial));
                            newAccessory.addService(Service.TemperatureSensor);
                            sensorAccessory.setAccessory(newAccessory);
                            this.addAccessory(sensorAccessory);
                        }
                    }
                } else if (sensor.type == SENSOR_TYPES.MOTION_SENSOR) {

                    // Check if secret alerts are enabled
                    if (sensor.setting.off == 0 || sensor.setting.home == 0 || sensor.setting.away == 0) {
                        this.log(`Sensor ${sensor.name} requires secret alerts to be added to Homebridge.`);
                        continue;
                    }

                    let uuid = UUIDGen.generate(sensor.serial);
                    let accessory = this.accessories.find(acc => acc.UUID === uuid);

                    if (!accessory) {
                        this.log(`Sensor ${sensor.name} not found, adding...`);
                        const sensorAccessory = new MotionSensor(
                            sensor.name || 'Motion Sensor',
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            Service,
                            Characteristic,
                            UUIDGen
                        );

                        this.devices.push(sensorAccessory);

                        if (addAndRemove) {
                            let newAccessory = new Accessory(sensor.name || 'Motion Sensor', UUIDGen.generate(sensor.serial));
                            newAccessory.addService(Service.MotionSensor);
                            sensorAccessory.setAccessory(newAccessory);
                            this.addAccessory(sensorAccessory);
                        }
                    }
                } else {
                    this.log(`Sensor not (yet) supported: ${sensor.name}`);
                    this.log(sensor);
                }
            }

            let locks = await this.simplisafe.getLocks();
            for (let lock of locks) {

                if (this.debug) {
                    this.log(`Discovered door lock: ${lock.name}`);
                    this.log(lock);
                }

                let uuid = UUIDGen.generate(lock.serial);
                let accessory = this.accessories.find(acc => acc.UUID === uuid);

                if (!accessory) {
                    this.log('Lock not found, adding...');
                    const lockAccessory = new DoorLock(
                        lock.name || 'Smart Lock',
                        lock.serial,
                        this.log,
                        this.debug,
                        this.simplisafe,
                        Service,
                        Characteristic,
                        UUIDGen
                    );

                    this.devices.push(lockAccessory);

                    if (addAndRemove) {
                        let newAccessory = new Accessory(lock.name || 'Smart Lock', UUIDGen.generate(lock.serial));
                        newAccessory.addService(Service.LockMechanism);
                        lockAccessory.setAccessory(newAccessory);
                        this.addAccessory(lockAccessory);
                    }
                }

            }

            if (this.enableCameras) {
                let cameras = await this.simplisafe.getCameras();

                for (let camera of cameras) {
                    let uuid = UUIDGen.generate(camera.uuid);
                    let cameraAccessory = this.accessories.find(acc => acc.UUID === uuid);

                    if (!cameraAccessory) {
                        // cameras are not cached by Homebridge
                        this.log(`Initializing camera ${camera.cameraSettings.cameraName} (uuid ${uuid}).`);
                        const cameraDevice = new Camera(
                            camera.cameraSettings.cameraName || 'Camera',
                            camera.uuid,
                            camera,
                            this.cameraOptions,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            Service,
                            Characteristic,
                            UUIDGen,
                            StreamController
                        );

                        cameraAccessory = new Accessory(camera.cameraSettings.cameraName || 'Camera', UUIDGen.generate(camera.uuid));
                        cameraAccessory.addService(Service.CameraControl);
                        cameraAccessory.addService(Service.Microphone);
                        cameraAccessory.addService(Service.MotionSensor);
                        if (camera.model == 'SS002') { // SSO02 is doorbell cam
                            cameraAccessory.addService(Service.Doorbell);
                        }
                        cameraDevice.setAccessory(cameraAccessory);

                        try {
                            this.api.publishCameraAccessories(PLUGIN_NAME, [cameraAccessory]);
                            this.accessories.push(cameraAccessory);
                            this.devices.push(cameraDevice);
                        } catch (err) {
                            this.log('An error occurred while publishing camera:');
                            this.log(err);
                        }
                    }
                }
            }
        } catch (err) {
            if (err instanceof RateLimitError) {
                this.log('Accessory refresh failed due to rate limiting or connectivity');
            } else {
                this.log('An error occurred while refreshing accessories');
                this.log(err);
            }
        }

    }

    updateAccessoriesReachability() {
        this.log('Updating reacahability');
        for (let accessory of this.accessories) {
            accessory.updateReachability();
        }
    }

    async retryBlockedAccessories() {
        try {
            await this.simplisafe.login(this.simplisafe.username, this.simplisafe.password, true);
            this.log('Recovered from 403 rate limit!');
            await this.refreshAccessories(false);
            this.cachedAccessoryConfig = [];
            for (let accessory of this.unreachableAccessories) {
                accessory.clearAccessory();
                this.configureAccessory(accessory.accessory);
            }
            await Promise.all(this.cachedAccessoryConfig);
            await this.refreshAccessories();

        } catch (err) {
            if (err instanceof RateLimitError) {
                this.log('Log in attempt failed, still rate limited');
                setTimeout(async () => {
                    await this.retryBlockedAccessories();
                }, this.simplisafe.nextAttempt - Date.now());
            } else {
                this.log('An error occurred while logging in again');
                this.log(err);
            }
        }
    }

}

const homebridge = homebridge => {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;
    StreamController = homebridge.hap.StreamController;

    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SS3Platform, true);
};

export default homebridge;
