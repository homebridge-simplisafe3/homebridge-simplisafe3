const {Command, flags} = require('@oclif/command');
const {cli} = require('cli-ux');
const SimpliSafeLoginManager = require('../common/loginManager.js');

class Login extends Command {
    loginManager;

    async run() {
        const {flags} = this.parse(Login);
        this.loginManager = new SimpliSafeLoginManager();

        const loginURL = this.loginManager.getSSAuthURL();

        this.log('A browser window will open to log you into the SimpliSafe site. Or copy + paste this URL into your browser: '+loginURL);
        this.log('Once logged in you will be redirected to a URL that doesnt open (starts with com.SimpliSafe.mobile://). Copy and paste it back here.');
        this.log('Note that in some browsers (e.g. Chrome) the browser will not redirect you and will show an error in the Console (e.g. View > Developer Tools > Javascript Console) and you will have to copy and paste the URL from the error message.');

        await cli.anykey();

        await cli.open(loginURL);

        const redirectURLStr = (await cli.prompt('Redirect URL'));

        let code = this.loginManager.parseCodeFromURL(redirectURLStr);

        const tokenResponse = await this.loginManager.getToken(code);

        this.log('Credentials retrieved successfully, you will need to enter the access_token and refresh_token below into the plugin config.');
        this.log(tokenResponse);
    }
}

Login.description = 'Command to login to SimpliSafe';

module.exports = Login;
