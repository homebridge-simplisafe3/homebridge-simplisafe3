const test = require('node:test');
const assert = require('node:assert/strict');

const { parseToc, splitPacket } = require('../dist/lib/opus');

test('reads mode, frame size and channels from the TOC byte', () => {
    assert.deepEqual(parseToc(Buffer.from([0x78])), { mode: 'Hybrid', frameMs: 20, stereo: false, frames: 1 }); // config 15
    assert.deepEqual(parseToc(Buffer.from([0xfc])), { mode: 'CELT', frameMs: 20, stereo: true, frames: 1 });    // config 31, s=1
    assert.deepEqual(parseToc(Buffer.from([0x01])), { mode: 'SILK', frameMs: 10, stereo: false, frames: 2 });   // config 0, code 1
});

test('reads the frame count of a code 3 packet', () => {
    assert.deepEqual(parseToc(Buffer.from([0x5b, 0x03])), { mode: 'SILK', frameMs: 60, stereo: false, frames: 3 }); // config 11
});

test('handles empty payloads', () => {
    assert.equal(parseToc(Buffer.alloc(0)), null);
});

test('leaves single-frame packets untouched', () => {
    const packet = Buffer.from([0x08, 1, 2, 3]);
    assert.deepEqual(splitPacket(packet), [packet]);
});

test('splits a VBR code 3 packet into single-frame packets', () => {
    // SILK WB 20ms, code 3, VBR, 3 frames sized 2, 1 and 3
    const packet = Buffer.from([0x4b, 0x83, 2, 1, 0xa1, 0xa2, 0xb1, 0xc1, 0xc2, 0xc3]);
    assert.deepEqual(splitPacket(packet), [
        Buffer.from([0x48, 0xa1, 0xa2]),
        Buffer.from([0x48, 0xb1]),
        Buffer.from([0x48, 0xc1, 0xc2, 0xc3]),
    ]);
});

test('splits a CBR code 3 packet and drops its padding', () => {
    // 2 frames of 2 bytes, then 3 bytes of padding
    const packet = Buffer.from([0x4b, 0x42, 3, 0xa1, 0xa2, 0xb1, 0xb2, 0, 0, 0]);
    assert.deepEqual(splitPacket(packet), [Buffer.from([0x48, 0xa1, 0xa2]), Buffer.from([0x48, 0xb1, 0xb2])]);
});

test('reads two-byte frame lengths', () => {
    // code 2, first frame is 252 + 1*4 = 256 bytes
    const first = Buffer.alloc(256, 0xa1);
    const packet = Buffer.concat([Buffer.from([0x4a, 252, 1]), first, Buffer.from([0xb1])]);
    assert.deepEqual(splitPacket(packet), [Buffer.concat([Buffer.from([0x48]), first]), Buffer.from([0x48, 0xb1])]);
});

test('splits code 1 packets into two equal frames', () => {
    assert.deepEqual(splitPacket(Buffer.from([0x49, 0xa1, 0xb1])), [Buffer.from([0x48, 0xa1]), Buffer.from([0x48, 0xb1])]);
});

test('forwards malformed packets as they are', () => {
    const packet = Buffer.from([0x4b, 0x83, 50, 0xa1]);
    assert.deepEqual(splitPacket(packet), [packet]);
});
