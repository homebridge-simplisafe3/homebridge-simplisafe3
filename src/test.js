import SimpliSafe from './simplisafe';

async function test() {
    try {
        let ss = new SimpliSafe();
        await ss.login('nzapponi@gmail.com', 'riqhy1-tirbob-fewsaN');
        // let events = await ss.getEvents({
        //     numEvents: 300
        // });
        // for (let data of events) {
            
        //     switch (data.eventCid) {
        //         case 1400:
        //         case 1407:
        //         case 9441:
        //         case 3441:
        //         case 9401:
        //         case 9407:
        //         case 3401:
        //         case 3407:
        //         case 1429:
        //             break;
        //         case 1170:
        //             console.log(data.info);
        //             break;
        //         case 1602:
        //             break;
        //         default:
        //             console.log(`${data.eventCid} - ${data.info}`);
        //             break;
        //     }
        // }
        await ss.subscribe((event, details) => {
            console.log(event);
            if (details) {
                console.log(details);
            }
        });
    
    } catch (err) {
        console.error('An error occurred');
        console.error(err);
    }
}

test();


// AWAY ARMED
// { eventTimestamp: 1560156599,
//   eventCid: 9407,
//   zoneCid: '0',
//   sensorType: 0,
//   sensorSerial: '',
//   account: '0005ee1e',
//   userId: 2290758,
//   sid: 2305642,
//   info: 'Exit Delay Countdown Triggered for Away Mode Remotely',
//   pinName: '',
//   sensorName: '',
//   messageSubject: '',
//   messageBody: '',
//   eventType: 'activityQuiet',
//   timezone: 8,
//   locationOffset: 60,
//   expires: 45,
//   internal: { dispatcher: 'securitas', shouldNotify: false },
//   senderId: 'wifi',
//   eventId: 5304510253,
//   serviceFeatures:
//    { monitoring: true,
//      alerts: true,
//      online: true,
//      video: true,
//      hazard: false },
//   copsVideoOptIn: true,
//   video:
//    { '1fe89fb1e73405eb7011cd48e006960f':
//       { clipId: 1479458951,
//         preroll: 5,
//         postroll: 45,
//         cameraName: 'Living Room' } },
//   exitDelay: 45 }

// AWAY ENGAGED
// { eventTimestamp: 1560156644,
//   eventCid: 3407,
//   zoneCid: '0',
//   sensorType: 0,
//   sensorSerial: '',
//   account: '0005ee1e',
//   userId: 2290758,
//   sid: 2305642,
//   info: 'System Armed (Away) by Remote Management',
//   pinName: '',
//   sensorName: '',
//   messageSubject: 'SimpliSafe System Armed (away mode)',
//   messageBody:
//    'System Armed (away mode): Your SimpliSafe System was armed (away) at Flat 12, Empire Reach on 6-10-19 at 9:50 am',
//   eventType: 'activity',
//   timezone: 8,
//   locationOffset: 60,
//   internal: { dispatcher: 'securitas' },
//   senderId: 'wifi',
//   eventId: 5304511555,
//   serviceFeatures:
//    { monitoring: true,
//      alerts: true,
//      online: true,
//      video: true,
//      hazard: false },
//   copsVideoOptIn: true,
//   video:
//    { '1fe89fb1e73405eb7011cd48e006960f':
//       { clipId: 1479459693,
//         preroll: 0,
//         postroll: 75,
//         cameraName: 'Living Room' } } }

// DISARMED
// { eventTimestamp: 1560156668,
//   eventCid: 1407,
//   zoneCid: '0',
//   sensorType: 0,
//   sensorSerial: '',
//   account: '0005ee1e',
//   userId: 2290758,
//   sid: 2305642,
//   info: 'System Disarmed by Remote',
//   pinName: '',
//   sensorName: '',
//   messageSubject: 'SimpliSafe System Disarmed',
//   messageBody:
//    'System Disarmed: Your SimpliSafe security system was disarmed by Remote at Flat 12, Empire Reach on 6-10-19 at 9:51 am',
//   eventType: 'activity',
//   timezone: 8,
//   locationOffset: 60,
//   internal: { dispatcher: 'securitas' },
//   senderId: 'wifi',
//   eventId: 5304512213,
//   serviceFeatures:
//    { monitoring: true,
//      alerts: true,
//      online: true,
//      video: true,
//      hazard: false },
//   copsVideoOptIn: true,
//   video:
//    { '1fe89fb1e73405eb7011cd48e006960f':
//       { clipId: 1479460035,
//         preroll: 5,
//         postroll: 20,
//         cameraName: 'Living Room' } } }

// HOME ARM
// { eventTimestamp: 1560156680,
//   eventCid: 9441,
//   zoneCid: '3',
//   sensorType: 0,
//   sensorSerial: '',
//   account: '0005ee1e',
//   userId: 2290758,
//   sid: 2305642,
//   info: 'Exit Delay Countdown Triggered for Home Mode',
//   pinName: '',
//   sensorName: '',
//   messageSubject: '',
//   messageBody: '',
//   eventType: 'activityQuiet',
//   timezone: 8,
//   locationOffset: 60,
//   expires: 30,
//   internal: { dispatcher: 'securitas', shouldNotify: false },
//   senderId: 'wifi',
//   eventId: 5304512529,
//   serviceFeatures:
//    { monitoring: true,
//      alerts: true,
//      online: true,
//      video: true,
//      hazard: false },
//   copsVideoOptIn: true,
//   video:
//    { '1fe89fb1e73405eb7011cd48e006960f':
//       { clipId: 1479460199,
//         preroll: 5,
//         postroll: 45,
//         cameraName: 'Living Room' } },
//   exitDelay: 30 }

// HOME ENGAGED
// { eventTimestamp: 1560156709,
//   eventCid: 3441,
//   zoneCid: '3',
//   sensorType: 0,
//   sensorSerial: '',
//   account: '0005ee1e',
//   userId: 2290758,
//   sid: 2305642,
//   info: 'System Armed (Home) by Remote Management',
//   pinName: '',
//   sensorName: '',
//   messageSubject: 'SimpliSafe System Armed (home mode)',
//   messageBody:
//    'System Armed (home mode): Your SimpliSafe System was armed (home) at Flat 12, Empire Reach on 6-10-19 at 9:51 am',
//   eventType: 'activity',
//   timezone: 8,
//   locationOffset: 60,
//   internal: { dispatcher: 'securitas' },
//   senderId: 'wifi',
//   eventId: 5304513247,
//   serviceFeatures:
//    { monitoring: true,
//      alerts: true,
//      online: true,
//      video: true,
//      hazard: false },
//   copsVideoOptIn: true,
//   video:
//    { '1fe89fb1e73405eb7011cd48e006960f':
//       { clipId: 1479460621,
//         preroll: 0,
//         postroll: 20,
//         cameraName: 'Living Room' } } }

// DISARMED
// { eventTimestamp: 1560156726,
//   eventCid: 1407,
//   zoneCid: '0',
//   sensorType: 0,
//   sensorSerial: '',
//   account: '0005ee1e',
//   userId: 2290758,
//   sid: 2305642,
//   info: 'System Disarmed by Remote',
//   pinName: '',
//   sensorName: '',
//   messageSubject: 'SimpliSafe System Disarmed',
//   messageBody:
//    'System Disarmed: Your SimpliSafe security system was disarmed by Remote at Flat 12, Empire Reach on 6-10-19 at 9:52 am',
//   eventType: 'activity',
//   timezone: 8,
//   locationOffset: 60,
//   internal: { dispatcher: 'securitas' },
//   senderId: 'wifi',
//   eventId: 5304513777,
//   serviceFeatures:
//    { monitoring: true,
//      alerts: true,
//      online: true,
//      video: true,
//      hazard: false },
//   copsVideoOptIn: true,
//   video:
//    { '1fe89fb1e73405eb7011cd48e006960f':
//       { clipId: 1479460927,
//         preroll: 5,
//         postroll: 20,
//         cameraName: 'Living Room' } } }

// AWAY ARMED
// { eventTimestamp: 1560156746,
//   eventCid: 9407,
//   zoneCid: '0',
//   sensorType: 0,
//   sensorSerial: '',
//   account: '0005ee1e',
//   userId: 2290758,
//   sid: 2305642,
//   info: 'Exit Delay Countdown Triggered for Away Mode Remotely',
//   pinName: '',
//   sensorName: '',
//   messageSubject: '',
//   messageBody: '',
//   eventType: 'activityQuiet',
//   timezone: 8,
//   locationOffset: 60,
//   expires: 45,
//   internal: { dispatcher: 'securitas', shouldNotify: false },
//   senderId: 'wifi',
//   eventId: 5304514303,
//   serviceFeatures:
//    { monitoring: true,
//      alerts: true,
//      online: true,
//      video: true,
//      hazard: false },
//   copsVideoOptIn: true,
//   video:
//    { '1fe89fb1e73405eb7011cd48e006960f':
//       { clipId: 1479461243,
//         preroll: 5,
//         postroll: 45,
//         cameraName: 'Living Room' } },
//   exitDelay: 45 }

// AWAY ENGAGED
// { eventTimestamp: 1560156790,
//   eventCid: 3407,
//   zoneCid: '0',
//   sensorType: 0,
//   sensorSerial: '',
//   account: '0005ee1e',
//   userId: 2290758,
//   sid: 2305642,
//   info: 'System Armed (Away) by Remote Management',
//   pinName: '',
//   sensorName: '',
//   messageSubject: 'SimpliSafe System Armed (away mode)',
//   messageBody:
//    'System Armed (away mode): Your SimpliSafe System was armed (away) at Flat 12, Empire Reach on 6-10-19 at 9:53 am',
//   eventType: 'activity',
//   timezone: 8,
//   locationOffset: 60,
//   internal: { dispatcher: 'securitas' },
//   senderId: 'wifi',
//   eventId: 5304515423,
//   serviceFeatures:
//    { monitoring: true,
//      alerts: true,
//      online: true,
//      video: true,
//      hazard: false },
//   copsVideoOptIn: true,
//   video:
//    { '1fe89fb1e73405eb7011cd48e006960f':
//       { clipId: 1479461791,
//         preroll: 0,
//         postroll: 75,
//         cameraName: 'Living Room' } } }