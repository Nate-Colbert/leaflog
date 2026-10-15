/* Shared app state, Supabase data access, modal and toast helpers. */
import * as L from './logic.js';
import { $, esc } from './util.js';

export const cfg = window.PLANT_CONFIG || {};
export const BUCKET = 'plant-photos';
export const URL_TTL = 60 * 60 * 24 * 7;

export const S = {
  session: null, settings: L.normSettings(), rooms: [], plants: [], events: [], issues: [],
  urls: {}, urlsAt: 0, tab: 'home', filter: 'all', detail: null, loadedAt: 0,
  today: '', st: [], stMap: {}, plan: [], cmp: {}, heat: null,
};
/** cross-module callbacks, filled in by the modules that own them */
export const hooks = {};
/** click actions by name (data-act), filled in by the view modules */
export const ACTS = {};
export let sb = null;
export const setClient = (c) => { sb = c; };

export const todayStr = () => L.ymd(new Date());
export const tz = () => S.settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
export const room = (p) => S.rooms.find((r) => r.id === p.room_id);
export const plantImg = (p) => (p.photo_path && S.urls[p.photo_path]) || '';

/** recompute schedules for every plant. Call after any change to plants, events or settings. */
export function recompute() {
  S.today = todayStr();
  S.st = L.allStats(S.plants, S.events, S.settings, S.today, tz());
  S.stMap = Object.fromEntries(S.st.map((x) => [x.p.id, x]));
  S.plan = L.buildPlan(S.st, S.settings, S.today, 14);
}

/* ------------------------------------------------------------ modals/toast */

let pending = null, toastTimer = null;

export function modal(html, cls = '') {
  const m = $('#modal');
  m.innerHTML = `<div class="box ${cls}">${html}</div>`;
  m.hidden = false;
}
export function closeModal() {
  const m = $('#modal');
  if (m) { m.hidden = true; m.innerHTML = ''; }
  if (pending) { const r = pending; pending = null; r(null); }
}
export function resolvePending(v) { const r = pending; pending = null; closeModal(); if (r) r(v); }

export function askText(title, value = '', placeholder = '') {
  return new Promise((res) => {
    pending = res;
    modal(`<form id="tf" class="form"><h2>${esc(title)}</h2>
      <input name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" required>
      <div class="row"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Save</button></div></form>`);
    setTimeout(() => { const i = $('#tf input'); if (i) i.focus(); }, 60);
  });
}
export function confirmBox(message, okLabel = 'Delete') {
  return new Promise((res) => {
    pending = res;
    modal(`<h2>Are you sure?</h2><p class="muted" style="margin-bottom:16px">${esc(message)}</p>
      <div class="row"><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn danger" data-act="confirm-yes">${esc(okLabel)}</button></div>`);
  });
}

export function showToast(html, ms = 5000, cls = '') {
  const t = $('#toast');
  t.className = `toast ${cls}`; t.innerHTML = html; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
export const hideToast = () => { const t = $('#toast'); if (t) t.hidden = true; };
export function fail(err) { console.error(err); showToast(`⚠️ ${esc((err && err.message) || err)}`, 7000, 'err'); }

/* ------------------------------------------------------------------- data */

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

export async function loadAll() {
  const [rooms, plants, events, issues, settings] = await Promise.all([
    fetchAll('rooms', [['created_at', true]]),
    fetchAll('plants', [['created_at', true]]),
    fetchAll('events', [['occurred_on', false], ['created_at', false]]),
    fetchAll('issues', [['started_on', false]]),
    sb.from('user_settings').select('*').maybeSingle(),
  ]);
  if (settings.error) throw settings.error;
  S.rooms = rooms; S.plants = plants; S.events = events; S.issues = issues;
  S.settings = L.normSettings(settings.data);
  S.loadedAt = Date.now();
  await refreshUrls();
}

export async function refreshUrls() {
  if (Date.now() - S.urlsAt > 5 * 864e5) { S.urls = {}; S.urlsAt = Date.now(); }
  const paths = [...new Set([...S.plants.map((p) => p.photo_path), ...S.events.map((e) => e.photo_path)].filter(Boolean))];
  const need = paths.filter((p) => !S.urls[p]);
  for (let i = 0; i < need.length; i += 100) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need.slice(i, i + 100), URL_TTL);
    if (error) { console.warn(error); break; }
    (data || []).forEach((d) => { if (d.signedUrl) S.urls[d.path] = d.signedUrl; });
  }
}

export async function saveSettings(patch) {
  const row = { user_id: S.session.user.id, ...patch, updated_at: new Date().toISOString() };
  const { error } = await sb.from('user_settings').upsert(row, { onConflict: 'user_id' });
  if (error) throw error;
  S.settings = L.normSettings({ ...S.settings, ...patch });
}

const sortEvents = () => S.events.sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at));

export async function insertEvents(rows) {
  const { data, error } = await sb.from('events').insert(rows).select();
  if (error) throw error;
  S.events.push(...data); sortEvents();
  return data;
}
export const insertEvent = async (row) => (await insertEvents([row]))[0];

export async function deleteEvents(ids) {
  const gone = S.events.filter((e) => ids.includes(e.id));
  for (const id of ids) {
    const { error } = await sb.from('events').delete().eq('id', id);
    if (error) throw error;
  }
  S.events = S.events.filter((e) => !ids.includes(e.id));
  removePhotos(gone.map((e) => e.photo_path));
}

export async function addRoom(name) {
  const { data, error } = await sb.from('rooms').insert({ name }).select().single();
  if (error) throw error;
  S.rooms.push(data);
  return data;
}

/* ----------------------------------------------------------------- photos */

function loadImg(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file), i = new Image();
    i.onload = () => { res(i); URL.revokeObjectURL(u); };
    i.onerror = () => { rej(new Error("Couldn't read that image")); URL.revokeObjectURL(u); };
    i.src = u;
  });
}
export async function resizeImage(file, max = 1400, quality = 0.82) {
  const img = await loadImg(file);
  const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Image conversion failed'))), 'image/jpeg', quality));
}
export async function uploadPhoto(file) {
  const blob = await resizeImage(file);
  const path = `${S.session.user.id}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}
export async function removePhotos(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  const { error } = await sb.storage.from(BUCKET).remove(list);
  if (error) console.warn(error);
}

/** call one of your Supabase Edge Functions (Claude advice, test notification) */
export async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* keep default */ }
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}
