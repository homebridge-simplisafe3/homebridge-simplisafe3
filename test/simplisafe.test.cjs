const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');

const { loadSimplisafe } = require('./helpers/load-simplisafe.cjs');

class FakeAuthManager extends EventEmitter {
    constructor({
        authenticated = true,
        tokenType = 'Bearer',
        accessToken = 'token-123',
        refreshImpl = async () => {},
    } = {}) {
        super();
        this._authenticated = authenticated;
        this.tokenType = tokenType;
        this.accessToken = accessToken;
        this.refreshImpl = refreshImpl;
    }

    isAuthenticated() {
        return this._authenticated;
    }

    async refreshCredentials() {
        await this.refreshImpl();
        this._authenticated = true;
    }
}

function createLogger() {
    const fn = () => {};
    fn.error = () => {};
    return fn;
}

test('request short-circuits with RateLimitError while blocked', async () => {
    const { default: SimpliSafe3, RateLimitError } = loadSimplisafe({
        requestImpl: async () => {
            throw new Error('should not be called');
        },
    });
    const ss = new SimpliSafe3(15000, new FakeAuthManager(), '/tmp', createLogger(), false);
    ss.isBlocked = true;
    ss.nextAttempt = Date.now() + 1000;

    await assert.rejects(
        ss.request({ method: 'GET', url: '/subscriptions' }),
        (err) => err instanceof RateLimitError && /rate limited/i.test(err.message)
    );
});

test('request refreshes credentials and forwards Authorization header', async () => {
    let capturedParams;
    const { default: SimpliSafe3 } = loadSimplisafe({
        requestImpl: async (params) => {
            capturedParams = params;
            return { data: { ok: true } };
        },
    });
    const authManager = new FakeAuthManager({
        authenticated: false,
        tokenType: 'Bearer',
        accessToken: 'refreshed-token',
    });
    const ss = new SimpliSafe3(15000, authManager, '/tmp', createLogger(), false);

    const result = await ss.request({ method: 'GET', url: '/foo', headers: { 'X-Test': 'yes' } });

    assert.deepEqual(result, { ok: true });
    assert.equal(capturedParams.headers.Authorization, 'Bearer refreshed-token');
    assert.equal(capturedParams.headers['X-Test'], 'yes');
});

test('request converts 403 responses into RateLimitError and updates block state', async () => {
    const { default: SimpliSafe3, RateLimitError } = loadSimplisafe({
        requestImpl: async () => {
            const err = new Error('forbidden');
            err.response = { status: 403, statusText: 'Forbidden', data: { message: 'blocked' } };
            throw err;
        },
    });
    const ss = new SimpliSafe3(15000, new FakeAuthManager(), '/tmp', createLogger(), true);

    await assert.rejects(
        ss.request({ method: 'GET', url: '/foo' }),
        (err) => err instanceof RateLimitError
    );
    assert.equal(ss.isBlocked, true);
    assert.ok(ss.nextAttempt > Date.now());
});

test('getSubscriptions filters unsupported plans and respects account selection', async () => {
    const { default: SimpliSafe3 } = loadSimplisafe({
        requestImpl: async () => ({ data: {} }),
    });
    const ss = new SimpliSafe3(15000, new FakeAuthManager(), '/tmp', createLogger(), false);
    ss.accountNumber = 'acct-2';
    ss.getUserId = async () => 'user-1';
    ss.request = async () => ({
        subscriptions: [
            { sid: 'ignore-status', sStatus: 5, location: { account: 'acct-2' }, activated: 1 },
            { sid: 'wrong-account', sStatus: 10, location: { account: 'acct-1' }, activated: 1 },
            { sid: 'keep-me', sStatus: 20, location: { account: 'acct-2' }, activated: 1 },
        ],
    });

    const subscriptions = await ss.getSubscriptions();

    assert.equal(subscriptions.length, 1);
    assert.equal(subscriptions[0].sid, 'keep-me');
    assert.equal(ss.subId, 'keep-me');
});
