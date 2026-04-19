/*global Buffer */
import { spawn } from 'child_process';
import { Room, RoomEvent, TrackKind, VideoStream } from '@livekit/rtc-node';

const TRACK_TIMEOUT_MS = 60000;

export function i420ToJpeg(i420Data, width, height, ffmpegPath) {
    return new Promise((resolve, reject) => {
        const cmd = spawn(ffmpegPath, [
            '-f', 'rawvideo',
            '-pix_fmt', 'yuv420p',
            '-s', `${width}x${height}`,
            '-i', '-',
            '-frames:v', '1',
            '-f', 'image2',
            '-vcodec', 'mjpeg',
            '-'
        ]);
        const chunks = [];
        let stderr = '';
        cmd.stdout.on('data', (d) => chunks.push(d));
        cmd.stderr.on('data', (d) => { stderr += d.toString(); });
        cmd.on('close', (code) => {
            if (code === 0) resolve(Buffer.concat(chunks));
            else reject(new Error(`ffmpeg jpeg exited with ${code}: ${stderr.slice(-200)}`));
        });
        cmd.on('error', reject);
        cmd.stdin.on('error', () => { /* ignore EPIPE */ });
        cmd.stdin.end(i420Data);
    });
}

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
        // The SS web app fires a POST to /camera-wakeup before every stream session.
        // Without it, an already-'online' (warm) camera stays out of the LiveKit room
        // and we time out waiting for its video track. Fire this unconditionally and
        // treat failures as non-fatal (cold/offline cams get woken by /live-view too).
        try {
            await this.simplisafe.wakeCameras();
            if (this.debug) this.log('LiveKit: camera-wakeup POST accepted');
        } catch (err) {
            if (this.debug) this.log(`LiveKit: camera-wakeup failed (continuing): ${err.message || err}`);
        }

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
        // Drop frames while FFmpeg stdin backpressures (slow consumers like RPi).
        // Queuing every raw I420 frame would OOM fast (1080p ~3MB/frame @ 20fps ≈ 60MB/s).
        let backpressure = false;
        const onDrain = () => { backpressure = false; };

        try {
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
                    if (backpressure) continue;
                    const buf = Buffer.from(frame.data.buffer, frame.data.byteOffset || 0, frame.data.byteLength);
                    if (!this.writer.write(buf)) {
                        backpressure = true;
                        this.writer.once('drain', onDrain);
                    }
                }
            }
        } finally {
            // Iterator ended (camera went away, room closed, etc.) — send EOF to FFmpeg
            // so its 'close' handler runs and HomeKit's streaming session is torn down.
            if (this.writer && !this.writer.destroyed) {
                try {
                    this.writer.removeListener('drain', onDrain);
                    this.writer.end();
                } catch (e) { /* ignore */ }
            }
        }
    }

    setWriter(writer) {
        this.writer = writer;
    }

    async captureSnapshotBuffer() {
        // connect() resolves once the first frame lands. getLatestFrameCopy()
        // returns a deep copy, so we can safely disconnect before returning.
        try {
            await this.connect();
            return this.getLatestFrameCopy();
        } finally {
            await this.disconnect();
        }
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
        // Wait for the background _consumeVideo coroutine to actually exit.
        // Without this, disconnect() returns while the LiveKit H.264 decoder
        // is still running, burning CPU forever on resource-constrained hosts.
        if (this._consumerTask) {
            try { await this._consumerTask; } catch (e) { /* ignore */ }
        }

        this.room = null;
        this.videoTrack = null;
        this.videoStream = null;
        this.latestFrame = null;
        this._consumerTask = null;
    }
}

export default LiveKitSource;
