import SimpliSafe from './simpilsafe';

const simplisafe = new SimpliSafe();

const tryLogIn = async () => {
    try {
        await simplisafe.login('nzapponi@gmail.com', 'riqhy1-tirbob-fewsaN', true);
        console.log(`Token is ${simplisafe.token}`);

        // await simplisafe.refreshToken();
        // console.log(`Token refreshed. It is now ${simplisafe.token}`);

        // simplisafe.token = simplisafe.token + '1';
        // simplisafe.rToken = simplisafe.rToken + '1';


        // simplisafe.request({
        //     method: 'GET',
        //     url: '/authCheck'
        // })
        //     .then(data => {
        //         console.log(data);
        //     })
        //     .catch(err => {
        //         console.error(err);
        //     });

        // let userId = await simplisafe.getUserId();
        // console.log(userId);

        let userInfo = await simplisafe.getUserInfo();
        console.log(userInfo);
    } catch (err) {
        console.error('An error occurred', err);
    }
};

tryLogIn();