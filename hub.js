/* Hub: a landscape, always-on dashboard for a spare iPad. Everything at a glance, tap to act.
   Written in plain older-JS style on purpose (no ?. or ??) so it also runs on older iPads. */
import * as L from './logic.js';
import { S, ACTS, hooks, sb, plantImg, loadAll, tz } from './state.js';
import { esc, plural, fmtDay, fmtDate, TYPES, ISSUE_KINDS } from './util.js';
import { waterStatus, dueEntries } from './home.js';

const KEY = 'leaflog-hub';
export function hubOn() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
function setHub(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* ignore */ } }

/* ------------------------------------------------------------ data */
let sensors = [];          // latest reading per (room|plant, kind)
let weather = null, weatherAt = 0, sensorsAt = 0;

export async function loadSensors() {
  sensorsAt = Date.now();
  try {
    const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    const r = await sb.from('sensor_readings').select('room_id,plant_id,kind,value,device,recorded_at')
      .gte('recorded_at', since).order('recorded_at', { ascending: false }).limit(2000);
    if (r.error) { sensors = []; return; }
    const seen = {}; sensors = [];
    r.data.forEach(function (x) {
      const k = (x.plant_id || x.room_id || '-') + '|' + x.kind + '|' + (x.plant_id ? 'p' : 'r');
      if (!seen[k]) { seen[k] = 1; sensors.push(x); }
    });
  } catch (e) { sensors = []; }
}

const WMO = function (c) {
  if (c === 0) return ['☀️', 'Clear'];
  if (c <= 2) return ['🌤️', 'Partly cloudy'];
  if (c === 3) return ['☁️', 'Overcast'];
  if (c <= 48) return ['🌫️', 'Fog'];
  if (c <= 57) return ['🌦️', 'Drizzle'];
  if (c <= 67) return ['🌧️', 'Rain'];
  if (c <= 77) return ['❄️', 'Snow'];
  if (c <= 82) return ['🌦️', 'Showers'];
  if (c <= 99) return ['⛈️', 'Storms'];
  return ['🌡️', ''];
};

export async function loadWeatherNow() {
  const lat = S.settings.latitude, lon = S.settings.longitude;
  if (lat == null || lon == null) { weather = null; return; }
  weatherAt = Date.now();
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&current=temperature_2m,relative_humidity_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum&forecast_days=4&timezone=auto');
    if (r.ok) weather = await r.json();
  } catch (e) { /* offline: keep the last one */ }
}

/* ------------------------------------------------------------ helpers */
function latest(kind, roomId, plantId) {
  for (let i = 0; i < sensors.length; i++) {
    const x = sensors[i];
    if (x.kind !== kind) continue;
    if (plantId ? x.plant_id === plantId : (x.room_id === roomId && !x.plant_id)) return x;
  }
  return null;
}
const ageMin = function (x) { return (Date.now() - new Date(x.recorded_at).getTime()) / 60000; };
const fresh = function (x) { return x && ageMin(x) < 180; };

function clockHtml() {
  const d = new Date(), z = tz();
  const t = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: z }).format(d);
  const date = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: z }).format(d);
  return '<div class="hub-time">' + esc(t.replace(' ', '')) + '</div><div class="hub-date">' + esc(date) + '</div>';
}

function weatherHtml() {
  if (S.settings.latitude == null) return '<div class="hub-card"><h3>Weather</h3><p class="muted">Set your location in Settings.</p></div>';
  if (!weather || !weather.current) return '<div class="hub-card"><h3>Weather</h3><p class="muted">Loading…</p></div>';
  const c = weather.current, dly = weather.daily, w = WMO(c.weather_code);
  const days = [1, 2, 3].map(function (i) {
    if (!dly.time[i]) return '';
    const dn = new Date(dly.time[i] + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short' });
    return '<div class="hub-fc"><span>' + dn + '</span><b>' + WMO(dly.weather_code[i])[0] + '</b><span>' + Math.round(dly.temperature_2m_max[i]) + '°/' + Math.round(dly.temperature_2m_min[i]) + '°</span></div>';
  }).join('');
  const heat = S.heat ? '<p class="hub-note">' + esc(S.heat) + '</p>' : '';
  return '<div class="hub-card"><h3>Outside</h3><div class="hub-wx"><span class="hub-wx-i">' + w[0] + '</span><div><div class="hub-big">' + Math.round(c.temperature_2m) +
    '°</div><div class="muted">' + esc(w[1]) + ' · ' + Math.round(c.relative_humidity_2m) + '% humidity</div></div></div><div class="hub-fcs">' + days + '</div>' + heat + '</div>';
}

function tasksHtml() {
  const due = dueEntries();
  if (!due.length) {
    const next = S.plan.filter(function (t) { return t.day > L.dnum(S.today); })[0];
    return '<div class="hub-card hub-today ok"><h3>Today</h3><div class="hub-empty">🎉<b>All caught up</b>' +
      (next ? '<span class="muted">Next jobs ' + esc(fmtDay(next.day)) + '</span>' : '') + '</div></div>';
  }
  let lastRoom = null, rows = '';
  due.forEach(function (e) {
    const p = S.plants.find(function (x) { return x.id === e.plantId; }); if (!p) return;
    const r = S.rooms.find(function (x) { return x.id === p.room_id; });
    const rn = r ? r.name : 'No room';
    if (rn !== lastRoom) { rows += '<div class="hub-room">' + esc(rn) + '</div>'; lastRoom = rn; }
    const img = plantImg(p), st = S.stMap[p.id];
    const feed = !!((e.water && e.water.feed) || e.feed);
    const what = [];
    if (e.water) what.push('💧 Water' + (feed ? ' + 🧪 feed' : '')); else if (feed) what.push('🧪 Feed');
    if (e.pole) { const ml = st && st.pole && st.pole.ml; what.push('🎋 Pole' + (ml ? ' ' + ml + ' ml' : '')); }
    rows += '<div class="hub-task"><div class="hub-av" data-act="open" data-id="' + p.id + '"' + (img ? ' style="background-image:url(\'' + img + '\')"' : '') + '>' + (img ? '' : '🪴') + '</div>' +
      '<div class="hub-tn" data-act="open" data-id="' + p.id + '"><b>' + esc(p.name) + '</b><span>' + what.join(' · ') + '</span></div>' +
      '<button class="hub-do" data-act="do-task" data-id="' + p.id + '" data-w="' + (e.water ? 1 : 0) + '" data-f="' + (e.feed ? 1 : 0) + '" data-p="' + (e.pole ? 1 : 0) + '">Done</button></div>';
  });
  return '<div class="hub-card hub-today"><h3>Today <small>' + plural(due.length, 'plant') + '</small><button class="hub-all" data-act="do-all">Do all ✓</button></h3><div class="hub-scroll">' + rows + '</div></div>';
}

function weekHtml() {
  const t0 = L.dnum(S.today), cols = [];
  for (let i = 0; i < 7; i++) {
    const d = t0 + i;
    const ts = S.plan.filter(function (t) { return i === 0 ? t.day <= d && !t.projected : t.day === d; });
    const w = ts.filter(function (t) { return t.kind === 'water'; }).length;
    const f = ts.filter(function (t) { return t.kind === 'feed' || (t.kind === 'water' && t.feed); }).length;
    const p = ts.filter(function (t) { return t.kind === 'pole'; }).length;
    const isWd = (S.settings.water_days || []).indexOf(L.dow(d)) >= 0;
    const nm = i === 0 ? 'Today' : new Date(L.fromDnum(d) + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short' });
    cols.push('<div class="hub-day' + (i === 0 ? ' now' : '') + (isWd ? ' wd' : '') + '"><span>' + nm + '</span><b>' + (w ? '💧' + w : '·') + '</b><small>' + (f ? '🧪' + f + ' ' : '') + (p ? '🎋' + p : '') + '&nbsp;</small></div>');
  }
  return '<div class="hub-card"><h3>This week</h3><div class="hub-week">' + cols.join('') + '</div></div>';
}

function roomsHtml() {
  const tiles = S.rooms.map(function (r) {
    const ps = S.plants.filter(function (p) { return p.room_id === r.id; });
    if (!ps.length) return '';
    const due = ps.filter(function (p) { return S.stMap[p.id] && S.stMap[p.id].w.days <= 0; }).length;
    const t = latest('temp_c', r.id), h = latest('humidity', r.id);
    const hasS = t || h, ok = fresh(t) || fresh(h);
    const cl = hasS
      ? '<div class="hub-clim' + (ok ? '' : ' stale') + '"><span>🌡️ ' + (t ? Number(t.value).toFixed(1) + '°' : '–') + '</span><span>💦 ' + (h ? Math.round(h.value) + '%' : '–') + '</span></div>'
      : '<div class="hub-clim none">no sensor yet</div>';
    return '<div class="hub-room-tile' + (due ? ' due' : '') + '"><b>' + esc(r.name) + '</b><span class="muted">' + plural(ps.length, 'plant') + (due ? ' · ' + due + ' thirsty' : '') + '</span>' + cl + '</div>';
  }).join('');
  return '<div class="hub-card"><h3>Rooms</h3><div class="hub-rooms">' + (tiles || '<p class="muted">Add plants to rooms to see them here.</p>') + '</div></div>';
}

function problemsHtml() {
  const open = S.issues.filter(function (i) { return !i.resolved_on; });
  if (!open.length) return '<div class="hub-card"><h3>Problems</h3><p class="muted">✅ Nothing ongoing</p></div>';
  const rows = open.slice(0, 5).map(function (i) {
    const p = S.plants.find(function (x) { return x.id === i.plant_id; });
    const days = L.dnum(S.today) - L.dnum(i.started_on);
    return '<div class="hub-li" data-act="open" data-id="' + i.plant_id + '"><b>' + esc(p ? p.name : '?') + '</b><span>' + esc((ISSUE_KINDS[i.kind] || i.kind)) + ' · day ' + (days + 1) + '</span></div>';
  }).join('');
  return '<div class="hub-card"><h3>Problems <small>' + open.length + ' open</small></h3>' + rows + '</div>';
}

function recentHtml() {
  const rows = S.events.slice(0, 5).map(function (e) {
    const p = S.plants.find(function (x) { return x.id === e.plant_id; }); const ty = TYPES[e.type] || TYPES.note;
    return '<div class="hub-li"><b>' + ty.icon + ' ' + esc(p ? p.name : '?') + '</b><span>' + esc(ty.label) + ' · ' + esc(fmtDate(e.occurred_on)) + '</span></div>';
  }).join('');
  return '<div class="hub-card"><h3>Recent</h3>' + (rows || '<p class="muted">Nothing logged yet.</p>') + '</div>';
}

function stripHtml() {
  const items = S.plants.map(function (p) {
    const st = S.stMap[p.id]; if (!st) return '';
    const ws = waterStatus(st.w), img = plantImg(p), m = latest('soil_moisture', null, p.id);
    return '<div class="hub-pl ' + ws.cls + '" data-act="open" data-id="' + p.id + '"><div class="hub-pimg"' + (img ? ' style="background-image:url(\'' + img + '\')"' : '') + '>' + (img ? '' : '🪴') + '</div>' +
      '<b>' + esc(p.name) + '</b><span>' + esc(ws.text) + (m ? ' · ' + Math.round(m.value) + '%' : '') + '</span></div>';
  }).join('');
  return '<div class="hub-strip">' + items + '</div>';
}

/* ------------------------------------------------------------ view */
export function viewHub() {
  return '<div class="hub' + (isNight() ? ' night' : '') + '" id="hub">' +
    '<div class="hub-col a"><div class="hub-card hub-clock" id="hub-clock">' + clockHtml() + '</div>' + weatherHtml() + problemsHtml() + '</div>' +
    '<div class="hub-col b">' + tasksHtml() + weekHtml() + '</div>' +
    '<div class="hub-col c">' + roomsHtml() + recentHtml() + '</div>' +
    stripHtml() +
    '<div class="hub-bar"><button data-act="hub-refresh" aria-label="Refresh">⟳</button><button data-act="hub-exit" aria-label="Leave hub">✕</button></div></div>';
}

function isNight() { const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz() }).format(new Date())); return h >= 22 || h < 6; }

/* ------------------------------------------------------------ lifecycle */
let timer = null, wake = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not supported */ }
}
export function startHub() {
  if (timer) return;
  keepAwake();
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && S.tab === 'hub') keepAwake(); });
  let n = 0;
  timer = setInterval(function () {
    if (S.tab !== 'hub') return;
    n++;
    const c = document.getElementById('hub-clock'); if (c) c.innerHTML = clockHtml();
    if (n % 10 === 0) refreshHub(); // every ~5 minutes
  }, 30000);
}
export async function refreshHub() {
  if (document.getElementById('modal') && !document.getElementById('modal').hidden) return;
  if (document.getElementById('sheet') && !document.getElementById('sheet').hidden) return;
  try { await loadAll(); } catch (e) { console.warn(e); }
  await Promise.all([loadSensors(), Date.now() - weatherAt > 20 * 60000 ? loadWeatherNow() : null]);
  hooks.render();
}
export async function enterHub() {
  setHub(true); S.tab = 'hub'; startHub();
  await Promise.all([loadSensors(), loadWeatherNow()]);
  hooks.render(); window.scrollTo(0, 0);
}

ACTS['hub-enter'] = function () { return enterHub(); };
ACTS['hub-exit'] = function () { setHub(false); S.tab = 'home'; hooks.render(); };
ACTS['hub-refresh'] = function () { return refreshHub(); };
