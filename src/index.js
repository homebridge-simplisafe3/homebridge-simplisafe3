// © 2019 Niccolò Zapponi
// SimpliSafe 3 HomeBridge Plugin

import SimpliSafe3 from './simplisafe';
import Alarm from './accessories/alarm';

const PLUGIN_NAME = 'homebridge-simplisafe3';
const PLATFORM_NAME = 'SimpliSafe 3';

let Accessory, Service, Characteristic, UUIDGen;

class SS3Platform {

    constructor(log, config, api) {
        this.log = log;
        this.name = config.name;
        this.devices = [];
        this.accessories = [];

        this.cachedAccessoryConfig = [];

        this.simplisafe = new SimpliSafe3();

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
            this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
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
                    Accessory,
                    UUIDGen
                );

                this.devices.push(alarmAccessory);
                
                if (addAndRemove) {
                    let newAccessory = new Accessory('SimpliSafe 3', UUIDGen.generate(subscription.location.system.serial));
                    newAccessory.addService(Service.SecuritySystem, 'Alarm');
                    alarmAccessory.setAccessory(newAccessory);
                    this.addAccessory(alarmAccessory);
                }
            }

            let sensors = await this.simplisafe.getSensors();
            for (let sensor of sensors) {
                switch (sensor.type) {
                    case 1: // Keypad
                    case 4: // Motion sensor
                        // Ignore as no data is provided by SimpliSafe
                        break;
                    case 5:
                        // Entry sensor

                        break;
                    default:
                        this.log(`Sensor not (yet) supported: ${sensor.name}`);
                        this.log(sensor);
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

    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SS3Platform, true);
};

export default homebridge;
