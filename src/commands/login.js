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

    async run() {
        const {flags} = await this.parse(Login);
        
        this.authManager = new SimpliSafe3AuthenticationManager(flags.homebridgeDir);
        this.authManager.on(AUTH_EVENTS.LOGIN_STEP, (message, isError) => {
            if (isError) {
                this.warn('Error during authentication');
                this.error(message);
            } else {
                this.log(message);
            }
        });

        this.authManager.on(AUTH_EVENTS.LOGIN_COMPLETE, () => {
            CliUx.ux.action.stop();
            this.log('\nCredentials retrieved successfully!');
            this.log('accessToken: ' + this.authManager.accessToken);
            this.log('refreshToken: ' + this.authManager.refreshToken);
            this.log('\nPlease restart Homebridge for changes to take effect.');
            this.authComplete = true;
        });
        
        this.log('\n******* Simplisafe Authentication *******');
        const email = await CliUx.ux.prompt('SimpliSafe Email')
        const password = await CliUx.ux.prompt('SimpliSafe Password', {type: 'hide'})
        CliUx.ux.action.start('Authenticating with Simplisafe');
        
        this.authManager.loginAuth(email, password);

        let sleep = ms => new Promise(r => setTimeout(r, ms));
        let waitFor = async function waitFor(f){
            while(!f()) await sleep(1000);
            return f();
        };
        await waitFor(() => this.authComplete)
        this.exit(0);
    }
}

Login.description = 'Command to login to SimpliSafe';

module.exports = Login;
