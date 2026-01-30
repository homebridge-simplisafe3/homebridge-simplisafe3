# Implementation Plan: Kinesis WebRTC Outdoor Cameras

**Design Doc:** `2026-01-29-kinesis-webrtc-outdoor-cameras.md`
**Branch:** `feature/kinesis-webrtc-outdoor-cameras`
**Worktree:** `.worktrees/kinesis-webrtc`

## Tasks

### Phase 1: Foundation

- [ ] **1.1** Add `werift` dependency to package.json
- [ ] **1.2** Create `src/lib/kinesisClient.ts` - Kinesis signaling client
  - LiveView API call to get signaling endpoint
  - WebSocket connection to Kinesis
  - SDP offer/answer exchange
  - ICE candidate handling
- [ ] **1.3** Create TypeScript types for Kinesis protocol in `src/types/kinesis.ts`

### Phase 2: Streaming Delegate

- [ ] **2.1** Create `src/lib/kinesisStreamingDelegate.ts`
  - Implement `CameraStreamingDelegate` interface
  - WebRTC peer connection management
  - RTP packet extraction from werift tracks
  - FFmpeg stdin piping
- [ ] **2.2** Implement snapshot handling
  - Brief WebRTC connection to grab keyframe
  - Frame caching with TTL

### Phase 3: Integration

- [ ] **3.1** Modify `src/accessories/camera.js` to detect Kinesis cameras
  - Check `supportedFeatures.providers.recording`
  - Instantiate appropriate delegate
- [ ] **3.2** Add Kinesis live-view endpoint to `src/simplisafe.js`
- [ ] **3.3** Update README.md with outdoor camera support

### Phase 4: Validation

- [ ] **4.1** Build and verify no TypeScript errors
- [ ] **4.2** Test with real outdoor camera (manual)
- [ ] **4.3** Verify no regression with indoor cameras

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modify | Add werift dependency |
| `src/types/kinesis.ts` | Create | TypeScript types for Kinesis protocol |
| `src/lib/kinesisClient.ts` | Create | Kinesis signaling client |
| `src/lib/kinesisStreamingDelegate.ts` | Create | WebRTC streaming delegate |
| `src/accessories/camera.js` | Modify | Select delegate based on provider |
| `src/simplisafe.js` | Modify | Add live-view API method |
| `README.md` | Modify | Document outdoor camera support |

## Implementation Order

Execute tasks in order 1.1 → 1.2 → 1.3 → 2.1 → 2.2 → 3.1 → 3.2 → 3.3 → 4.x

Each phase builds on the previous. Phase 1 can be validated independently via unit tests. Phase 2 requires Phase 1. Phase 3 integrates everything.
