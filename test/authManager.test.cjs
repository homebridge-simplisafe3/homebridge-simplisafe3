const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadAuthManager } = require('./helpers/load-auth-manager.cjs');

function createTempStorage() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ss3-auth-'));
}

function createLogger() {
    const fn = () => {};
    fn.error = () => {};
    return fn;
}

test('getSSAuthURL embeds expected OAuth parameters', () => {
    const { default: AuthManager } = loadAuthManager();
    const manager = new AuthManager(createTempStorage(), createLogger(), false);

    const authUrl = manager.getSSAuthURL();

    assert.match(authUrl, /^https:\/\/auth\.simplisafe\.com\/authorize\?/);
    assert.match(authUrl, /client_id=42aBZ5lYrVW12jfOuu3CQROitwxg9sN5/);
    assert.match(authUrl, /code_challenge=/);
    assert.match(authUrl, /redirect_uri=com\.simplisafe\.mobile/);
});

test('parseCodeFromURL extracts the authorization code and rejects invalid input', () => {
    const { default: AuthManager } = loadAuthManager();
    const manager = new AuthManager(createTempStorage(), createLogger(), false);

    assert.equal(
        manager.parseCodeFromURL('com.simplisafe.mobile://callback?code=abc123&state=ok'),
        'abc123'
    );
    assert.throws(() => manager.parseCodeFromURL('not-a-url'), /Invalid redirect URL/);
    assert.throws(() => manager.parseCodeFromURL('https://example.com/no-code'), /Invalid redirect URL/);
});

test('refreshCredentials stores new tokens and emits success', async () => {
    const { default: AuthManager, AUTH_EVENTS } = loadAuthManager({
        postImpl: async () => ({
            data: {
                access_token: 'new-access',
                refresh_token: 'new-refresh',
                expires_in: '3600',
                token_type: 'Bearer',
            },
        }),
    });
    const manager = new AuthManager(createTempStorage(), createLogger(), false);
    manager.refreshToken = 'old-refresh';

    let emitted = false;
    manager.on(AUTH_EVENTS.REFRESH_CREDENTIALS_SUCCESS, () => {
        emitted = true;
    });

    await manager.refreshCredentials();

    assert.equal(manager.accessToken, 'new-access');
    assert.equal(manager.refreshToken, 'new-refresh');
    assert.equal(manager.tokenType, 'Bearer');
    assert.equal(emitted, true);
    clearInterval(manager.refreshInterval);
});

test('refreshCredentials clears tokens and emits failure on 4xx auth errors', async () => {
    const { default: AuthManager, AUTH_EVENTS } = loadAuthManager({
        postImpl: async () => {
            const err = new Error('unauthorized');
            err.response = { status: 401, data: 'Unauthorized' };
            throw err;
        },
    });
    const manager = new AuthManager(createTempStorage(), createLogger(), false);
    manager.refreshToken = 'refresh-me';
    manager.accessToken = 'access-me';

    let emitted = false;
    manager.on(AUTH_EVENTS.REFRESH_CREDENTIALS_FAILURE, () => {
        emitted = true;
    });

    await assert.rejects(manager.refreshCredentials(), /unauthorized/i);
    assert.equal(manager.refreshToken, null);
    assert.equal(manager.accessToken, null);
    assert.equal(emitted, true);
});
