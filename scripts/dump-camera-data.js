#!/usr/bin/env node
/**
 * Dump full camera details from SimpliSafe API
 *
 * Usage:
 *   node scripts/dump-camera-data.js <access_token>
 *   SS_ACCESS_TOKEN=<token> node scripts/dump-camera-data.js
 *
 * Get token from:
 *   - Homebridge logs (look for Authorization: Bearer ...)
 *   - /var/lib/homebridge/simplisafe3auth.json on Pi
 */

const token = process.argv[2] || process.env.SS_ACCESS_TOKEN;
const API_BASE = 'https://api.simplisafe.com/v1';

if (!token) {
    console.error('Usage: node scripts/dump-camera-data.js <access_token>');
    console.error('Or set SS_ACCESS_TOKEN environment variable');
    process.exit(1);
}

async function main() {
    console.log('=== SimpliSafe Camera Data Dump ===\n');

    // Get user ID
    const authCheck = await fetch(`${API_BASE}/api/authCheck`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!authCheck.ok) {
        console.error(`Auth failed: ${authCheck.status} ${authCheck.statusText}`);
        process.exit(1);
    }

    const authData = await authCheck.json();
    const userId = authData.userId;
    console.log(`User ID: ${userId}`);

    // Get subscriptions list
    const subsResp = await fetch(`${API_BASE}/users/${userId}/subscriptions?activeOnly=false`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const subsData = await subsResp.json();
    const subId = subsData.subscriptions[0].sid;
    console.log(`Subscription ID: ${subId}`);

    // Get full subscription detail - cameras live here
    const subDetailResp = await fetch(`${API_BASE}/subscriptions/${subId}/`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const subDetail = await subDetailResp.json();

    const system = subDetail.subscription?.location?.system;
    const cameras = system?.cameras || [];

    console.log(`\nFound ${cameras.length} camera(s)\n`);

    for (const cam of cameras) {
        const name = cam.cameraSettings?.cameraName || cam.uuid;
        console.log('='.repeat(60));
        console.log(`Camera: ${name}`);
        console.log('='.repeat(60));

        // Key fields summary
        console.log('\n>>> Summary:');
        console.log(`    Model: ${cam.model}`);
        console.log(`    UUID: ${cam.uuid}`);
        console.log(`    Status: ${cam.status}`);
        console.log(`    WebRTC Provider: ${cam.currentState?.webrtcProvider}`);
        console.log(`    Recording Provider: ${cam.currentState?.recordingProvider}`);

        // Battery/power info
        console.log('\n>>> Power:');
        console.log(`    Battery capable: ${cam.supportedFeatures?.battery}`);
        console.log(`    Wired: ${cam.supportedFeatures?.wired}`);
        console.log(`    Battery %: ${cam.cameraStatus?.batteryPercentage}`);
        console.log(`    Charging: ${cam.currentState?.batteryCharging}`);

        // Supported providers
        console.log('\n>>> Supported Providers:');
        const providers = cam.supportedFeatures?.providers;
        if (providers) {
            console.log(`    WebRTC: ${JSON.stringify(providers.allSupportedProviders?.webrtc)}`);
            console.log(`    Recording: ${JSON.stringify(providers.allSupportedProviders?.recording)}`);
            console.log(`    Live: ${JSON.stringify(providers.allSupportedProviders?.live)}`);
        }

        // Full JSON if --full flag
        if (process.argv.includes('--full')) {
            console.log('\n>>> Full JSON:');
            console.log(JSON.stringify(cam, null, 2));
        }

        console.log('');
    }

    console.log('Done! Use --full flag to see complete JSON.');
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
