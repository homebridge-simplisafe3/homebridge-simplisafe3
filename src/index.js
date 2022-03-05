import SimpliSafe3, { SENSOR_TYPES, RateLimitError } from './simplisafe';
import SimpliSafe3AuthenticationManager from './lib/authManager';
import Alarm from './accessories/alarm';
import EntrySensor from './accessories/entrySensor';
import MotionSensor from './accessories/motionSensor';
import SmokeDetector from './accessories/smokeDetector';
import CODetector from './accessories/coDetector';
import WaterSensor from './accessories/waterSensor';
import FreezeSensor from './accessories/freezeSensor';
import DoorLock from './accessories/doorLock';
import Camera from './accessories/camera';
import UnreachableAccessory from './accessories/unreachableAccessory';

const PLUGIN_NAME = 'homebridge-simplisafe3';
const PLATFORM_NAME = 'SimpliSafe 3';

let UUIDGen;

class SS3Platform {

    constructor(log, config, api) {
        this.log = log;
        this.name = config.name;
        this.enableCameras = config.cameras || false;
        this.cameraOptions = config.cameraOptions || null;
        this.debug = config.debug || false;
        this.persistAccessories = config.persistAccessories !== undefined ? config.persistAccessories : true;
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
        this.simplisafe = new SimpliSafe3(refreshInterval, this.authManager, this.api.user.storagePath(), log, this.debug);

        if (config.subscriptionId) {
            if (this.debug) this.log(`Specifying account number: ${config.subscriptionId}`);
            this.simplisafe.setDefaultSubscription(config.subscriptionId);
        }

        if (config.auth && config.auth.username && config.auth.password && !this.authManager.accountsFileExists()) {
            // this will flag authManager to try username / pw login
            this.authManager.username = config.auth.username;
            this.authManager.password = config.auth.password;
        }

        this.initialLoad = this.authManager.refreshCredentials()
            .then(() => {
                return this.discoverSimpliSafeDevices();
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
            if (this.debug) this.log(`Found ${this.cachedAccessoryConfig.length} cached accessories to be configured.`);
            if (this.debug) this.log('Attempting intial SimpliSafe credentials refresh.');
            this.initialLoad
                .then(() => {
                    return Promise.all(this.cachedAccessoryConfig);
                })
                .then(() => {
                    if (!this.authManager.isAuthenticated()) throw new Error('Not authenticated with SimpliSafe.');
                    else {
                        this.simplisafe.startListening();
                        this.createNewPlatformAccessories();
                    }
                })
                .catch(err => {
                    this.log.error('Initial accessories refresh failed with error:', err);
                });
        });
    }

    configureAccessory(accessory) {
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
                        if (this.debug) this.log(`Initializing SS device ${device.constructor.name} '${device.name ? device.name : device.uuid}' with cached accessory`);
                        device.setAccessory(accessory);
                        this.accessories.push(accessory);
                    } else {
                        if (this.debug) this.log(`Cached accessory {${accessory.UUID}} not matched to a SimpliSafe device`);
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
        if (accessory) {
            if (!this.persistAccessories && !this.simplisafe.isBlocked) {
                if (this.debug) this.log('Removing accessory', accessory.name ?? accessory.UUID);
                this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            }
            if (this.accessories.indexOf(accessory) > -1) {
                this.accessories.splice(this.accessories.indexOf(accessory), 1);
            }
        }
    }

    createNewPlatformAccessories() {
        for (let device of this.devices) {
            let existingAccessory = this.accessories.find(acc => acc.UUID == device.uuid);
            if (!existingAccessory) {
                if (this.debug) this.log(`Initializing SS device '${device.name}' with new accessory.`);
                let accessory = device.createAccessory(); // from SimpliSafe3Accessory
                try {
                    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                    this.accessories.push(accessory);
                } catch (err) {
                    this.log.error(`An error occurred while adding accessory: ${err}`);
                }
            }
        }
    }

    async discoverSimpliSafeDevices() {
        if (this.debug) this.log('Discovering devices from SimpliSafe');
        try {
            let subscription = await this.simplisafe.getSubscription();
            if (subscription.location.system.serial == null) throw new Error('System serial not found.');
            let uuid = UUIDGen.generate(subscription.location.system.serial);
            let alarm = this.accessories.find(acc => acc.UUID === uuid);

            if (!alarm) {
                const alarmAccessory = new Alarm(
                    'SimpliSafe 3',
                    subscription.location.system.serial,
                    this.log,
                    this.debug,
                    this.simplisafe,
                    this.api
                );

                this.devices.push(alarmAccessory);
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
                if (this.debug) {
                    this.log(`Discovered sensor '${sensor.name}' from SimpliSafe:`, JSON.stringify(sensor));
                }

                if (sensor.serial && this.excludedDevices.includes(sensor.serial)) {
                    this.log.info(`Excluding sensor with serial '${sensor.serial}'`);
                    continue;
                }

                if (sensor.type == SENSOR_TYPES.ENTRY_SENSOR) {
                    if (!accessory) {
                        sensorName = sensorName || `Entry Sensor ${sensor.serial}`;
                        const sensorAccessory = new EntrySensor(
                            sensorName,
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            this.api
                        );

                        this.devices.push(sensorAccessory);
                    }
                } else if (sensor.type == SENSOR_TYPES.CO_SENSOR) {
                    if (!accessory) {
                        sensorName = sensorName || `CO Detector ${sensor.serial}`;
                        const sensorAccessory = new CODetector(
                            sensorName,
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            this.api
                        );

                        this.devices.push(sensorAccessory);
                    }
                } else if (sensor.type == SENSOR_TYPES.SMOKE_SENSOR) {
                    if (!accessory) {
                        sensorName = sensorName || `Smoke Detector ${sensor.serial}`;
                        const sensorAccessory = new SmokeDetector(
                            sensorName,
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            this.api
                        );

                        this.devices.push(sensorAccessory);
                    }
                } else if (sensor.type == SENSOR_TYPES.WATER_SENSOR) {
                    if (!accessory) {
                        sensorName = sensorName || `Water Sensor ${sensor.serial}`;
                        const sensorAccessory = new WaterSensor(
                            sensorName,
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            this.api
                        );

                        this.devices.push(sensorAccessory);
                    }
                } else if (sensor.type == SENSOR_TYPES.FREEZE_SENSOR) {
                    if (!accessory) {
                        sensorName = sensorName || `Freeze Sensor ${sensor.serial}`;
                        const sensorAccessory = new FreezeSensor(
                            sensorName,
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            this.api
                        );

                        this.devices.push(sensorAccessory);
                    }
                } else if (sensor.type == SENSOR_TYPES.MOTION_SENSOR) {
                    sensorName = sensorName || `Motion Sensor ${sensor.serial}`;
                    // Check if secret alerts are enabled
                    if (sensor.setting.off == 0 || sensor.setting.home == 0 || sensor.setting.away == 0) {
                        this.log.warn(`Motion Sensor '${sensorName}' requires secret alerts to be enabled in SimpliSafe before you can add it to Homebridge.`);
                        continue;
                    }
                    if (!accessory) {
                        const sensorAccessory = new MotionSensor(
                            sensorName,
                            sensor.serial,
                            this.log,
                            this.debug,
                            this.simplisafe,
                            this.api
                        );

                        this.devices.push(sensorAccessory);
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
                    this.log(`Discovered door lock '${lockName}' from SimpliSafe:`, JSON.stringify(lock));
                }

                let accessory = this.accessories.find(acc => acc.UUID === uuid);
                if (!accessory) {
                    const lockAccessory = new DoorLock(
                        lockName,
                        lock.serial,
                        this.log,
                        this.debug,
                        this.simplisafe,
                        this.api
                    );

                    this.devices.push(lockAccessory);
                }

            }

            if (this.enableCameras) {
                let cameras = await this.simplisafe.getCameras();

                for (let camera of cameras) {
                    let cameraName = camera.cameraSettings.cameraName || `Camera ${camera.uuid}`;
                    let uuid = UUIDGen.generate(camera.uuid);

                    if (this.debug) {
                        this.log(`Discovered camera '${cameraName}' from SimpliSafe:`, JSON.stringify(camera));
                    }

                    let cameraAccessory = this.accessories.find(acc => acc.UUID === uuid);
                    if (!cameraAccessory) {
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
                        if (cameraAccessory.isUnsupported()) this.log.warn(`Detected unsupported camera ${cameraName}, some features will be disabled.`);

                        this.devices.push(cameraAccessory);
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
            await this.discoverSimpliSafeDevices();
            this.cachedAccessoryConfig = [];
            for (let accessory of this.unreachableAccessories) {
                accessory.clearAccessory();
                this.configureAccessory(accessory.accessory);
            }
            await Promise.all(this.cachedAccessoryConfig);
            this.createNewPlatformAccessories();
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
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SS3Platform, true);
};

export default homebridge;
