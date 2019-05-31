// © 2019 Niccolò Zapponi
// SimpliSafe 3 HomeBridge Plugin

import SimpliSafe3 from './simpilsafe';

const simplisafe = new SimpliSafe3();

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

        // let events = await simplisafe.getEvents();
        // console.log(events);

        let sensors = await simplisafe.getSensors();
        console.log(sensors);
        
    } catch (err) {
        console.error('An error occurred', err);
    }
};

tryLogIn();