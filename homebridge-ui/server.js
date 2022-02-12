const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const SimpliSafe3AuthenticationManager = require('../lib/authManager');

// your class MUST extend the HomebridgePluginUiServer
class UiServer extends HomebridgePluginUiServer {
    authManager;

    constructor () {
    // super must be called first
        super();

        this.authManager = new SimpliSafe3AuthenticationManager(this.homebridgeStoragePath);

        this.onRequest('/credentialsExist', this.credentialsExist.bind(this));
        this.onRequest('/getCodeVerifier', this.getCodeVerifier.bind(this));
        this.onRequest('/getSSAuthURL', this.getSSAuthURL.bind(this));
        this.onRequest('/getAuthCodeFromUrl', this.getAuthCodeFromUrl.bind(this));
        this.onRequest('/getToken', this.getToken.bind(this));

        // this.ready() must be called to let the UI know you are ready to accept api calls
        this.ready();
    }

    /**
   * Reports whether credentials already exiist
   */
    async credentialsExist() {
        return { success: true, credentialsExist: this.authManager.accountsFileExists() }
    }

    /**
   * Get code verifier
   */
    async getCodeVerifier() {
        return { success: true, codeVerifier: this.authManager.codeVerifier }
    }

    /**
   * Get SS auth URL
   */
    async getSSAuthURL() {
        return { success: true, url: this.authManager.getSSAuthURL() }
    }

    /**
   * Try to extract auth code
   */
    async getAuthCodeFromUrl(payload) {
        const redirectURLStr = payload.redirectURLStr;
        let code;
        try {
          code = this.authManager.parseCodeFromURL(redirectURLStr);
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
          await this.authManager.getToken(code);
        } catch (error) {
            console.log(error);
            return { success: false, error: error.toString() }
        }
        return {
          success: true,
          accessToken: this.authManager.accessToken,
          refreshToken: this.authManager.refreshToken
        }
    }
}

// start the instance of the class
(() => {
    return new UiServer;
})();
