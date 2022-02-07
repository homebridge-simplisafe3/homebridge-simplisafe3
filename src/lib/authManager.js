// © 2021 Michael Shamoon
// SimpliSafe 3 Authentication Manager

const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const events = require('events');

const ssOAuth = axios.create({
    baseURL: 'https://auth.simplisafe.com/oauth'
});

const ssApiV1 = axios.create({
    baseURL: 'https://api.simplisafe.com/v1'
});

const SS_OAUTH_AUTH_URL = 'https://auth.simplisafe.com/authorize';
const SS_OAUTH_CLIENT_ID = '42aBZ5lYrVW12jfOuu3CQROitwxg9sN5';
const SS_OAUTH_AUTH0_CLIENT = 'eyJuYW1lIjoiQXV0aDAuc3dpZnQiLCJlbnYiOnsiaU9TIjoiMTUuMCIsInN3aWZ0IjoiNS54In0sInZlcnNpb24iOiIxLjMzLjAifQ';
const SS_OAUTH_REDIRECT_URI = 'com.simplisafe.mobile://auth.simplisafe.com/ios/com.simplisafe.mobile/callback';
const SS_OAUTH_SCOPE = 'offline_access%20email%20openid%20https://api.simplisafe.com/scopes/user:platform';
const SS_OAUTH_AUDIENCE = 'https://api.simplisafe.com/';
const MAX_RETRIES = 3;

// Retained for deprecated username / password login, for now
const clientUuid = '4df55627-46b2-4e2c-866b-1521b395ded2';
const clientUsername = `${clientUuid}.WebApp.simplisafe.com`;
const clientPassword = '';
const ssApiExpiry = 3600;

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
    nRetries = 0;

    // Retained for deprecated username / password login, for now
    username;
    password;
    ssId;

    constructor(storagePath, log, debug) {
        super();
        this.storagePath = storagePath;
        this.log = log || console.log;
        this.debug = debug || false;

        const account = this._parseAccountsFile();
        if (account.accessToken !== undefined) {
            this.accessToken = account.accessToken;
            this.refreshToken = account.refreshToken;
            this.codeVerifier = account.codeVerifier;
        }

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

    _parseAccountsFile() {
        if (this.accountsFileExists()) {
          let fileContents;

          try {
            fileContents = (fs.readFileSync(path.join(this.storagePath, accountsFilename))).toString();
          } catch {
            fileContents = '{}';
          }

          return JSON.parse(fileContents);
        } else if (!this._storagePathExists()) {
            throw new Error(`Supplied path ${this.storagePath} does not exist`);
        }

        return {};
    }

    _writeAccountsFile(account) {
      try {
          fs.writeFileSync(
            path.join(this.storagePath, accountsFilename),
            JSON.stringify(account)
          );
      } catch (err) {
        throw err;
      }
   }

    isAuthenticated() {
        return this.refreshToken !== null && Date.now() < this.expiry;
    }

    getSSAuthURL() {
        const loginURL = new URL(SS_OAUTH_AUTH_URL);
        loginURL.searchParams.append('client_id', SS_OAUTH_CLIENT_ID);
        loginURL.searchParams.append('scope', 'SCOPE'); // otherwise this gets URI encoded
        loginURL.searchParams.append('response_type', 'code');
        loginURL.searchParams.append('redirect_uri', SS_OAUTH_REDIRECT_URI);
        loginURL.searchParams.append('code_challenge_method', 'S256');
        loginURL.searchParams.append('code_challenge', this.codeChallenge);
        loginURL.searchParams.append('audience', 'AUDIENCE');
        loginURL.searchParams.append('auth0Client', SS_OAUTH_AUTH0_CLIENT);
        return loginURL.toString().replace('SCOPE', SS_OAUTH_SCOPE).replace('AUDIENCE', SS_OAUTH_AUDIENCE);
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

    parseCodeFromURL(redirectURLStr) {
      let code;
      try {
          const redirectURL = new URL(redirectURLStr);
          const maybeCode = redirectURL.searchParams.get('code');
          if (!maybeCode) {
              throw new Error();
          }
          code = maybeCode;
      } catch (error) {
          throw new Error('Invalid redirect URL');
      }

      return code;
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
        if (!this.accountsFileExists()) {
            if (this.username !== undefined && this.password !== undefined) {
                // support old username / password, for now...
                if (this.refreshToken == undefined) await this._loginWithUsernamePassword();
                else await this._refreshWithUsernamePassword();
                return;
            } else if (this.refreshToken == undefined) {
                throw new Error('No authentication credentials detected.');
            }
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
                  'Content-Length': 186,
                  'Auth0-Client': SS_OAUTH_AUTH0_CLIENT
                }
            });

            await this._storeToken(refreshTokenResponse.data);
            this.emit('refreshCredentialsSuccess');
            this.nRetries = 0;
            if (this.log !== undefined && this.debug) this.log('Credentials refresh was successful');
        } catch (err) {
            if (err.response && err.response.status == 500 && this.nRetries < MAX_RETRIES) {
                // Lets try again in case it was simple connectivity
                this.nRetries++;
                if (this.log !== undefined && this.debug) this.log(`Initiating credentials refresh attempt #${this.nRetries}`);
                await this.refreshCredentials();
            } else {
                this.emit('refreshCredentialsFailure');
                this.nRetries = 0;
                throw new Error('Failed refreshing token: ' + err.toString());
            }
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
        }
        await this._writeAccountsFile(account);

        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        this.refreshInterval = setInterval(() => {
            if (this.log !== undefined && this.debug) this.log('Preemptively authenticating with SimpliSafe');
            this.refreshCredentials()
            .catch(err => {
                // handled elsewhere, just log
                if (this.log !== undefined) this.log.error(err);
            })
        }, parseInt(token.expires_in) * 1000 - 300000);
    }

    // Deprecated login with username / password
    async _loginWithUsernamePassword() {
        try {
            if (this.log && this.log.warn) this.log.warn('Warning: Authentication with username / password is expected to cease to function on or after December 2021. Please re-authenticate using newest method. See README for more info.');
            if (this.log && this.debug) this.log('Attempting to login with username / password.');
            const response = await ssApiV1.post('/api/token', {
                username: this.username,
                password: this.password,
                grant_type: 'password',
                client_id: clientUsername,
                device_id: `Homebridge; useragent="Homebridge-SimpliSafe3 (SS-ID: ${this.ssId})"; uuid="${clientUuid}"; id="${this.ssId}"`,
                scope: ''
            }, {
                auth: {
                    username: clientUsername,
                    password: clientPassword
              }
            });

            let token = response.data;
            this.accessToken = token.access_token;
            this.refreshToken = token.refresh_token;
            this.expiry = Date.now() + (parseInt(token.expires_in) * 1000);
            this.tokenType = token.token_type;
            if (this.log && this.debug) this.log('Username / password login successful.');
        } catch (error) {
            this.log('Username / password login failed.');
            throw error;
        }
    }

    // Deprecated refresh with username / password
    async _refreshWithUsernamePassword() {
        try {
            if (this.log && this.log.warn) this.log.warn('Warning: Authentication with username / password is expected to cease to function on or after December 2021. Please re-authenticate using newest method. See README for more info.');
            if (this.log && this.debug) this.log('Attempting to refresh with username / password.');
            const response = await ssApiV1.post('/api/token', {
                refresh_token: this.refreshToken,
                grant_type: 'refresh_token'
            }, {
              auth: {
                  username: clientUsername,
                  password: clientPassword
              }
            });

            let token = response.data;
            this.accessToken = token.access_token;
            this.refreshToken = token.refresh_token;
            this.expiry = Date.now() + (parseInt(token.expires_in) * 1000);
            this.tokenType = token.token_type;
            if (this.log && this.debug) this.log('Username / password refresh successful.');
        } catch (error) {
            this.log('Refresh with username / password login failed.');
            throw error;
        }
    }
}

module.exports = SimpliSafe3AuthenticationManager
