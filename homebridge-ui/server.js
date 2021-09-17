const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const SimpliSafeLoginManager = require('../common/loginManager.js');

// your class MUST extend the HomebridgePluginUiServer
class UiServer extends HomebridgePluginUiServer {
    loginManager;

    constructor () {
    // super must be called first
        super();

        this.loginManager = new SimpliSafeLoginManager();

        this.onRequest('/getCodeVerifier', this.getCodeVerifier.bind(this));
        this.onRequest('/getSSAuthURL', this.getSSAuthURL.bind(this));
        this.onRequest('/getToken', this.getToken.bind(this));
        this.onRequest('/getAuthCodeFromUrl', this.getAuthCodeFromUrl.bind(this));

        // this.ready() must be called to let the UI know you are ready to accept api calls
        this.ready();
    }

    /**
   * Get code verifier
   */
    async getCodeVerifier() {
        return { success: true, codeVerifier: this.loginManager.codeVerifier }
    }

    /**
   * Get SS auth URL
   */
    async getSSAuthURL() {
        return { success: true, url: this.loginManager.getSSAuthURL() }
    }

    /**
   * Try to extract auth code
   */
    async getAuthCodeFromUrl(payload) {
        const redirectURLStr = payload.redirectURLStr;
        let code;
        try {
          code = this.loginManager.parseCodeFromURL(redirectURLStr);
        } catch (error) {
          return { success: false, error: error }
        }
        return { success: true, authCode: code }
    }

    /**
   * Get SS auth Token
   */
    async getToken(payload) {
        const code = payload.authCode;
        const token = await this.loginManager.getToken(code);
        return { success: true, token: token }
    }
}

// start the instance of the class
(() => {
    return new UiServer;
})();
