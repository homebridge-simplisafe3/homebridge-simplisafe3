const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const { SimpliSafe3AuthenticationManager } = require('../lib/authManager');
const axios = require('axios');

// your class MUST extend the HomebridgePluginUiServer
class UiServer extends HomebridgePluginUiServer {
    authManager;
    finalAuthCallbackUrl;
    authError;

    constructor () {
        // super must be called first
        super();

        this.authManager = new SimpliSafe3AuthenticationManager(this.homebridgeStoragePath);

        this.onRequest('/credentialsExist', this.credentialsExist.bind(this));
        this.onRequest('/initiateLogin', this.initiateLogin.bind(this));
        this.onRequest('/checkForAuth', this.checkForAuth.bind(this));

        // this.ready() must be called to let the UI know you are ready to accept api calls
        this.ready();
    }

    /**
   * Reports whether credentials already exiist
   */
    async credentialsExist() {
        return { success: true, credentialsExist: this.authManager.accountsFileExists() }
    }

    async checkForAuth() {
        let res = {}
        if (this.finalAuthCallbackUrl !== undefined) res.success = true;
        if (this.authError !== undefined) res.error = true;
        return res;
    }

    async initiateLogin(payload) {
        const username = payload.username;
        const password = payload.password;
        if (!username.length || !password.length) {
            return { success: false }
        }

        // reset
        this.finalAuthCallbackUrl = undefined;
        this.authError = undefined;
        
        const initialAuthUrl = this.authManager.getSSAuthURL();

        let auth0 = axios.create({
            withCredentials: true,
            responseType: 'document',
            paramsSerializer: function(params) {
                return params.join('&');
            },
            maxRedirects: 0,
            validateStatus: function(status) {
                return status >= 200 && status < 303;
            },
        });
        
        try {
            this.doLoginStep('Loading login auth url...');
            auth0.get(initialAuthUrl.url, {
                params: initialAuthUrl.params,
                headers: {
                    'Accept': 'text/html',
                    'User-Agent': 'Homebridge-Simplisafe3',
                    'Host': 'auth.simplisafe.com',
                    'Connection': 'keep-alive'
                }
            }).then(authorizeRes => {
                const cookies = authorizeRes.headers["set-cookie"];
                const loginLocation = authorizeRes.headers['location'];
                this.doLoginStep('Attempting to login with credentials...');
                auth0.post('https://auth.simplisafe.com' + loginLocation, {
                    'username': username,
                    'password': password
                },
                {
                    headers: {
                        'Cookie': cookies
                    },
                    maxRedirects: 5
                }
                ).then(awaitMfaResult => {
                    let awaitMfaUrl = awaitMfaResult.request._redirectable._currentUrl;
                    let checkMfaInterval = setInterval(async () => {
                        this.doLoginStep('Awaiting login verification (check email)...');
                        auth0.get(awaitMfaUrl, {
                            maxRedirects: 5
                        }).then(mfaCheckResult => {
                            // <form method="post" action="https://auth.simplisafe.com/continue?state=***" id="success-form">\n' +
                            // <input type="hidden" name="token" value="***" />
                            if (mfaCheckResult.data && mfaCheckResult.data.indexOf('Verification Successful') > -1) {
                                this.doLoginStep('Detected verification success...');
                                clearInterval(checkMfaInterval);
                                const continueUrlMatch = mfaCheckResult.data.match(/https:\/\/auth\.simplisafe\.com\/continue\?[^"]*/g);
                                const tokenRegExp = new RegExp(/name="token" value="([^"]*)"/, 'g');
                                const tokenMatch = tokenRegExp.exec(mfaCheckResult.data);
                                if (continueUrlMatch.length && tokenMatch.length) {
                                    this.doLoginStep('Submitting verification form for redirect...');
                                    auth0.post(continueUrlMatch[0], {
                                        token: tokenMatch[1]
                                    }, {
                                        maxRedirects: 0,
                                        headers: {
                                            'Cookie': cookies
                                        }
                                    }).then(verificationRedirectResult => {
                                        this.doLoginStep('Verification form submission successful...');
                                        const finalAuthLocation = verificationRedirectResult.headers['location'];
                                        auth0.get('https://auth.simplisafe.com' + finalAuthLocation, {
                                            maxRedirects: 0,
                                            headers: {
                                                'Cookie': cookies
                                            }
                                        }).then(finalRedirectResult => {
                                            const finalRedirectUrl = finalRedirectResult.headers['location'];
                                            this.finalAuthCallbackUrl = finalRedirectUrl;
                                            this.doLoginStep('Received final auth URL');
                                        });
                                    });
                                }
                            }
                        });
                    }, 3000)
                })
            });
            return { success: true }            
        } catch (error) {
            this.doLoginStep(`Auth error: ${error.toString()}`, true);
            this.authError = error;
        }
    }

    doLoginStep(message, isError) {
        this.pushEvent('login-step', { message: message, isError: isError });
        console.log(message);
    }
}


// start the instance of the class
(() => {
    return new UiServer;
})();
