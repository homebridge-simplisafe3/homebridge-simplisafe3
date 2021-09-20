const {Command, flags} = require('@oclif/command');
const {cli} = require('cli-ux');
const SimpliSafeLoginManager = require('../common/loginManager.js');
const path = require('path');
const os = require('os');

class Login extends Command {
    static flags = {
      homebridgeDir: flags.string({
        char: 'd',
        default: path.join(os.homedir(), '.homebridge'),
        description: 'The path to your Homebridge directory',
      })
    }
    loginManager;

    async run() {
        const {flags} = this.parse(Login);
        this.loginManager = new SimpliSafeLoginManager(flags.homebridgeDir);

        const loginURL = this.loginManager.getSSAuthURL();

        this.log('\n******* Simplisafe Authentication *******');
        this.log('\nA browser window will open to log you into the SimpliSafe site. Or copy + paste this URL into your browser: '+loginURL);
        this.log('\nOnce logged in you will be redirected to a URL that doesnt open (starts with com.SimpliSafe.mobile://). Copy and paste it back here.');
        this.log('\nNote that in some browsers (e.g. Chrome) the browser will not redirect you and will show an error in the Console (e.g. View > Developer Tools > Javascript Console) and you will have to copy and paste the URL from the error message.\n');

        await cli.anykey();

        await cli.open(loginURL);

        const redirectURLStr = (await cli.prompt('Redirect URL'));

        let code = this.loginManager.parseCodeFromURL(redirectURLStr);

        try {
          await this.loginManager.getToken(code);

          this.log('\nCredentials retrieved successfully.');
          this.log('accessToken: ' + this.loginManager.accessToken);
          this.log('refreshToken: ' + this.loginManager.refreshToken);
        } catch (e) {
          this.log('\nAn error occurred retrieving credentials:');
          this.log(e);
        }
    }
}

Login.description = 'Command to login to SimpliSafe';

module.exports = Login;
