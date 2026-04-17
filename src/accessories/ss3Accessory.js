import { AUTH_EVENTS } from '../lib/authManager';

class SimpliSafe3Accessory {
    services = [];

    constructor (name, id, log, debug, simplisafe, api) {
        this.id = id;
        this.log = log;
        this.debug = debug;
        this.name = name;
        this.simplisafe = simplisafe;
        this.api = api;
        this.uuid = this.api.hap.uuid.generate(id);
    }

    identify(callback) {
        if (this.debug) this.log(`Identify request for ${this.name}`);
        callback();
    }

    createAccessory() {
        let newAccessory = new this.api.platformAccessory(this.name, this.uuid);
        this.setupServices(newAccessory);
        this.setAccessory(newAccessory);
        return newAccessory;
    }

    setAccessory(accessory) {
        this.accessory = accessory;
        this.accessory.on('identify', (paired, callback) => this.identify(callback));
        this._wireConnectionStatusFault();
    }

    setupServices(accessory) {
        for (let service of this.services) {
            accessory.addService(service);
        }
    }

    // Reflect SimpliSafe auth / connectivity failures as a StatusFault on the primary
    // service of every accessory, so HomeKit apps can surface "device not responding"
    // instead of quietly returning stale values. Alarm overrides this with its own
    // StatusFault handling for backward compatibility.
    _wireConnectionStatusFault() {
        const StatusFault = this.api.hap.Characteristic.StatusFault;
        const service = this._primaryServiceForFault();
        if (!service || !StatusFault) return;

        // Ensure the characteristic is present; HAP adds it lazily for optional chars.
        if (!service.testCharacteristic(StatusFault)) service.addOptionalCharacteristic(StatusFault);

        const apply = (fault) => {
            if (!this.accessory) return;
            const s = this._primaryServiceForFault();
            if (!s) return;
            s.updateCharacteristic(StatusFault, fault ? StatusFault.GENERAL_FAULT : StatusFault.NO_FAULT);
        };

        if (this.simplisafe && this.simplisafe.authManager && this.simplisafe.authManager.on) {
            this.simplisafe.authManager.on(AUTH_EVENTS.REFRESH_CREDENTIALS_SUCCESS, () => apply(false));
            this.simplisafe.authManager.on(AUTH_EVENTS.REFRESH_CREDENTIALS_FAILURE, () => apply(true));
        }
    }

    // Subclasses may override to return a different service for StatusFault; default
    // uses the first pushed service type. Returns null if the accessory already handles
    // StatusFault itself (e.g. Alarm) or has no suitable service.
    _primaryServiceForFault() {
        if (!this.accessory || !this.services || this.services.length === 0) return null;
        return this.accessory.getService(this.services[0]);
    }
}

export default SimpliSafe3Accessory;
