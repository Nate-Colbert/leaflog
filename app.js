'use strict';
/* Leaflog: indoor plant tracker. Static front end + Supabase (database, auth, photo storage). */

const cfg = window.PLANT_CONFIG || {};
const BUCKET = 'plant-photos';
const URL_TTL = 60 * 60 * 24 * 7; // signed photo links last a week

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TYPES = {
  water:     { icon: '💧', label: 'Watered',      short: 'Water',     color: '#3b9ae1' },
  fertilise: { icon: '🧪', label: 'Fertilised',   short: 'Feed',      color: '#8e6bd8' },
  repot:     { icon: '🪴', label: 'Repotted',     short: 'Repot',     color: '#b9772f' },
  new_leaf:  { icon: '🍃', label: 'New leaf',     short: 'New leaf',  color: '#3fae6a' },
  prune:     { icon: '✂️', label: 'Pruned',       short: 'Prune',     color: '#d9669b' },
  pest:      { icon: '🐛', label: 'Pest / issue', short: 'Pest',      color: '#d24545' },
  note:      { icon: '📝', label: 'Note',         short: 'Note',      color: '#8a979a' },
};
const SOIL = { dry: 'Dry', damp: 'Damp', wet: 'Wet' };
const DEFAULT_ROOMS = ['Living room', 'Kitchen', 'Bedroom', 'Bathroom', 'Office', 'Hallway', 'Balcony'];

const S = {
  session: null, rooms: [], plants: [], events: [], urls: {}, urlsAt: 0,
  tab: 'home', filter: 'all', detail: null, charts: [], loadedAt: 0,
};
let sb = null;
let pending = null; // resolver for askText / confirmBox
let toastTimer = null;
const busy = new Set();

/* ------------------------------------------------------------------ dates */

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const localDate = (iso) => ymd(new Date(iso));
const dnum = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const fmtDate = (s) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  const opts = { day: 'numeric', month: 'short' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', opts);
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* ------------------------------------------------------- learning schedule */

/* Works out when a plant is next due.
   - Looks at the gaps between its logged waterings (ignores same-day repeats and long holiday gaps).
   - Weights recent gaps more, so seasons shift the rhythm naturally.
   - If you noted the soil was damp/wet when you watered, that gap was "too short", so it's stretched a bit.
   - With fewer than 3 gaps it blends in your starting guess (interval_days). */
function plantStats(p, events = S.events, today = todayStr()) {
  const ws = events
    .filter((e) => e.plant_id === p.id && e.type === 'water')
    .map((e) => ({ d: dnum(e.occurred_on), soil: e.soil }))
    .sort((a, b) => a.d - b.d);
  const gaps = [];
  for (let i = 1; i < ws.length; i++) {
    const g = ws[i].d - ws[i - 1].d;
    if (g >= 1) gaps.push({ g, soil: ws[i].soil });
  }
  let use = gaps;
  if (gaps.length >= 3) {
    const med = median(gaps.map((x) => x.g));
    use = gaps.filter((x) => x.g <= med * 3);
  }
  use = use.slice(-6);
  let learned = null;
  if (use.length) {
    let sw = 0, sv = 0;
    use.forEach((x, i) => {
      const w = i + 1;
      const f = x.soil === 'wet' ? 1.25 : x.soil === 'damp' ? 1.1 : 1;
      sw += w; sv += w * x.g * f;
    });
    learned = sv / sw;
  }
  const n = use.length;
  let interval = p.interval_days;
  if (learned !== null) interval = n >= 3 ? learned : (learned * n + p.interval_days * (3 - n)) / 3;
  interval = Math.max(1, Math.round(interval));
  const last = ws.length ? ws[ws.length - 1].d : null;
  const base = last ?? dnum(localDate(p.created_at));
  const due = base + interval;
  const days = due - dnum(today);
  return { interval, learned: n >= 3, n, last, due, days, waterCount: ws.length, sinceLast: last === null ? null : dnum(today) - last };
}

function statusInfo(s) {
  if (s.days < 0) return { cls: 'late', text: `${-s.days}d overdue`, long: `${plural(-s.days, 'day')} overdue` };
  if (s.days === 0) return { cls: 'today', text: 'Water today', long: 'Due today' };
  if (s.days === 1) return { cls: 'ok', text: 'Tomorrow', long: 'Due tomorrow' };
  return { cls: 'ok', text: `in ${s.days}d`, long: `Due in ${plural(s.days, 'day')}` };
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  if (!cfg.SUPABASE_URL || /PASTE/i.test(cfg.SUPABASE_URL) || !cfg.SUPABASE_ANON_KEY || /PASTE/i.test(cfg.SUPABASE_ANON_KEY)) {
    $('#app').innerHTML = `<div class="wrap"><div class="empty"><div class="big">🔧</div><h2>Almost there</h2>
      <p>Open <b>config.js</b> and paste in your Supabase project URL and key (the README explains where to find them).</p></div></div>`;
    return;
  }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  sb.auth.onAuthStateChange((_evt, session) => {
    const had = !!S.session;
    S.session = session;
    if (session && !had) start();
    if (!session && had) { resetState(); renderLogin(); }
  });
  S.session ? start() : renderLogin();
}

function resetState() {
  Object.assign(S, { rooms: [], plants: [], events: [], urls: {}, urlsAt: 0, tab: 'home', filter: 'all', detail: null });
  hideSheet(); closeModal();
}

async function start() {
  $('#app').innerHTML = '<div class="boot">🪴</div>';
  try { await loadAll(); } catch (e) { fail(e); }
  render();
}

async function fetchAll(table, orders) {
  let out = [], from = 0;
  for (;;) {
    let q = sb.from(table).select('*');
    orders.forEach(([col, asc]) => { q = q.order(col, { ascending: asc }); });
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function loadAll() {
  const [rooms, plants, events] = await Promise.all([
    fetchAll('rooms', [['created_at', true]]),
    fetchAll('plants', [['created_at', true]]),
    fetchAll('events', [['occurred_on', false], ['created_at', false]]),
  ]);
  S.rooms = rooms; S.plants = plants; S.events = events;
  S.loadedAt = Date.now();
  await refreshUrls();
}

async function refreshUrls() {
  if (Date.now() - S.urlsAt > 5 * 864e5) { S.urls = {}; S.urlsAt = Date.now(); }
  const paths = [...new Set([...S.plants.map((p) => p.photo_path), ...S.events.map((e) => e.photo_path)].filter(Boolean))];
  const need = paths.filter((p) => !S.urls[p]);
  for (let i = 0; i < need.length; i += 100) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need.slice(i, i + 100), URL_TTL);
    if (error) { console.warn(error); break; }
    (data || []).forEach((d) => { if (d.signedUrl) S.urls[d.path] = d.signedUrl; });
  }
}

/* ---------------------------------------------------------------- login */

function renderLogin(msg = '') {
  $('#app').innerHTML = `<div class="wrap" style="padding-top:12vh">
    <div style="text-align:center;margin-bottom:22px"><div style="font-size:64px">🪴</div><h1 style="font-size:30px;letter-spacing:-.02em">Leaflog</h1>
    <p class="muted">Sign in to see your plants</p></div>
    <form id="lf" class="form panel-card" style="max-width:380px;margin:auto">
      <label>Email<input name="email" type="email" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      ${msg ? `<p style="color:var(--danger);font-size:14px">${esc(msg)}</p>` : ''}
      <button class="btn primary block">Sign in</button>
    </form></div>`;
}

async function loginSubmit(f) {
  const fd = new FormData(f);
  const btn = $('button', f); btn.disabled = true; btn.textContent = 'Signing in…';
  const { error } = await sb.auth.signInWithPassword({ email: fd.get('email').trim(), password: fd.get('password') });
  if (error) renderLogin(error.message);
}

/* ---------------------------------------------------------------- render */

function render() {
  if (!S.session) return;
  const y = window.scrollY;
  const view = S.tab === 'home' ? viewHome() : S.tab === 'insights' ? viewInsights() : viewSettings();
  const nav = [['home', '🪴', 'Plants'], ['insights', '📊', 'Insights'], ['settings', '⚙️', 'Settings']]
    .map(([t, i, l]) => `<button class="${S.tab === t ? 'on' : ''}" data-act="tab" data-tab="${t}"><span>${i}</span>${l}</button>`).join('');
  $('#app').innerHTML = `<div class="wrap">${view}</div><nav class="nav"><div class="inner">${nav}</div></nav>` +
    (S.tab === 'home' && S.plants.length ? '<button class="fab" data-act="add-plant" aria-label="Add plant">+</button>' : '');
  if (S.tab === 'insights') drawCharts();
  window.scrollTo(0, y);
  if (S.detail && !$('#sheet').hidden) renderDetail();
}

const plantImg = (p) => (p.photo_path && S.urls[p.photo_path]) || '';

function viewHome() {
  const items = S.plants.map((p) => ({ p, s: plantStats(p) }));
  const due = items.filter((x) => x.s.days <= 0).sort((a, b) => a.s.days - b.s.days);
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const sub = !items.length ? "Let's get your plants set up" : due.length ? `${plural(due.length, 'plant')} ready for a drink` : 'Everything is watered 🎉';
  let html = `<div class="top"><div><h1>${greet}</h1><p>${sub}</p></div><button class="icon-btn" data-act="refresh" aria-label="Refresh">↻</button></div>`;

  if (!items.length) {
    return html + `<div class="empty"><div class="big">🌿</div><h2>No plants yet</h2>
      <p>Add your first plant, then log a watering. Leaflog learns each plant's rhythm as you go.</p>
      ${S.rooms.length ? '' : '<button class="btn" data-act="quick-rooms">Set up rooms first</button>'}
      <button class="btn primary" data-act="add-plant">Add a plant</button></div>`;
  }

  if (due.length) {
    html += `<section class="today-strip"><h2>Needs water</h2><div class="today-row">${due.map(({ p, s }) => {
      const img = plantImg(p), st = statusInfo(s);
      return `<div class="t-item" data-act="open" data-id="${p.id}"><div class="t-ph">${img ? `<img src="${esc(img)}" alt="">` : '🪴'}</div>
        <b>${esc(p.name)}</b><small>${esc(st.text)}</small><button data-act="water" data-id="${p.id}">💧 Water</button></div>`;
    }).join('')}</div></section>`;
  } else {
    html += '<div class="all-good">✨ Nothing needs water right now.</div>';
  }

  const hasNone = items.some((x) => !x.p.room_id || !S.rooms.find((r) => r.id === x.p.room_id));
  const chips = [['all', 'All'], ...S.rooms.map((r) => [r.id, r.name]), ...(hasNone && S.rooms.length ? [['none', 'No room']] : [])];
  if (chips.length > 1) {
    html += `<div class="chips">${chips.map(([id, l]) => `<button class="chip ${S.filter === id ? 'on' : ''}" data-act="filter" data-id="${id}">${esc(l)}</button>`).join('')}</div>`;
  }

  const groups = [...S.rooms.map((r) => ({ key: r.id, name: r.name, items: items.filter((x) => x.p.room_id === r.id) })),
    { key: 'none', name: S.rooms.length ? 'No room' : 'My plants', items: items.filter((x) => !x.p.room_id || !S.rooms.find((r) => r.id === x.p.room_id)) }];
  groups.forEach((g) => {
    if (!g.items.length) return;
    if (S.filter !== 'all' && S.filter !== g.key) return;
    g.items.sort((a, b) => a.s.days - b.s.days || a.p.name.localeCompare(b.p.name));
    html += `<section class="group"><h2>${esc(g.name)} <small>${plural(g.items.length, 'plant')}</small></h2><div class="grid">${g.items.map(card).join('')}</div></section>`;
  });
  return html;
}

function card({ p, s }) {
  const img = plantImg(p), st = statusInfo(s);
  return `<article class="card" data-act="open" data-id="${p.id}">
    <div class="ph">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '🪴'}<span class="pill ${st.cls}">${esc(st.text)}</span></div>
    <div class="cb"><h3>${esc(p.name)}</h3><p>${esc(p.species || '')}</p>
    <button class="btn water" data-act="water" data-id="${p.id}">💧 Water</button></div></article>`;
}

/* ---------------------------------------------------------- plant detail */

function openSheet(id) {
  S.detail = id;
  const sh = $('#sheet');
  sh.hidden = false; sh.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  history.pushState({ sheet: 1 }, '');
  renderDetail();
}
function hideSheet() { const sh = $('#sheet'); if (sh) sh.hidden = true; S.detail = null; document.body.style.overflow = ''; }
function closeSheet() { if (history.state && history.state.sheet) history.back(); else hideSheet(); }

function renderDetail() {
  const p = S.plants.find((x) => x.id === S.detail);
  if (!p) { hideSheet(); return; }
  const s = plantStats(p), st = statusInfo(s);
  const room = S.rooms.find((r) => r.id === p.room_id);
  const evs = S.events.filter((e) => e.plant_id === p.id);
  const img = plantImg(p);
  const photos = [...(img ? [img] : []), ...evs.filter((e) => e.photo_path && S.urls[e.photo_path]).map((e) => S.urls[e.photo_path])];
  const waters = evs.filter((e) => e.type === 'water');
  const learnTxt = s.learned
    ? `Learned from your last ${plural(s.n, 'watering gap')}: about every ${s.interval} days.`
    : s.n ? `Still learning (${plural(s.n, 'gap')} so far). Using about every ${s.interval} days.`
    : `Using your starting guess: every ${p.interval_days} days. Log a few waterings and Leaflog learns the real rhythm.`;
  const lastTxt = s.sinceLast === null ? 'Never watered' : s.sinceLast === 0 ? 'Today' : `${s.sinceLast}d ago`;
  const count = (t) => evs.filter((e) => e.type === t).length;

  $('#sheet').innerHTML = `<div class="panel">
    <div class="hero" data-act="${img ? 'zoom' : 'edit-plant'}" data-src="${esc(img)}">
      ${img ? `<img src="${esc(img)}" alt="">` : '🪴'}
      <button class="back" data-act="close-sheet">‹ Back</button><button class="edit" data-act="edit-plant">Edit</button>
    </div>
    <div class="pad">
      <h1 class="d-title">${esc(p.name)}</h1>
      <p class="d-sub">${[p.species, room && room.name].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</p>
      <div class="status ${st.cls}"><div><b>${esc(st.long)}</b><small>${esc(learnTxt)}</small></div>
        <button class="btn water" data-act="water" data-id="${p.id}">💧 Water</button></div>

      <div class="actions">${Object.entries(TYPES).filter(([t]) => t !== 'water').map(([t, v]) =>
        `<button class="act" data-act="log" data-type="${t}"><span>${v.icon}</span>${v.short}</button>`).join('')}
        <button class="act" data-act="log" data-type="water"><span>📅</span>Past water</button></div>

      <div class="facts"><div class="fact"><b>${lastTxt}</b><small>last watered</small></div>
        <div class="fact"><b>${waters.length}</b><small>waterings</small></div>
        <div class="fact"><b>${count('new_leaf')}</b><small>new leaves</small></div></div>

      ${p.notes ? `<h3 class="sec-h">Notes</h3><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(p.notes)}</p>` : ''}
      ${photos.length ? `<h3 class="sec-h">Photos</h3><div class="gallery">${photos.map((u) => `<img src="${esc(u)}" alt="" loading="lazy" data-act="zoom" data-src="${esc(u)}">`).join('')}</div>` : ''}

      <h3 class="sec-h">History</h3>
      ${evs.length ? `<ul class="tl">${evs.slice(0, 120).map((e) => {
        const t = TYPES[e.type] || TYPES.note, u = e.photo_path && S.urls[e.photo_path];
        return `<li><div class="ic" style="background:${t.color}22">${t.icon}</div><div class="bd">
          <b>${t.label}${e.soil ? `<span class="badge">${SOIL[e.soil]} soil</span>` : ''}</b><small>${fmtDate(e.occurred_on)}</small>
          ${e.note ? `<p>${esc(e.note)}</p>` : ''}${u ? `<img src="${esc(u)}" alt="" loading="lazy" data-act="zoom" data-src="${esc(u)}">` : ''}</div>
          <button class="del" data-act="del-event" data-id="${e.id}" aria-label="Delete entry">🗑</button></li>`;
      }).join('')}</ul>` : '<p class="muted">Nothing logged yet. Tap Water or any action above.</p>'}
    </div></div>`;
}

/* ----------------------------------------------------------------- modal */

function modal(html, cls = '') {
  const m = $('#modal');
  m.innerHTML = `<div class="box ${cls}">${html}</div>`;
  m.hidden = false;
}
function closeModal() {
  const m = $('#modal');
  if (m) { m.hidden = true; m.innerHTML = ''; }
  if (pending) { const r = pending; pending = null; r(null); }
}

function askText(title, value = '', placeholder = '') {
  return new Promise((res) => {
    pending = res;
    modal(`<form id="tf" class="form"><h2>${esc(title)}</h2>
      <input name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" required>
      <div class="row"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Save</button></div></form>`);
    setTimeout(() => { const i = $('#tf input'); if (i) i.focus(); }, 60);
  });
}
function confirmBox(message, okLabel = 'Delete') {
  return new Promise((res) => {
    pending = res;
    modal(`<h2>Are you sure?</h2><p class="muted" style="margin-bottom:16px">${esc(message)}</p>
      <div class="row"><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn danger" data-act="confirm-yes">${esc(okLabel)}</button></div>`);
  });
}
function resolvePending(v) { const r = pending; pending = null; closeModal(); if (r) r(v); }

function showToast(html, ms = 5000, cls = '') {
  const t = $('#toast');
  t.className = `toast ${cls}`; t.innerHTML = html; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function fail(err) { console.error(err); showToast(`⚠️ ${esc((err && err.message) || err)}`, 7000, 'err'); }

/* ---------------------------------------------------------------- photos */

function loadImg(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file), i = new Image();
    i.onload = () => { res(i); URL.revokeObjectURL(u); };
    i.onerror = () => { rej(new Error("Couldn't read that image")); URL.revokeObjectURL(u); };
    i.src = u;
  });
}
async function resizeImage(file, max = 1400) {
  const img = await loadImg(file);
  const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Image conversion failed'))), 'image/jpeg', 0.82));
}
async function uploadPhoto(file) {
  const blob = await resizeImage(file);
  const path = `${S.session.user.id}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}
async function removePhotos(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  const { error } = await sb.storage.from(BUCKET).remove(list);
  if (error) console.warn(error);
}

/* ---------------------------------------------------------------- events */

const sortEvents = () => S.events.sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at));

async function insertEvent(row) {
  const { data, error } = await sb.from('events').insert(row).select().single();
  if (error) throw error;
  S.events.push(data); sortEvents();
  return data;
}

async function quickWater(id) {
  if (busy.has(id)) return;
  busy.add(id);
  try {
    const p = S.plants.find((x) => x.id === id);
    const ev = await insertEvent({ plant_id: id, type: 'water', occurred_on: todayStr() });
    render();
    showToast(`<span>💧 <b>${esc(p.name)}</b> watered</span><span class="tchips">Soil was:
      ${Object.entries(SOIL).map(([k, v]) => `<button data-act="soil" data-id="${ev.id}" data-v="${k}">${v}</button>`).join('')}
      <button class="u" data-act="undo" data-id="${ev.id}">Undo</button></span>`, 8000);
  } finally { setTimeout(() => busy.delete(id), 600); }
}

async function setSoil(id, v) {
  const { error } = await sb.from('events').update({ soil: v }).eq('id', id);
  if (error) throw error;
  const e = S.events.find((x) => x.id === id); if (e) e.soil = v;
  render();
  showToast(`Saved: soil was ${SOIL[v].toLowerCase()} ✓`, 1800);
}

async function deleteEvent(id, silent = false) {
  const e = S.events.find((x) => x.id === id); if (!e) return;
  const { error } = await sb.from('events').delete().eq('id', id);
  if (error) throw error;
  S.events = S.events.filter((x) => x.id !== id);
  removePhotos([e.photo_path]);
  render();
  if (!silent) showToast('Entry deleted', 1800);
}

function openEventModal(plantId, type = 'water') {
  const p = S.plants.find((x) => x.id === plantId); if (!p) return;
  modal(`<form id="ef" class="form" data-plant="${p.id}"><h2>${esc(p.name)}</h2>
    <label>What happened?<span class="seg">${Object.entries(TYPES).map(([k, v]) =>
      `<label><input type="radio" name="type" value="${k}" ${k === type ? 'checked' : ''}><span>${v.icon} ${v.short}</span></label>`).join('')}</span></label>
    <label>Date<input type="date" name="date" value="${todayStr()}" max="${todayStr()}" required></label>
    <div id="soilbox" ${type === 'water' ? '' : 'hidden'}><label>How was the soil before watering?<span class="seg">
      <label><input type="radio" name="soil" value="" checked><span>Skip</span></label>
      ${Object.entries(SOIL).map(([k, v]) => `<label><input type="radio" name="soil" value="${k}"><span>${v}</span></label>`).join('')}</span></label></div>
    <label>Note (optional)<textarea name="note" placeholder="e.g. 2 new leaves, brown tips, moved to brighter spot"></textarea></label>
    <label>Photo (optional)<span class="photo-pick"><span class="ph-hint">📷 Take or choose a photo</span><input type="file" accept="image/*"></span></label>
    <div class="row"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Save</button></div></form>`);
}

async function saveEvent(f) {
  const fd = new FormData(f), type = fd.get('type');
  const btn = $('button.primary', f); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const file = $('input[type=file]', f).files[0];
    const photo_path = file ? await uploadPhoto(file) : null;
    await insertEvent({
      plant_id: f.dataset.plant, type, occurred_on: fd.get('date') || todayStr(),
      soil: type === 'water' ? fd.get('soil') || null : null, note: (fd.get('note') || '').trim() || null, photo_path,
    });
    await refreshUrls();
    closeModal(); render();
    showToast(`${TYPES[type].icon} Saved`, 1800);
  } catch (err) { fail(err); btn.disabled = false; btn.textContent = 'Save'; }
}

/* ---------------------------------------------------------------- plants */

function openPlantForm(id) {
  const p = id ? S.plants.find((x) => x.id === id) : { name: '', species: '', room_id: S.filter !== 'all' && S.filter !== 'none' ? S.filter : '', interval_days: 7, notes: '' };
  const img = id ? plantImg(p) : '';
  modal(`<form id="pf" class="form" data-id="${id || ''}"><h2>${id ? 'Edit plant' : 'New plant'}</h2>
    <label>Photo<span class="photo-pick">${img ? `<img src="${esc(img)}" alt="">` : '<span class="ph-hint">📷 Take or choose a photo</span>'}<input type="file" accept="image/*"></span></label>
    <label>Name<input name="name" required value="${esc(p.name)}" placeholder="e.g. Monty the monstera"></label>
    <label>Type / species (optional)<input name="species" value="${esc(p.species || '')}" placeholder="e.g. Monstera deliciosa"></label>
    <label>Room<select name="room"><option value="">No room</option>
      ${S.rooms.map((r) => `<option value="${r.id}" ${r.id === p.room_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
      <option value="__new">+ New room…</option></select></label>
    <input name="newroom" placeholder="New room name" hidden>
    <label>Starting guess: water every (days)<input type="number" name="interval" min="1" max="365" inputmode="numeric" value="${p.interval_days}"></label>
    <label>Notes (optional)<textarea name="notes" placeholder="Light, quirks, care tips">${esc(p.notes || '')}</textarea></label>
    <div class="row"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Save</button></div>
    ${id ? '<button type="button" class="link-danger" data-act="delete-plant">Delete this plant…</button>' : ''}</form>`);
}

async function addRoom(name) {
  const { data, error } = await sb.from('rooms').insert({ name }).select().single();
  if (error) throw error;
  S.rooms.push(data);
  return data;
}

async function savePlant(f) {
  const id = f.dataset.id || null, fd = new FormData(f);
  const btn = $('button.primary', f); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    let room_id = fd.get('room') || null;
    if (room_id === '__new') {
      const n = (fd.get('newroom') || '').trim();
      room_id = n ? (await addRoom(n)).id : null;
    }
    const row = {
      name: fd.get('name').trim(), species: (fd.get('species') || '').trim() || null, room_id,
      interval_days: Math.min(365, Math.max(1, parseInt(fd.get('interval'), 10) || 7)), notes: (fd.get('notes') || '').trim() || null,
    };
    const file = $('input[type=file]', f).files[0];
    const old = id ? S.plants.find((x) => x.id === id).photo_path : null;
    if (file) row.photo_path = await uploadPhoto(file);
    if (id) {
      const { data, error } = await sb.from('plants').update(row).eq('id', id).select().single();
      if (error) throw error;
      S.plants = S.plants.map((x) => (x.id === id ? data : x));
      if (file) removePhotos([old]);
    } else {
      const { data, error } = await sb.from('plants').insert(row).select().single();
      if (error) throw error;
      S.plants.push(data);
    }
    await refreshUrls();
    closeModal(); render();
    showToast('🌿 Plant saved', 1800);
  } catch (err) { fail(err); btn.disabled = false; btn.textContent = 'Save'; }
}

async function deletePlant() {
  const id = S.detail; const p = S.plants.find((x) => x.id === id); if (!p) return;
  const ok = await confirmBox(`Delete ${p.name} and its whole history? This can't be undone.`, 'Delete plant');
  if (!ok) return;
  const paths = [p.photo_path, ...S.events.filter((e) => e.plant_id === id).map((e) => e.photo_path)];
  const { error } = await sb.from('plants').delete().eq('id', id);
  if (error) throw error;
  S.plants = S.plants.filter((x) => x.id !== id);
  S.events = S.events.filter((e) => e.plant_id !== id);
  removePhotos(paths);
  closeSheet(); render();
  showToast('Plant deleted', 2000);
}

/* ----------------------------------------------------------------- rooms */

function openQuickRooms() {
  const have = new Set(S.rooms.map((r) => r.name.toLowerCase()));
  modal(`<form id="qr" class="form"><h2>Which rooms have plants?</h2>
    <span class="seg">${DEFAULT_ROOMS.filter((n) => !have.has(n.toLowerCase())).map((n) =>
      `<label><input type="checkbox" name="r" value="${esc(n)}"><span>${esc(n)}</span></label>`).join('')}</span>
    <p class="muted" style="font-size:14px">You can add your own and rename them any time in Settings.</p>
    <div class="row"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Add rooms</button></div></form>`);
}

async function renameRoom(id) {
  const r = S.rooms.find((x) => x.id === id);
  const v = await askText('Rename room', r.name);
  if (!v || !v.trim()) return;
  const { error } = await sb.from('rooms').update({ name: v.trim() }).eq('id', id);
  if (error) throw error;
  r.name = v.trim(); render();
}
async function deleteRoom(id) {
  const r = S.rooms.find((x) => x.id === id);
  const n = S.plants.filter((p) => p.room_id === id).length;
  const ok = await confirmBox(`Delete the room "${r.name}"? ${n ? `Its ${plural(n, 'plant')} will move to "No room".` : ''}`, 'Delete room');
  if (!ok) return;
  const { error } = await sb.from('rooms').delete().eq('id', id);
  if (error) throw error;
  S.rooms = S.rooms.filter((x) => x.id !== id);
  S.plants.forEach((p) => { if (p.room_id === id) p.room_id = null; });
  if (S.filter === id) S.filter = 'all';
  render();
}

/* -------------------------------------------------------------- settings */

function viewSettings() {
  const email = S.session && S.session.user ? S.session.user.email : '';
  return `<div class="top"><div><h1>Settings</h1><p>${esc(email)}</p></div></div>
    <div class="panel-card"><h2>Rooms</h2><p>Plants are grouped by room on the home screen.</p>
      <ul class="list">${S.rooms.map((r) => `<li><span>${esc(r.name)} <small class="muted">· ${plural(S.plants.filter((p) => p.room_id === r.id).length, 'plant')}</small></span>
        <span class="acts"><button data-act="rename-room" data-id="${r.id}" aria-label="Rename">✏️</button><button data-act="del-room" data-id="${r.id}" aria-label="Delete">🗑</button></span></li>`).join('') || '<li class="muted">No rooms yet</li>'}</ul>
      <div class="row"><button class="btn" data-act="add-room">+ Add room</button><button class="btn ghost" data-act="quick-rooms">Quick add</button></div></div>
    <div class="panel-card"><h2>Your data</h2><p>Everything lives in your own Supabase project. Export it to analyse in Excel or Google Sheets.</p>
      <div class="row"><button class="btn" data-act="export-events">Export history (CSV)</button><button class="btn" data-act="export-plants">Export plants (CSV)</button></div></div>
    <div class="panel-card"><h2>Install as an app</h2>
      <p class="install-tip"><b>Android (Chrome):</b> menu ⋮ → Install app.<br><b>iPad (Safari):</b> Share → Add to Home Screen.</p></div>
    <button class="btn ghost block" data-act="signout">Sign out</button>`;
}

function csv(rows) {
  return rows.map((r) => r.map((v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(',')).join('\n');
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
function exportEvents() {
  const room = (p) => (S.rooms.find((r) => r.id === p.room_id) || {}).name || '';
  const rows = [['date', 'plant', 'room', 'type', 'soil_before_watering', 'note', 'has_photo']];
  [...S.events].reverse().forEach((e) => {
    const p = S.plants.find((x) => x.id === e.plant_id) || {};
    rows.push([e.occurred_on, p.name, room(p), e.type, e.soil, e.note, e.photo_path ? 'yes' : '']);
  });
  download(`leaflog-history-${todayStr()}.csv`, csv(rows));
}
function exportPlants() {
  const rows = [['plant', 'species', 'room', 'starting_interval_days', 'learned_interval_days', 'waterings', 'last_watered', 'next_due', 'added']];
  S.plants.forEach((p) => {
    const s = plantStats(p), r = (S.rooms.find((x) => x.id === p.room_id) || {}).name || '';
    const fd = (n) => (n == null ? '' : new Date(n * 864e5).toISOString().slice(0, 10));
    rows.push([p.name, p.species, r, p.interval_days, s.learned ? s.interval : '', s.waterCount, fd(s.last), fd(s.due), localDate(p.created_at)]);
  });
  download(`leaflog-plants-${todayStr()}.csv`, csv(rows));
}

/* -------------------------------------------------------------- insights */

function loadChartLib() {
  if (window.Chart) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}

function lastMonths(n) {
  const out = [], d = new Date(); d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ key: `${x.getFullYear()}-${pad(x.getMonth() + 1)}`, label: x.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' }) });
  }
  return out;
}

function viewInsights() {
  const today = dnum(todayStr());
  const within = (e, days) => today - dnum(e.occurred_on) <= days;
  const w30 = S.events.filter((e) => e.type === 'water' && within(e, 30)).length;
  const leaves90 = S.events.filter((e) => e.type === 'new_leaf' && within(e, 90)).length;
  const head = `<div class="top"><div><h1>Insights</h1><p>Patterns across your plants</p></div></div>`;
  if (!S.events.length) return head + '<div class="empty"><div class="big">📊</div><h2>No data yet</h2><p>Log a few waterings and growth events and your charts will appear here.</p></div>';
  return head + `<div class="stats">
    <div class="stat"><b>${S.plants.length}</b><small>plants</small></div>
    <div class="stat"><b>${w30}</b><small>waterings, last 30 days</small></div>
    <div class="stat"><b>${leaves90}</b><small>new leaves, last 90 days</small></div>
    <div class="stat"><b>${S.events.length}</b><small>entries logged</small></div></div>
    <div class="charts">
      <div class="panel-card wide"><h2>Activity by month</h2><p>Everything you've logged over the last year.</p><div class="chart-box"><canvas id="c-month"></canvas></div></div>
      <div class="panel-card"><h2>New leaves</h2><p>Growth by month.</p><div class="chart-box"><canvas id="c-leaf"></canvas></div></div>
      <div class="panel-card"><h2>Soil when you watered</h2><p>Mostly "wet" can mean watering too soon.</p><div class="chart-box"><canvas id="c-soil"></canvas></div></div>
      <div class="panel-card"><h2>Thirst by room</h2><p>Waterings per plant, last 90 days.</p><div class="chart-box"><canvas id="c-room"></canvas></div></div>
      <div class="panel-card"><h2>Watering rhythm</h2><p>Days between waterings (learned, or your starting guess).</p><div class="chart-box" style="height:${Math.max(220, S.plants.length * 28 + 40)}px"><canvas id="c-int"></canvas></div></div>
    </div>`;
}

function destroyCharts() { S.charts.forEach((c) => c.destroy()); S.charts = []; }

async function drawCharts() {
  destroyCharts();
  if (!S.events.length) return;
  try { await loadChartLib(); } catch (e) { const el = $('.charts'); if (el) el.innerHTML = '<p class="muted">Charts need an internet connection.</p>'; return; }
  if (S.tab !== 'insights') return;
  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue('--muted').trim(), grid = css.getPropertyValue('--border').trim(), accent = css.getPropertyValue('--accent').trim();
  Chart.defaults.color = muted; Chart.defaults.borderColor = grid;
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const mk = (id, conf) => { const el = document.getElementById(id); if (el) S.charts.push(new Chart(el, conf)); };
  const base = { responsive: true, maintainAspectRatio: false };
  const months = lastMonths(12);
  const countBy = (pred) => months.map((m) => S.events.filter((e) => pred(e) && e.occurred_on.slice(0, 7) === m.key).length);

  mk('c-month', { type: 'bar', data: { labels: months.map((m) => m.label),
    datasets: Object.entries(TYPES).map(([t, v]) => ({ label: v.label, data: countBy((e) => e.type === t), backgroundColor: v.color, borderRadius: 3 })) },
    options: { ...base, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } } });

  mk('c-leaf', { type: 'bar', data: { labels: months.map((m) => m.label), datasets: [{ label: 'New leaves', data: countBy((e) => e.type === 'new_leaf'), backgroundColor: TYPES.new_leaf.color, borderRadius: 4 }] },
    options: { ...base, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } } });

  const soil = ['dry', 'damp', 'wet'].map((k) => S.events.filter((e) => e.type === 'water' && e.soil === k).length);
  if (soil.some(Boolean)) {
    mk('c-soil', { type: 'doughnut', data: { labels: ['Dry', 'Damp', 'Wet'], datasets: [{ data: soil, backgroundColor: ['#c98a4b', '#4fa3d9', '#2b5fa8'], borderWidth: 0 }] },
      options: { ...base, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } } });
  } else {
    const el = document.getElementById('c-soil');
    if (el) el.parentElement.innerHTML = '<p class="muted">Tap Dry / Damp / Wet after you water and this chart fills in.</p>';
  }

  const today = dnum(todayStr());
  const roomRows = [...S.rooms.map((r) => ({ name: r.name, plants: S.plants.filter((p) => p.room_id === r.id) })), { name: 'No room', plants: S.plants.filter((p) => !S.rooms.find((r) => r.id === p.room_id)) }]
    .filter((r) => r.plants.length)
    .map((r) => {
      const ids = new Set(r.plants.map((p) => p.id));
      const n = S.events.filter((e) => e.type === 'water' && ids.has(e.plant_id) && today - dnum(e.occurred_on) <= 90).length;
      return { name: r.name, v: +(n / r.plants.length).toFixed(1) };
    });
  mk('c-room', { type: 'bar', data: { labels: roomRows.map((r) => r.name), datasets: [{ label: 'Waterings per plant', data: roomRows.map((r) => r.v), backgroundColor: accent, borderRadius: 6 }] },
    options: { ...base, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } } });

  const ints = S.plants.map((p) => ({ name: p.name, s: plantStats(p), p })).sort((a, b) => b.s.interval - a.s.interval);
  mk('c-int', { type: 'bar', data: { labels: ints.map((x) => x.name), datasets: [{ label: 'Days between waterings', data: ints.map((x) => x.s.interval),
    backgroundColor: ints.map((x) => (x.s.learned ? accent : muted + '88')), borderRadius: 6 }] },
    options: { ...base, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => (ints[c.dataIndex].s.learned ? 'learned from your data' : 'starting guess / still learning') } } },
      scales: { y: { grid: { display: false } }, x: { beginAtZero: true } } } });
}

/* --------------------------------------------------------------- actions */

const ACTS = {
  tab: (t) => { destroyCharts(); S.tab = t.dataset.tab; render(); window.scrollTo(0, 0); },
  filter: (t) => { S.filter = t.dataset.id; render(); },
  open: (t) => openSheet(t.dataset.id),
  water: (t) => quickWater(t.dataset.id),
  'add-plant': () => openPlantForm(null),
  'edit-plant': () => openPlantForm(S.detail),
  'delete-plant': () => deletePlant(),
  log: (t) => openEventModal(S.detail, t.dataset.type),
  'close-sheet': () => closeSheet(),
  'close-modal': () => closeModal(),
  'confirm-yes': () => resolvePending(true),
  zoom: (t) => { const src = t.dataset.src; if (src) modal(`<img src="${esc(src)}" alt="">`, 'lightbox'); },
  'del-event': async (t) => { if (await confirmBox('Delete this entry?')) await deleteEvent(t.dataset.id); },
  soil: (t) => setSoil(t.dataset.id, t.dataset.v),
  undo: async (t) => { await deleteEvent(t.dataset.id, true); $('#toast').hidden = true; },
  refresh: async () => { await loadAll(); render(); showToast('Up to date ✓', 1200); },
  'quick-rooms': () => openQuickRooms(),
  'add-room': async () => { const v = await askText('New room', '', 'e.g. Living room'); if (v && v.trim()) { await addRoom(v.trim()); render(); } },
  'rename-room': (t) => renameRoom(t.dataset.id),
  'del-room': (t) => deleteRoom(t.dataset.id),
  'export-events': () => exportEvents(),
  'export-plants': () => exportPlants(),
  signout: async () => { await sb.auth.signOut(); },
};

document.addEventListener('click', (e) => {
  if (e.target.id === 'modal') { closeModal(); return; }
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const fn = ACTS[t.dataset.act];
  if (fn) Promise.resolve().then(() => fn(t, e)).catch(fail);
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const run = (p) => Promise.resolve(p).catch(fail);
  if (f.id === 'lf') run(loginSubmit(f));
  else if (f.id === 'pf') run(savePlant(f));
  else if (f.id === 'ef') run(saveEvent(f));
  else if (f.id === 'tf') resolvePending(new FormData(f).get('v'));
  else if (f.id === 'qr') {
    const names = new FormData(f).getAll('r');
    run((async () => { for (const n of names) await addRoom(n); closeModal(); render(); })());
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.name === 'type') { const box = $('#soilbox'); if (box) box.hidden = t.value !== 'water'; }
  if (t.name === 'room') { const n = $('[name=newroom]', t.form); if (n) { n.hidden = t.value !== '__new'; if (!n.hidden) n.focus(); } }
  if (t.type === 'file' && t.files[0]) {
    const pp = t.closest('.photo-pick'); if (!pp) return;
    let img = $('img', pp);
    if (!img) { img = document.createElement('img'); img.alt = ''; pp.prepend(img); }
    img.src = URL.createObjectURL(t.files[0]);
    const hint = $('.ph-hint', pp); if (hint) hint.remove();
  }
});

window.addEventListener('popstate', () => { hideSheet(); closeModal(); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.session && sb && Date.now() - S.loadedAt > 60000 && $('#modal').hidden) {
    loadAll().then(render).catch(console.warn);
  }
});

if (!window.__TEST__) {
  boot();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
