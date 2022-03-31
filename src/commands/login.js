const { Command, Flags, CliUx } = require('@oclif/core');
const { SimpliSafe3AuthenticationManager, AUTH_EVENTS } = require('../lib/authManager');
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
    authComplete;
    errorMessage;

    async run() {
        const {flags} = await this.parse(Login);
        
        this.authManager = new SimpliSafe3AuthenticationManager(flags.homebridgeDir);
        this.authManager.on(AUTH_EVENTS.LOGIN_STEP, (message, isError) => {
            if (isError) {
                this.warn(`Error: ${message}`);
            } else {
                this.log(message);
            }
        });
        
        this.log('\n******* Simplisafe Authentication *******');

        const email = await CliUx.ux.prompt('SimpliSafe Email')
        const password = await CliUx.ux.prompt('SimpliSafe Password', {type: 'hide'})

        CliUx.ux.action.start('Authenticating with SimpliSafe');
        
        const loggedInAndAuthorized = await this.authManager.loginAndAuthorize(email, password);

        CliUx.ux.action.stop();
        if (loggedInAndAuthorized) {
            this.log('\nAuthentication successful!');
            this.log('accessToken: ' + this.authManager.accessToken);
            this.log('refreshToken: ' + this.authManager.refreshToken);
            this.log('\nPlease restart Homebridge for changes to take effect.');
        } else {
            this.warn('\nAuthentication failed.');
            this.exit(1);
        }

        this.exit(0);
    }
}

Login.description = 'Login and authenticate with SimpliSafe';

module.exports = Login;
