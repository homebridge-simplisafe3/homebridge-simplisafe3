const test = require('node:test');
const assert = require('node:assert/strict');

const streamingDelegatePath = require.resolve('../dist/lib/streamingDelegate');
require.cache[streamingDelegatePath] = {
    id: streamingDelegatePath,
    filename: streamingDelegatePath,
    loaded: true,
    exports: {
        __esModule: true,
        default: class StreamingDelegate {
            constructor() {
                this.controller = {};
            }
        },
    },
};

const SS3Camera = require('../dist/accessories/camera').default;

test('supportsPrivacyShutter reflects the camera feature flag', () => {
    const withShutter = SS3Camera.prototype.supportsPrivacyShutter.call({
        cameraDetails: { supportedFeatures: { privacyShutter: true } },
    });
    const withoutShutter = SS3Camera.prototype.supportsPrivacyShutter.call({
        cameraDetails: { supportedFeatures: { privacyShutter: false } },
    });

    assert.equal(withShutter, true);
    assert.equal(withoutShutter, false);
});

test('isUnsupported flags non-simplisafe recording providers', () => {
    const supported = SS3Camera.prototype.isUnsupported.call({
        cameraDetails: { supportedFeatures: { providers: { recording: 'simplisafe' } } },
    });
    const unsupported = SS3Camera.prototype.isUnsupported.call({
        cameraDetails: { supportedFeatures: { providers: { recording: 'webrtc' } } },
    });

    assert.equal(supported, false);
    assert.equal(unsupported, true);
});

test('_validateEvent accepts direct and internal camera matches', () => {
    const ctx = {
        accessory: {},
        id: 'camera-1',
        debug: false,
        log: () => {},
        name: 'Front Door',
    };

    assert.equal(
        SS3Camera.prototype._validateEvent.call(ctx, 'CAMERA_MOTION', { sensorSerial: 'camera-1' }),
        true
    );
    assert.equal(
        SS3Camera.prototype._validateEvent.call(ctx, 'CAMERA_MOTION', {
            sensorSerial: 'other-camera',
            internal: { mainCamera: 'camera-1' },
        }),
        true
    );
    assert.equal(
        SS3Camera.prototype._validateEvent.call(ctx, 'CAMERA_MOTION', { sensorSerial: 'other-camera' }),
        false
    );
});

test('_validateEvent rejects missing accessory or empty payloads', () => {
    assert.equal(
        SS3Camera.prototype._validateEvent.call({ accessory: null, id: 'camera-1', debug: false, log: () => {} }, 'CAMERA_MOTION', {
            sensorSerial: 'camera-1',
        }),
        false
    );
    assert.equal(
        SS3Camera.prototype._validateEvent.call({ accessory: {}, id: 'camera-1', debug: false, log: () => {} }, 'CAMERA_MOTION', null),
        false
    );
});

test('getState returns an error when the API is rate limited', () => {
    let callbackArgs;
    SS3Camera.prototype.getState.call(
        { simplisafe: { isBlocked: true, nextAttempt: Date.now() + 1000 } },
        (...args) => { callbackArgs = args; },
        {},
        'MotionDetected'
    );

    assert.equal(callbackArgs.length, 1);
    assert.match(callbackArgs[0].message, /rate limited/i);
});

test('getState returns the characteristic value when unblocked', () => {
    let callbackArgs;
    const service = {
        getCharacteristic: () => ({ value: true }),
    };

    SS3Camera.prototype.getState.call(
        { simplisafe: { isBlocked: false, nextAttempt: 0 } },
        (...args) => { callbackArgs = args; },
        service,
        'MotionDetected'
    );

    assert.deepEqual(callbackArgs, [null, true]);
});
