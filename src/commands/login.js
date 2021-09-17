const {Command, flags} = require('@oclif/command');
const {cli} = require('cli-ux');
const SimpliSafeLoginManager = require('../common/loginManager.js');

class Login extends Command {
    loginManager;

    async run() {
        const {flags} = this.parse(Login);
        this.loginManager = new SimpliSafeLoginManager();

        const loginURL = this.loginManager.getSSAuthURL();

        this.log('\n******* Simplisafe Authentication *******');
        this.log('\nA browser window will open to log you into the SimpliSafe site. Or copy + paste this URL into your browser: '+loginURL);
        this.log('\nOnce logged in you will be redirected to a URL that doesnt open (starts with com.SimpliSafe.mobile://). Copy and paste it back here.');
        this.log('\nNote that in some browsers (e.g. Chrome) the browser will not redirect you and will show an error in the Console (e.g. View > Developer Tools > Javascript Console) and you will have to copy and paste the URL from the error message.\n');

        await cli.anykey();

        await cli.open(loginURL);

        const redirectURLStr = (await cli.prompt('Redirect URL'));

        let code = this.loginManager.parseCodeFromURL(redirectURLStr);

        const tokenResponse = await this.loginManager.getToken(code);

        this.log('\nCredentials retrieved successfully, you will need to enter the information below into the plugin config.');
        this.log('accessToken: ' + this.loginManager.codeVerifier);
        this.log('refreshToken: ' + tokenResponse.refresh_token);
        this.log('codeVerifier: ' + tokenResponse.access_token);
    }
}

Login.description = 'Command to login to SimpliSafe';

module.exports = Login;
