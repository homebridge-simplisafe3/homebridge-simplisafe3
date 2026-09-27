// © 2021 Michael Shamoon
// SimpliSafe 3 Authentication Manager

import crypto from 'crypto';
import axios from 'axios';
import type { AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export const AUTH_EVENTS = {
    REFRESH_CREDENTIALS_SUCCESS: 'REFRESH_CREDENTIALS_SUCCESS',
    REFRESH_CREDENTIALS_FAILURE: 'REFRESH_CREDENTIALS_FAILURE',
};

// homebridge Logging or console.log
type Logger = ((...args: unknown[]) => void) & { error?: (...args: unknown[]) => void };

interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number | string;
    token_type: string;
}

interface StoredAccount {
    accessToken?: string | null;
    refreshToken?: string | null;
    codeVerifier?: string;
}

const ssOAuth = axios.create({
    baseURL: 'https://auth.simplisafe.com/oauth'
});
axiosRetry(ssOAuth, { retries: 3 });

const SS_OAUTH_AUTH_URL = 'https://auth.simplisafe.com/authorize';
const SS_OAUTH_CLIENT_ID = '42aBZ5lYrVW12jfOuu3CQROitwxg9sN5';
const SS_OAUTH_AUTH0_CLIENT = 'eyJ2ZXJzaW9uIjoiMi4zLjIiLCJuYW1lIjoiQXV0aDAuc3dpZnQiLCJlbnYiOnsic3dpZnQiOiI1LngiLCJpT1MiOiIxNi4zIn19';
const SS_OAUTH_REDIRECT_URI = 'com.simplisafe.mobile://auth.simplisafe.com/ios/com.simplisafe.mobile/callback';
const SS_OAUTH_SCOPE = 'offline_access%20email%20openid%20https://api.simplisafe.com/scopes/user:platform';
const SS_OAUTH_AUDIENCE = 'https://api.simplisafe.com/';
const SS_OAUTH_DEVICE = 'iPhone';
const SS_OAUTH_DEVICE_UUID = '0000007E-0000-1000-8000-0026BB765291'; // anything, e.g. hap.Service.SecuritySystem.UUID

const accountsFilename = 'simplisafe3auth.json';

class SimpliSafe3AuthenticationManager extends EventEmitter {
    storagePath: string;
    accessToken?: string | null;
    refreshToken?: string | null;
    tokenType = 'Bearer';
    codeVerifier!: string;
    codeChallenge: string;
    expiry?: number;
    refreshInterval?: ReturnType<typeof setInterval>;
    log: Logger;
    debug: boolean;

    constructor(storagePath: string, log?: Logger, debug?: boolean) {
        super();
        this.storagePath = storagePath;
        this.log = log || console.log;
        this.debug = debug || false;

        this.parseAccountsFile();

        if (!this.codeVerifier) this.codeVerifier = this.base64URLEncode(crypto.randomBytes(32));
        this.codeChallenge = this.base64URLEncode(this.sha256(this.codeVerifier));
    }

    getSSAuthURL(): string {
        const loginURL = new URL(SS_OAUTH_AUTH_URL);
        loginURL.searchParams.append('client_id', SS_OAUTH_CLIENT_ID);
        loginURL.searchParams.append('scope', 'SCOPE'); // otherwise this gets URI encoded
        loginURL.searchParams.append('response_type', 'code');
        loginURL.searchParams.append('redirect_uri', SS_OAUTH_REDIRECT_URI);
        loginURL.searchParams.append('code_challenge_method', 'S256');
        loginURL.searchParams.append('code_challenge', this.codeChallenge);
        loginURL.searchParams.append('audience', 'AUDIENCE');
        loginURL.searchParams.append('auth0Client', SS_OAUTH_AUTH0_CLIENT);
        loginURL.searchParams.append('device', SS_OAUTH_DEVICE);
        loginURL.searchParams.append('device_id', SS_OAUTH_DEVICE_UUID);
        return loginURL.toString().replace('SCOPE', SS_OAUTH_SCOPE).replace('AUDIENCE', SS_OAUTH_AUDIENCE);
    }

    private _storagePathExists(): boolean {
        return fs.existsSync(this.storagePath);
    }

    accountsFileExists(): boolean {
        if (!this._storagePathExists()) return false;
        const accountsFile = path.join(this.storagePath, accountsFilename);
        return fs.existsSync(accountsFile);
    }

    parseAccountsFile(): void {
        if (this.accountsFileExists()) {
            let fileContents;

            try {
                fileContents = (fs.readFileSync(path.join(this.storagePath, accountsFilename))).toString();
            } catch {
                fileContents = '{}';
            }

            const account: StoredAccount = JSON.parse(fileContents);

            if (account.accessToken !== undefined) {
                this.accessToken = account.accessToken;
                this.refreshToken = account.refreshToken;
                this.codeVerifier = account.codeVerifier as string;
            }
        } else if (!this._storagePathExists()) {
            throw new Error(`Supplied path ${this.storagePath} does not exist`);
        }
    }

    isAuthenticated(): boolean {
        return this.refreshToken !== null && this.expiry !== undefined && Date.now() < this.expiry;
    }

    parseCodeFromURL(redirectURLStr: string): string {
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

    base64URLEncode(str: Buffer): string {
        return str.toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    sha256(buffer: crypto.BinaryLike): Buffer {
        return crypto.createHash('sha256').update(buffer).digest();
    }

    async getToken(authorizationCode: string): Promise<string | null | undefined> {
        try {
            const tokenResponse = await ssOAuth.post<TokenResponse>('/token', {
                grant_type: 'authorization_code',
                client_id: SS_OAUTH_CLIENT_ID,
                code_verifier: this.codeVerifier,
                code: authorizationCode,
                redirect_uri: SS_OAUTH_REDIRECT_URI,
            });

            await this._storeToken(tokenResponse.data);
            return this.accessToken;
        } catch (err) {
            const error = err as Error;
            throw new Error('Error getting token: ' + error.message ? error.message : error.toString());
        }
    }

    async refreshCredentials(): Promise<void> {
        if (!this.accountsFileExists() && this.refreshToken == undefined) {
            throw new Error('No valid authentication credentials detected.');
        }

        try {
            if (!this.refreshToken) {
                // E.g. re-trying after failed attempt
                this.parseAccountsFile();
            }
            const refreshTokenResponse = await ssOAuth.post<TokenResponse>('/token', {
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
            if (this.log && this.debug) this.log('SimpliSafe credentials refresh was successful');
        } catch (err) {
            if (this.log && this.debug) this.log('SimpliSafe credentials refresh failed');
            const error = err as AxiosError;
            if (error.response && (String(error.response.status).indexOf('4') == 0 || error.response.data == 'Unauthorized')) {
                // this is a true auth failure
                this.refreshToken = this.accessToken = null;
                this.emit(AUTH_EVENTS.REFRESH_CREDENTIALS_FAILURE);
            }
            throw err; // just pass it along
        }
    }

    private async _storeToken(token: TokenResponse): Promise<void> {
        this.accessToken = token.access_token;
        this.refreshToken = token.refresh_token ?? this.refreshToken;
        this.expiry = Date.now() + (parseInt(String(token.expires_in)) * 1000);
        this.tokenType = token.token_type;

        const account: StoredAccount = {
            accessToken: this.accessToken,
            codeVerifier: this.codeVerifier,
            refreshToken: this.refreshToken
        };

        try {
            fs.writeFileSync(
                path.join(this.storagePath, accountsFilename),
                JSON.stringify(account)
            );
        } catch (err) {
            if (this.log && this.log.error) this.log.error('Unable to write accounts file.', err);
            throw new Error(`Failed storing token with error message "${(err as Error).message}"`);
        }

        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        this.refreshInterval = setInterval(() => {
            if (this.log && this.debug) this.log('Preemptively authenticating with SimpliSafe');
            this.refreshCredentials()
                .catch((err: AxiosError) => {
                    if (this.log && this.log.error) this.log.error(err.toJSON ? err.toJSON() : err);
                    if (err.response && (err.response.status == 403 || err.response.data == 'Unauthorized')) {
                        clearInterval(this.refreshInterval); // just disable until next successful one
                    }
                });
        }, parseInt(String(token.expires_in)) * 1000 - 300000);
    }

}

export { SimpliSafe3AuthenticationManager };
export default SimpliSafe3AuthenticationManager;
