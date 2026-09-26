// Drafted by Claude Opus 5
/*global Buffer */

const startCode = Buffer.from([0, 0, 0, 1]);

// Collects SPS/PPS/IDR out of RTP payloads so a snapshot can be decoded from the
// live stream. Depacketization only, no decoding
class KeyframeCollector {
    constructor() {
        this.reset();
    }

    reset() {
        this.sps = null;
        this.pps = null;
        this.idr = null;
        this.fragment = null;
    }

    get complete() {
        return !!(this.sps && this.pps && this.idr);
    }

    _store(type, nal) {
        if (type === 7) this.sps = nal;
        else if (type === 8) this.pps = nal;
        else if (type === 5) this.idr = nal;
    }

    push(payload) {
        if (!payload || !payload.length) return;

        const type = payload[0] & 0x1f;

        if (type >= 1 && type <= 23) {
            this._store(type, Buffer.from(payload));
        } else if (type === 24) { // STAP-A, several NALs in one packet
            let offset = 1;
            while (offset + 2 <= payload.length) {
                const length = payload.readUInt16BE(offset);
                offset += 2;
                if (offset + length > payload.length) break;
                const nal = Buffer.from(payload.subarray(offset, offset + length));
                this._store(nal[0] & 0x1f, nal);
                offset += length;
            }
        } else if (type === 28) { // FU-A, one NAL split across packets
            const header = payload[1];
            const nalType = header & 0x1f;

            if (header & 0x80) { // start
                this.fragment = {
                    type: nalType,
                    chunks: [Buffer.from([(payload[0] & 0x60) | nalType]), Buffer.from(payload.subarray(2))]
                };
            } else if (this.fragment && this.fragment.type === nalType) {
                this.fragment.chunks.push(Buffer.from(payload.subarray(2)));
                if (header & 0x40) { // end
                    this._store(nalType, Buffer.concat(this.fragment.chunks));
                    this.fragment = null;
                }
            }
        }
    }

    // Annex B elementary stream, ready to hand to ffmpeg
    annexB() {
        if (!this.complete) return null;
        return Buffer.concat([startCode, this.sps, startCode, this.pps, startCode, this.idr]);
    }
}

export default KeyframeCollector;
