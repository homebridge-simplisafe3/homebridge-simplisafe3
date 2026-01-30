# SimpliSafe API Discovery Notes

**Date:** 2026-01-30
**Source:** Live API investigation via `scripts/dump-camera-data.js`

## Camera Models Discovered

| Model | Name | Type | WebRTC | Notes |
|-------|------|------|--------|-------|
| SS002 | Front Door | Doorbell | SIMPLISAFE (FLV) | Wired, no battery |
| SSOBCM4 | Back Yard | Outdoor | MIST (LiveKit) | Battery, supports KVS+MIST |
| olympus | Garage | Outdoor | KVS (Kinesis) | Battery, supports KVS+MIST |

## Battery & Power (Implemented in Design Doc)

```javascript
supportedFeatures.battery      // boolean - can run on battery
supportedFeatures.wired        // boolean - has wired power
cameraStatus.batteryPercentage // number 0-100
currentState.batteryCharging   // boolean - plugged in/charging
```

## Future Implementation Ideas

### 1. HomeKit Battery Service
Expose battery status for battery-capable cameras:
- `BatteryLevel` characteristic (0-100)
- `ChargingState` characteristic
- `StatusLowBattery` when below threshold (20%?)

**Fields:** `cameraStatus.batteryPercentage`, `currentState.batteryCharging`

### 2. Siren Control
Outdoor cameras have sirens that could be exposed as a switch.

```javascript
supportedFeatures.siren              // boolean
supportedFeatures.sirenManualControl // boolean - can trigger manually
```

**Potential:** Add `Switch` service for manual siren trigger.

### 3. Spotlight Control
Some cameras have spotlights.

```javascript
supportedFeatures.spotlight              // boolean
supportedFeatures.spotlightManualControl // boolean
cameraSettings.spotlight.level           // "low", "medium", "high"
cameraSettings.spotlight.enableColorNightMode // boolean
```

**Potential:** Add `Lightbulb` service for spotlight control.

### 4. Two-Way Audio
Full duplex audio support varies by camera.

```javascript
supportedFeatures.microphone      // boolean
supportedFeatures.speaker         // boolean
supportedFeatures.fullDuplexAudio // boolean - true = real two-way
```

**Note:** Doorbell (SS002) has `fullDuplexAudio: false`, outdoor cameras have `true`.

### 5. Privacy Shutter by Alarm Mode
Cameras support different shutter states per alarm mode:

```javascript
cameraSettings.shutterHome  // "open", "closed", "closedAlarmOnly"
cameraSettings.shutterAway  // "open", "closed", "closedAlarmOnly"
cameraSettings.shutterOff   // "open", "closed", "closedAlarmOnly"
```

**Current:** Plugin respects these when deciding if stream is available.
**Potential:** Expose as HomeKit switches to change settings.

### 6. Status Light Control
LED indicator can be controlled:

```javascript
cameraSettings.statusLight  // "on", "off"
```

**Potential:** Add switch to toggle status LED.

### 7. Night Vision Mode
```javascript
cameraSettings.nightVision  // "auto", "on", "off"
supportedFeatures.colorNightMode // boolean - color night vision capable
```

### 8. Motion Detection Sensitivity
```javascript
cameraSettings.motionSensitivity  // 0-100
cameraSettings.pirLevel           // "low", "medium", "high"
cameraSettings.odLevel            // "low", "medium", "high" (object detection)
cameraSettings.pirEnable          // boolean
cameraSettings.vaEnable           // boolean (video analytics)
```

### 9. Audio Settings
```javascript
cameraSettings.micEnable       // boolean
cameraSettings.micSensitivity  // 0-100
cameraSettings.speakerVolume   // 0-100
```

### 10. Video Quality
```javascript
cameraSettings.pictureQuality       // "480p", "720p", "1080p"
cameraSettings.supportedResolutions // ["480p", "720p", "1080p"]
cameraSettings.hdr                  // boolean
cameraSettings.admin.fps            // frames per second
cameraSettings.admin.bitRate        // bitrate
```

### 11. Video Flip
```javascript
supportedFeatures.videoFlip           // boolean - camera supports flip
cameraSettings.videoFlip.enable       // boolean
cameraSettings.videoFlip.verticalFlip // boolean
cameraSettings.videoFlip.horizontalFlip // boolean
```

**Note:** Outdoor cameras have both flips enabled (mounted upside down?).

### 12. Doorbell-Specific
```javascript
supportedFeatures.doorbell                    // boolean
cameraSettings.enableDoorbellNotification     // boolean
cameraSettings.doorbellChimeVolume            // "off", "low", "medium", "high"
cameraSettings.doorbellChimeType              // "Mechanical", etc.
supportedFeatures.doorbellChimeSupported      // boolean
```

### 13. Provider Flexibility
Cameras can support multiple providers:

```javascript
supportedFeatures.providers.allSupportedProviders.webrtc     // ["kvs", "mist"]
supportedFeatures.providers.allSupportedProviders.recording  // ["kvs", "mist"]
currentState.webrtcProvider    // Current: "KVS" or "MIST"
currentState.recordingProvider // Current: "KVS" or "MIST"
```

**Note:** Back Yard and Garage both support KVS+MIST but use different current providers.

### 14. Firmware & Device Info
```javascript
cameraStatus.firmwareVersion     // e.g., "1.49.2.31701"
cameraSettings.admin.wlanMac     // WiFi MAC address
cameraStatus.setupTimestamp      // Unix timestamp of setup
cameraStatus.lastLogin           // Last connection timestamp
cameraStatus.lastLogout          // Last disconnect timestamp
```

### 15. Object Detection Types
```javascript
cameraSettings.motion.granularObjectDetectionTypes  // [] - future expansion?
supportedFeatures.granularObjectDetectionTypes      // []
```

**Note:** Currently empty arrays, may be used for person/vehicle/animal detection.

## State Monitoring

Real-time camera state:
```javascript
currentState.idle           // boolean
currentState.liveStreaming  // boolean - someone viewing
currentState.recording      // boolean - recording event
currentState.otaDownloading // boolean
currentState.otaFlashing    // boolean
currentState.online         // boolean
currentState.connected      // boolean
```

## API Endpoints Discovered

| Endpoint | Purpose |
|----------|---------|
| `/api/authCheck` | Get user ID |
| `/users/{userId}/subscriptions` | List subscriptions |
| `/subscriptions/{subId}/` | Full system + cameras |
| `/ss3/subscriptions/{subId}/settings/normal` | System settings (no cameras) |
| `app-hub.../v2/cameras/{uuid}/{subId}/live-view` | WebRTC credentials |

## Not Available (Confirmed)

- Motion event thumbnails/images
- Recording clips via API
- Historical event images
