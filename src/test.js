import SimpliSafe from './simplisafe';

async function test() {
    try {
        let ss = new SimpliSafe();
        await ss.login('nzapponi@gmail.com', 'riqhy1-tirbob-fewsaN');
        ss.subscribe(event => {
            console.log(event);
        });
    
    } catch (err) {
        console.error('An error occurred');
        console.error(err);
    }
}

test();