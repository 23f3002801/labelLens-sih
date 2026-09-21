// API base URL for the ALMAC backend.
//
// A phone/emulator can't reach your dev machine via "localhost", so this must point at a
// LAN-reachable address. Override per-machine in app/.env (gitignored):
//   EXPO_PUBLIC_API_BASE_URL=http://<your-lan-ip>:8000
// Android emulator's host loopback is 10.0.2.2; iOS simulator can use localhost directly;
// a physical device needs your machine's actual LAN IP.
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || 'http://10.0.2.2:8000').replace(/\/+$/, '');
