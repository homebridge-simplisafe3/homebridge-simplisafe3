import os from 'os';

// matches ip.address(): first non-loopback IPv4 across interfaces, else loopback
export function localIPv4Address() {
    for (const addresses of Object.values(os.networkInterfaces())) {
        const match = addresses.find(a => (a.family === 'IPv4' || a.family === 4) && !/^127\./.test(a.address));
        if (match) return match.address;
    }
    return '127.0.0.1';
}
