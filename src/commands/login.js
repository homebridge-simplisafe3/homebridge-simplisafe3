const { Command, Flags, CliUx } = require('@oclif/core');
const SimpliSafe3AuthenticationManager = require('../lib/authManager');
const path = require('path');
const os = require('os');
const isDocker = require('is-docker');

export const homebridgeDir = Flags.build({
    char: 'd',
    description: 'The path to your Homebridge directory',
    default: () => {
        return isDocker() ? '/homebridge/' : path.join(os.homedir(), '.homebridge');
    }
})

class Login extends Command {
    static flags = {
        homebridgeDir: homebridgeDir()
    };
    authManager;

    async run() {
        const {flags} = await this.parse(Login);
        this.authManager = new SimpliSafe3AuthenticationManager(flags.homebridgeDir);

        const loginURL = this.authManager.getSSAuthURL();

        this.log('\n******* Simplisafe Authentication *******');
        this.log('\nA browser window will open to log you into the SimpliSafe site, or you may need to copy + paste this URL into your browser:\n' + loginURL);
        this.log('\nOnce you have approved the login you will be redirected to a URL that wont load (starts with com.SimpliSafe.mobile://) which you will need to copy and paste back here.');
        this.log('\nNote that in some browsers (e.g. Chrome) the browser will not redirect you and will show an error in the Console (e.g. View > Developer Tools > Javascript Console) and you will have to copy and paste the URL from the error message.');
        this.log('\nAlso please note that this task cannot be performed on an iOS device that has the SimpliSafe app installed (authenticating will launch the app).\n');

        await CliUx.ux.anykey();

        try {
            await CliUx.ux.open(loginURL);
        } catch (e) {
            this.log('Unable to open automatically, please copy and paste the URL above into your web browser.');
        }

        const redirectURLStr = (await CliUx.ux.prompt('Redirect URL'));

        let code = this.authManager.parseCodeFromURL(redirectURLStr);

        try {
            await this.authManager.getToken(code);

            this.log('\nCredentials retrieved successfully.');
            this.log('accessToken: ' + this.authManager.accessToken);
            this.log('refreshToken: ' + this.authManager.refreshToken);
            this.log('Please restart Homebridge for changes to take effect.');
        } catch (e) {
            this.log('\nAn error occurred retrieving credentials:');
            this.log(e);
            this.exit(1);
        }

        this.exit(0);
    }
}

Login.description = 'Command to login to SimpliSafe';

module.exports = Login;
