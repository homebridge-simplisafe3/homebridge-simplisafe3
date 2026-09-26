const test = require('node:test');
const assert = require('node:assert/strict');

const KeyframeCollector = require('../dist/lib/h264').default;

const START = Buffer.from([0, 0, 0, 1]);
const TS = 1000;
let seq = 0;
const hdr = (marker, ts = TS) => ({ timestamp: ts, marker: marker, sequenceNumber: seq++ });

test('collects SPS, PPS and IDR sent as single NAL packets', () => {
    const collector = new KeyframeCollector();
    seq = 0;

    collector.push(Buffer.from([0x67, 0x11, 0x22]), hdr(false));  // SPS
    collector.push(Buffer.from([0x68, 0x33]), hdr(false));        // PPS
    assert.equal(collector.complete, false);
    collector.push(Buffer.from([0x65, 0x44, 0x55]), hdr(true));   // IDR, marker ends the frame

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
    seq = 0;

    collector.push(Buffer.from([0x67, 0x01]), hdr(false));
    collector.push(Buffer.from([0x68, 0x02]), hdr(false));
    collector.push(Buffer.from([0x65, 0xa1]), hdr(false));   // slice 1
    collector.push(Buffer.from([0x65, 0xa2]), hdr(false));   // slice 2
    collector.push(Buffer.from([0x65, 0xa3]), hdr(true));    // slice 3, end of frame

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
    seq = 0;

    collector.push(Buffer.from([0x67, 0x01]), hdr(false));
    collector.push(Buffer.from([0x68, 0x02]), hdr(false));
    collector.push(Buffer.from([0x65, 0xb1]), hdr(false));
    collector.push(Buffer.from([0x65, 0xb2]), hdr(false));
    assert.equal(collector.complete, false);

    collector.push(Buffer.from([0x41, 0xc1]), hdr(false, TS + 3000));  // next frame arrives

    assert.equal(collector.complete, true);
    assert.equal(collector.annexB().length, 4 * 4 + 2 + 2 + 2 + 2);
});

test('does not emit a keyframe from non-IDR slices', () => {
    const collector = new KeyframeCollector();
    seq = 0;

    collector.push(Buffer.from([0x67, 0x01]), hdr(false));
    collector.push(Buffer.from([0x68, 0x02]), hdr(false));
    collector.push(Buffer.from([0x41, 0xd1]), hdr(true));   // non-IDR only

    assert.equal(collector.complete, false);
    assert.equal(collector.annexB(), null);
});

test('does not emit without parameter sets', () => {
    const collector = new KeyframeCollector();
    seq = 0;

    collector.push(Buffer.from([0x65, 0xe1]), hdr(true));   // IDR with no SPS/PPS yet

    assert.equal(collector.complete, false);
});

test('unpacks several NALs from one STAP-A packet', () => {
    const collector = new KeyframeCollector();
    seq = 0;

    collector.push(Buffer.concat([
        Buffer.from([0x78]),
        Buffer.from([0x00, 0x03]), Buffer.from([0x67, 0xaa, 0xbb]),
        Buffer.from([0x00, 0x02]), Buffer.from([0x68, 0xcc]),
        Buffer.from([0x00, 0x02]), Buffer.from([0x65, 0xdd]),
    ]), hdr(true));

    assert.equal(collector.complete, true);
    assert.deepEqual(collector.sps, Buffer.from([0x67, 0xaa, 0xbb]));
    assert.deepEqual(collector.pps, Buffer.from([0x68, 0xcc]));
});

test('reassembles a NAL split across FU-A packets', () => {
    const collector = new KeyframeCollector();
    seq = 0;

    collector.push(Buffer.from([0x67, 0x01]), hdr(false));
    collector.push(Buffer.from([0x68, 0x02]), hdr(false));
    collector.push(Buffer.from([0x7c, 0x85, 0xa1, 0xa2]), hdr(false)); // start
    collector.push(Buffer.from([0x7c, 0x05, 0xb1]), hdr(false));       // middle
    collector.push(Buffer.from([0x7c, 0x45, 0xc1]), hdr(true));        // end

    assert.equal(collector.complete, true);
    assert.ok(collector.annexB().includes(Buffer.from([0x65, 0xa1, 0xa2, 0xb1, 0xc1])));
});

test('ignores an FU-A continuation with no start packet', () => {
    const collector = new KeyframeCollector();
    seq = 0;

    collector.push(Buffer.from([0x67, 0x01]), hdr(false));
    collector.push(Buffer.from([0x68, 0x02]), hdr(false));
    collector.push(Buffer.from([0x7c, 0x45, 0xc1]), hdr(true));

    assert.equal(collector.complete, false);
});

test('reset clears collected state so the next keyframe starts clean', () => {
    const collector = new KeyframeCollector();
    seq = 0;

    collector.push(Buffer.from([0x67, 0x01]), hdr(false));
    collector.push(Buffer.from([0x68, 0x02]), hdr(false));
    collector.push(Buffer.from([0x65, 0x03]), hdr(true));
    assert.equal(collector.complete, true);

    collector.reset();
    assert.equal(collector.complete, false);
    assert.equal(collector.sps, null);
});

test('tolerates empty and unknown packet types', () => {
    const collector = new KeyframeCollector();
    seq = 0;

    assert.doesNotThrow(() => {
        collector.push(null, hdr(false));
        collector.push(Buffer.alloc(0), hdr(false));
        collector.push(Buffer.from([0x79, 0x00]), hdr(false));
    });
    assert.equal(collector.complete, false);
});

test('discards a keyframe when an FU-A fragment is lost', () => {
    const collector = new KeyframeCollector();
    seq = 0;

    collector.push(Buffer.from([0x67, 0x01]), hdr(false));
    collector.push(Buffer.from([0x68, 0x02]), hdr(false));
    collector.push(Buffer.from([0x7c, 0x85, 0xa1]), hdr(false));            // FU-A start
    seq++;                                                                   // a packet goes missing
    collector.push(Buffer.from([0x7c, 0x45, 0xc1]), hdr(true));             // FU-A end, wrong seq

    // Better to wait for the next keyframe than to serve a smeared one
    assert.equal(collector.complete, false);
});
