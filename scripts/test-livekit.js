#!/usr/bin/env node

/*
 * POC: Join the SimpliSafe live-view LiveKit room for an SSOBCM4 (outdoor cam)
 * and validate the full signaling + media flow before wiring any of it into
 * the Homebridge plugin.
 *
 * Usage:
 *   npm install @livekit/rtc-node      # one-time, before first run
 *   node scripts/test-livekit.js --camera <uuid> --sid <subscriptionId>
 *
 * Optional flags:
 *   --auth-file <path>    Path to simplisafe3auth.json
 *                         Default search order:
 *                           $SS3_AUTH_FILE
 *                           ~/.homebridge/simplisafe3auth.json
 *                           /volume1/homebridge/simplisafe3auth.json   (Synology)
 *                           /homebridge/simplisafe3auth.json           (Docker)
 *   --out-dir <path>      Where to dump raw video (default: os tmpdir)
 *   --duration <seconds>  How long to record after first frame (default: 10)
 *   --wait <seconds>      How long to wait for camera to start publishing
 *                         (default: 60; outdoor cams sleep until poked)
 *
 * What it prints:
 *   - HTTP response from /v2/cameras/{uuid}/{sid}/live-view
 *   - Every LiveKit event (Connected, ParticipantConnected, TrackPublished,
 *     TrackSubscribed, ConnectionStateChanged, ...)
 *   - First video frame metadata (width, height, pixel format)
 *   - Periodic frame counter
 *   - ffmpeg command you can paste to render the raw dump into a PNG/MP4
 *
 * This script is intentionally dependency-light and CommonJS so it runs under
 * plain `node` without the Babel pipeline the rest of src/ uses.
 */

/* eslint-disable no-console */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_HUB = 'https://app-hub.prd.aser.simplisafe.com';

function parseArgs() {
    const args = process.argv.slice(2);
    const out = { duration: 10, wait: 60 };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        const next = () => args[++i];
        if (a === '--camera' || a === '-c') out.camera = next();
        else if (a === '--sid' || a === '-s') out.sid = next();
        else if (a === '--auth-file' || a === '-a') out.authFile = next();
        else if (a === '--out-dir' || a === '-o') out.outDir = next();
        else if (a === '--duration' || a === '-d') out.duration = parseInt(next(), 10);
        else if (a === '--wait' || a === '-w') out.wait = parseInt(next(), 10);
        else if (a === '--help' || a === '-h') { help(); process.exit(0); }
        else { console.error(`Unknown arg: ${a}`); help(); process.exit(1); }
    }
    out.outDir = out.outDir || path.join(os.tmpdir(), 'ss3-livekit-poc');
    if (!out.camera || !out.sid) { help(); process.exit(1); }
    return out;
}

function help() {
    console.log(`
Usage: node scripts/test-livekit.js --camera <uuid> --sid <subscriptionId> [options]

Required:
  --camera, -c       Camera UUID (from "Discovered camera ..." debug log)
  --sid, -s          Subscription id (the "sid" field in the discovery JSON)

Optional:
  --auth-file, -a    Path to simplisafe3auth.json
  --out-dir, -o      Directory for raw video dump
  --duration, -d     Seconds of video to record (default: 10)
  --wait, -w         Max seconds to wait for first frame (default: 60)
`);
}

function findAuthFile(explicit) {
    const candidates = [
        explicit,
        process.env.SS3_AUTH_FILE,
        path.join(process.env.HOME || '', '.homebridge/simplisafe3auth.json'),
        '/volume1/homebridge/simplisafe3auth.json',
        '/homebridge/simplisafe3auth.json',
    ].filter(Boolean);
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    throw new Error(`No simplisafe3auth.json found. Tried:\n  ${candidates.join('\n  ')}`);
}

function readAccessToken(authPath) {
    const parsed = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    if (!parsed.accessToken) throw new Error(`No "accessToken" field in ${authPath}`);
    return parsed.accessToken;
}

const ts = () => new Date().toISOString();
const log = (tag, ...rest) => console.log(`[${ts()}] ${tag}`, ...rest);

async function getLiveView(accessToken, cameraUuid, sid) {
    const url = `${APP_HUB}/v2/cameras/${cameraUuid}/${sid}/live-view`;
    log('GET', url);
    const resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
    });
    log('HTTP', resp.status);
    if (resp.status >= 400) {
        throw new Error(`live-view failed: ${resp.status} ${JSON.stringify(resp.data)}`);
    }
    const { liveKitDetails, cameraStatus } = resp.data || {};
    log('response', JSON.stringify({
        cameraStatus,
        liveKitURL: liveKitDetails && liveKitDetails.liveKitURL,
        userTokenLen: liveKitDetails && liveKitDetails.userToken && liveKitDetails.userToken.length,
    }));
    if (!liveKitDetails || !liveKitDetails.userToken || !liveKitDetails.liveKitURL) {
        throw new Error(`Missing liveKitDetails: ${JSON.stringify(resp.data)}`);
    }
    return { ...liveKitDetails, cameraStatus };
}

function requireRtcNode() {
    try {
        return require('@livekit/rtc-node');
    } catch (e) {
        console.error('\n@livekit/rtc-node is not installed. Install it with:\n');
        console.error('  npm install @livekit/rtc-node\n');
        throw e;
    }
}

async function runRoom(liveKitUrl, token, opts) {
    const rtc = requireRtcNode();
    // Defensive about API shape — log what the module actually exports.
    log('rtc-node exports', Object.keys(rtc).join(', '));

    const { Room, RoomEvent, TrackKind, VideoStream, AudioStream } = rtc;

    fs.mkdirSync(opts.outDir, { recursive: true });

    const state = {
        gotFirstVideo: false,
        videoFrames: 0,
        audioFrames: 0,
        videoMeta: null,
        videoFile: null,
        videoFilePath: null,
        startedAt: Date.now(),
    };

    const room = new Room();

    const hook = (name) => room.on(RoomEvent[name], (...args) =>
        log(`event:${name}`, args.map(summarize).join(' | '))
    );
    // Log broadly — helps us learn what SS actually sends.
    [
        'Connected', 'Disconnected', 'Reconnecting', 'Reconnected',
        'ParticipantConnected', 'ParticipantDisconnected',
        'TrackPublished', 'TrackUnpublished',
        'TrackMuted', 'TrackUnmuted',
        'ActiveSpeakersChanged',
        'ConnectionStateChanged', 'ConnectionQualityChanged',
        'LocalTrackPublished', 'LocalTrackUnpublished',
        'DataReceived',
    ].forEach((n) => { if (RoomEvent[n]) hook(n); });

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        log('event:TrackSubscribed', `participant=${participant && participant.identity}`,
            `kind=${track && track.kind}`,
            `source=${publication && publication.source}`,
            `sid=${publication && publication.sid}`,
            `mime=${publication && publication.mimeType}`);

        const kindIsVideo = track.kind === (TrackKind && TrackKind.KIND_VIDEO) || track.kind === 'video' || track.kind === 1;
        const kindIsAudio = track.kind === (TrackKind && TrackKind.KIND_AUDIO) || track.kind === 'audio' || track.kind === 2;

        if (kindIsVideo) consumeVideo(track, VideoStream, state, opts).catch((e) => log('video-consume-error', e));
        else if (kindIsAudio) consumeAudio(track, AudioStream, state).catch((e) => log('audio-consume-error', e));
        else log('unknown track kind', track.kind);
    });

    log('connecting', liveKitUrl);
    await room.connect(liveKitUrl, token, { autoSubscribe: true, dynacast: true });
    log('connected', `localIdentity=${room.localParticipant && room.localParticipant.identity}`);

    // Snapshot of room state right after join — the camera participant may
    // already be publishing if it was warm; for a cold battery cam, we'll
    // see it show up via ParticipantConnected later.
    if (room.remoteParticipants && room.remoteParticipants.size > 0) {
        for (const [sid, p] of room.remoteParticipants) {
            log('existing-remote', `identity=${p.identity}`, `sid=${sid}`, `tracks=${p.trackPublications && p.trackPublications.size}`);
        }
    } else {
        log('no-remote-participants-yet', 'camera is likely still waking up');
    }

    const firstVideoOrTimeout = new Promise((resolve) => {
        const started = Date.now();
        const iv = setInterval(() => {
            const elapsed = ((Date.now() - started) / 1000).toFixed(1);
            if (state.gotFirstVideo) { clearInterval(iv); resolve('ok'); return; }
            if ((Date.now() - started) / 1000 > opts.wait) { clearInterval(iv); resolve('timeout'); return; }
            log('waiting-for-video', `${elapsed}s / ${opts.wait}s`);
        }, 5000);
    });

    const waitResult = await firstVideoOrTimeout;
    if (waitResult === 'timeout') {
        log('ERROR', `No video within ${opts.wait}s. Camera may not be waking. Exiting.`);
        await room.disconnect();
        return { ok: false, state, reason: 'no-video' };
    }

    log('recording', `${opts.duration}s of video (frames so far: ${state.videoFrames})`);
    await new Promise((r) => setTimeout(r, opts.duration * 1000));

    await room.disconnect();
    if (state.videoFile) {
        await new Promise((r) => state.videoFile.end(r));
    }

    return { ok: true, state };
}

async function consumeVideo(track, VideoStream, state, opts) {
    if (!VideoStream) { log('no-VideoStream-export'); return; }
    const stream = new VideoStream(track);
    for await (const event of stream) {
        const frame = event && event.frame ? event.frame : event;
        if (!frame) continue;
        state.videoFrames++;
        if (!state.gotFirstVideo) {
            state.gotFirstVideo = true;
            state.videoMeta = {
                width: frame.width,
                height: frame.height,
                type: frame.type,                // pixel format enum / string
                rotation: frame.rotation,
                timestampUs: frame.timestampUs,
                dataByteLength: frame.data && frame.data.byteLength,
            };
            const fname = `video_${frame.width}x${frame.height}_type${frame.type}.raw`;
            state.videoFilePath = path.join(opts.outDir, fname);
            state.videoFile = fs.createWriteStream(state.videoFilePath);
            log('first-video-frame', JSON.stringify(state.videoMeta), '→', state.videoFilePath);
        }
        if (state.videoFile && frame.data) {
            state.videoFile.write(Buffer.from(frame.data.buffer, frame.data.byteOffset || 0, frame.data.byteLength));
        }
        if (state.videoFrames % 30 === 0) {
            log('video-frames', state.videoFrames);
        }
    }
}

async function consumeAudio(track, AudioStream, state) {
    if (!AudioStream) { log('no-AudioStream-export'); return; }
    const stream = new AudioStream(track);
    for await (const event of stream) {
        const frame = event && event.frame ? event.frame : event;
        if (!frame) continue;
        state.audioFrames++;
        if (state.audioFrames === 1) {
            log('first-audio-frame', JSON.stringify({
                sampleRate: frame.sampleRate,
                channels: frame.numChannels || frame.channels,
                samplesPerChannel: frame.samplesPerChannel,
            }));
        }
    }
}

function summarize(v) {
    if (v == null) return String(v);
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v.identity) return `participant(${v.identity})`;
    if (v.sid && v.kind) return `track(${v.kind}, sid=${v.sid})`;
    try { return JSON.stringify(v); } catch { return '[unserializable]'; }
}

(async () => {
    const opts = parseArgs();

    const authPath = findAuthFile(opts.authFile);
    log('auth-file', authPath);
    const accessToken = readAccessToken(authPath);

    const lk = await getLiveView(accessToken, opts.camera, opts.sid);

    const result = await runRoom(lk.liveKitURL, lk.userToken, opts);

    console.log('\n=== POC SUMMARY ===');
    console.log('ok:', result.ok, result.reason ? `(${result.reason})` : '');
    console.log('video frames:', result.state.videoFrames);
    console.log('audio frames:', result.state.audioFrames);
    if (result.state.videoMeta) {
        console.log('video meta:', JSON.stringify(result.state.videoMeta));
    }
    if (result.state.videoFilePath) {
        const { width, height } = result.state.videoMeta;
        console.log('raw dump:', result.state.videoFilePath);
        console.log('\ninspect:');
        console.log(`  ffprobe -f rawvideo -pixel_format yuv420p -video_size ${width}x${height} ${result.state.videoFilePath}`);
        console.log(`  ffmpeg -f rawvideo -pixel_format yuv420p -video_size ${width}x${height} -framerate 20 -i ${result.state.videoFilePath} -c:v libx264 ${path.join(path.dirname(result.state.videoFilePath), 'out.mp4')}`);
    }
    process.exit(result.ok ? 0 : 1);
})().catch((e) => {
    console.error('fatal:', e);
    process.exit(1);
});
