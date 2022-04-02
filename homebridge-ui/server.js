const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const { SimpliSafe3AuthenticationManager, AUTH_EVENTS, N_LOGIN_STEPS } = require('../lib/authManager');

// your class MUST extend the HomebridgePluginUiServer
class UiServer extends HomebridgePluginUiServer {
    authManager;

    constructor () {
        // super must be called first
        super();

        this.authManager = new SimpliSafe3AuthenticationManager(this.homebridgeStoragePath);
        this.authManager.on(AUTH_EVENTS.LOGIN_STEP, (message, isError) => {
            this.pushEvent('login-step', { message: message, isError: isError });
            console.log(message);
        });

        this.authManager.on(AUTH_EVENTS.LOGIN_COMPLETE, () => {
            this.pushEvent('login-complete');
            console.log('Authentication completed successfully');
        });

        this.authManager.on(AUTH_EVENTS.LOGIN_STEP_SMS_REQUEST, (message) => {
            this.pushEvent('login-step-sms-request', { message: message });
            console.log(message);
        });

        this.onRequest('/credentialsExist', this.credentialsExist.bind(this));
        this.onRequest('/nLoginSteps', this.nLoginSteps.bind(this));
        this.onRequest('/loginAndAuth', this.loginAndAuth.bind(this));
        this.onRequest('/sendSmsCode', this.sendSmsCode.bind(this));

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
     * Reports the number of login steps
     */
    async nLoginSteps() {
      return { steps: N_LOGIN_STEPS }
    }
    
    /**
     * Starts login process from authManager
     */
    async loginAndAuth(payload) {
        const username = payload.username;
        const password = payload.password;
        if (!username.length || !password.length) {
            return { success: false }
        }
        const loggedInAuthorized = await this.authManager.loginAndAuthorize(username, password);
        return { success: loggedInAuthorized }
    }

    async sendSmsCode(payload) {
        const code = payload.code;
        this.authManager.smsCode = code;
        return true;
    }
}

// start the instance of the class
(() => {
    return new UiServer;
})();
