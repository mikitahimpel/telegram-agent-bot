# Car Mini App — design

Telegram Mini App (opened from the bot: `/car` → button "Open app" `web_app`) running in
Chrome on Android. Reads OBD-II through an ELM327 adapter, records trips **locally first**
(IndexedDB), uploads them in small chunks to the gateway Worker, which stores them in R2 for
the `car` plugin and the agent.

Shared contract: `packages/car/format` (Sample/CSV, TripManifest, R2 layout, HTTP API, sha256).

## Packages
| Package | Owner of |
|---|---|
| packages/car/format | data contract (done) |
| packages/car/obd (@bot/car-obd) | transports (Web Bluetooth BLE, Web Serial, simulator), ELM327 protocol, PID decoding, sampler Stream |
| packages/car/recorder (@bot/car-recorder) | IndexedDB store, trip recorder (chunking, crash recovery), upload queue, API client, sync state model |
| apps/car-web (@bot/car-web) | Vue 3 + Vite UI, Telegram WebApp SDK, i18n ru/en |
| packages/plugins/car + apps/gateway `/car/api/*` | server API, verification, bot notifications, analytics, document import fallback |

## Principle: the user always knows what is happening
Every state has: a plain-language title, one sentence of what it means, and the one action
the user can take. Never a spinner without text. Never a raw error without explanation
(raw details go to an expandable "Details" section and the Diagnostics log).

Data on the phone is the source of truth until the server confirms it (`TripStatus.complete`).
The UI shows three numbers per trip: **recorded** points, **sent** chunks, **confirmed** chunks.
A trip is only "✅ In the cloud" after server verification of every chunk.
Local data is deleted only after confirmation, and only automatically after 7 days (or by user).

## Corner cases that MUST be handled (each needs a visible state + message)
Connection / adapter
- Browser lacks Web Bluetooth (iOS, Telegram Desktop, Firefox) → explain + suggest Chrome on Android / Web Serial; offer simulator demo.
- Bluetooth off / permission denied / user cancelled device picker.
- Adapter found but wrong GATT service (non-ELM device) → list known UUIDs tried.
- ELM doesn't answer `ATZ` / garbage (clone adapters, wrong baud on serial) → retry with alternative init, show which step failed.
- `UNABLE TO CONNECT` / `BUS INIT... ERROR` / `NO DATA` on 0100 → ignition is off or the engine is not running: tell user to turn ignition on.
- `CAN ERROR`, `BUFFER FULL`, `STOPPED`, `?` responses, timeouts → per-command handling, degrade polling rate.
- PID not supported → column empty, show "not supported by your car" (not an error).
- Adapter disconnects mid-trip → keep the trip open, auto-reconnect with backoff, record a Gap, show "Connection lost Xs ago, reconnecting…".
- Screen locks / tab backgrounded (Chrome throttles timers, BLE may drop) → Wake Lock API, warn before leaving, record Gap reason `app_backgrounded`.

Recording / storage
- App reloaded or killed during a trip → on next open, detect the unfinished trip, show "Trip was interrupted at HH:MM — continue or finish?"; samples already flushed are safe (flush every ≤ 5 s).
- IndexedDB quota low / `QuotaExceededError` → warn early (navigator.storage.estimate), ask persistence (navigator.storage.persist()).
- Storage evicted (persist denied) → explain the risk on the settings screen.
- Device clock wrong (|device − serverTime| > 2 min) → warn; timestamps still device time, offset stored in manifest note.
- Very long trip → chunks keep it bounded; UI virtualized.

Upload
- Offline / flaky mobile network → queue, auto-retry with exponential backoff + jitter, resume on `online` event and on app open.
- Partial upload (some chunks failed) → trip shows "Sent 12 of 14 parts, 2 waiting", per-chunk grid, "Retry now".
- `checksum_mismatch` → retry (corruption in transit); persistent → mark chunk corrupt locally, offer export.
- `chunk_conflict` → device bug or duplicate trip id; never overwrite; show error, offer export.
- `unauthorized` (initData expired, app opened >24h ago) → "Session expired — reopen the app from the bot" with button.
- `plugin_disabled` / `forbidden` → explain, ask the admin.
- `rate_limited` / 5xx → backoff, show next retry time.
- App closed before upload finished → uploads resume next time; the bot also reminds the user if a trip stays incomplete for > 1 h (server knows from manifest).
- Server lost an object / reconciliation: on open, `GET /trips` + `GET status` per local trip; anything `missing`/`corrupt` is re-queued from local data.
- Local data already deleted but server incomplete → mark "partial in cloud, local copy gone" honestly.
- Fallback when uploading is impossible: "Export file" → single CSV (+ manifest JSON) shared via Android share sheet / download; user sends it to the bot as a document; bot imports it (`car/<tgId>/imports/`).

Server / bot side
- After `finish` the bot posts a summary in the chat: complete ✅ (duration, distance, points) or ⚠️ incomplete (which parts are missing, button to open the app).
- Trips with gaps are analysed per segment, never interpolated across gaps.

## Runtime modes (IMPORTANT — Web Bluetooth is not available in Android WebView)
Telegram Mini Apps on Android run in Android System WebView, which has no `navigator.bluetooth`
and no `navigator.serial`. Therefore:
- **Mini App (inside Telegram)**: status, trips, chunk grid, retry/export of what the server has,
  device list. Primary button "Open recorder in Chrome" → POST /car/api/pair/start →
  `Telegram.WebApp.openLink(url)`. If `navigator.bluetooth` IS available (future WebView), allow recording in place.
- **Chrome PWA** (`/car/` opened in Chrome, installable: web manifest + service worker caching the
  app shell for offline start): pairs via `#pair=<code>`, keeps a Device token in IndexedDB, records and uploads.
  Unpaired Chrome → screen "Open the bot → /car app to connect this phone".
- Corner cases: pairing link expired/used; token revoked (`unauthorized` → "This phone was disconnected from your account — pair again");
  opened in Chrome on desktop/iOS (no BLE → explain, Serial possible on desktop); several paired devices.
