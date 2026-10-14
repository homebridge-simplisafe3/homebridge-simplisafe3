// Drafted by Claude Opus 5.5

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
