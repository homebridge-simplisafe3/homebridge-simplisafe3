// © 2021 Michael Shamoon
// SimpliSafe 3 Authentication Manager

const crypto = require('crypto');
const axios = require('axios');
const axiosRetry = require('axios-retry');
const fs = require('fs');
const path = require('path');
const events = require('events');

export const AUTH_EVENTS = {
    REFRESH_CREDENTIALS_SUCCESS: 'REFRESH_CREDENTIALS_SUCCESS',
    REFRESH_CREDENTIALS_FAILURE: 'REFRESH_CREDENTIALS_FAILURE',
    LOGIN_STEP: 'LOGIN_STEP',
    LOGIN_STEP_SMS_REQUEST: 'LOGIN_STEP_SMS_REQUEST',
    LOGIN_COMPLETE: 'LOGIN_COMPLETE',
};

export const N_LOGIN_STEPS = 9;

const ssOAuth = axios.create({
    baseURL: 'https://auth.simplisafe.com/oauth'
});
axiosRetry(ssOAuth, { retries: 3 });

const SS_OAUTH_AUTH_URL = 'https://auth.simplisafe.com';
const SS_OAUTH_CLIENT_ID = '42aBZ5lYrVW12jfOuu3CQROitwxg9sN5';
const SS_OAUTH_AUTH0_CLIENT = 'eyJuYW1lIjoiQXV0aDAuc3dpZnQiLCJlbnYiOnsiaU9TIjoiMTUuMCIsInN3aWZ0IjoiNS54In0sInZlcnNpb24iOiIxLjMzLjAifQ';
const SS_OAUTH_REDIRECT_URI = 'com.simplisafe.mobile://auth.simplisafe.com/ios/com.simplisafe.mobile/callback';
const SS_OAUTH_SCOPE = 'offline_access%20email%20openid%20https://api.simplisafe.com/scopes/user:platform';
const SS_OAUTH_AUDIENCE = 'https://api.simplisafe.com/';

const accountsFilename = 'simplisafe3auth.json';

class SimpliSafe3AuthenticationManager extends events.EventEmitter {
    storagePath;
    accessToken;
    refreshToken;
    tokenType = 'Bearer';
    codeVerifier;
    codeChallenge;
    expiry;
    refreshInterval;
    log;
    debug;

    smsCode;

    constructor(storagePath, log, debug) {
        super();
        this.storagePath = storagePath;
        this.log = log || console.log;
        this.debug = debug || false;

        this.parseAccountsFile();

        if (!this.codeVerifier) this.codeVerifier = this.base64URLEncode(crypto.randomBytes(32));
        this.codeChallenge = this.base64URLEncode(this.sha256(this.codeVerifier));
    }

    _storagePathExists() {
        return fs.existsSync(this.storagePath);
    }

    accountsFileExists() {
        if (!this._storagePathExists()) return false;
        const accountsFile = path.join(this.storagePath, accountsFilename);
        return fs.existsSync(accountsFile);
    }

    parseAccountsFile() {
        if (this.accountsFileExists()) {
            let fileContents;

            try {
                fileContents = (fs.readFileSync(path.join(this.storagePath, accountsFilename))).toString();
            } catch {
                fileContents = '{}';
            }

            const account = JSON.parse(fileContents);

            if (account.accessToken !== undefined) {
                this.accessToken = account.accessToken;
                this.refreshToken = account.refreshToken;
                this.codeVerifier = account.codeVerifier;
            }
        } else if (!this._storagePathExists()) {
            throw new Error(`Supplied path ${this.storagePath} does not exist`);
        }
    }

    _writeAccountsFile(account) {
        try {
            fs.writeFileSync(
                path.join(this.storagePath, accountsFilename),
                JSON.stringify(account)
            );
            return true;
        } catch (err) {
            if (this.log !== undefined) this.log.error('Unable to write accounts file.', err);
            return false;
        }
    }

    isAuthenticated() {
        return this.refreshToken !== null && Date.now() < this.expiry;
    }

    base64URLEncode(str) {
        return str.toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    sha256(buffer) {
        return crypto.createHash('sha256').update(buffer).digest();
    }

    async getToken(authorizationCode) {
        try {
            const tokenResponse = await ssOAuth.post('/token', {
                grant_type: 'authorization_code',
                client_id: SS_OAUTH_CLIENT_ID,
                code_verifier: this.codeVerifier,
                code: authorizationCode,
                redirect_uri: SS_OAUTH_REDIRECT_URI,
            });

            await this._storeToken(tokenResponse.data);
            return this.accessToken;
        } catch (err) {
            throw new Error('Error getting token: ' + err.toString());
        }
    }

    async refreshCredentials() {
        if (!this.accountsFileExists() && this.refreshToken == undefined) {
            throw new Error('No authentication credentials detected.');
        }

        try {
            const refreshTokenResponse = await ssOAuth.post('/token', {
                grant_type: 'refresh_token',
                client_id: SS_OAUTH_CLIENT_ID,
                refresh_token: this.refreshToken
            }, {
                headers: { // SS seems to need these...
                    'Host': 'auth.simplisafe.com',
                    'Content-Type': 'application/json',
                    'Auth0-Client': SS_OAUTH_AUTH0_CLIENT
                }
            });

            await this._storeToken(refreshTokenResponse.data);
            this.emit(AUTH_EVENTS.REFRESH_CREDENTIALS_SUCCESS);
            if (this.log !== undefined && this.debug) this.log('SimpliSafe credentials refresh was successful');
        } catch (err) {
            if (this.log !== undefined && this.debug) this.log('SimpliSafe credentials refresh failed');
            if (err.response && (err.response.status == 401 || err.response.data == 'Unauthorized')) {
                // this is a true auth failure
                this.refreshToken = null;
                this.emit(AUTH_EVENTS.REFRESH_CREDENTIALS_FAILURE);
            }
            throw err; // just pass it along
        }
    }

    async _storeToken(token) {
        this.accessToken = token.access_token;
        this.refreshToken = token.refresh_token;
        this.expiry = Date.now() + (parseInt(token.expires_in) * 1000);
        this.tokenType = token.token_type;

        const account = {
            accessToken: this.accessToken,
            codeVerifier: this.codeVerifier,
            refreshToken: this.refreshToken
        };
        const fileWritten = await this._writeAccountsFile(account);
        if (!fileWritten) {
            if (this.log !== undefined) this.log.error('Unable to store token.');
            return;
        }

        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        this.refreshInterval = setInterval(() => {
            if (this.log !== undefined && this.debug) this.log('Preemptively authenticating with SimpliSafe');
            this.refreshCredentials()
                .catch(err => {
                    if (this.log !== undefined) this.log.error(err.toJSON ? err.toJSON() : err);
                    if (err.response && (err.response.status == 403 || err.response.data == 'Unauthorized')) {
                        clearInterval(this.refreshInterval); // just disable until next successful one
                    }
                });
        }, parseInt(token.expires_in) * 1000 - 300000);
    }

    /**
     * This method handles logging into SimpliSafe via the auth0 web flow. The flow is:
     * 1. Visit initial auth URL e.g. https://auth.simplisafe.com/authorize?client_id=SS_OAUTH_CLIENT_ID&scope=SS_OAUTH_SCOPE&response_type=code&response_mode=query&redirect_uri=SS_OAUTH_REDIRECT_URI&code_challenge_method=S256&code_challenge=${this.codeChallenge}&audience=SS_OAUTH_AUDIENCE&auth0Client=SS_OAUTH_AUTH0_CLIENT
     *      Generating this URL requires codeVerifier and codeChallenge, see above
     * 2. Obtain cookies from step 1 from headers "set-cookie"
     * 3. Now we can try to login, with cookies with POST (allow redirects here for next step) to e.g. https://auth.simplisafe.com/u/login?state=STATE
     * 4. If the user has email verification chosen, flow is redirected to the page awaiting login verification, note the different host e.g. https://tsv.prd.platform.simplisafe.com/v1/tsv/check?token=TOKEN (not the same token as at the end)
     *      This web page periodically re-submits a form which presumably checks with auth0 whether login was verified. To simulate this we POST the form every 3 seconds. The form action URL and required token parameter need to be scraped from the page, e.g.:
    *       <form method="post" action="https://auth.simplisafe.com/continue?state=STATE" id="success-form">...
    *       <input type="hidden" name="token" value="TOKEN" />
    *       This form data is sent as POST to the form action URL
     * 5. Alternatively, if they are using SMS verification the URL is of the format /u/mfa-sms-challenge
     *      The user needs to supply their SMS code
     * 6. After the login was verified, we are redirected to https://tsv.prd.platform.simplisafe.com/v1/tsv/confirm?code=CODE (not same code as below)
     * 7. The URL in step 6 passes a redirect to the final web URL e.g. https://auth.simplisafe.com/authorize/resume?state=STATE
     * 7. At this point we are supposed to be redirected to the callback URI, this can be either webapp.simplisafe or the mobile URI e.g. com.simplisafe.mobile://auth.simplisafe.com/ios/com.simplisafe.mobile/callback?code=CODE
     * 8. Strip the CODE from the URI in step 7 and we can finally use this to obtain a token be sending POST to /token, see getToken()
     */
    async loginAndAuthorize(username, password) {
        let auth0 = axios.create({
            baseURL: SS_OAUTH_AUTH_URL,
            headers: {
                'Accept': 'text/html',
                'User-Agent': 'Homebridge-Simplisafe3'
            },
            withCredentials: true,
            responseType: 'document',
            paramsSerializer: function(params) {
                return Object.keys(params).map(key => `${key}=${params[key]}`).join('&');
            },
            maxRedirects: 0,
            validateStatus: function(status) {
                return status >= 200 && status < 303;
            },
        });

        let cookies;
        
        this.emit(AUTH_EVENTS.LOGIN_STEP, 'Loading login auth url...');
        return auth0.get('/authorize', {
            params: {
                'client_id': SS_OAUTH_CLIENT_ID,
                'scope': SS_OAUTH_SCOPE,
                'response_type': 'code',
                'response_mode': 'query',
                'redirect_uri': SS_OAUTH_REDIRECT_URI,
                'code_challenge_method': 'S256',
                'code_challenge': this.codeChallenge,
                'audience': SS_OAUTH_AUDIENCE,
                'auth0Client': SS_OAUTH_AUTH0_CLIENT,
            }
        }).then(initialAuthUrlResponse => {
            cookies = initialAuthUrlResponse.headers["set-cookie"];
            const loginPath = initialAuthUrlResponse.headers['location'];
            this.emit(AUTH_EVENTS.LOGIN_STEP, 'Attempting to login with credentials...');
            return auth0.post(loginPath, {
                'username': username,
                'password': password
            },
            {
                headers: {
                    'Cookie': cookies
                },
                maxRedirects: 5
            });
        }).then(loginAttemptResponse => {
            let awaitLoginVerificationUrl = loginAttemptResponse.request._redirectable._currentUrl;

            const checkVerifiedByEmail = async (ms, triesLeft) => {
                return new Promise((resolve, reject) => {
                    const interval = setInterval(async () => {
                        this.emit(AUTH_EVENTS.LOGIN_STEP, 'Awaiting login verification (check email)...');
                        auth0.get(awaitLoginVerificationUrl, {
                            maxRedirects: 5
                        }).then(loginVerificationCheckResponse => {
                            if (loginVerificationCheckResponse.data && loginVerificationCheckResponse.data.indexOf('Verification Successful') > -1) {
                                this.emit(AUTH_EVENTS.LOGIN_STEP, 'Detected verification completed...');
                                resolve(loginVerificationCheckResponse);
                                clearInterval(interval);
                            } else if (triesLeft <= 1) {
                                reject(new Error('Timed out waiting for login verification'));
                                clearInterval(interval);
                            }
                        })
                        triesLeft--;
                    }, ms);
                });
            }

            const checkLoginVerifiedBySms = async (ms, triesLeft) => {
                return new Promise((resolve, reject) => {
                    const interval = setInterval(async () => {
                        this.emit(AUTH_EVENTS.LOGIN_STEP_SMS_REQUEST, 'Awaiting sms verification code...');
                        if (this.smsCode) {
                            resolve(this.smsCode);
                            this.smsCode = undefined;
                            clearInterval(interval);
                        } else if (triesLeft <= 1) {
                            reject(new Error('Timed out waiting for sms verification'));
                            clearInterval(interval);
                        }
                        triesLeft--;
                    }, ms);
                });
            }

            if (awaitLoginVerificationUrl.indexOf('/u/mfa-sms-challenge') > -1) {
                // SMS verification
                return checkLoginVerifiedBySms(3000, (5 * 60 * 1000) / 3000).then(smsCode => {
                    this.emit(AUTH_EVENTS.LOGIN_STEP, 'Submitting verification form for redirect...');
                    return auth0.post(awaitLoginVerificationUrl, {
                        code: smsCode
                    }, {
                        maxRedirects: 0,
                        headers: {
                            'Cookie': cookies
                        }
                    });
                });
            } else {
                return checkVerifiedByEmail(3000, (15 * 60 * 1000) / 3000).then(loginVerificationCheckResponse => {
                    // parse <form>
                    const continueUrlMatch = loginVerificationCheckResponse.data.match(/https:\/\/auth\.simplisafe\.com\/continue\?[^"]*/g);
                    const tokenRegExp = new RegExp(/name="token" value="([^"]*)"/, 'g');
                    const tokenMatch = tokenRegExp.exec(loginVerificationCheckResponse.data);
                    if (continueUrlMatch.length && tokenMatch.length) {
                        this.emit(AUTH_EVENTS.LOGIN_STEP, 'Submitting verification form for redirect...');
                        return auth0.post(continueUrlMatch[0], {
                            token: tokenMatch[1]
                        }, {
                            maxRedirects: 0,
                            headers: {
                                'Cookie': cookies
                            }
                        });
                    } else {
                        throw Error('Unable to parse token from continue form');
                    }
                });
            }
        }).then(verificationRedirectResponse => {
            const finalAuthPath = verificationRedirectResponse.headers['location'];
            this.emit(AUTH_EVENTS.LOGIN_STEP, 'Verification form submission successful, loading final auth redirect...');
            return auth0.get(finalAuthPath, {
                maxRedirects: 0,
                headers: {
                    'Cookie': cookies
                }
            });
        }).then(finalRedirectReponse => {
            this.emit(AUTH_EVENTS.LOGIN_STEP, 'Attempting to parse code from final callback URL...');
            const redirectURL = new URL(finalRedirectReponse.headers['location']);
            const code = redirectURL.searchParams.get('code');
            if (!code) {
                throw new Error('Unable to retrieve code from final redirect URL');
            }
            this.emit(AUTH_EVENTS.LOGIN_STEP, 'Attempting to obtain auth token...');
            return this.getToken(code);
        }).then(token => {
            if (token) this.emit(AUTH_EVENTS.LOGIN_COMPLETE);
            return true;
        }).catch((error) => {
            this.emit(AUTH_EVENTS.LOGIN_STEP, `Authentication error: ${error.message ?? error.toString()}`, true);
            return false;
        });
    }
}

module.exports.SimpliSafe3AuthenticationManager = SimpliSafe3AuthenticationManager;
module.exports.AUTH_EVENTS = AUTH_EVENTS;
module.exports.N_LOGIN_STEPS = N_LOGIN_STEPS;
export default SimpliSafe3AuthenticationManager;
