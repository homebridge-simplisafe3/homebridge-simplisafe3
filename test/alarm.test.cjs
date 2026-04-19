const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');

const SS3Alarm = require('../dist/accessories/alarm').default;
const { EVENT_TYPES, SENSOR_TYPES } = require('../dist/simplisafe');
const { AUTH_EVENTS } = require('../dist/lib/authManager');

function createLogger() {
    const fn = () => {};
    fn.error = () => {};
    fn.warn = () => {};
    return fn;
}

function createApiStub() {
    const Characteristic = {
        SecuritySystemCurrentState: {
            DISARMED: 0,
            STAY_ARM: 1,
            AWAY_ARM: 2,
            ALARM_TRIGGERED: 3,
        },
        SecuritySystemTargetState: {
            DISARM: 10,
            STAY_ARM: 11,
            AWAY_ARM: 12,
        },
        StatusTampered: {
            TAMPERED: 20,
            NOT_TAMPERED: 21,
        },
        StatusFault: {
            GENERAL_FAULT: 30,
            NO_FAULT: 31,
        },
    };

    return {
        hap: {
            Service: {
                SecuritySystem: 'SecuritySystem',
                AccessoryInformation: 'AccessoryInformation',
            },
            Characteristic,
            uuid: {
                generate: (id) => `uuid:${id}`,
            },
        },
    };
}

function createSimplisafeStub(overrides = {}) {
    const simplisafe = new EventEmitter();
    simplisafe.subscribeToAlarmSystem = () => {};
    simplisafe.authManager = new EventEmitter();
    simplisafe.getAlarmSystem = async () => ({ alarmState: 'OFF', isAlarming: false });
    simplisafe.setAlarmState = async () => ({ state: 'OFF' });
    simplisafe.isBlocked = false;
    simplisafe.nextAttempt = 0;
    return Object.assign(simplisafe, overrides);
}

function createServiceSpy(api) {
    const values = new Map();
    const updates = [];
    return {
        updates,
        getCharacteristic(characteristic) {
            return {
                value: values.get(characteristic),
            };
        },
        updateCharacteristic(characteristic, value) {
            values.set(characteristic, value);
            updates.push([characteristic, value]);
        },
    };
}

test('_validateEvent accepts only valid alarm-originating sensor types', () => {
    const api = createApiStub();
    const alarm = new SS3Alarm('Alarm', 'alarm-1', createLogger(), false, createSimplisafeStub(), api);
    alarm.service = {};

    assert.equal(alarm._validateEvent(EVENT_TYPES.ALARM_TRIGGER, {}), true);
    assert.equal(alarm._validateEvent(EVENT_TYPES.ALARM_OFF, { sensorType: SENSOR_TYPES.APP }), true);
    assert.equal(alarm._validateEvent(EVENT_TYPES.AWAY_ARM, { sensorType: SENSOR_TYPES.KEYPAD }), true);
    assert.equal(alarm._validateEvent(EVENT_TYPES.AWAY_ARM, { sensorType: SENSOR_TYPES.MOTION_SENSOR }), false);
});

test('getAlarmState retries once on an unknown alarm state before succeeding', async () => {
    const api = createApiStub();
    let calls = 0;
    const alarm = new SS3Alarm('Alarm', 'alarm-1', createLogger(), false, createSimplisafeStub(), api);
    alarm.service = { updateCharacteristic: () => {} };
    alarm.setFault = () => {};
    alarm.simplisafe.getAlarmSystem = async (forceRefresh) => {
        calls++;
        if (!forceRefresh) return { alarmState: 'MYSTERY', isAlarming: false };
        return { alarmState: 'HOME', isAlarming: false };
    };

    const state = await alarm.getAlarmState();

    assert.equal(state, 'HOME');
    assert.equal(calls, 2);
});

test('refreshState updates current and target characteristics from the alarm state', async () => {
    const api = createApiStub();
    const alarm = new SS3Alarm('Alarm', 'alarm-1', createLogger(), false, createSimplisafeStub(), api);
    const service = createServiceSpy(api);
    alarm.service = service;
    alarm.getAlarmState = async () => 'AWAY';

    await alarm.refreshState();

    assert.deepEqual(service.updates, [
        [api.hap.Characteristic.SecuritySystemCurrentState, api.hap.Characteristic.SecuritySystemCurrentState.AWAY_ARM],
        [api.hap.Characteristic.SecuritySystemTargetState, api.hap.Characteristic.SecuritySystemTargetState.AWAY_ARM],
        [api.hap.Characteristic.StatusFault, api.hap.Characteristic.StatusFault.NO_FAULT],
    ]);
});

test('constructor wires auth refresh events to fault state changes', () => {
    const api = createApiStub();
    const simplisafe = createSimplisafeStub();
    const alarm = new SS3Alarm('Alarm', 'alarm-1', createLogger(), false, simplisafe, api);
    const calls = [];
    alarm.service = {};
    alarm.setFault = (fault = true) => {
        calls.push(fault);
    };

    simplisafe.authManager.emit(AUTH_EVENTS.REFRESH_CREDENTIALS_SUCCESS);
    simplisafe.authManager.emit(AUTH_EVENTS.REFRESH_CREDENTIALS_FAILURE);

    assert.deepEqual(calls, [false, true]);
});
