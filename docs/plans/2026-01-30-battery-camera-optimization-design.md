# Battery Camera Optimization Design

**Status:** Draft
**Date:** 2026-01-30
**Related:** Kinesis WebRTC / LiveKit streaming implementation

## Context

SimpliSafe outdoor cameras (Garage, Back Yard) can run on battery power. The new WebRTC streaming implementation needs to minimize unnecessary camera wake-ups to preserve battery life.

## Current Behavior

### Live Streaming (Good)

Live streaming is already on-demand:
- Connection established only when HomeKit sends `START` request (user opens camera)
- WebRTC session created, video flows through FFmpeg to HomeKit SRTP
- Connection fully terminated on `STOP` request (user closes camera)
- No persistent connections between viewing sessions

### Snapshots (Potential Issue)

HomeKit periodically requests snapshots for camera tile previews, even when not actively viewing:

| Aspect | Current Implementation |
|--------|------------------------|
| Cache TTL | 60 seconds |
| Cache miss behavior | Opens full WebRTC connection |
| Camera impact | Wakes camera from sleep on each cache miss |

**Frequency estimate:** HomeKit may request snapshots every 30-60 seconds when Home app is open, less frequently in background.

## Battery Impact Analysis

Each snapshot request on cache miss:
1. API call to SimpliSafe for WebRTC credentials
2. Full WebRTC signaling handshake
3. Camera wakes, starts encoding video
4. Single frame captured, connection closed
5. Camera returns to sleep

This cycle consumes significant battery compared to letting the camera stay dormant.

## Proposed Options

### Option 1: Extended Cache TTL

Increase `snapshotCacheTTL` for battery cameras.

```javascript
// Current
this.snapshotCacheTTL = 60000; // 1 minute

// Proposed for battery cameras
this.snapshotCacheTTL = 300000; // 5 minutes
// or
this.snapshotCacheTTL = 600000; // 10 minutes
```

**Pros:**
- Simple implementation
- Still shows relatively recent image
- Reduces wake-ups by 5-10x

**Cons:**
- Stale previews (user sees old image in Home app)
- Still wakes camera periodically

### Option 2: Static Placeholder Image

Return a static "Battery Saving Mode" image instead of live snapshots.

```javascript
if (this.isBatteryCamera && this.batteryOptimizationEnabled) {
    return this.batterySavingPlaceholder;
}
```

**Pros:**
- Zero camera wake-ups for snapshots
- Maximum battery preservation

**Cons:**
- No preview at all in Home app tile
- User must open camera to see anything

### Option 3: Motion Event Thumbnail ❌ NOT VIABLE

Use SimpliSafe's stored thumbnail from last motion event (if API supports this).

**Investigation Results (2026-01-30):**
- SimpliSafe does **not** expose a motion thumbnail API
- [SimpliSafe Support forums](https://support.simplisafe.com/en_GB/conversations/product-requests-and-suggestions/camera-snapshot-in-notification/636c66ef7aca5e4ceea8711a) show this is a requested feature, not implemented
- [simplisafe-python](https://pypi.org/project/simplisafe-python/) library only has live FLV streaming, no image endpoints
- The only media endpoint is `https://media.simplisafe.com/v1/{serial}/flv` for live video

**Conclusion:** This option is not possible until SimpliSafe adds thumbnail API support.

### Option 4: User Configuration

Add config option to let users choose behavior per camera:

```json
{
    "cameras": {
        "Garage": {
            "snapshotMode": "live"  // Default, current behavior
        },
        "Back Yard": {
            "snapshotMode": "cached",  // Extended 5-10 min cache
            "snapshotCacheTTL": 300
        },
        "Front Door": {
            "snapshotMode": "disabled"  // Static placeholder
        }
    }
}
```

**Pros:**
- User controls trade-off per camera
- Flexible for different use cases (plugged-in vs battery)

**Cons:**
- More complex configuration
- User must understand implications

## Recommendation

**Implement Option 4 (User Configuration)** with sensible defaults:

1. Default to current behavior (60s cache) for backwards compatibility
2. Add `snapshotMode` config: `"live"` | `"cached"` | `"disabled"`
3. Add `snapshotCacheTTL` config for fine-tuning cached mode
4. Document battery implications in README

This gives power users control while maintaining current behavior for those who don't configure it.

Note: Option 3 (Motion Thumbnails) was the preferred approach but is **not viable** - SimpliSafe does not expose this API.

## Detection - SOLVED ✅

**Investigation completed 2026-01-30.** The SimpliSafe API exposes battery/power fields:

### Available Fields

| Field | Type | Description |
|-------|------|-------------|
| `supportedFeatures.battery` | boolean | Camera supports battery power |
| `supportedFeatures.wired` | boolean | Camera has wired power option |
| `cameraStatus.batteryPercentage` | number | Battery level 0-100 |
| `currentState.batteryCharging` | boolean | Currently plugged in/charging |

### Real Camera Data

| Camera | Model | battery | wired | batteryCharging |
|--------|-------|---------|-------|-----------------|
| Front Door | SS002 (doorbell) | `false` | `true` | `false` |
| Back Yard | SSOBCM4 (outdoor) | `true` | `false` | `true` |
| Garage | olympus (outdoor) | `true` | `false` | `true` |

### Detection Logic

```javascript
// Is this a battery-capable camera?
const isBatteryCamera = camera.supportedFeatures?.battery === true;

// Is it currently plugged in? (charging = on external power)
const isPluggedIn = camera.currentState?.batteryCharging === true;

// Current battery level
const batteryLevel = camera.cameraStatus?.batteryPercentage ?? 100;

// Smart default: extend cache for battery cameras not plugged in
const shouldExtendCache = isBatteryCamera && !isPluggedIn;
```

### Bonus: HomeKit Battery Service

We can expose battery status to HomeKit:
- Add `BatteryService` to battery cameras
- Report `BatteryLevel` (0-100)
- Report `ChargingState` (charging/not charging)
- Report `StatusLowBattery` when below threshold

## Open Questions

1. ~~Does SimpliSafe API expose camera power source (battery vs AC)?~~ **Answered: Yes!** See Detection section above.
2. ~~Does SimpliSafe store motion event thumbnails accessible via API?~~ **Answered: No**
3. What's the actual HomeKit snapshot request frequency in practice?
4. Should we log snapshot requests to help users understand the impact?

## Implementation Priority

Based on findings, recommended implementation order:

1. **Auto-detection** - Use `supportedFeatures.battery` and `currentState.batteryCharging` to auto-adjust snapshot cache TTL
2. **Battery service** - Expose battery level to HomeKit for battery cameras
3. **User config** - Add optional override for users who want different behavior

## Files Affected

- `src/lib/kinesisStreamingDelegate.js` - Kinesis snapshot handling
- `src/lib/liveKitStreamingDelegate.js` - LiveKit snapshot handling
- `config.schema.json` - Add new camera config options
- `README.md` - Document battery optimization options
