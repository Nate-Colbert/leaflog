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

## Notes
- Snapping only ever delays watering to the next water day (within each plant's flexibility: strict 0 / normal 2 / hardy 4 days). This slightly lengthens observed gaps, so log soil dampness when you water to keep the learning honest.
- Weather uses free Open-Meteo; no key needed.
- Push could not be tested end to end in my environment. If the test button errors, check the function's Logs tab and tell me the message.
