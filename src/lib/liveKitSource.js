/*global Buffer */
import { Room, RoomEvent, TrackKind, VideoStream } from '@livekit/rtc-node';

const TRACK_TIMEOUT_MS = 60000;

class LiveKitSource {
    constructor(ss3Camera) {
        this.ss3Camera = ss3Camera;
        this.simplisafe = ss3Camera.simplisafe;
        this.log = ss3Camera.log;
        this.debug = ss3Camera.debug;

        this.room = null;
        this.videoTrack = null;
        this.videoStream = null;
        this.videoMeta = null;
        this.latestFrame = null;
        this.writer = null;
        this._stopping = false;
        this._consumerTask = null;
        this._metaResolve = null;
    }

    async connect() {
        const liveView = await this.simplisafe.getCameraLiveView(this.ss3Camera.id);
        if (!liveView || !liveView.liveKitDetails || !liveView.liveKitDetails.userToken) {
            throw new Error('Missing liveKitDetails in /live-view response');
        }
        if (this.debug) this.log(`LiveKit: cameraStatus=${liveView.cameraStatus}`);

        const { liveKitURL, userToken } = liveView.liveKitDetails;
        this.room = new Room();

        const videoTrackPromise = new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`Timed out waiting for camera video track after ${TRACK_TIMEOUT_MS}ms`)),
                TRACK_TIMEOUT_MS
            );
            this.room.on(RoomEvent.TrackSubscribed, (track) => {
                if (track.kind === TrackKind.KIND_VIDEO && !this.videoTrack) {
                    clearTimeout(timer);
                    resolve(track);
                }
            });
            this.room.on(RoomEvent.Disconnected, (reason) => {
                clearTimeout(timer);
                reject(new Error(`LiveKit disconnected before video track arrived (reason=${reason})`));
            });
        });

        if (this.debug) this.log(`LiveKit: connecting to ${liveKitURL} for camera ${this.ss3Camera.name}`);
        await this.room.connect(liveKitURL, userToken, { autoSubscribe: true, dynacast: true });

        this.videoTrack = await videoTrackPromise;
        this.videoStream = new VideoStream(this.videoTrack);

        const metaReady = new Promise((resolve) => { this._metaResolve = resolve; });
        this._consumerTask = this._consumeVideo().catch((err) => {
            if (!this._stopping) this.log.error(`LiveKit consume error: ${err.message || err}`);
        });

        this.videoMeta = await metaReady;
        return this.videoMeta;
    }

    async _consumeVideo() {
        for await (const event of this.videoStream) {
            if (this._stopping) break;
            const frame = event && event.frame ? event.frame : event;
            if (!frame || !frame.data) continue;

            if (!this.videoMeta) {
                this.videoMeta = { width: frame.width, height: frame.height, type: frame.type };
                if (this.debug) this.log(`LiveKit: first frame ${frame.width}x${frame.height} type=${frame.type}`);
                if (this._metaResolve) {
                    this._metaResolve(this.videoMeta);
                    this._metaResolve = null;
                }
            }

            this.latestFrame = frame;

            if (this.writer && this.writer.writable && !this.writer.destroyed) {
                const buf = Buffer.from(frame.data.buffer, frame.data.byteOffset || 0, frame.data.byteLength);
                this.writer.write(buf);
            }
        }
    }

    setWriter(writer) {
        this.writer = writer;
    }

    getVideoMeta() {
        return this.videoMeta;
    }

    getLatestFrameCopy() {
        if (!this.latestFrame || !this.latestFrame.data) return null;
        const f = this.latestFrame;
        const src = new Uint8Array(f.data.buffer, f.data.byteOffset || 0, f.data.byteLength);
        return {
            data: Buffer.from(src),
            width: f.width,
            height: f.height,
            type: f.type
        };
    }

    async disconnect() {
        this._stopping = true;
        this.writer = null;

        if (this.videoStream && typeof this.videoStream.close === 'function') {
            try { await this.videoStream.close(); } catch (e) { /* ignore */ }
        }
        if (this.room) {
            try { await this.room.disconnect(); } catch (e) { /* ignore */ }
        }

        this.room = null;
        this.videoTrack = null;
        this.videoStream = null;
        this.latestFrame = null;
    }
}

export default LiveKitSource;
