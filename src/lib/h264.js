// Drafted by Claude Opus 5

const startCode = Buffer.from([0, 0, 0, 1]);

// Collects a whole keyframe out of RTP payloads so a snapshot can be decoded from
// the live stream. Depacketization only, no decoding.
// A keyframe is usually several slices sharing one RTP timestamp, so NALs are
// gathered per access unit rather than kept individually
class KeyframeCollector {
    constructor() {
        this.reset();
    }

    reset() {
        this.sps = null;
        this.pps = null;
        this.keyframe = null;
        this.currentTimestamp = null;
        this.accessUnit = [];
        this.fragment = null;
    }

    get complete() {
        return !!this.keyframe;
    }

    annexB() {
        return this.keyframe;
    }

    push(payload, header) {
        if (!payload || !payload.length || !header) return;
        const { timestamp, marker, sequenceNumber } = header;

        if (this.currentTimestamp !== null && timestamp !== this.currentTimestamp) {
            this._endAccessUnit();
        }
        this.currentTimestamp = timestamp;

        const type = payload[0] & 0x1f;

        if (type >= 1 && type <= 23) {
            this._store(Buffer.from(payload));
        } else if (type === 24) { // STAP-A, several NALs in one packet
            let offset = 1;
            while (offset + 2 <= payload.length) {
                const length = payload.readUInt16BE(offset);
                offset += 2;
                if (offset + length > payload.length) break;
                this._store(Buffer.from(payload.subarray(offset, offset + length)));
                offset += length;
            }
        } else if (type === 28) { // FU-A, one NAL split across packets
            const fuHeader = payload[1];
            const nalType = fuHeader & 0x1f;

            if (fuHeader & 0x80) { // start
                this.fragment = {
                    type: nalType,
                    chunks: [Buffer.from([(payload[0] & 0x60) | nalType]), Buffer.from(payload.subarray(2))],
                    nextSequence: (sequenceNumber + 1) & 0xffff
                };
            } else if (this.fragment && this.fragment.type === nalType) {
                // A gap means a lost or reordered fragment. Concatenating across it
                // yields a corrupt NAL and a smeared picture, so drop the whole frame
                if (sequenceNumber !== this.fragment.nextSequence) {
                    this.fragment = null;
                    this.accessUnit = [];
                    return;
                }
                this.fragment.chunks.push(Buffer.from(payload.subarray(2)));
                this.fragment.nextSequence = (sequenceNumber + 1) & 0xffff;
                if (fuHeader & 0x40) { // end
                    this._store(Buffer.concat(this.fragment.chunks));
                    this.fragment = null;
                }
            }
        }

        if (marker) this._endAccessUnit();
    }

    _store(nal) {
        if (!nal.length) return;
        const type = nal[0] & 0x1f;

        // Parameter sets are sent repeatedly, keep the latest outside the access unit
        if (type === 7) this.sps = nal;
        else if (type === 8) this.pps = nal;
        else this.accessUnit.push(nal);
    }

    // An access unit holding an IDR is a complete keyframe, emit every slice of it
    _endAccessUnit() {
        if (this.keyframe) { this.accessUnit = []; return; }

        const hasIdr = this.accessUnit.some(nal => (nal[0] & 0x1f) === 5);
        if (hasIdr && this.sps && this.pps) {
            const parts = [startCode, this.sps, startCode, this.pps];
            for (const nal of this.accessUnit) parts.push(startCode, nal);
            this.keyframe = Buffer.concat(parts);
        }

        this.accessUnit = [];
        this.fragment = null;
    }
}

export default KeyframeCollector;
