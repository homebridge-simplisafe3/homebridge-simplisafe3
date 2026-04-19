const path = require('node:path');

const authManagerModulePath = path.join(__dirname, '..', '..', 'dist', 'lib', 'authManager.js');
const axiosModulePath = require.resolve('axios');
const axiosRetryModulePath = require.resolve('axios-retry');

function loadAuthManager({ postImpl = async () => ({ data: {} }) } = {}) {
    delete require.cache[authManagerModulePath];
    delete require.cache[axiosModulePath];
    delete require.cache[axiosRetryModulePath];

    const oauthClient = {
        post: postImpl,
    };

    const axiosStub = {
        create: () => oauthClient,
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

    return require(authManagerModulePath);
}

module.exports = { loadAuthManager };
