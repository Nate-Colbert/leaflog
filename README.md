# Leaflog: setup guide

Your plant tracker: a static web app hosted free on GitHub Pages, with a free Supabase project holding the data and photos. Takes about 15 minutes, once.

## 1. Create the Supabase project (5 min)

1. Sign up at **supabase.com** and click **New project**. Pick any name, set a database password (save it somewhere), and choose the **Sydney** region.
2. Wait a minute for it to finish setting up.
3. Open **SQL Editor** → **New query**, paste in everything from `schema.sql`, and click **Run**. This creates your tables, the private photo storage and the security rules.

## 2. Create your login (2 min)

1. Go to **Authentication → Users → Add user → Create new user**.
2. Enter your email and a password, and tick **Auto Confirm User**.
3. Go to **Authentication → Sign In / Providers** (or *Settings*, depending on the dashboard version) and turn **off** "Allow new users to sign up". That way you're the only person who can ever log in.

## 3. Connect the app to Supabase (1 min)

1. In Supabase go to **Project Settings → API** (or **API Keys**).
2. Copy the **Project URL** and the **anon / publishable key**.
3. Open `config.js` and paste them in place of the two `PASTE_...` values.

## 4. Put it on GitHub Pages (5 min)

1. Create a new GitHub repository (e.g. `leaflog`). Public is fine; Pages on free accounts needs public repos.
2. Click **Add file → Upload files** and drag in **all the files from the zip, unzipped** (`index.html`, `app.js`, `styles.css`, `config.js`, `sw.js`, `manifest.webmanifest` and the three `icon-*.png`). You don't need `schema.sql` or this README in the repo, but it does no harm.
3. Go to **Settings → Pages**, set **Source** to *Deploy from a branch*, choose **main** and **/ (root)**, and Save.
4. After a minute your app is live at `https://YOUR-USERNAME.github.io/leaflog/`.

## 5. Install it on your devices

- **Android (Chrome):** open the link, tap the menu (⋮) → **Install app**.
- **iPad (Safari):** open the link, tap **Share → Add to Home Screen**.

Sign in on each device once. Both devices read the same data, so a watering logged on your phone shows up on the iPad (pull the ↻ button or just reopen the app).

## How it works

- **Rooms:** create them in Settings (or the quick-add), then pick one for each plant. The home screen groups plants by room, with filter chips along the top.
- **Watering:** tap 💧 on any plant. A toast lets you tap **Dry / Damp / Wet** for the soil, or **Undo**. Use **Past water** inside a plant to back-fill earlier dates.
- **Learning schedule:** each plant starts on your "water every N days" guess. After 3 logged waterings it learns the plant's real rhythm from the recent gaps, weighting newer ones more so seasonal changes carry through. Waterings where the soil was still damp or wet nudge the interval longer. Long gaps (holidays) are ignored.
- **Events:** fertilise, repot, new leaf, prune, pest/issue and free notes, each with a date, note and optional photo.
- **Photos:** resized on your device before uploading and stored privately in your Supabase project.
- **Insights:** activity by month, new leaves, soil when watered, thirst by room, and watering rhythm per plant.
- **Your data:** Settings → export CSV for history or plants to analyse in Excel/Sheets. You can also browse the tables directly in Supabase's **Table Editor**.

## Good to know

- Supabase's free tier pauses a project after about a week of **no activity at all**. Using the app weekly keeps it awake; if it ever pauses, press Restore in the Supabase dashboard.
- Back up occasionally with the CSV export.
- After you update files on GitHub, the app picks up changes the next time you open it (close and reopen if it looks stale).
