# 🪴 Leaflog v2

Indoor plant tracker for your Android phone and iPad. Hosted free on GitHub Pages, data in your own Supabase.

## What's new in v2
Shared water days with forward-only snapping (plants dry out a bit rather than get overwatered), feeding aligned to watering day, moss-pole drip schedule with ml tracking, grow-light and extra plant details, propagation, problem tracker, weather correlation, seasonal view with winter-slowdown suggestion, growth timeline, morning push notification, and Claude plant ID / care advice.

## 1. Update the app (required)
1. Replace all files in your GitHub repo with the ones in this zip. **Keep your own `config.js` values** (URL and key) and copy them into the new `config.js`.
2. Supabase > SQL Editor > paste **all of `schema.sql`** > Run. It is safe to re-run and keeps your data.
3. In the app: Settings > choose your **water days** (e.g. Mon + Thu), hemisphere, and your location (for weather).

## 2. Claude plant ID and care advice (optional)
1. console.anthropic.com > create an API key, add a little credit, and **set a monthly spend limit**. (This is separate from your Claude subscription; a photo ID costs a few cents.)
2. Supabase > Edge Functions > **Deploy a new function** > name `plant-advisor` > paste `edge-functions/plant-advisor/index.ts`. Turn **Verify JWT off** (the function checks your login itself) and deploy.
3. Edge Functions > Secrets: add `ANTHROPIC_API_KEY`. Optional: `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`).
4. In `config.js` set `AI_ENABLED: true`. Add or edit a plant, attach a photo, tap **Identify with Claude**.

## 3. Morning push notification (optional, phone only)
1. Open `vapid.html` in a browser, tap Generate. Keep the page open.
2. Edge Functions > Secrets, add: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (from the page), `VAPID_SUBJECT` (`mailto:you@example.com`), and `CRON_SECRET` (any long random text).
3. Deploy a function named `daily-summary` from `edge-functions/daily-summary/index.ts`, **Verify JWT off**.
4. Database > Extensions: enable `pg_cron` and `pg_net`. Edit the two placeholders in `cron_setup.sql` and run it.
5. In `config.js` set `PUSH_ENABLED: true` and `VAPID_PUBLIC_KEY: "..."`.
6. On your **Android phone**: install the app (Chrome menu > Install app), open it, Settings > turn on notifications, pick the hour, tap **Send a test**. Don't enable it on the iPad; it just shows the summary in the app.

If you ever change `logic.js`, run `edge-functions/build.sh` and redeploy `daily-summary` so the notification uses the same schedule.

## 4. iPad hub (landscape dashboard)
On the iPad: Settings > **Open hub mode**. It shows a big clock, outside weather, today's jobs (tap **Done**, or **Do all**), this week's water days, rooms, open problems, recent activity and a photo strip of every plant. It refreshes itself every ~5 minutes, dims 10pm to 6am, and tries to keep the screen awake. Tap a plant to open it; ✕ top right leaves hub mode. It remembers hub mode on that device, so add it to the Home Screen and open it as a kiosk.
Tip: iPad Settings > Display & Brightness > Auto-Lock > Never, and keep it plugged in. Needs iPadOS 14 or newer (Safari 12-era iPads can't run the Supabase library).

### Sensors (Govee etc.)
The hub already shows room temperature/humidity (and per-plant soil moisture in the photo strip) from the `sensor_readings` table; until data arrives each room says "no sensor yet".
1. Re-run `schema.sql` (adds the table).
2. Deploy `edge-functions/sensor-ingest/index.ts` as `sensor-ingest` (Verify JWT off) with secrets `INGEST_SECRET` and `INGEST_USER_ID` (your user id from Authentication > Users).
3. Anything that can POST JSON can send readings (format is in the file's header comment). The next step for Govee is a small poller using your Govee developer API key; tell me which models you have (H5075, H5179, etc.) and I'll write it.

## Notes
- Photos: on a NEW plant, choosing or taking a photo automatically sends it to Claude and fills in name, species, watering, feeding, light, soil and pole settings (needs section 2 set up; check the fields, then Save). The plant form now has separate **Take photo** (opens the camera) and **Choose photo** (gallery) buttons.
- Snapping only ever delays watering to the next water day (within each plant's flexibility: strict 0 / normal 2 / hardy 4 days). This slightly lengthens observed gaps, so log soil dampness when you water to keep the learning honest.
- Weather uses free Open-Meteo; no key needed.
- Push could not be tested end to end in my environment. If the test button errors, check the function's Logs tab and tell me the message.
