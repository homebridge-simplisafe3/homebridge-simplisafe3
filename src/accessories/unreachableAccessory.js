class SS3UnreachableAccessory {

    // This is a dummy accessory used to let Homebridge know that the real
    // accessory is not reachable (due to rate limiting)

    constructor(accessory, api) {
        this.api = api;
        this.setAccessory(accessory);
    }

    identify(callback) {
        let err = new Error('Identify not supported');
        callback(err);
    }

    setAccessory(accessory) {
        this.accessory = accessory;
        this.accessory.on('identify', (paired, callback) => this.identify(callback));

        for (let service of accessory.services) {
            if (service.UUID == this.api.hap.Service.AccessoryInformation.UUID) {
                // Don't mess with the accessory information
                continue;
            }

            for (let characteristic of service.characteristics) {
                if (characteristic.props.perms.indexOf('pr') > -1) {
                    characteristic.onGet(() => this.unreachable());
                }

                if (characteristic.props.perms.indexOf('pw') > -1) {
                    characteristic.onSet(() => this.unreachable());
                }
            }
        }
    }

    clearAccessory() {
        for (let service of this.accessory.services) {
            if (service.UUID == this.api.hap.Service.AccessoryInformation.UUID) {
                // Don't mess with the accessory information
                continue;
            }

            for (let characteristic of service.characteristics) {
                if (characteristic.props.perms.indexOf('pr') > -1) {
                    if (typeof characteristic.removeOnGet === 'function') characteristic.removeOnGet();
                    else characteristic.removeAllListeners('get');
                }

                if (characteristic.props.perms.indexOf('pw') > -1) {
                    if (typeof characteristic.removeOnSet === 'function') characteristic.removeOnSet();
                    else characteristic.removeAllListeners('set');
                }
            }
        }
    }

    updateReachability() {
        return false;
    }

    unreachable() {
        throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

}

export default SS3UnreachableAccessory;
