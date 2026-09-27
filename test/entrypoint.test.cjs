const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const distDir = path.join(__dirname, '..', 'dist');
const distPackage = require(path.join(distDir, 'package.json'));
const configSchema = require(path.join(distDir, 'config.schema.json'));

// mirrors homebridge's plugin loader
function loadPluginInitializer() {
    const pluginModule = require(path.join(distDir, distPackage.main));
    return typeof pluginModule === 'function' ? pluginModule : pluginModule.default;
}

test('dist package main resolves to a plugin initializer function', () => {
    assert.ok(fs.existsSync(path.join(distDir, distPackage.main)));
    assert.equal(typeof loadPluginInitializer(), 'function');
});

test('plugin initializer registers the platform with homebridge', () => {
    const calls = [];
    const api = {
        hap: { uuid: { generate: () => 'uuid' } },
        registerPlatform: (...args) => calls.push(args),
    };

    loadPluginInitializer()(api);

    assert.equal(calls.length, 1);
    const [pluginName, platformName, constructor, dynamic] = calls[0];
    assert.equal(pluginName, distPackage.name);
    assert.equal(platformName, 'SimpliSafe 3');
    assert.equal(typeof constructor, 'function');
    assert.equal(dynamic, true);
});

test('config schema alias matches the registered platform', () => {
    let registered;
    loadPluginInitializer()({
        hap: { uuid: {} },
        registerPlatform: (pluginName, platformName) => {
            registered = `${pluginName}.${platformName}`;
        },
    });

    assert.equal(configSchema.pluginAlias, registered);
});

test('oclif login command is present in dist', () => {
    const commandsDir = path.join(distDir, distPackage.oclif.commands);
    const Login = require(path.join(commandsDir, 'login.js'));

    assert.equal(typeof Login, 'function');
    assert.equal(typeof Login.run, 'function');
    assert.ok(fs.existsSync(path.join(distDir, distPackage.bin[distPackage.name])));
});
