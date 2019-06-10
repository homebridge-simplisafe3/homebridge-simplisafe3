import SimpliSafe from './simplisafe';

async function test() {
    try {
        let ss = new SimpliSafe();
        await ss.login('nzapponi@gmail.com', 'riqhy1-tirbob-fewsaN');
        await ss.subscribe(event => {
            console.log('New event!');
            console.log(event);
        });
    
    } catch (err) {
        console.error('An error occurred');
        console.error(err);
    }
}

test();