const test = require('node:test');
const assert = require('node:assert/strict');

const StreamingDelegate = require('../dist/lib/streamingDelegate').default;

function createApiStub() {
    class CameraController {
        constructor(config) {
            this.delegate = config.delegate;
            this.streamingOptions = config.streamingOptions;
        }
    }

    return {
        hap: {
            SRTPCryptoSuites: { AES_CM_128_HMAC_SHA1_80: 'suite' },
            H264Profile: { BASELINE: 'baseline', MAIN: 'main', HIGH: 'high' },
            H264Level: { LEVEL3_1: '3.1', LEVEL3_2: '3.2', LEVEL4_0: '4.0' },
            AudioStreamingCodecType: { AAC_ELD: 'AAC_ELD' },
            AudioStreamingSamplerate: { KHZ_16: 16 },
            CameraController,
            uuid: { unparse: (value) => `uuid:${value}` },
        },
    };
}

function createCameraStub(overrides = {}) {
    return {
        simplisafe: { isBlocked: false, nextAttempt: 0 },
        log: (() => {
            const fn = () => {};
            fn.error = () => {};
            return fn;
        })(),
        api: createApiStub(),
        cameraOptions: null,
        cameraDetails: {
            uuid: 'camera-uuid',
            cameraSettings: {
                admin: { fps: 20, bitRate: 300 },
                pictureQuality: '720p',
                cameraName: 'Garage Camera',
            },
        },
        debug: false,
        name: 'Garage Camera',
        authManager: { accessToken: 'token-123' },
        isUnsupported: () => false,
        supportsPrivacyShutter: () => false,
        motionIsTriggered: false,
        ...overrides,
    };
}

test('constructor limits advertised resolutions to the configured picture quality', () => {
    const delegate = new StreamingDelegate(createCameraStub());
    const heights = delegate.controller.streamingOptions.video.resolutions.map((resolution) => resolution[1]);

    assert.ok(heights.every((height) => height <= 720));
    assert.ok(heights.includes(720));
    assert.ok(!heights.includes(1080));
});

test('prepareStream records pending session details for audio and video', () => {
    const delegate = new StreamingDelegate(createCameraStub());
    let callbackArgs;

    delegate.prepareStream({
        targetAddress: '192.168.1.5',
        sessionID: 'session-1',
        video: {
            port: 5010,
            srtp_key: Buffer.from('1234567890123456'),
            srtp_salt: Buffer.from('12345678901234'),
        },
        audio: {
            port: 5011,
            srtp_key: Buffer.from('abcdefghijklmnop'),
            srtp_salt: Buffer.from('abcdefghijklmn'),
        },
    }, (...args) => {
        callbackArgs = args;
    });

    const [, response] = callbackArgs;
    const session = delegate.pendingSessions['uuid:session-1'];

    assert.equal(response.video.port, 5010);
    assert.equal(response.audio.port, 5011);
    assert.equal(typeof response.video.ssrc, 'number');
    assert.equal(typeof response.audio.ssrc, 'number');
    assert.equal(session.address, '192.168.1.5');
    assert.equal(session.video_port, 5010);
    assert.equal(session.audio_port, 5011);
    assert.equal(session.video_srtp.length, 30);
    assert.equal(session.audio_srtp.length, 30);
});

test('handleUnsupportedCameraSnapshotRequest returns the static unsupported image', () => {
    const delegate = new StreamingDelegate(createCameraStub({
        isUnsupported: () => true,
    }));

    delegate.handleUnsupportedCameraSnapshotRequest((err, image) => {
        assert.equal(err, undefined);
        assert.ok(Buffer.isBuffer(image));
        assert.ok(image.length > 0);
    });
});

test('handlePrivacyShutterClosedSnapshotRequest returns the static privacy image', () => {
    const delegate = new StreamingDelegate(createCameraStub());

    delegate.handlePrivacyShutterClosedSnapshotRequest((err, image) => {
        assert.equal(err, undefined);
        assert.ok(Buffer.isBuffer(image));
        assert.ok(image.length > 0);
    });
});
