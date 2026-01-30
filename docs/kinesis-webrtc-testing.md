# WebRTC Streaming Testing Documentation

## Test Environment

- **Hardware:** Raspberry Pi 4 running Homebridge
- **Homebridge Version:** Latest stable
- **Plugin Version:** Development branch `feature/kinesis-webrtc-outdoor-cameras`
- **Test Clients:** iOS Home app, macOS Home app

## Camera Types Tested

| Model | Type | Provider | Status |
|-------|------|----------|--------|
| SS002 | Doorbell | SIMPLISAFE (FLV) | Existing, unchanged |
| SSOBCM4 | Outdoor | MIST (LiveKit) | ✅ Working |
| olympus | Outdoor | KVS (Kinesis) | ✅ Working |

## Test Scripts

### `scripts/test-kinesis.js`
Tests raw Kinesis WebRTC connection without Homebridge:
```bash
node scripts/test-kinesis.js <access_token> <camera_uuid> <location_id>
```

### `scripts/test-livekit.js`
Tests raw LiveKit connection without Homebridge:
```bash
node scripts/test-livekit.js <livekit_token>
```

### `scripts/dump-camera-data.js`
Dumps camera details from SimpliSafe API:
```bash
node scripts/dump-camera-data.js <access_token> [--full]
```

## Verification Steps

### 1. Provider Detection
**Verified:** Camera accessory correctly detects WebRTC provider from `cameraDetails.currentState.webrtcProvider`:
- `KVS` → Uses `KinesisStreamingDelegate`
- `MIST` → Uses `LiveKitStreamingDelegate`
- `null/undefined` → Uses standard `StreamingDelegate` (FLV)

### 2. Kinesis (KVS) Streaming
**Test procedure:**
1. Open outdoor camera (KVS provider) in Home app
2. Verify video loads within 5-10 seconds
3. Verify video is smooth without major artifacts
4. Close camera, verify clean disconnect in logs

**Results:**
- WebRTC signaling connects successfully
- Video track received via H264
- H264 depacketization (RTP → Annex B) working
- Keyframe synchronization (SPS/PPS + IDR) implemented
- Some minor frame corruption with FFmpeg `-err_detect ignore_err` as mitigation

### 3. LiveKit (MIST) Streaming
**Test procedure:**
1. Open outdoor camera (MIST provider) in Home app
2. Verify video loads within 5-10 seconds
3. Verify video displays correctly (colors, aspect ratio)
4. Close camera, verify clean disconnect in logs

**Results:**
- LiveKit room connection successful
- Video track subscription working
- I420/YUV420P pixel format correctly handled
- Frame piping to FFmpeg working
- Video quality good at 1920x1080

### 4. Snapshot Handling
**Test procedure:**
1. View camera tile in Home app (triggers snapshot)
2. Check logs for snapshot request handling
3. Verify cached snapshots return quickly

**Results:**
- Snapshots use same WebRTC connection
- 60-second cache implemented
- Cache hits return immediately

### 5. Stream Cleanup
**Test procedure:**
1. Open camera stream
2. Force-close Home app
3. Check logs for proper cleanup

**Results:**
- FFmpeg process terminated correctly
- WebRTC/LiveKit connection closed
- No orphaned processes

## Known Issues

### Kinesis Frame Corruption
- **Symptom:** Occasional frame corruption, "concealing errors" in FFmpeg
- **Mitigation:** Added `-err_detect ignore_err` to FFmpeg args
- **Status:** Acceptable for viewing, may need further investigation

### Snapshot Battery Impact
- **Issue:** Snapshots wake battery cameras
- **Status:** Documented in `docs/plans/2026-01-30-battery-camera-optimization-design.md`
- **Mitigation:** Future work to extend cache TTL for battery cameras

## Performance Metrics

| Metric | Kinesis | LiveKit |
|--------|---------|---------|
| Connection time | ~3-5s | ~2-4s |
| First frame | ~5-8s | ~4-6s |
| Resolution | 1920x1080 | 1920x1080 |
| Frame rate | 20fps | 20fps |

## Debug Logging

Enable debug mode in Homebridge config:
```json
{
  "platform": "homebridge-simplisafe3.SimpliSafe 3",
  "debug": true
}
```

Key log prefixes:
- `[KinesisDelegate]` - Kinesis streaming delegate
- `[LiveKitDelegate]` - LiveKit streaming delegate
- `[Kinesis]` - Kinesis client (signaling, WebRTC)
