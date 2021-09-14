// const {clientId, redirectURI} = require('../simplisafe');
const crypto = require('crypto');
const {Command, flags} = require('@oclif/command');
const {cli} = require('cli-ux');
const axios = require('axios');

const ssAuthURL = 'https://auth.simplisafe.com/authorize';
const clientId = '42aBZ5lYrVW12jfOuu3CQROitwxg9sN5';
const redirectURI = 'com.simplisafe.mobile://auth.simplisafe.com/ios/com.simplisafe.mobile/callback';
const oAuthScope = 'offline_access%20email%20openid%20https://api.simplisafe.com/scopes/user:platform';
const oAuthAudience = 'https://api.simplisafe.com/';
const ssOAuth = axios.create({
    baseURL: 'https://auth.simplisafe.com/oauth'
});

class Login extends Command {
    async run() {
        const {flags} = this.parse(Login)
        const codeVerifier = this.base64URLEncode(crypto.randomBytes(32));
        const codeChallenge = this.base64URLEncode(this.sha256(codeVerifier));

        const loginURL = new URL(ssAuthURL);
        loginURL.searchParams.append('client_id', clientId);
        loginURL.searchParams.append('scope', 'SCOPE'); // otherwise this gets URI encoded
        loginURL.searchParams.append('response_type', 'code');
        loginURL.searchParams.append('redirect_uri', redirectURI);
        loginURL.searchParams.append('code_challenge_method', 'S256');
        loginURL.searchParams.append('code_challenge', codeChallenge);
        loginURL.searchParams.append('audience', 'AUDIENCE');
        loginURL.searchParams.append('auth0Client', 'eyJuYW1lIjoiQXV0aDAuc3dpZnQiLCJlbnYiOnsiaU9TIjoiMTUuMCIsInN3aWZ0IjoiNS54In0sInZlcnNpb24iOiIxLjMzLjAifQ');
        const loginURLFinal = loginURL.toString().replace('SCOPE', oAuthScope).replace('AUDIENCE', oAuthAudience);

        this.log('A browser window will open to log you into the SimpliSafe site.');
        this.log('Once logged in you will be redirected to a URL that doesnt open (starts with com.SimpliSafe.mobile://). Copy and paste it back here.');

        await cli.anykey();

        await cli.open(loginURLFinal);

        const redirectURLStr = (await cli.prompt('Redirect URL'));

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

        const tokenResponse = await this.getToken(code, codeVerifier);

        this.log('loginURL: ' + loginURLFinal);
        this.log('codeVerifier: ' + codeVerifier);
        this.log('codeChallenge: ' + codeChallenge);
        this.log('authorizationCode: ' + code);
        this.log('token: ' + tokenResponse);
        this.log('Logged in successfully!');
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

    async getToken(authorizationCode, codeVerifier) {
        try {
            const response = await ssOAuth.post('/token', {
                grant_type: 'authorization_code',
                client_id: clientId,
                code_verifier: codeVerifier,
                code: authorizationCode,
                redirect_uri: redirectURI,
            });

            let data = response.data;
            return response.data.access_token;
        } catch (err) {
            this.log(err);
        }
    }
}

Login.description = 'Command to login to SimpliSafe';

module.exports = Login;
