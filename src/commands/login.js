const { Command, Flags, CliUx } = require('@oclif/core');
const { SimpliSafe3AuthenticationManager, AUTH_EVENTS, AUTH_STATES } = require('../lib/authManager');
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
                this.warn(message);
            } else {
                this.log(message);
            }
        });
        
        this.log('\n======= Simplisafe Authentication =======\n');

        const email = await CliUx.ux.prompt('SimpliSafe Email');
        const password = await CliUx.ux.prompt('SimpliSafe Password', {type: 'hide'});

        CliUx.ux.action.start('Initiating authentication with SimpliSafe');
        
        let authorizedOrAwaitingVerification = await this.authManager.initiateLoginAndAuth(email, password);
        
        if (authorizedOrAwaitingVerification == AUTH_STATES.ERROR) {
            this.error('Authentication failed.');
        } else if (authorizedOrAwaitingVerification == AUTH_STATES.AWAITING_VERIFICATION) {
            CliUx.ux.action.stop();
            const code = await CliUx.ux.prompt('Enter SMS code');
            CliUx.ux.action.start('Completing authentication with SimpliSafe');
            authorizedOrAwaitingVerification = this.authManager.verifySmsAndCompleteAuthorization(code);
        }

        CliUx.ux.action.stop();
        
        if (authorizedOrAwaitingVerification == AUTH_STATES.ERROR) {
            this.error('Authentication failed.');
        } else {
            this.log('\n======= Authentication Successful! =======\n');
            this.log('accessToken: ' + this.authManager.accessToken);
            this.log('refreshToken: ' + this.authManager.refreshToken + '\n');
            this.warn('Please restart Homebridge for changes to take effect.');
        }

        this.exit(0);
    }
}

Login.description = 'Login and authenticate with SimpliSafe';

module.exports = Login;
