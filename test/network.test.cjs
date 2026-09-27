const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');

const { localIPv4Address } = require('../dist/lib/network');

function withInterfaces(interfaces, fn) {
    const original = os.networkInterfaces;
    os.networkInterfaces = () => interfaces;
    try {
        return fn();
    } finally {
        os.networkInterfaces = original;
    }
}

const v4 = (address, extra = {}) => ({ address, family: 'IPv4', internal: false, ...extra });
const v6 = (address) => ({ address, family: 'IPv6', internal: false });

test('returns the first non-loopback IPv4 address in interface order', () => {
    const address = withInterfaces({
        lo0: [v4('127.0.0.1', { internal: true }), v6('::1')],
        en0: [v6('fe80::1c2b'), v4('192.168.1.20'), v4('192.168.1.21')],
        en1: [v4('10.0.0.5')],
    }, localIPv4Address);

    assert.equal(address, '192.168.1.20');
});

test('skips 127.x addresses on non-loopback interfaces', () => {
    const address = withInterfaces({
        docker0: [v4('127.0.1.1')],
        eth0: [v4('172.17.0.2')],
    }, localIPv4Address);

    assert.equal(address, '172.17.0.2');
});

test('accepts numeric family values from older Node releases', () => {
    const address = withInterfaces({
        eth0: [{ address: '10.1.2.3', family: 4, internal: false }],
    }, localIPv4Address);

    assert.equal(address, '10.1.2.3');
});

test('falls back to IPv4 loopback when no IPv4 address is available', () => {
    const address = withInterfaces({
        lo: [v4('127.0.0.1', { internal: true })],
        eth0: [v6('2001:db8::1')],
    }, localIPv4Address);

    assert.equal(address, '127.0.0.1');
});
