const path = require('node:path');

const simplisafeModulePath = path.join(__dirname, '..', '..', 'dist', 'simplisafe.js');
const authManagerModulePath = path.join(__dirname, '..', '..', 'dist', 'lib', 'authManager.js');
const axiosModulePath = require.resolve('axios');
const axiosRetryModulePath = require.resolve('axios-retry');

function loadSimplisafe({ requestImpl }) {
    delete require.cache[simplisafeModulePath];
    delete require.cache[authManagerModulePath];
    delete require.cache[axiosModulePath];
    delete require.cache[axiosRetryModulePath];

    const axiosStub = {
        create: () => ({
            request: requestImpl,
        }),
    };

    require.cache[axiosModulePath] = {
        id: axiosModulePath,
        filename: axiosModulePath,
        loaded: true,
        exports: Object.assign(axiosStub, { default: axiosStub }),
    };

    const axiosRetryStub = () => {};

    require.cache[axiosRetryModulePath] = {
        id: axiosRetryModulePath,
        filename: axiosRetryModulePath,
        loaded: true,
        exports: Object.assign(axiosRetryStub, { default: axiosRetryStub }),
    };

    return require(simplisafeModulePath);
}

module.exports = { loadSimplisafe };
