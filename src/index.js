// © 2019 Niccolò Zapponi
// SimpliSafe 3 HomeBridge Plugin

import SimpliSafe3, { SENSOR_TYPES, RateLimitError } from './simplisafe';
import SimpliSafe3AuthenticationManager from './lib/authManager.js';
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

let Accessory, Service, UUIDGen;

class SS3Platform {

    constructor(log, config, api) {
        this.log = log;
        this.name = config.name;
        this.enableCameras = config.cameras || false;
        this.cameraOptions = config.cameraOptions || null;
        this.debug = config.debug || false;
        this.persistAccessories = config.persistAccessories !== undefined ? config.persistAccessories : true;
        this.resetId = config.resetSimpliSafeId || false;
        this.excludedDevices = config.excludedDevices || [];
        this.devices = [];
        this.accessories = [];
        this.api = api;

        this.cachedAccessoryConfig = [];
        this.unreachableAccessories = [];

        let refreshInterval = 15000;
        if (config.sensorRefresh) {
            refreshInterval = config.sensorRefresh * 1000;
        }

        this.authManager = new SimpliSafe3AuthenticationManager(this.api.user.storagePath(), log, this.debug);
        this.simplisafe = new SimpliSafe3(refreshInterval, this.resetId, this.authManager, this.api.user.storagePath(), log, this.debug);

        if (config.subscriptionId) {
            if (this.debug) this.log(`Specifying account number: ${config.subscriptionId}`);
            this.simplisafe.setDefaultSubscription(config.subscriptionId);
        }

        if (config.auth && config.auth.username && config.auth.password && !this.authManager.accountsFileExists()) {
            // this will flag authManager to try username / pw login
            this.authManager.username = config.auth.username;
            this.authManager.password = config.auth.password;
            this.authManager.ssId = this.simplisafe.ssId;
        }

        this.initialLoad = this.authManager.refreshCredentials()
            .then(() => {
                if (this.debug) this.log('SimpliSafe credentials initial refresh successful');
                return this.refreshAccessories(false);
            })
            .catch(err => {
                if (err instanceof RateLimitError) {
                    this.log.error('Initial load failed due to rate limiting or connectivity, trying again later');
                    setTimeout(async () => {
                        await this.retryBlockedAccessories();
                    }, this.simplisafe.nextAttempt - Date.now());
                } else {
                    this.log.error('SimpliSafe login failed with error:', err);
                    this.log.error('See the plugin README for more information on authenticating with SimpliSafe.');
                }
            });

        this.api.on('didFinishLaunching', () => {
            if (this.debug) this.log(`Found ${this.cachedAccessoryConfig.length} cached accessories being configured`);

            this.initialLoad
                .then(() => {
                    return Promise.all(this.cachedAccessoryConfig);
                })
                .then(() => {
                    if (!this.authManager.isAuthenticated()) throw new Error('Not authenticated with SimpliSafe.');
                    else {
                        this.simplisafe.startListening();
                        return this.refreshAccessories();
                    }
                })
                .catch(err => {
                    this.log.error('Initial accessories refresh failed with error:', err);
                });
        });
    }

    addAccessory(device) {
        if (this.debug) this.log('Add accessory');
        try {
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [device.accessory]);
            this.accessories.push(device.accessory);
        } catch (err) {
            this.log.error(`An error occurred while adding accessory: ${err}`);
        }
    }

    configureAccessory(accessory) {
        if (this.debug) this.log(`Configure existing accessory from cache: '${accessory.displayName}' (uuid ${accessory.UUID})`);

        let config = new Promise((resolve, reject) => {
            this.initialLoad
                .then(() => {

                    if (this.simplisafe.isBlocked) {
                        let unreachableAccessory = new UnreachableAccessory(accessory, this.api);
                        this.unreachableAccessories.push(unreachableAccessory);

                        return resolve();
                    }

                    let device = this.devices.find(device => device.uuid === accessory.UUID);

                    if (device) {
                        if (this.debug) this.log('Found device', device.name ? `'${device.name}'` : device.uuid);
                        device.setAccessory(accessory);
                        this.accessories.push(accessory);
                    } else {
                        if (this.debug) this.log('Device not found', accessory.UUID);
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
        if (this.debug) this.log('Remove accessory');
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
        if (this.debug) this.log(`Refreshing accessories (add and remove: ${addAndRemove})`);
        try {
            let subscription = await this.simplisafe.getSubscription();
            if (subscription.location.system.serial == null) throw new Error('System serial not found.');
            let uuid = UUIDGen.generate(subscription.location.system.serial);
            let alarm = this.accessories.find(acc => acc.UUID === uuid);

            if (!alarm) {
                if (this.debug) this.log('Adding Alarm...');
                const alarmAccessory = new Alarm(
                    'SimpliSafe 3',
                    subscription.location.system.serial,
                    this.log,
                    this.debug,
                    this.simplisafe,
                    this.api
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
                    continue;
                }

                let uuid = UUIDGen.generate(sensor.serial);
                let accessory = this.accessories.find(acc => acc.UUID === uuid);
                let sensorName = sensor.name;
                if (this.debug && !addAndRemove) {
                    this.log(`Discovered sensor '${sensor.name}' from SimpliSafe:`, JSON.stringify(sensor));
                }

                if (sensor.serial && this.excludedDevices.includes(sensor.serial)) {
                    this.log.info(`Excluding sensor with serial '${sensor.serial}'`);
                    continue;
                }

                if (sensor.type == SENSOR_TYPES.ENTRY_SENSOR) {
                    if (!accessory) {
                        sensorName = sensorName || `Entry Sensor ${sensor.serial}`;
                        if (this.debug) this.log(`Adding Entry Sensor '${sensorName}'...`);
                        const sensorAccessory = new EntrySensor(
                            sensorName,
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            this.api
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
                    accessory = this.accessories.find(acc => acc.UUID === uuid);
                    if (!accessory) {
                        sensorName = sensorName || `CO Detector ${sensor.serial}`;
                        if (this.debug) this.log(`Adding CO Detector '${sensorName}'...`);
                        const sensorAccessory = new CODetector(
                            sensorName,
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            this.api
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
                    accessory = this.accessories.find(acc => acc.UUID === uuid);
                    if (!accessory) {
                        sensorName = sensorName || `Smoke Detector ${sensor.serial}`;
                        if (this.debug) this.log(`Adding Smoke Detector '${sensorName}'...`);
                        const sensorAccessory = new SmokeDetector(
                            sensorName,
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            this.api
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
                    accessory = this.accessories.find(acc => acc.UUID === uuid);
                    if (!accessory) {
                        sensorName = sensorName || `Water Sensor ${sensor.serial}`;
                        if (this.debug) this.log(`Adding Water Sensor '${sensorName}'...`);
                        const sensorAccessory = new WaterSensor(
                            sensorName,
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            this.api
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
                    accessory = this.accessories.find(acc => acc.UUID === uuid);
                    if (!accessory) {
                        sensorName = sensorName || `Freeze Sensor ${sensor.serial}`;
                        if (this.debug) this.log(`Adding Freeze Sensor '${sensorName}'...`);
                        const sensorAccessory = new FreezeSensor(
                            sensorName,
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            this.api
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
                    sensorName = sensorName || `Motion Sensor ${sensor.serial}`;
                    // Check if secret alerts are enabled
                    if (sensor.setting.off == 0 || sensor.setting.home == 0 || sensor.setting.away == 0) {
                        if (!addAndRemove) this.log.warn(`Motion Sensor '${sensorName}' requires secret alerts to be enabled in SimpliSafe before you can add it to Homebridge.`);
                        continue;
                    }
                    accessory = this.accessories.find(acc => acc.UUID === uuid);
                    if (!accessory) {
                        if (this.debug) this.log(`Adding Motion Sensor '${sensorName}'...`);
                        const sensorAccessory = new MotionSensor(
                            sensorName,
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            this.api
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

                if (this.debug && !addAndRemove) {
                    this.log(`Discovered door lock '${lockName}' from SimpliSafe:`, JSON.stringify(lock));
                }

                let accessory = this.accessories.find(acc => acc.UUID === uuid);
                if (!accessory) {
                    if (this.debug) this.log(`Adding Lock ${lockName}...`);
                    const lockAccessory = new DoorLock(
                        lockName,
                        lock.serial,
                        this.log,
                        this.debug,
                        this.simplisafe,
                        this.api
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

                    if (this.debug && !addAndRemove) {
                        this.log(`Discovered camera '${cameraName}' from SimpliSafe:`, JSON.stringify(camera));
                    }

                    let cameraAccessory = this.accessories.find(acc => acc.UUID === uuid);
                    if (!cameraAccessory) {
                        if (this.debug) this.log(`Adding Camera ${cameraName} (uuid ${uuid})...`);
                        const cameraAccessory = new Camera(
                            cameraName,
                            camera.uuid,
                            camera,
                            this.cameraOptions,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            this.authManager,
                            this.api
                        );

                        this.devices.push(cameraAccessory);

                        if (addAndRemove) {
                            let newAccessory = new Accessory(cameraName, uuid);
                            cameraAccessory.setAccessory(newAccessory);

                            this.addAccessory(cameraAccessory);
                        }
                    }
                }
            }
        } catch (err) {
            if (err instanceof RateLimitError) {
                this.log.error('Accessory refresh failed due to rate limiting or connectivity:', err);
                this.log.info('Note: this error can also occur if you are not signed up for a SimpliSafe monitoring plan.');
            } else {
                this.log.error('An error occurred while refreshing accessories:', err);
            }
            throw err;
        }

    }

    updateAccessoriesReachability() {
        if (this.debug) this.log('Updating reacahability');
        for (let accessory of this.accessories) {
            accessory.updateReachability();
        }
    }

    async retryBlockedAccessories() {
        try {
            await this.authManager.refreshCredentials();
            if (this.debug) this.log('Recovered from 403 rate limit!');
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
                this.log.error('Credentials refresh attempt failed, still rate limited');
                setTimeout(async () => {
                    await this.retryBlockedAccessories();
                }, this.simplisafe.nextAttempt - Date.now());
            } else {
                this.log.error('An error occurred while refreshing credentials again:', err);
            }
        }
    }

}

const homebridge = homebridge => {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SS3Platform, true);
};

export default homebridge;
