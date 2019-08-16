// © 2019 Niccolò Zapponi
// SimpliSafe 3 HomeBridge Plugin

import SimpliSafe3 from './simplisafe';
import Alarm from './accessories/alarm';
import EntrySensor from './accessories/entrySensor';
import Camera from './accessories/simplicam';

const PLUGIN_NAME = 'homebridge-simplisafe3';
const PLATFORM_NAME = 'SimpliSafe 3';

let Accessory, Service, Characteristic, UUIDGen, StreamController;

class SS3Platform {

    constructor(log, config, api) {
        this.log = log;
        this.name = config.name;
        this.enableCameras = config.cameras || false;
        this.cameraOptions = config.cameraOptions || null;
        this.devices = [];
        this.accessories = [];

        this.cachedAccessoryConfig = [];

        let refreshInterval = 15000;
        if (config.sensorRefresh) {
            refreshInterval = config.sensorRefresh * 1000;
        }

        this.simplisafe = new SimpliSafe3(refreshInterval);

        this.initialLoad = this.simplisafe.login(config.auth.username, config.auth.password, true)
            .then(() => {
                this.log('Logged in!');

                if (config.subscriptionId) {
                    this.simplisafe.setDefaultSubscription(config.subscriptionId);
                }

                return this.refreshAccessories(false);
            })
            .catch(err => {
                this.log('SS3 init failed');
                this.log(err);
            });

        if (api) {
            this.api = api;
            this.api.on('didFinishLaunching', () => {

                this.log('DidFinishLaunching');
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
        this.log('Configure existing accessory');

        let config = new Promise((resolve, reject) => {
            this.initialLoad
                .then(() => {
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
            // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            if (this.accessories.indexOf(accessory) > -1) {
                this.accessories.splice(this.accessories.indexOf(accessory), 1);
            }
        }
    }

    async refreshAccessories(addAndRemove = true) {
        this.log('Refreshing accessories');
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
                if (sensor.type == 1 || sensor.type == 4 || sensor.type == 6) {
                    // Ignore as no data is provided by SimpliSafe
                } else if (sensor.type == 5) {
                    // Entry sensor
                    let uuid = UUIDGen.generate(sensor.serial);
                    let accessory = this.accessories.find(acc => acc.UUID === uuid);

                    if (!accessory) {
                        this.log('Sensor not found, adding...');
                        const sensorAccessory = new EntrySensor(
                            sensor.name || 'Entry Sensor',
                            sensor.serial,
                            this.log,
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
                } else {
                    this.log(`Sensor not (yet) supported: ${sensor.name}`);
                    this.log(sensor);
                }
            }

            if (this.enableCameras) {
                let cameras = await this.simplisafe.getCameras();

                for (let camera of cameras) {
                    let uuid = UUIDGen.generate(camera.uuid);
                    let accessory = this.accessories.find(acc => acc.UUID === uuid);

                    if (!accessory) {
                        this.log('Camera not found, adding...');
                        const cameraAccessory = new Camera(
                            camera.cameraSettings.cameraName || 'Camera',
                            camera.uuid,
                            camera,
                            this.cameraOptions,
                            this.log,
                            this.simplisafe,
                            Service,
                            Characteristic,
                            UUIDGen,
                            StreamController
                        );

                        this.devices.push(cameraAccessory);

                        if (addAndRemove) {
                            let newAccessory = new Accessory(camera.cameraSettings.cameraName || 'Camera', UUIDGen.generate(camera.uuid));
                            newAccessory.addService(Service.CameraControl);
                            newAccessory.addService(Service.Microphone);
                            cameraAccessory.setAccessory(newAccessory);
                            this.addAccessory(cameraAccessory);
                        }
                    }
                }
            }
        } catch (err) {
            this.log('An error occurred while refreshing accessories');
            this.log(err);
        }

    }

    updateAccessoriesReachability() {
        this.log('Updating reacahability');
        for (let accessory of this.accessories) {
            accessory.updateReachability();
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
