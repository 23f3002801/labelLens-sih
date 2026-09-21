# Running the app on a physical Android device (USB)

This is the manual process for testing the app against your local backend over a USB cable,
using `adb reverse` instead of a tunnel (no traffic leaves your machine).

## Prerequisites

- Android device with **Developer options → USB debugging** turned on
- `adb` available on PATH (installed with Android Studio / Android SDK platform-tools)
- Backend `server/.env` already configured (`DATABASE_URL`, `CLOUDINARY_CLOUD_NAME`,
  `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`)
- `app/.env` set to:
  ```
  EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
  ```
  (this must be `127.0.0.1`, not a LAN IP - `adb reverse` makes the *device's* `localhost:8000`
  point at your machine's `localhost:8000`)

## Steps

**1. Start the backend** (from `server/`):
```
uv run uvicorn main:app --reload
```
Confirm it's up: `curl http://127.0.0.1:8000/health/db` should return `{"status":"healthy", ...}`.
Leave this running in its own terminal.

**2. Plug in the phone via USB**, then accept the "Allow USB debugging" prompt that appears on
the phone's screen.

**3. Confirm adb sees the device**:
```
adb devices
```
It should list your device (not empty, not "unauthorized" - if unauthorized, re-check/accept the
prompt on the phone).

**4. Forward the backend port over USB**:
```
adb reverse tcp:8000 tcp:8000
```
This needs to be re-run any time the device is unplugged and replugged (the reverse mapping
doesn't persist across reconnects). No output means it worked.

**5. Run the app** (from `app/`):
```
npm run android
```
This runs `expo run:android`, which builds the dev client and installs it on the connected
device over USB. It also forwards the Metro bundler port (8081) automatically - you don't need
a separate `adb reverse` for that one.

**6. Test.** Scan a label photo in the app; it should upload to the backend, process, and land on
the Result screen automatically.

## Troubleshooting

- **`adb devices` shows nothing**: check the USB cable supports data (not charge-only), and that
  you tapped "Allow" on the device's USB debugging prompt.
- **App can't reach the backend / times out**: re-run `adb reverse tcp:8000 tcp:8000` (it resets
  on replug), and confirm `app/.env` has `127.0.0.1:8000` not `10.0.2.2` (that address is for the
  Android *emulator* only, not a real device).
- **`.env` changes not taking effect**: `EXPO_PUBLIC_*` variables are baked in at build time -
  stop and restart `npm run android` after editing `app/.env`.
- **`[Error: Unsupported FormDataPart implementation]`**: Expo SDK 57's global `fetch` is
  `expo/fetch`, which only accepts real `Blob`/`File` values in `FormData` - not React Native's
  older `{uri, name, type}` descriptor object. `scanService.js` already uses `expo-file-system`'s
  `File` class for this; if you see this error again after touching upload code, check it didn't
  regress back to the old descriptor shape.

## Known limitation: video scanning

The 360° video capture flow calls `/api/v1/video/frames` on the backend, which needs a SAM2
model checkpoint at `server/checkpoints/sam2.1_hiera_large.pt`. That file is intentionally
gitignored (too large for git) and is not present by default - video scans will fail until it's
added locally. Photo scanning does not depend on this and works without it.
