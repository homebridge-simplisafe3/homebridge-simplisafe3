const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const ssOAuth = axios.create({
    baseURL: 'https://auth.simplisafe.com/oauth'
});

const SS_OAUTH_AUTH_URL = 'https://auth.simplisafe.com/authorize';
const SS_OAUTH_CLIENT_ID = '42aBZ5lYrVW12jfOuu3CQROitwxg9sN5';
const SS_OAUTH_AUTH0_CLIENT = 'eyJuYW1lIjoiQXV0aDAuc3dpZnQiLCJlbnYiOnsiaU9TIjoiMTUuMCIsInN3aWZ0IjoiNS54In0sInZlcnNpb24iOiIxLjMzLjAifQ';
const SS_OAUTH_REDIRECT_URI = 'com.simplisafe.mobile://auth.simplisafe.com/ios/com.simplisafe.mobile/callback';
const SS_OAUTH_SCOPE = 'offline_access%20email%20openid%20https://api.simplisafe.com/scopes/user:platform';
const SS_OAUTH_AUDIENCE = 'https://api.simplisafe.com/';

const accountsFilename = 'simplisafe3accounts.json';

class SimpliSafeLoginManager {
    storagePath;
    accessToken;
    refreshToken;
    tokenType = 'Bearer';
    codeVerifier;
    codeChallenge;
    expiry;

    constructor(storagePath) {
        this.storagePath = storagePath;

        const account = this._parseAccountsFile();

        this.codeVerifier = this.base64URLEncode(crypto.randomBytes(32));
        this.codeChallenge = this.base64URLEncode(this.sha256(this.codeVerifier));
    }

    async _parseAccountsFile() {
        const accountsFile = path.join(this.storagePath, accountsFilename);
        if (fs.existsSync(accountsFile)) {
          let fileContents;

          try {
            fileContents = (fs.readFileSync(accountsFile)).toString();
          } catch {
            fileContents = '{}';
          }

          const account = JSON.parse(fileContents);
          if (account.accessToken !== undefined) {
              this.accessToken = account.accessToken;
              this.refreshToken = account.refreshToken;
              this.codeVerifier = account.codeVerifier;
          }
          return account;
        }
    }

    async _writeAccountsFile() {
      const account = {
          accessToken: this.accessToken,
          codeVerifier: this.codeVerifier,
          refreshToken: this.refreshToken
      }

      try {
          fs.writeFileSync(
            path.join(this.storagePath, accountsFilename),
            JSON.stringify(account)
          );
      } catch (err) {
        throw err;
      }
   }

    isLoggedIn() {
        return this.refreshToken !== null || (this.accessToken !== null && Date.now() < this.expiry);
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
        try {
            const refreshTokenResponse = await ssOAuth.post('/token', {
                grant_type: 'refresh_token',
                client_id: SS_OAUTH_CLIENT_ID,
                refresh_token: this.refreshToken
            }, {
                headers: {
                  'Host': 'auth.simplisafe.com',
                  'Content-Type': 'application/json',
                  'Content-Length': 186,
                  'Auth0-Client': SS_OAUTH_AUTH0_CLIENT
                }
            });

            await this._storeToken(refreshTokenResponse.data);
            return this.accessToken;
        } catch (err) {
            throw new Error('Error refreshing token: ' + err.toString());
        }
    }

    async _storeToken(token) {
        this.accessToken = token.access_token;
        this.refreshToken = token.refresh_token;
        this.expiry = Date.now() + (token.expires_in * 1000);
        await this._writeAccountsFile();
    }
}

module.exports = SimpliSafeLoginManager
