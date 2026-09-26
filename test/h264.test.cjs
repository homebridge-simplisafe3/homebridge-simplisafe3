const test = require('node:test');
const assert = require('node:assert/strict');

const KeyframeCollector = require('../dist/lib/h264').default;

const START = Buffer.from([0, 0, 0, 1]);
const TS = 1000;

test('collects SPS, PPS and IDR sent as single NAL packets', () => {
    const collector = new KeyframeCollector();

    collector.push(Buffer.from([0x67, 0x11, 0x22]), TS, false);  // SPS
    collector.push(Buffer.from([0x68, 0x33]), TS, false);        // PPS
    assert.equal(collector.complete, false);
    collector.push(Buffer.from([0x65, 0x44, 0x55]), TS, true);   // IDR, marker ends the frame

    assert.equal(collector.complete, true);
    assert.deepEqual(collector.annexB(), Buffer.concat([
        START, Buffer.from([0x67, 0x11, 0x22]),
        START, Buffer.from([0x68, 0x33]),
        START, Buffer.from([0x65, 0x44, 0x55]),
    ]));
});

test('keeps every slice of a multi-slice keyframe', () => {
    // Regression: only retaining the last IDR NAL produced a partly decoded,
    // smeared snapshot on the 1536x1536 doorbell
    const collector = new KeyframeCollector();

    collector.push(Buffer.from([0x67, 0x01]), TS, false);
    collector.push(Buffer.from([0x68, 0x02]), TS, false);
    collector.push(Buffer.from([0x65, 0xa1]), TS, false);   // slice 1
    collector.push(Buffer.from([0x65, 0xa2]), TS, false);   // slice 2
    collector.push(Buffer.from([0x65, 0xa3]), TS, true);    // slice 3, end of frame

    assert.equal(collector.complete, true);
    assert.deepEqual(collector.annexB(), Buffer.concat([
        START, Buffer.from([0x67, 0x01]),
        START, Buffer.from([0x68, 0x02]),
        START, Buffer.from([0x65, 0xa1]),
        START, Buffer.from([0x65, 0xa2]),
        START, Buffer.from([0x65, 0xa3]),
    ]));
});

test('a change of RTP timestamp also ends the access unit', () => {
    const collector = new KeyframeCollector();

    collector.push(Buffer.from([0x67, 0x01]), TS, false);
    collector.push(Buffer.from([0x68, 0x02]), TS, false);
    collector.push(Buffer.from([0x65, 0xb1]), TS, false);
    collector.push(Buffer.from([0x65, 0xb2]), TS, false);
    assert.equal(collector.complete, false);

    collector.push(Buffer.from([0x41, 0xc1]), TS + 3000, false);  // next frame arrives

    assert.equal(collector.complete, true);
    assert.equal(collector.annexB().length, 4 * 4 + 2 + 2 + 2 + 2);
});

test('does not emit a keyframe from non-IDR slices', () => {
    const collector = new KeyframeCollector();

    collector.push(Buffer.from([0x67, 0x01]), TS, false);
    collector.push(Buffer.from([0x68, 0x02]), TS, false);
    collector.push(Buffer.from([0x41, 0xd1]), TS, true);   // non-IDR only

    assert.equal(collector.complete, false);
    assert.equal(collector.annexB(), null);
});

test('does not emit without parameter sets', () => {
    const collector = new KeyframeCollector();

    collector.push(Buffer.from([0x65, 0xe1]), TS, true);   // IDR with no SPS/PPS yet

    assert.equal(collector.complete, false);
});

test('unpacks several NALs from one STAP-A packet', () => {
    const collector = new KeyframeCollector();

    collector.push(Buffer.concat([
        Buffer.from([0x78]),
        Buffer.from([0x00, 0x03]), Buffer.from([0x67, 0xaa, 0xbb]),
        Buffer.from([0x00, 0x02]), Buffer.from([0x68, 0xcc]),
        Buffer.from([0x00, 0x02]), Buffer.from([0x65, 0xdd]),
    ]), TS, true);

    assert.equal(collector.complete, true);
    assert.deepEqual(collector.sps, Buffer.from([0x67, 0xaa, 0xbb]));
    assert.deepEqual(collector.pps, Buffer.from([0x68, 0xcc]));
});

test('reassembles a NAL split across FU-A packets', () => {
    const collector = new KeyframeCollector();

    collector.push(Buffer.from([0x67, 0x01]), TS, false);
    collector.push(Buffer.from([0x68, 0x02]), TS, false);
    collector.push(Buffer.from([0x7c, 0x85, 0xa1, 0xa2]), TS, false); // start
    collector.push(Buffer.from([0x7c, 0x05, 0xb1]), TS, false);       // middle
    collector.push(Buffer.from([0x7c, 0x45, 0xc1]), TS, true);        // end

    assert.equal(collector.complete, true);
    assert.ok(collector.annexB().includes(Buffer.from([0x65, 0xa1, 0xa2, 0xb1, 0xc1])));
});

test('ignores an FU-A continuation with no start packet', () => {
    const collector = new KeyframeCollector();

    collector.push(Buffer.from([0x67, 0x01]), TS, false);
    collector.push(Buffer.from([0x68, 0x02]), TS, false);
    collector.push(Buffer.from([0x7c, 0x45, 0xc1]), TS, true);

    assert.equal(collector.complete, false);
});

test('reset clears collected state so the next keyframe starts clean', () => {
    const collector = new KeyframeCollector();

    collector.push(Buffer.from([0x67, 0x01]), TS, false);
    collector.push(Buffer.from([0x68, 0x02]), TS, false);
    collector.push(Buffer.from([0x65, 0x03]), TS, true);
    assert.equal(collector.complete, true);

    collector.reset();
    assert.equal(collector.complete, false);
    assert.equal(collector.sps, null);
});

test('tolerates empty and unknown packet types', () => {
    const collector = new KeyframeCollector();

    assert.doesNotThrow(() => {
        collector.push(null, TS, false);
        collector.push(Buffer.alloc(0), TS, false);
        collector.push(Buffer.from([0x79, 0x00]), TS, false);
    });
    assert.equal(collector.complete, false);
});
