/* Settings tab: water days, season and location, notifications, rooms, exports. */
import * as L from './logic.js';
import {
  S, ACTS, hooks, cfg, sb, modal, closeModal, askText, confirmBox, showToast, fail, saveSettings, addRoom, callFn, tz,
} from './state.js';
import { $, esc, plural, WEEKDAYS, DEFAULT_ROOMS, csv, download, urlB64ToU8, fmtDate } from './util.js';

let geoResults = [];

export function viewSettings() {
  const email = S.session && S.session.user ? S.session.user.email : '';
  const st = S.settings, wd = st.water_days, push = S.push;
  const pushOn = cfg.PUSH_ENABLED && cfg.VAPID_PUBLIC_KEY;
  return `<div class="top"><div><h1>Settings</h1><p>${esc(email)}</p></div></div>

    <div class="panel-card"><h2>💧 Water days</h2>
      <p>Pick the days you like to water. Each plant is moved <b>later</b> (never earlier) onto the next water day if that costs it no more than its flexibility allows. Feeding and moss-pole drips ride along.</p>
      <div class="chips wrap">${WEEKDAYS.map((d, i) => `<button class="chip ${wd.includes(i) ? 'on' : ''}" data-act="toggle-day" data-d="${i}">${d}</button>`).join('')}</div>
      <p class="muted small">${wd.length ? 'Plants that cannot wait for the next water day keep their own date and show as "own day" in the Plan.' : 'No water days selected: every plant is scheduled on its own date.'}</p></div>

    <div class="panel-card"><h2>🌦️ Season and location</h2>
      <p>Used for the seasonal view, the feeding pause and the weather correlation.</p>
      <div class="chips wrap"><button class="chip ${st.hemisphere === 'south' ? 'on' : ''}" data-act="set-hemi" data-v="south">Southern hemisphere</button>
        <button class="chip ${st.hemisphere === 'north' ? 'on' : ''}" data-act="set-hemi" data-v="north">Northern hemisphere</button></div>
      <p style="margin:6px 0"><b>${st.location_name ? esc(st.location_name) : 'No location set'}</b>${st.location_name ? ` <button class="btn mini ghost" data-act="clear-loc">Clear</button>` : ''}</p>
      <form id="locf" class="row"><input name="q" placeholder="Search for your city" autocomplete="off"><button class="btn">Search</button></form>
      <div id="geo-results">${geoResults.map((g, i) => `<button class="geo" data-act="pick-loc" data-i="${i}">${esc(g.name)}${g.admin1 ? ', ' + esc(g.admin1) : ''}, ${esc(g.country || '')}</button>`).join('')}</div>
      <button class="btn ghost block" style="margin-top:8px" data-act="device-loc">📍 Use this device's location</button>
      <details class="fs" style="margin-top:12px"><summary>Seasonal adjustment (optional)</summary><div class="fs-b">
        <label class="check"><input type="checkbox" id="adj" data-setting="season_adjust" ${st.season_adjust ? 'checked' : ''}> Scale learned intervals when the season changes</label>
        <p class="muted small">Off by default. Leaflog always prefers gaps from the current season once it has 3. With this on, it also stretches or shrinks older gaps from a different season using the multipliers below (1 = no change).</p>
        <form id="sf" class="row wrap4">${L.SEASONS.map((s) => `<label>${s[0].toUpperCase() + s.slice(1)}<input type="number" step="0.05" min="0.5" max="3" name="${s}" value="${st.season_factors[s]}"></label>`).join('')}<button class="btn">Save</button></form></div></details></div>

    <div class="panel-card"><h2>🔔 Morning notification</h2>
      ${pushOn ? `
        <p>A push notification on this device each morning listing what's due. Turn it on for your phone only.</p>
        <p class="muted small">${!push ? 'Checking this device…' : !push.supported ? 'This browser does not support push notifications (on iPad it needs the app added to the Home Screen).' : push.subscribed ? '✅ On for this device.' : push.perm === 'denied' ? '⚠️ Notifications are blocked for this site in your browser settings.' : 'Off for this device.'}</p>
        <label class="inline">Send at <select data-setting="notify_hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${st.notify_hour === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>
        <div class="row" style="margin-top:8px">${push && push.subscribed
          ? '<button class="btn" data-act="test-push">Send a test</button><button class="btn ghost" data-act="disable-push">Turn off</button>'
          : '<button class="btn primary" data-act="enable-push">Turn on for this device</button>'}</div>`
      : '<p class="muted">Not set up yet. Follow the "Morning notifications" steps in the README, then set <code>PUSH_ENABLED</code> and your VAPID key in <code>config.js</code>.</p>'}</div>

    <div class="panel-card"><h2>✨ Claude</h2>
      <p>${cfg.AI_ENABLED ? 'Plant identification, care guides and "Ask Claude" are switched on.' : 'Plant identification and advice are not set up yet. See the "Claude plant advisor" steps in the README, then set <code>AI_ENABLED</code> to true in <code>config.js</code>.'}</p></div>

    <div class="panel-card"><h2>Rooms</h2><p>Plants are grouped by room on the home screen.</p>
      <ul class="list">${S.rooms.map((r) => `<li><span>${esc(r.name)} <small class="muted">· ${plural(S.plants.filter((p) => p.room_id === r.id).length, 'plant')}</small></span>
        <span class="acts"><button data-act="rename-room" data-id="${r.id}" aria-label="Rename">✏️</button><button data-act="del-room" data-id="${r.id}" aria-label="Delete">🗑</button></span></li>`).join('') || '<li class="muted">No rooms yet</li>'}</ul>
      <div class="row"><button class="btn" data-act="add-room">+ Add room</button><button class="btn ghost" data-act="quick-rooms">Quick add</button></div></div>

    <div class="panel-card"><h2>Your data</h2><p>Everything lives in your own Supabase project. Export it to analyse in Excel or Google Sheets.</p>
      <div class="row wrap3"><button class="btn" data-act="export-events">History (CSV)</button><button class="btn" data-act="export-plants">Plants (CSV)</button><button class="btn" data-act="export-issues">Problems (CSV)</button></div></div>

    <div class="panel-card"><h2>Install as an app</h2>
      <p class="install-tip"><b>Android (Chrome):</b> menu ⋮ → Install app.<br><b>iPad (Safari):</b> Share → Add to Home Screen.</p></div>
    <button class="btn ghost block" data-act="signout">Sign out</button>`;
}

/* --------------------------------------------------------------- push */

export async function refreshPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { S.push = { supported: false }; return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    S.push = { supported: true, perm: Notification.permission, subscribed: !!sub };
  } catch (e) { S.push = { supported: false }; }
}

async function enablePush() {
  if (!cfg.VAPID_PUBLIC_KEY) throw new Error('VAPID_PUBLIC_KEY is missing in config.js');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { await refreshPush(); hooks.render(); throw new Error('Notifications were not allowed'); }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(cfg.VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({ user_id: S.session.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' });
  if (error) throw error;
  await saveSettings({ push_enabled: true, timezone: tz() });
  await refreshPush(); hooks.render();
  showToast('🔔 Notifications on. Tap "Send a test" to check.', 4000);
}
async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
  await refreshPush(); hooks.render();
  showToast('Notifications turned off for this device', 2500);
}

/* ------------------------------------------------------------- location */

async function searchPlace(q) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`);
  if (!r.ok) throw new Error('Place search failed');
  const j = await r.json();
  geoResults = j.results || [];
  if (!geoResults.length) showToast('No places found, try another spelling', 2500);
  hooks.render();
}
async function setLocation(lat, lon, name) {
  await saveSettings({ latitude: lat, longitude: lon, location_name: name, hemisphere: lat < 0 ? 'south' : 'north' });
  geoResults = [];
  if (hooks.clearWeather) hooks.clearWeather();
  hooks.render(); showToast(`📍 Location set: ${name}`, 2200);
  if (hooks.loadHeat) hooks.loadHeat();
}

/* -------------------------------------------------------------- rooms */

export function openQuickRooms() {
  const have = new Set(S.rooms.map((r) => r.name.toLowerCase()));
  modal(`<form id="qr" class="form"><h2>Which rooms have plants?</h2>
    <span class="seg">${DEFAULT_ROOMS.filter((n) => !have.has(n.toLowerCase())).map((n) => `<label><input type="checkbox" name="r" value="${esc(n)}"><span>${esc(n)}</span></label>`).join('')}</span>
    <p class="muted" style="font-size:14px">You can add your own and rename them any time in Settings.</p>
    <div class="row"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Add rooms</button></div></form>`);
}

/* -------------------------------------------------------------- exports */

function exportEvents() {
  const roomName = (p) => (S.rooms.find((r) => r.id === p.room_id) || {}).name || '';
  const rows = [['date', 'plant', 'room', 'type', 'soil_before_watering', 'amount_ml', 'note', 'has_photo']];
  [...S.events].reverse().forEach((e) => { const p = S.plants.find((x) => x.id === e.plant_id) || {}; rows.push([e.occurred_on, p.name, roomName(p), e.type, e.soil, e.amount_ml, e.note, e.photo_path ? 'yes' : '']); });
  download(`leaflog-history-${S.today}.csv`, csv(rows));
}
function exportPlants() {
  const head = ['plant', 'species', 'room', 'parent', 'prop_stage', 'prop_method', 'propagated_on', 'starting_interval_days', 'current_interval_days', 'interval_learned', 'flexibility', 'waterings', 'last_watered', 'next_water',
    'feed_every_weeks', 'next_feed', 'has_pole', 'pole_every_days', 'pole_ml', 'light_level', 'grow_light', 'light_model', 'light_watts', 'light_hours', 'light_distance_cm', 'pot_size_cm', 'soil_mix', 'purchased_on', 'purchased_from', 'price', 'added'];
  const rows = [head];
  const d = (n) => (n == null ? '' : L.fromDnum(n));
  S.st.forEach(({ p, w, f }) => {
    const rm = (S.rooms.find((r) => r.id === p.room_id) || {}).name || '', par = (S.plants.find((q) => q.id === p.parent_id) || {}).name || '';
    rows.push([p.name, p.species, rm, par, p.prop_stage, p.prop_method, p.propagated_on, p.interval_days, w.interval, w.learned ? 'yes' : 'no', p.flex, w.waterCount, d(w.last), d(w.due),
      p.fert_every_weeks, f ? d(f.due) : '', p.has_pole ? 'yes' : '', p.pole_every_days, p.pole_ml, p.light_level, p.grow_light ? 'yes' : '', p.light_model, p.light_watts, p.light_hours, p.light_distance_cm,
      p.pot_size_cm, p.soil_mix, p.purchased_on, p.purchased_from, p.price, L.localDate(p.created_at, tz())]);
  });
  download(`leaflog-plants-${S.today}.csv`, csv(rows));
}
function exportIssues() {
  const rows = [['plant', 'kind', 'title', 'started', 'resolved', 'days_to_fix', 'treatment', 'what_worked']];
  S.issues.forEach((i) => { const p = S.plants.find((x) => x.id === i.plant_id) || {}; rows.push([p.name, i.kind, i.title, i.started_on, i.resolved_on, i.resolved_on ? L.dnum(i.resolved_on) - L.dnum(i.started_on) : '', i.treatment, i.what_worked]); });
  download(`leaflog-problems-${S.today}.csv`, csv(rows));
}

/* --------------------------------------------------------------- wiring */

Object.assign(ACTS, {
  'toggle-day': async (t) => {
    const d = Number(t.dataset.d), cur = S.settings.water_days;
    await saveSettings({ water_days: cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort() });
    hooks.render();
  },
  'set-hemi': async (t) => { await saveSettings({ hemisphere: t.dataset.v }); hooks.render(); },
  'pick-loc': (t) => { const g = geoResults[Number(t.dataset.i)]; return setLocation(g.latitude, g.longitude, `${g.name}${g.admin1 ? ', ' + g.admin1 : ''}`); },
  'device-loc': () => new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('This browser cannot share its location'));
    navigator.geolocation.getCurrentPosition((pos) => setLocation(Math.round(pos.coords.latitude * 100) / 100, Math.round(pos.coords.longitude * 100) / 100, 'My location').then(res, rej), () => rej(new Error('Location permission was denied')));
  }),
  'clear-loc': async () => { await saveSettings({ latitude: null, longitude: null, location_name: null }); if (hooks.clearWeather) hooks.clearWeather(); hooks.render(); },
  'enable-push': () => enablePush(),
  'disable-push': () => disablePush(),
  'test-push': async () => { await callFn('daily-summary', { test: true }); showToast('Test sent. It should arrive in a few seconds.', 3500); },
  'quick-rooms': () => openQuickRooms(),
  'add-room': async () => { const v = await askText('New room', '', 'e.g. Living room'); if (v && v.trim()) { await addRoom(v.trim()); hooks.render(); } },
  'rename-room': async (t) => {
    const r = S.rooms.find((x) => x.id === t.dataset.id);
    const v = await askText('Rename room', r.name); if (!v || !v.trim()) return;
    const { error } = await sb.from('rooms').update({ name: v.trim() }).eq('id', r.id); if (error) throw error;
    r.name = v.trim(); hooks.render();
  },
  'del-room': async (t) => {
    const r = S.rooms.find((x) => x.id === t.dataset.id);
    const n = S.plants.filter((p) => p.room_id === r.id).length;
    if (!(await confirmBox(`Delete the room "${r.name}"? ${n ? `Its ${plural(n, 'plant')} will move to "No room".` : ''}`, 'Delete room'))) return;
    const { error } = await sb.from('rooms').delete().eq('id', r.id); if (error) throw error;
    S.rooms = S.rooms.filter((x) => x.id !== r.id);
    S.plants.forEach((p) => { if (p.room_id === r.id) p.room_id = null; });
    if (S.filter === r.id) S.filter = 'all';
    hooks.render();
  },
  'export-events': () => exportEvents(),
  'export-plants': () => exportPlants(),
  'export-issues': () => exportIssues(),
  signout: async () => { await sb.auth.signOut(); },
});

export function handleSubmit(f) {
  if (f.id === 'locf') { const q = new FormData(f).get('q').trim(); return q ? searchPlace(q) : null; }
  if (f.id === 'sf') {
    const fd = new FormData(f), factors = {};
    L.SEASONS.forEach((s) => { const v = Number(fd.get(s)); factors[s] = Number.isFinite(v) && v >= 0.5 && v <= 3 ? v : L.DEFAULT_SEASON_FACTORS[s]; });
    return saveSettings({ season_factors: factors }).then(() => { hooks.render(); showToast('Saved', 1500); });
  }
  if (f.id === 'qr') {
    const names = new FormData(f).getAll('r');
    return (async () => { for (const n of names) await addRoom(n); closeModal(); hooks.render(); })();
  }
  return null;
}

export function handleChange(e) {
  const t = e.target;
  if (t.dataset && t.dataset.setting === 'season_adjust') return saveSettings({ season_adjust: t.checked }).then(() => hooks.render());
  if (t.dataset && t.dataset.setting === 'notify_hour') return saveSettings({ notify_hour: Number(t.value) }).then(() => showToast('Saved', 1200));
  return null;
}
