import { Command, Flags } from '@oclif/core';
import { SimpliSafe3AuthenticationManager } from '../lib/authManager';
import path from 'path';
import os from 'os';
import { inspect } from 'util';
import { createInterface } from 'readline/promises';
import isDocker from 'is-docker';

const homebridgeDir = Flags.string({
    char: 'd',
    description: 'The path to your Homebridge directory',
    default: async () => {
        return isDocker() ? '/homebridge/' : path.join(os.homedir(), '.homebridge');
    }
});

class Login extends Command {
    static description = 'Login with SimpliSafe';
    static flags = {
        homebridgeDir
    };
    authManager?: SimpliSafe3AuthenticationManager;

    async run(): Promise<void> {
        const {flags} = await this.parse(Login);

        this.authManager = new SimpliSafe3AuthenticationManager(flags.homebridgeDir);

        const loginURL = this.authManager.getSSAuthURL();

        this.log('\n******* Simplisafe Authentication *******');
        this.log('\nCopy and paste this URL into your browser to log in to SimpliSafe:\n' + loginURL);
        this.log('\nOnce you have approved the login, depending on your browser, you then will either be redirected to a URL that begins with com.SimpliSafe.mobile:// which you should copy and paste back here in its entirety.');
        this.log('\nOr, many browsers will not display the final redirect but will show an error in the Console (e.g. View > Developer Tools > Javascript Console) and you will have to copy and paste the URL from the error message.');
        this.log('\nSafari v15.1+ does not show the URL in the console or the browser and thus is not recommended for this process.');
        this.log('\nAlso please note that this task cannot be performed on a mobile device.\n');

        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const redirectURLStr = (await rl.question('Redirect URL: ')).trim();
        rl.close();

        const code = this.authManager.parseCodeFromURL(redirectURLStr);

        try {
            await this.authManager.getToken(code);

            this.log('\nCredentials retrieved successfully.');
            this.log('accessToken: ' + this.authManager.accessToken);
            this.log('refreshToken: ' + this.authManager.refreshToken);
            this.log('Please restart Homebridge for changes to take effect.');
        } catch (e) {
            this.log('\nAn error occurred retrieving credentials:');
            this.log(inspect(e));
            this.exit(1);
        }

        this.exit(0);
    }
}

export default Login;
