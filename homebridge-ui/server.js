const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const SimpliSafeLoginManager = require('../common/loginManager.js');

// your class MUST extend the HomebridgePluginUiServer
class UiServer extends HomebridgePluginUiServer {
    loginManager;

    constructor () {
    // super must be called first
        super();

        this.loginManager = new SimpliSafeLoginManager(this.homebridgeStoragePath);

        this.onRequest('/getCodeVerifier', this.getCodeVerifier.bind(this));
        this.onRequest('/getSSAuthURL', this.getSSAuthURL.bind(this));
        this.onRequest('/getAuthCodeFromUrl', this.getAuthCodeFromUrl.bind(this));
        this.onRequest('/getToken', this.getToken.bind(this));

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
          return { success: false, error: error.toString() }
        }
        return { success: true, authCode: code }
    }

    /**
   * Get SS auth Token
   */
    async getToken(payload) {
        const code = payload.authCode;
        try {
          await this.loginManager.getToken(code);
        } catch (error) {
            console.log(error);
            return { success: false, error: error.toString() }
        }
        return {
          success: true,
          accessToken: this.loginManager.accessToken,
          refreshToken: this.loginManager.refreshToken
        }
    }
}

// start the instance of the class
(() => {
    return new UiServer;
})();
