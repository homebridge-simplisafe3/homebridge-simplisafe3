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
        this.accessories = [];

        this.simplisafe = new SimpliSafe3();

        if (api) {
            this.api = api;
            this.api.on('didFinishLaunching', () => {

                this.log('DidFinishLaunching');

                this.simplisafe.login(config.auth.username, config.auth.password, true)
                    .then(() => {
                        this.log('Logged in!');

                        if (config.subscriptionId) {
                            this.simplisafe.setDefaultSubscription(config.subscriptionId);
                        }

                        return this.refreshAccessories();
                    })
                    .catch(err => {
                        this.log('SS3 init failed');
                        this.log(err);
                    });
            });
        }
    }

    addAccessory(accessory) {
        this.log('Add accessory');
        this.accessories.push(accessory);
        try {
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory.accessory]);
        } catch (err) {
            this.log(`An error occurred while adding accessory: ${err}`);
        }
    }

    configureAccessory(accessory) {
        this.log('Configure accessory');
        this.log(accessory);
    }

    async refreshAccessories() {
        this.log('Refreshing accessories');
        try {
            let subscription = await this.simplisafe.getSubscription();

            let uuid = UUIDGen.generate(subscription.location.system.serial);
            let alarm = this.accessories.find(acc => acc.uuid === uuid);

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

                this.addAccessory(alarmAccessory);
            }

            let sensors = await this.simplisafe.getSensors();
            for (let sensor of sensors) {
                switch (sensor.type) {
                    case 5:
                        // Entry sensor
                        
                        break;
                    default:
                        this.log(`Sensor not (yet) supported: ${sensor.name}`);
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
