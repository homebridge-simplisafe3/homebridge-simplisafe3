const crypto = require('crypto');
const axios = require('axios');

const ssOAuth = axios.create({
    baseURL: 'https://auth.simplisafe.com/oauth'
});

const SS_OAUTH_AUTH_URL = 'https://auth.simplisafe.com/authorize';
const SS_OAUTH_CLIENT_ID = '42aBZ5lYrVW12jfOuu3CQROitwxg9sN5';
const SS_OAUTH_CLIENT = 'eyJuYW1lIjoiQXV0aDAuc3dpZnQiLCJlbnYiOnsiaU9TIjoiMTUuMCIsInN3aWZ0IjoiNS54In0sInZlcnNpb24iOiIxLjMzLjAifQ';
const SS_OAUTH_REDIRECT_URI = 'com.simplisafe.mobile://auth.simplisafe.com/ios/com.simplisafe.mobile/callback';
const SS_OAUTH_SCOPE = 'offline_access%20email%20openid%20https://api.simplisafe.com/scopes/user:platform';
const SS_OAUTH_AUDIENCE = 'https://api.simplisafe.com/';

class SimpliSafeLoginManager {
    token;
    refreshToken;
    tokenType = 'Bearer';
    codeVerifier;
    codeChallenge;

    constructor (accessToken, refreshToken, codeVerifier) {
        if (accessToken !== undefined) this.token = accessToken;
        if (refreshToken !== undefined) this.refreshToken = refreshToken;
        this.codeVerifier = (codeVerifier !== undefined) ? codeVerifier : this.base64URLEncode(crypto.randomBytes(32));
        this.codeChallenge = this.base64URLEncode(this.sha256(this.codeVerifier));
    }

    async login() {
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

        const tokenResponse = await this.getToken(code);
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
        loginURL.searchParams.append('auth0Client', SS_OAUTH_CLIENT);
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
            const response = await ssOAuth.post('/token', {
                grant_type: 'authorization_code',
                client_id: SS_OAUTH_CLIENT_ID,
                code_verifier: this.codeVerifier,
                code: authorizationCode,
                redirect_uri: SS_OAUTH_REDIRECT_URI,
            });

            return response.data;
        } catch (err) {
            this.log(err);
        }
    }

    async refreshCredentials() {
        try {
            const response = await ssOAuth.post('/token', {
                grant_type: 'refresh_token',
                client_id: SS_OAUTH_CLIENT_ID,
                code_verifier: this.codeVerifier,
                refresh_token: this.refreshToken
            });

            return response.data;
        } catch (err) {
            this.log(err);
        }
    }
}

module.exports = SimpliSafeLoginManager
