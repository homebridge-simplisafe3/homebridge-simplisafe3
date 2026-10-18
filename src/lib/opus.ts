// Drafted by Claude Opus 5.5

import { RtpHeader } from 'werift';

export interface OpusToc {
    mode: 'SILK' | 'Hybrid' | 'CELT';
    frameMs: number;
    stereo: boolean;
    frames: number;
}

// Subset of werift's RtpHeader the stats need
export interface RtpHeaderFields {
    timestamp: number;
    payloadType: number;
    ssrc: number;
    extension: boolean;
    padding: boolean;
}

const silkMs = [10, 20, 40, 60];
const hybridMs = [10, 20];
const celtMs = [2.5, 5, 10, 20];
const maxDeltas = 8;

// RFC 6716 section 3.1, reads the TOC byte without decoding anything
export function parseToc(payload: Buffer): OpusToc | null {
    if (!payload || payload.length === 0) return null;

    const toc = payload[0];
    const config = toc >> 3;
    const code = toc & 0x03;

    let mode: OpusToc['mode'];
    let frameMs: number;
    if (config < 12) {
        mode = 'SILK';
        frameMs = silkMs[config % 4];
    } else if (config < 16) {
        mode = 'Hybrid';
        frameMs = hybridMs[config % 2];
    } else {
        mode = 'CELT';
        frameMs = celtMs[config % 4];
    }

    let frames = code === 0 ? 1 : 2;
    if (code === 3) frames = payload.length > 1 ? payload[1] & 0x3f : 0;

    return { mode, frameMs, stereo: (toc & 0x04) !== 0, frames };
}

// RFC 6716 section 3.2, the frames of a packet without decoding them, null if malformed
function frames(packet: Buffer): Buffer[] | null {
    const code = packet[0] & 0x03;
    if (code === 0) return [packet.subarray(1)];

    // Code 1 and 2 are two frames, equal or sized; code 3 carries its own count, sizing and padding
    let count = 2;
    let sized = code === 2;
    let offset = 1;
    let padding = 0;
    if (code === 3) {
        if (packet.length < 2) return null;
        count = packet[1] & 0x3f;
        sized = (packet[1] & 0x80) !== 0;
        offset = 2;
        let more = (packet[1] & 0x40) !== 0;
        while (more) {
            const value = packet[offset++];
            if (value === undefined) return null;
            padding += value === 255 ? 254 : value;
            more = value === 255;
        }
    }

    const sizes: number[] = [];
    while (sized && sizes.length < count - 1) {
        const first = packet[offset];
        if (first === undefined) return null;
        if (first < 252) {
            sizes.push(first);
            offset += 1;
        } else {
            sizes.push(packet[offset + 1] * 4 + first);
            offset += 2;
        }
    }

    const remaining = packet.length - padding - offset;
    if (sized) {
        sizes.push(remaining - sizes.reduce((a, b) => a + b, 0));
    } else {
        while (sizes.length < count) sizes.push(remaining / count);
    }
    if (count === 0 || sizes.some(size => !Number.isInteger(size) || size < 0)) return null;

    return sizes.map(size => packet.subarray(offset, (offset += size)));
}

// Splits a multi-frame packet into single-frame (code 0) packets, a malformed one comes back as is
export function splitPacket(packet: Buffer): Buffer[] {
    if (!packet || packet.length === 0 || (packet[0] & 0x03) === 0) return [packet];

    const parts = frames(packet);
    if (!parts) return [packet];

    const toc = Buffer.from([packet[0] & 0xfc]);
    return parts.map(frame => Buffer.concat([toc, frame]));
}

export interface Rtp {
    header: RtpHeader;
    payload: Buffer;
}

// HomeKit only plays one Opus frame per packet, some cameras send several (e.g. 5x20ms)
export class OpusRepacketizer {
    declare private sequenceNumber: number;
    declare private lastSequence: number | null;

    constructor() {
        this.sequenceNumber = 0;
        this.lastSequence = null;
    }

    split(rtp: Rtp): Rtp[] {
        // werift can report the same track twice, so the same packet arrives twice
        if (rtp.header.sequenceNumber === this.lastSequence) return [];
        this.lastSequence = rtp.header.sequenceNumber;

        const toc = parseToc(rtp.payload);
        const step = toc ? toc.frameMs * 48 : 0; // Opus RTP clock is always 48kHz

        // New headers, the duplicate subscriber gets this same packet object
        return splitPacket(rtp.payload).map((payload, i) => {
            const header = new RtpHeader({
                ...rtp.header,
                sequenceNumber: this.sequenceNumber,
                timestamp: (rtp.header.timestamp + i * step) >>> 0,
                padding: false
            });
            this.sequenceNumber = (this.sequenceNumber + 1) & 0xffff;
            return { header, payload };
        });
    }
}

export function describeToc(toc: OpusToc | null): string {
    if (!toc) return 'empty';
    return `${toc.mode} ${toc.stereo ? 'stereo' : 'mono'} ${toc.frames}x${toc.frameMs}ms`;
}

// Per-track tally of what an Opus RTP stream actually carries, for debug logs
export class OpusTrackStats {
    declare packets: number;
    declare bytes: number;
    declare first: RtpHeaderFields | null;
    declare private lastTimestamp: number | null;
    declare private tocs: Map<string, number>;
    declare private deltas: Map<number, number>;
    declare private extensions: number;

    constructor() {
        this.packets = 0;
        this.bytes = 0;
        this.first = null;
        this.lastTimestamp = null;
        this.tocs = new Map();
        this.deltas = new Map();
        this.extensions = 0;
    }

    push(payload: Buffer, header: RtpHeaderFields): void {
        if (!this.first) this.first = { ...header };
        this.packets++;
        this.bytes += payload.length;
        if (header.extension) this.extensions++;

        const key = describeToc(parseToc(payload));
        this.tocs.set(key, (this.tocs.get(key) ?? 0) + 1);

        if (this.lastTimestamp !== null) {
            const delta = (header.timestamp - this.lastTimestamp) >>> 0;
            if (this.deltas.has(delta) || this.deltas.size < maxDeltas) this.deltas.set(delta, (this.deltas.get(delta) ?? 0) + 1);
        }
        this.lastTimestamp = header.timestamp;
    }

    summary(): string {
        if (!this.packets) return 'no packets';
        const tocs = [...this.tocs].map(([k, n]) => `${k}: ${n}`).join(', ');
        const deltas = [...this.deltas].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d}: ${n}`).join(', ');
        const avg = Math.round(this.bytes / this.packets);
        return `${this.packets} packets, avg ${avg}B, extensions ${this.extensions}, frames [${tocs}], timestamp steps [${deltas}]`;
    }
}
