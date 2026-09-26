const test = require('node:test');
const assert = require('node:assert/strict');

const KeyframeCollector = require('../dist/lib/h264').default;

const START = Buffer.from([0, 0, 0, 1]);

test('collects SPS, PPS and IDR sent as single NAL packets', () => {
    const collector = new KeyframeCollector();

    assert.equal(collector.complete, false);
    collector.push(Buffer.from([0x67, 0x11, 0x22]));  // SPS (type 7)
    assert.equal(collector.complete, false);
    collector.push(Buffer.from([0x68, 0x33]));        // PPS (type 8)
    collector.push(Buffer.from([0x65, 0x44, 0x55]));  // IDR (type 5)

    assert.equal(collector.complete, true);
    assert.deepEqual(collector.annexB(), Buffer.concat([
        START, Buffer.from([0x67, 0x11, 0x22]),
        START, Buffer.from([0x68, 0x33]),
        START, Buffer.from([0x65, 0x44, 0x55]),
    ]));
});

test('unpacks several NALs from one STAP-A packet', () => {
    const collector = new KeyframeCollector();

    collector.push(Buffer.concat([
        Buffer.from([0x78]),                     // STAP-A (type 24)
        Buffer.from([0x00, 0x03]), Buffer.from([0x67, 0xaa, 0xbb]),
        Buffer.from([0x00, 0x02]), Buffer.from([0x68, 0xcc]),
        Buffer.from([0x00, 0x02]), Buffer.from([0x65, 0xdd]),
    ]));

    assert.equal(collector.complete, true);
    assert.deepEqual(collector.sps, Buffer.from([0x67, 0xaa, 0xbb]));
    assert.deepEqual(collector.pps, Buffer.from([0x68, 0xcc]));
    assert.deepEqual(collector.idr, Buffer.from([0x65, 0xdd]));
});

test('reassembles a NAL split across FU-A packets', () => {
    const collector = new KeyframeCollector();

    collector.push(Buffer.from([0x67, 0x01]));
    collector.push(Buffer.from([0x68, 0x02]));

    // FU-A indicator 0x7c (type 28, NRI 3), IDR payload split three ways
    collector.push(Buffer.from([0x7c, 0x85, 0xa1, 0xa2])); // start bit set
    collector.push(Buffer.from([0x7c, 0x05, 0xb1]));       // middle
    collector.push(Buffer.from([0x7c, 0x45, 0xc1]));       // end bit set

    assert.equal(collector.complete, true);
    // NRI is carried over from the indicator and the FU header type restored
    assert.deepEqual(collector.idr, Buffer.from([0x65, 0xa1, 0xa2, 0xb1, 0xc1]));
});

test('ignores an FU-A continuation with no start packet', () => {
    const collector = new KeyframeCollector();

    collector.push(Buffer.from([0x67, 0x01]));
    collector.push(Buffer.from([0x68, 0x02]));
    collector.push(Buffer.from([0x7c, 0x45, 0xc1])); // end without start

    assert.equal(collector.complete, false);
    assert.equal(collector.annexB(), null);
});

test('reset clears collected NALs so the next keyframe starts clean', () => {
    const collector = new KeyframeCollector();

    collector.push(Buffer.from([0x67, 0x01]));
    collector.push(Buffer.from([0x68, 0x02]));
    collector.push(Buffer.from([0x65, 0x03]));
    assert.equal(collector.complete, true);

    collector.reset();
    assert.equal(collector.complete, false);
    assert.equal(collector.sps, null);
});

test('tolerates empty and unknown packet types', () => {
    const collector = new KeyframeCollector();

    assert.doesNotThrow(() => {
        collector.push(null);
        collector.push(Buffer.alloc(0));
        collector.push(Buffer.from([0x79, 0x00])); // type 25, not handled
    });
    assert.equal(collector.complete, false);
});
