/* Small shared helpers and labels (no app state in here). */
import { fromDnum, dnum, dow } from './logic.js';

export const $ = (s, el = document) => el.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const num = (v) => { const s = String(v ?? '').trim(); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : null; };

export const TYPES = {
  water:     { icon: '💧', label: 'Watered',      short: 'Water',     color: '#3b9ae1' },
  fertilise: { icon: '🧪', label: 'Fertilised',   short: 'Feed',      color: '#8e6bd8' },
  pole:      { icon: '🎋', label: 'Pole drip',    short: 'Pole drip', color: '#2fa6a0' },
  repot:     { icon: '🪴', label: 'Repotted',     short: 'Repot',     color: '#b9772f' },
  new_leaf:  { icon: '🍃', label: 'New leaf',     short: 'New leaf',  color: '#3fae6a' },
  prune:     { icon: '✂️', label: 'Pruned',       short: 'Prune',     color: '#d9669b' },
  propagate: { icon: '🌱', label: 'Propagated',   short: 'Propagate', color: '#8fb83a' },
  pest:      { icon: '🐛', label: 'Pest / issue', short: 'Pest',      color: '#d24545' },
  note:      { icon: '📝', label: 'Note',         short: 'Note',      color: '#8a979a' },
};
export const SOIL = { dry: 'Dry', damp: 'Damp', wet: 'Wet' };
export const DEFAULT_ROOMS = ['Living room', 'Kitchen', 'Bedroom', 'Bathroom', 'Office', 'Hallway', 'Balcony'];
export const ISSUE_KINDS = { pest: '🐛 Pest', disease: '🍄 Disease / fungus', overwatering: '💦 Overwatering', underwatering: '🏜️ Underwatering', nutrients: '🧪 Nutrients', light: '☀️ Light', other: '❓ Other' };
export const PROP_STAGES = { cutting: 'Cutting taken', rooting: 'Rooting', potted: 'Potted up', established: 'Established', failed: 'Failed' };
export const PROP_METHODS = { water: 'Water', soil: 'Soil', sphagnum: 'Sphagnum moss', air_layer: 'Air layer', division: 'Division', offset: 'Offset / pup', other: 'Other' };
export const LIGHT_LEVELS = { low: 'Low', medium: 'Medium', bright: 'Bright indirect', direct: 'Direct sun' };
export const FLEX = {
  strict: { label: 'Thirsty', hint: 'Never delayed; watered on its own day' },
  normal: { label: 'Normal', hint: 'Up to 2 days later onto a water day' },
  hardy:  { label: 'Hardy', hint: 'Up to 4 days later onto a water day' },
};
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (s) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}`;
};
/** "Sat 17 Oct" from a day number */
export const fmtDay = (n) => { const s = fromDnum(n); return `${WEEKDAYS[dow(n)]} ${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]}`; };
export const dayName = (n) => WEEKDAYS_LONG[dow(n)];
export const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${String(y).slice(2)}`; };

export function csv(rows) {
  return rows.map((r) => r.map((v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(',')).join('\n');
}
export function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
export const toBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
export const urlB64ToU8 = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};
export { dnum, fromDnum, dow };
