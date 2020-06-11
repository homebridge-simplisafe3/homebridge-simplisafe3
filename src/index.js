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

let Accessory, Service, Characteristic, UUIDGen, CameraController;

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
        this.api = api;

        this.cachedAccessoryConfig = [];
        this.unreachableAccessories = [];

        let refreshInterval = 15000;
        if (config.sensorRefresh) {
            refreshInterval = config.sensorRefresh * 1000;
        }


        this.simplisafe = new SimpliSafe3(refreshInterval, this.resetId, this.api.user.storagePath(), log, this.debug);

        if (config.subscriptionId) {
            if (this.debug) this.log.debug(`Specifying account number: ${config.subscriptionId}`);
            this.simplisafe.setDefaultSubscription(config.subscriptionId);
        }

        this.initialLoad = this.simplisafe.login(config.auth.username, config.auth.password, true)
            .then(() => {
                if (this.debug) this.log.debug('Logged in!');
                return this.refreshAccessories(false);
            })
            .catch(err => {
                if (err instanceof RateLimitError) {
                    this.log.error('Log in failed due to rate limiting or connectivity, trying again later');
                    setTimeout(async () => {
                        await this.retryBlockedAccessories();
                    }, this.simplisafe.nextAttempt - Date.now());
                } else {
                    this.log.error('SS3 init failed');
                    this.log.error(err);
                }
            });

        this.api.on('didFinishLaunching', () => {
            if (this.debug) this.log.debug(`Found ${this.cachedAccessoryConfig.length} cached accessories being configured`);

            this.initialLoad
                .then(() => {
                    return Promise.all(this.cachedAccessoryConfig);
                })
                .then(() => {
                    return this.refreshAccessories();
                })
                .catch(err => {
                    this.log.error('SS3 refresh failed');
                    this.log.error(err);
                });
        });
    }

    addAccessory(device) {
        if (this.debug) this.log.debug('Add accessory');
        try {
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [device.accessory]);
            this.accessories.push(device.accessory);
        } catch (err) {
            this.log.error(`An error occurred while adding accessory: ${err}`);
        }
    }

    configureAccessory(accessory) {
        if (this.debug) this.log.debug(`Configure existing accessory '${accessory.displayName}' (uuid ${accessory.UUID})`);

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
                        if (this.debug) this.log.debug('Found device', device.name ? `'${device.name}'` : device.uuid);
                        device.setAccessory(accessory);
                        this.accessories.push(accessory);
                    } else {
                        if (this.debug) this.log.debug('Device not found', device.name ? `'${device.name}'` : device.uuid);
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
        if (this.debug) this.log.debug('Remove accessory');
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
        if (this.debug) this.log.debug(`Refreshing accessories (add and remove: ${addAndRemove})`);
        try {
            let subscription = await this.simplisafe.getSubscription();

            let uuid = UUIDGen.generate(subscription.location.system.serial);
            let alarm = this.accessories.find(acc => acc.UUID === uuid);

            if (!alarm) {
                if (this.debug) this.log.debug('Alarm not found, adding...');
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
                    this.log.debug(`Discovered sensor '${sensor.name}' from SimpliSafe.`);
                    this.log.debug(sensor);
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
                    let sensorName = sensor.name || `Entry Sensor ${sensor.serial}`;
                    let uuid = UUIDGen.generate(sensor.serial);
                    let accessory = this.accessories.find(acc => acc.UUID === uuid);
                    if (!accessory) {
                        if (this.debug) this.log.debug(`Entry Sensor '${sensorName}' not found, adding...`);
                        const sensorAccessory = new EntrySensor(
                            sensorName,
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
                            let newAccessory = new Accessory(sensorName, uuid);
                            newAccessory.addService(Service.ContactSensor);
                            sensorAccessory.setAccessory(newAccessory);
                            this.addAccessory(sensorAccessory);
                        }
                    }
                } else if (sensor.type == SENSOR_TYPES.CO_SENSOR) {
                    let sensorName = sensor.name || `CO Detector ${sensor.serial}`;
                    let uuid = UUIDGen.generate(sensor.serial);
                    let accessory = this.accessories.find(acc => acc.UUID === uuid);
                    if (!accessory) {
                        if (this.debug) this.log.debug(`CO Detector '${sensorName}' not found, adding...`);
                        const sensorAccessory = new CODetector(
                            sensorName,
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
                            let newAccessory = new Accessory(sensorName, uuid);
                            newAccessory.addService(Service.CarbonMonoxideSensor);
                            sensorAccessory.setAccessory(newAccessory);
                            this.addAccessory(sensorAccessory);
                        }
                    }
                } else if (sensor.type == SENSOR_TYPES.SMOKE_SENSOR) {
                    let sensorName = sensor.name || `Smoke Detector ${sensor.serial}`;
                    let uuid = UUIDGen.generate(sensor.serial);
                    let accessory = this.accessories.find(acc => acc.UUID === uuid);
                    if (!accessory) {
                        if (this.debug) this.log.debug(`Smoke Detector '${sensorName}' not found, adding...`);
                        const sensorAccessory = new SmokeDetector(
                            sensorName,
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
                            let newAccessory = new Accessory(sensorName, uuid);
                            newAccessory.addService(Service.SmokeSensor);
                            sensorAccessory.setAccessory(newAccessory);
                            this.addAccessory(sensorAccessory);
                        }
                    }
                } else if (sensor.type == SENSOR_TYPES.WATER_SENSOR) {
                    let sensorName = sensor.name || `Water Sensor ${sensor.serial}`;
                    let uuid = UUIDGen.generate(sensor.serial);
                    let accessory = this.accessories.find(acc => acc.UUID === uuid);
                    if (!accessory) {
                        if (this.debug) this.log.debug(`Water Sensor '${sensorName}' not found, adding...`);
                        const sensorAccessory = new WaterSensor(
                            sensorName,
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
                            let newAccessory = new Accessory(sensorName, uuid);
                            newAccessory.addService(Service.LeakSensor);
                            sensorAccessory.setAccessory(newAccessory);
                            this.addAccessory(sensorAccessory);
                        }
                    }
                } else if (sensor.type == SENSOR_TYPES.FREEZE_SENSOR) {
                    let sensorName = sensor.name || `Freeze Sensor ${sensor.serial}`;
                    let uuid = UUIDGen.generate(sensor.serial);
                    let accessory = this.accessories.find(acc => acc.UUID === uuid);
                    if (!accessory) {
                        if (this.debug) this.log.debug(`Freeze Sensor '${sensorName}' not found, adding...`);
                        const sensorAccessory = new FreezeSensor(
                            sensorName,
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
                            let newAccessory = new Accessory(sensorName, uuid);
                            newAccessory.addService(Service.TemperatureSensor);
                            sensorAccessory.setAccessory(newAccessory);
                            this.addAccessory(sensorAccessory);
                        }
                    }
                } else if (sensor.type == SENSOR_TYPES.MOTION_SENSOR) {
                    let sensorName = sensor.name || `Motion Sensor ${sensor.serial}`;
                    // Check if secret alerts are enabled
                    if (sensor.setting.off == 0 || sensor.setting.home == 0 || sensor.setting.away == 0) {
                        this.log.warn(`Motion Sensor '${sensorName}' requires secret alerts to be enabled in SimpliSafe before you can add it to Homebridge.`);
                        continue;
                    }
                    let uuid = UUIDGen.generate(sensor.serial);
                    let accessory = this.accessories.find(acc => acc.UUID === uuid);
                    if (!accessory) {
                        if (this.debug) this.log.debug(`Motion Sensor '${sensorName}' not found, adding...`);
                        const sensorAccessory = new MotionSensor(
                            sensorName,
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
                            let newAccessory = new Accessory(sensorName, uuid);
                            newAccessory.addService(Service.MotionSensor);
                            sensorAccessory.setAccessory(newAccessory);
                            this.addAccessory(sensorAccessory);
                        }
                    }
                } else {
                    this.log.warn(`Sensor not (yet) supported: ${sensor.name}`);
                    this.log.warn(sensor);
                }
            }

            let locks = await this.simplisafe.getLocks();
            for (let lock of locks) {
                let lockName = lock.name || `Smart Lock ${lock.serial}`;
                let uuid = UUIDGen.generate(lock.serial);

                if (this.debug) {
                    this.log.debug(`Discovered door lock '${lockName}' from SimpliSafe`);
                    this.log.debug(lock);
                }

                let accessory = this.accessories.find(acc => acc.UUID === uuid);
                if (!accessory) {
                    if (this.debug) this.log.debug(`Lock ${lockName} not found, adding...`);
                    const lockAccessory = new DoorLock(
                        lockName,
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
                        let newAccessory = new Accessory(lockName, uuid);
                        newAccessory.addService(Service.LockMechanism);
                        lockAccessory.setAccessory(newAccessory);
                        this.addAccessory(lockAccessory);
                    }
                }

            }

            if (this.enableCameras) {
                let cameras = await this.simplisafe.getCameras();
                for (let camera of cameras) {
                    let cameraName = camera.cameraSettings.cameraName || `Camera ${camera.uuid}`;
                    let uuid = UUIDGen.generate(camera.uuid);

                    if (this.debug) {
                        this.log.debug(`Discovered camera '${cameraName}' from SimpliSafe`);
                        this.log.debug(camera);
                    }

                    let cameraAccessory = this.accessories.find(acc => acc.UUID === uuid);
                    if (!cameraAccessory) {
                        if (this.debug) this.log.debug(`Camera ${cameraName} (uuid ${uuid}) not found, adding...`);
                        const cameraAccessory = new Camera(
                            cameraName,
                            camera.uuid,
                            camera,
                            this.cameraOptions,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            Service,
                            Characteristic,
                            UUIDGen,
                            CameraController
                        );

                        this.devices.push(cameraAccessory);

                        if (addAndRemove) {
                            let newAccessory = new Accessory(cameraName, uuid);
                            newAccessory.addService(Service.MotionSensor);
                            if (camera.model == 'SS002') { // SSO02 is doorbell cam
                                newAccessory.addService(Service.Doorbell);
                            }
                            cameraAccessory.setAccessory(newAccessory);

                            this.addAccessory(cameraAccessory);
                        }
                    }
                }
            }
        } catch (err) {
            if (err instanceof RateLimitError) {
                this.log.error('Accessory refresh failed due to rate limiting or connectivity');
            } else {
                this.log.error('An error occurred while refreshing accessories');
                this.log.error(err);
            }
        }

    }

    updateAccessoriesReachability() {
        if (this.debug) this.log.debug('Updating reacahability');
        for (let accessory of this.accessories) {
            accessory.updateReachability();
        }
    }

    async retryBlockedAccessories() {
        try {
            await this.simplisafe.login(this.simplisafe.username, this.simplisafe.password, true);
            if (this.debug) this.log.debug('Recovered from 403 rate limit!');
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
                this.log.error('Log in attempt failed, still rate limited');
                setTimeout(async () => {
                    await this.retryBlockedAccessories();
                }, this.simplisafe.nextAttempt - Date.now());
            } else {
                this.log.error('An error occurred while logging in again');
                this.log.error(err);
            }
        }
    }

}

const homebridge = homebridge => {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;
    CameraController = homebridge.hap.CameraController;

    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SS3Platform, true);
};

export default homebridge;
