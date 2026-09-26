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

const withProvider = (webRTCProvider) => ({
    cameraDetails: { cameraSettings: { admin: webRTCProvider === undefined ? {} : { webRTCProvider } } },
    getStreamProvider: SS3Camera.prototype.getStreamProvider,
    getWebRTCProvider: SS3Camera.prototype.getWebRTCProvider,
});

test('getStreamProvider maps webRTCProvider to a streaming path', () => {
    // SimpliCam / Video Doorbell Pro
    assert.equal(SS3Camera.prototype.getStreamProvider.call(withProvider('simplisafe')), 'legacy');
    // Video Doorbell Series 2 ('mockingbird')
    assert.equal(SS3Camera.prototype.getStreamProvider.call(withProvider('mist')), 'livekit');
    // Something we have not seen
    assert.equal(SS3Camera.prototype.getStreamProvider.call(withProvider('kvs')), 'none');
    // Older payloads with no provider fall back to the legacy path
    assert.equal(SS3Camera.prototype.getStreamProvider.call(withProvider(undefined)), 'legacy');
    assert.equal(SS3Camera.prototype.getStreamProvider.call({
        cameraDetails: {}, getWebRTCProvider: SS3Camera.prototype.getWebRTCProvider,
    }), 'legacy');
});

test('isUnsupported only flags providers we cannot stream', () => {
    assert.equal(SS3Camera.prototype.isUnsupported.call(withProvider('simplisafe')), false);
    assert.equal(SS3Camera.prototype.isUnsupported.call(withProvider('mist')), false);
    assert.equal(SS3Camera.prototype.isUnsupported.call(withProvider('kvs')), true);
});

test('isDoorbell uses the feature flag rather than the model string', () => {
    const isDoorbell = (supportedFeatures) => SS3Camera.prototype.isDoorbell.call({ cameraDetails: { supportedFeatures } });

    assert.equal(isDoorbell({ doorbell: true }), true);
    assert.equal(isDoorbell({ doorbell: false }), false);
    assert.equal(isDoorbell({}), false);
    assert.equal(SS3Camera.prototype.isDoorbell.call({ cameraDetails: {} }), false);
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

test('getWebRTCProvider surfaces the raw value so unsupported cameras can be reported', () => {
    assert.equal(SS3Camera.prototype.getWebRTCProvider.call(withProvider('kvs')), 'kvs');
    assert.equal(SS3Camera.prototype.getWebRTCProvider.call({ cameraDetails: {} }), undefined);
});
