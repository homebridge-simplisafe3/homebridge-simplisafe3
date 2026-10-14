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
        getStreamProvider: () => 'legacy',
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

test('constructor offers square resolutions for 1:1 cameras', () => {
    const square = new StreamingDelegate(createCameraStub({
        cameraDetails: {
            uuid: 'camera-uuid',
            supportedFeatures: { aspectRatio: '1:1' },
            cameraSettings: { admin: { fps: 20, bitRate: 300 }, pictureQuality: '1536p', cameraName: 'Front Door' },
        },
    }));
    const wide = new StreamingDelegate(createCameraStub());

    const isSquare = (r) => r[0] === r[1];
    assert.ok(square.controller.streamingOptions.video.resolutions.some(isSquare));
    assert.ok(!wide.controller.streamingOptions.video.resolutions.some(isSquare));
});

test('livekit snapshot request serves a cached frame while it is fresh', async () => {
    const delegate = new StreamingDelegate(createCameraStub({ getStreamProvider: () => 'livekit' }));
    const cached = Buffer.from('jpeg-bytes');
    delegate.cachedSnapshot = cached;
    delegate.cachedSnapshotExpires = Date.now() + 60000;

    const args = await new Promise((resolve) => {
        delegate.handleSnapshotRequest({ width: 1280, height: 720 }, (...a) => resolve(a));
    });

    assert.equal(args[0], undefined);
    assert.equal(args[1], cached);
});

test('stopLiveKitStream is a no-op for an unknown session', () => {
    const delegate = new StreamingDelegate(createCameraStub({ getStreamProvider: () => 'livekit' }));
    assert.doesNotThrow(() => delegate.stopLiveKitStream('uuid:missing'));
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

test('handleStreamRequest acknowledges a reconfigure request', async () => {
    const delegate = new StreamingDelegate(createCameraStub({ getStreamProvider: () => 'livekit' }));

    const args = await new Promise((resolve) => {
        delegate.handleStreamRequest({ type: 'reconfigure', sessionID: 'session-9' }, (...a) => resolve(a));
    });

    assert.equal(args[0], undefined);
});

test('livekit snapshot prefers a stale cache over joining the room twice', async () => {
    const delegate = new StreamingDelegate(createCameraStub({ getStreamProvider: () => 'livekit' }));
    const stale = Buffer.from('stale-jpeg');
    delegate.cachedSnapshot = stale;
    delegate.cachedSnapshotExpires = Date.now() - 1000;   // expired
    delegate.liveKitSessions['uuid:active'] = {};          // a stream is running

    const args = await new Promise((resolve) => {
        delegate.handleSnapshotRequest({ width: 1280, height: 720 }, (...a) => resolve(a));
    });

    assert.equal(args[0], undefined);
    assert.equal(args[1], stale);
    assert.equal(delegate.snapshotWarming, null);          // no second room was opened
});

test('startLiveKitStream reports setup failures instead of leaving HAP hanging', () => {
    const delegate = new StreamingDelegate(createCameraStub({ getStreamProvider: () => 'livekit' }));
    let closed = false;
    const sessionInfo = {
        address: '192.168.1.5',
        video_port: 5010,
        video_srtp: undefined,                             // makes createSrtpSession throw
        liveKitSource: { close: () => { closed = true; } },
        liveKitReady: Promise.resolve(),
    };

    let callbackArgs;
    delegate.startLiveKitStream({ sessionID: 'x', audio: {} }, 'uuid:x', sessionInfo, (...a) => { callbackArgs = a; });

    assert.ok(callbackArgs, 'callback must always be called');
    assert.ok(callbackArgs[0] instanceof Error);
    assert.equal(closed, true, 'the pre-warmed source must be closed');
});

function cameraEvent(cameraId) {
    return {
        video: {
            [cameraId]: {
                timestamp: 1792008324,
                _links: {
                    'snapshot/jpg': {
                        href: `https://remix.example/v1/snapshot/${cameraId}/1725425/time/1792008313?account=1&region=us-west-2{&width}`,
                        templated: true,
                    },
                },
            },
        },
    };
}

function eventCameraStub(overrides = {}) {
    return createCameraStub({
        id: 'cam-1',
        getStreamProvider: () => 'livekit',
        authManager: { tokenType: 'Bearer', accessToken: 'token-123' },
        ...overrides,
    });
}

test('eventSnapshotUrl points the recording snapshot at the moment of the event', () => {
    const delegate = new StreamingDelegate(eventCameraStub());

    assert.equal(
        delegate.eventSnapshotUrl(cameraEvent('cam-1')),
        'https://remix.example/v1/snapshot/cam-1/1725425/time/1792008324?account=1&region=us-west-2&width=1280'
    );
    assert.equal(delegate.eventSnapshotUrl(cameraEvent('other-cam')), null);
    assert.equal(delegate.eventSnapshotUrl({}), null);
    assert.equal(delegate.eventSnapshotUrl(undefined), null);
});

test('refreshSnapshotFromEvent ignores non livekit cameras', (t) => {
    const delegate = new StreamingDelegate(eventCameraStub({ getStreamProvider: () => 'legacy' }));
    const fetchMock = t.mock.method(global, 'fetch', async () => ({ ok: false, status: 404 }));

    delegate.refreshSnapshotFromEvent(cameraEvent('cam-1'));

    assert.equal(delegate.eventSnapshot, null);
    assert.equal(fetchMock.mock.callCount(), 0);
});

test('fetchEventSnapshot polls past 404s until the recording has the frame', async (t) => {
    const delegate = new StreamingDelegate(eventCameraStub());
    const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
    const responses = [
        { ok: false, status: 404 },
        { ok: true, status: 200, arrayBuffer: async () => jpeg },
    ];
    let authHeader;
    t.mock.method(global, 'fetch', async (url, options) => {
        authHeader = options.headers.Authorization;
        return responses.shift();
    });
    t.mock.method(global, 'setTimeout', (fn) => { fn(); return 0; });

    const result = await delegate.fetchEventSnapshot('https://remix.example/snap');

    assert.deepEqual(result, jpeg);
    assert.deepEqual(delegate.cachedSnapshot, jpeg);
    assert.ok(delegate.cachedSnapshotExpires > Date.now());
    assert.equal(authHeader, 'Bearer token-123');
});

test('fetchEventSnapshot gives up on errors other than 404', async (t) => {
    const delegate = new StreamingDelegate(eventCameraStub());
    t.mock.method(global, 'fetch', async () => ({ ok: false, status: 401 }));

    await assert.rejects(delegate.fetchEventSnapshot('https://remix.example/snap'), /HTTP 401/);
});

test('livekit snapshot waits for an in flight event snapshot over the stale cache', async () => {
    const delegate = new StreamingDelegate(eventCameraStub());
    const fresh = Buffer.from('fresh-jpeg');
    delegate.cachedSnapshot = Buffer.from('stale-jpeg');
    delegate.cachedSnapshotExpires = Date.now() + 60000;
    delegate.eventSnapshot = new Promise((resolve) => setTimeout(() => resolve(fresh), 10));

    const args = await new Promise((resolve) => {
        delegate.handleSnapshotRequest({ width: 1280, height: 720 }, (...a) => resolve(a));
    });

    assert.equal(args[1], fresh);
});

test('livekit snapshot falls back to the cache when the event snapshot fails', async () => {
    const delegate = new StreamingDelegate(eventCameraStub());
    const cached = Buffer.from('cached-jpeg');
    delegate.cachedSnapshot = cached;
    delegate.cachedSnapshotExpires = Date.now() + 60000;
    delegate.eventSnapshot = Promise.resolve(null);

    const args = await new Promise((resolve) => {
        delegate.handleSnapshotRequest({ width: 1280, height: 720 }, (...a) => resolve(a));
    });

    assert.equal(args[0], undefined);
    assert.equal(args[1], cached);
});
