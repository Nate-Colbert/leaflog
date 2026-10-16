/* Plants tab (home) and Plan tab, plus the one-tap "do it" actions. */
import * as L from './logic.js';
import { S, ACTS, hooks, room, plantImg, showToast, hideToast, insertEvents, deleteEvents, sb } from './state.js';
import { esc, plural, SOIL, WEEKDAYS, fmtDay, dayName } from './util.js';

/* ------------------------------------------------------------ status text */

export function waterStatus(w) {
  if (w.days <= 0) {
    if (w.late >= 2) return { cls: 'late', text: `${w.late}d overdue`, long: `${plural(w.late, 'day')} overdue` };
    return { cls: 'today', text: 'Water today', long: 'Due today' };
  }
  if (w.days === 1) return { cls: 'ok', text: 'Tomorrow', long: 'Due tomorrow' };
  if (w.days < 7) return { cls: 'ok', text: WEEKDAYS[L.dow(w.due)], long: `Due ${dayName(w.due)}` };
  return { cls: 'ok', text: `in ${w.days}d`, long: `Due ${fmtDay(w.due)}` };
}

/** plants with something due now: [{ plantId, water, feed, pole }] in room order */
export function dueEntries() {
  const m = new Map();
  L.dueNow(S.plan, S.today).forEach((t) => {
    const e = m.get(t.plantId) || { plantId: t.plantId };
    e[t.kind] = t; m.set(t.plantId, e);
  });
  const order = (id) => { const p = S.plants.find((x) => x.id === id); const i = S.rooms.findIndex((r) => r.id === (p && p.room_id)); return [i < 0 ? 999 : i, p ? p.name : '']; };
  return [...m.values()].sort((a, b) => { const x = order(a.plantId), y = order(b.plantId); return x[0] - y[0] || x[1].localeCompare(y[1]); });
}
const flagsOf = (e) => ({ plantId: e.plantId, water: !!e.water, feed: !!(e.water && e.water.feed) || !!e.feed, pole: !!e.pole });

/* ----------------------------------------------------- thirst dot (green -> yellow -> red) */

/** colour + tooltip for the little droplet on a plant card: green when freshly watered, easing to
    yellow as the water day approaches, red once it has been missed. */
export function thirst(w) {
  if (w.last == null) return { color: L.dnum(S.today) > w.due ? 'hsl(0 72% 46%)' : '#aab4ae', tip: 'Not watered yet' };
  const t = L.dnum(S.today), total = Math.max(1, w.due - w.last), elapsed = t - w.last;
  let hue;
  if (t < w.due) hue = 135 - 90 * Math.pow(Math.max(0, elapsed) / total, 1.25);   // 135 green -> 45 yellow
  else hue = 45 - 45 * Math.min(1, (t - w.due) / 1.5);                                // 45 yellow -> 0 red
  const tip = w.sinceLast === 0 ? 'Watered today' : `Watered ${w.sinceLast}d ago`;
  return { color: `hsl(${Math.round(hue)} 72% 46%)`, tip };
}

/* ------------------------------------------------------------- the actions */

const busy = new Set();

export async function perform(entries) {
  const key = entries.map((e) => e.plantId + (e.water ? 'w' : '') + (e.feed ? 'f' : '') + (e.pole ? 'p' : '')).join('|');
  if (busy.has(key)) return;
  busy.add(key);
  try {
    const rows = [], t = S.today;
    entries.forEach((e) => {
      if (e.water) rows.push({ plant_id: e.plantId, type: 'water', occurred_on: t });
      if (e.feed) rows.push({ plant_id: e.plantId, type: 'fertilise', occurred_on: t });
      if (e.pole) { const ps = S.stMap[e.plantId] && S.stMap[e.plantId].pole; rows.push({ plant_id: e.plantId, type: 'pole', occurred_on: t, amount_ml: (ps && ps.ml) || null }); }
    });
    if (!rows.length) return;
    const made = await insertEvents(rows);
    hooks.render();
    const ids = made.map((x) => x.id).join(',');
    const w = made.find((x) => x.type === 'water');
    if (entries.length === 1 && w) {
      const p = S.plants.find((x) => x.id === entries[0].plantId);
      showToast(`<span>💧 <b>${esc(p.name)}</b> watered${entries[0].feed ? ' + fed' : ''}</span><span class="tchips">Soil was:
        ${Object.entries(SOIL).map(([k, v]) => `<button data-act="soil" data-id="${w.id}" data-v="${k}">${v}</button>`).join('')}
        <button class="u" data-act="undo" data-ids="${ids}">Undo</button></span>`, 8000);
    } else {
      showToast(`<span>✓ Logged ${plural(rows.length, 'job')}</span><span class="tchips"><button class="u" data-act="undo" data-ids="${ids}">Undo</button></span>`, 7000);
    }
  } finally { setTimeout(() => busy.delete(key), 700); }
}

Object.assign(ACTS, {
  filter: (t) => { S.filter = t.dataset.id; hooks.render(); },
  open: (t) => hooks.openSheet(t.dataset.id),
  'do-water': (t) => {
    const e = dueEntries().find((x) => x.plantId === t.dataset.id);
    return perform([{ plantId: t.dataset.id, water: true, feed: !!(e && e.water && e.water.feed), pole: false }]);
  },
  'do-feed': (t) => perform([{ plantId: t.dataset.id, feed: true }]),
  'do-pole': (t) => perform([{ plantId: t.dataset.id, pole: true }]),
  'do-task': (t) => perform([{ plantId: t.dataset.id, water: t.dataset.w === '1', feed: t.dataset.f === '1', pole: t.dataset.p === '1' }]),
  'do-all': () => perform(dueEntries().map(flagsOf)),
  'do-room': (t) => {
    const id = t.dataset.room || null;
    return perform(dueEntries().filter((e) => (S.plants.find((p) => p.id === e.plantId).room_id || null) === id).map(flagsOf));
  },
  undo: async (t) => { await deleteEvents(t.dataset.ids.split(',')); hideToast(); hooks.render(); },
  soil: async (t) => {
    const { error } = await sb.from('events').update({ soil: t.dataset.v }).eq('id', t.dataset.id);
    if (error) throw error;
    const e = S.events.find((x) => x.id === t.dataset.id); if (e) e.soil = t.dataset.v;
    hooks.render();
    showToast(`Saved: soil was ${SOIL[t.dataset.v].toLowerCase()} ✓`, 1800);
  },
  'acclim-done': async (t) => {
    const p = S.plants.find((x) => x.id === t.dataset.id); if (!p) return;
    const { error } = await sb.from('plants').update({ acclim_done_on: S.today }).eq('id', p.id);
    if (error) throw error;
    p.acclim_done_on = S.today;
    await insertEvents([{ plant_id: p.id, type: 'note', occurred_on: S.today, note: 'Finished acclimatising' }]);
    hooks.render(); showToast(`✅ ${esc(p.name)} acclimatised`, 2200);
  },
  'acclim-snooze': async (t) => {
    const p = S.plants.find((x) => x.id === t.dataset.id); if (!p) return;
    const a = L.acclimStats(p, S.today), started = L.fromDnum(L.dnum(S.today) - a.total + 7); // ends a week from today
    const { error } = await sb.from('plants').update({ acclim_started_on: started }).eq('id', p.id);
    if (error) throw error;
    p.acclim_started_on = started; hooks.render(); showToast('Reminder pushed back a week', 1800);
  },
  'go-settings': () => { S.tab = 'settings'; hooks.render(); window.scrollTo(0, 0); },
});

/* ------------------------------------------------------------------ home */

function waterBtn(p, due) {
  const e = due.get(p.id);
  const label = e && e.water && e.water.feed ? '💧🧪 Water + feed' : '💧 Water';
  return `<button class="btn water" data-act="do-water" data-id="${p.id}">${label}</button>`;
}

function card({ p, w, f, pole }, due) {
  const img = plantImg(p), st = waterStatus(w);
  const badges = [];
  if (f && f.days <= 0) badges.push('🧪');
  if (pole && pole.days <= 0) badges.push('🎋');
  if (S.issues.some((i) => i.plant_id === p.id && !i.resolved_on)) badges.push('⚠️');
  if (p.prop_stage && p.prop_stage !== 'established') badges.push('🌱');
  const ac = L.acclimStats(p, S.today); if (ac && !ac.done) badges.push(ac.ready ? '✅' : '⏳');
  const th = thirst(w);
  return `<article class="card" data-act="open" data-id="${p.id}">
    <div class="ph">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '🪴'}<span class="pill ${st.cls}">${esc(st.text)}</span>
      ${badges.length ? `<span class="badges">${badges.join('')}</span>` : ''}</div>
    <div class="cb"><h3><i class="thirst" style="--c:${th.color}" title="${esc(th.tip)}" aria-label="${esc(th.tip)}"></i>${esc(p.name)}</h3><p>${esc(p.species || '')}</p>${waterBtn(p, due)}</div></article>`;
}

export function viewHome() {
  const items = S.st;
  const entries = dueEntries();
  const due = new Map(entries.map((e) => [e.plantId, e]));
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const sub = !items.length ? "Let's get your plants set up" : entries.length ? `${plural(entries.length, 'plant')} need attention today` : 'Everything is up to date 🎉';
  let html = `<div class="top"><div><h1>${greet}</h1><p>${sub}</p></div><button class="icon-btn" data-act="refresh" aria-label="Refresh">↻</button></div>`;

  if (!items.length) {
    return html + `<div class="empty"><div class="big">🌿</div><h2>No plants yet</h2>
      <p>Add your first plant, then log a watering. Leaflog learns each plant's rhythm as you go.</p>
      ${S.rooms.length ? '' : '<button class="btn" data-act="quick-rooms">Set up rooms first</button>'}
      <button class="btn primary" data-act="add-plant">Add a plant</button></div>`;
  }

  if (S.heat) html += `<div class="notice warm">${esc(S.heat)}</div>`;
  S.st.forEach((x) => {
    const a = L.acclimStats(x.p, S.today);
    if (a && a.ready) html += `<div class="notice acclim">✅ <b data-act="open" data-id="${x.p.id}" style="cursor:pointer">${esc(x.p.name)}</b> has finished acclimatising. Time to ${L.ACCLIM_GOALS[a.goal]}.
      <span class="acl-btns"><button class="btn mini" data-act="acclim-done" data-id="${x.p.id}">Done</button><button class="btn mini ghost" data-act="acclim-snooze" data-id="${x.p.id}">+1 week</button></span></div>`;
  });

  if (entries.length) {
    html += `<section class="today-strip"><div class="ts-h"><h2>Today</h2>${entries.length > 1 ? `<button class="btn mini light" data-act="do-all">Do all (${entries.length})</button>` : ''}</div><div class="today-row">${entries.map((e) => {
      const x = S.stMap[e.plantId]; if (!x) return '';
      const p = x.p, img = plantImg(p);
      const small = e.water ? waterStatus(x.w).text : e.feed ? 'Feed due' : 'Pole drip';
      return `<div class="t-item" data-act="open" data-id="${p.id}"><div class="t-ph">${img ? `<img src="${esc(img)}" alt="">` : '🪴'}</div>
        <b>${esc(p.name)}</b><small>${esc(small)}</small>
        ${e.water ? `<button data-act="do-water" data-id="${p.id}">${e.water.feed ? '💧🧪' : '💧'} Water${e.water.feed ? ' + feed' : ''}</button>` : ''}
        ${!e.water && e.feed ? `<button data-act="do-feed" data-id="${p.id}">🧪 Feed</button>` : ''}
        ${e.pole ? `<button data-act="do-pole" data-id="${p.id}">🎋 Pole${e.pole.ml ? ' ' + e.pole.ml + 'ml' : ''}</button>` : ''}</div>`;
    }).join('')}</div></section>`;
  } else {
    html += '<div class="all-good">✨ Nothing needs doing today.</div>';
  }

  const hasNone = items.some((x) => !x.p.room_id || !S.rooms.find((r) => r.id === x.p.room_id));
  const chips = [['all', 'All'], ...S.rooms.map((r) => [r.id, r.name]), ...(hasNone && S.rooms.length ? [['none', 'No room']] : [])];
  if (chips.length > 1) html += `<div class="chips">${chips.map(([id, l]) => `<button class="chip ${S.filter === id ? 'on' : ''}" data-act="filter" data-id="${id}">${esc(l)}</button>`).join('')}</div>`;

  const groups = [...S.rooms.map((r) => ({ key: r.id, name: r.name, items: items.filter((x) => x.p.room_id === r.id) })),
    { key: 'none', name: S.rooms.length ? 'No room' : 'My plants', items: items.filter((x) => !x.p.room_id || !S.rooms.find((r) => r.id === x.p.room_id)) }];
  groups.forEach((g) => {
    if (!g.items.length || (S.filter !== 'all' && S.filter !== g.key)) return;
    g.items.sort((a, b) => a.w.days - b.w.days || a.p.name.localeCompare(b.p.name));
    html += `<section class="group"><h2>${esc(g.name)} <small>${plural(g.items.length, 'plant')}</small></h2><div class="grid">${g.items.map((x) => card(x, due)).join('')}</div></section>`;
  });
  return html;
}

/* ------------------------------------------------------------------ plan */

export function viewPlan() {
  const t = L.dnum(S.today), wd = S.settings.water_days;
  let html = `<div class="top"><div><h1>Plan</h1><p>${wd.length ? 'Water days: ' + wd.map((d) => WEEKDAYS[d]).join(' · ') : 'No water days set yet'}</p></div>
    <button class="icon-btn" data-act="go-settings" aria-label="Settings">⚙️</button></div>`;
  if (!S.plants.length) return html + '<div class="empty"><div class="big">🗓️</div><h2>Nothing to plan yet</h2><p>Add some plants first.</p></div>';
  if (!wd.length) html += `<div class="notice">Pick one or two weekly water days in <a href="#" data-act="go-settings">Settings</a> and Leaflog will bunch watering onto them. Plants are only ever pushed <b>later</b>, never earlier, so they dry out a little rather than get overwatered.</div>`;

  const byRoom = (list) => {
    const rooms = [...S.rooms.map((r) => ({ id: r.id, name: r.name })), { id: null, name: 'No room' }];
    return rooms.map((r) => ({ ...r, rows: list.filter((e) => (S.plants.find((p) => p.id === e.plantId).room_id || null) === r.id) })).filter((r) => r.rows.length);
  };

  for (let d = t; d < t + 14; d++) {
    const tasks = S.plan.filter((x) => (d === t ? x.day <= t : x.day === d));
    if (!tasks.length && d !== t) continue;
    const m = new Map();
    tasks.forEach((x) => { const e = m.get(x.plantId) || { plantId: x.plantId, day: d }; e[x.kind] = x; m.set(x.plantId, e); });
    const rows = [...m.values()].filter((e) => S.stMap[e.plantId]);
    const isWaterDay = wd.includes(L.dow(d));
    const label = d === t ? 'Today' : d === t + 1 ? 'Tomorrow' : fmtDay(d);
    html += `<section class="day"><div class="day-h"><h2>${label}${d <= t + 1 ? ` <small>${fmtDay(d)}</small>` : ''}</h2>
      ${isWaterDay ? '<span class="badge water">Water day</span>' : ''}<span class="muted">${rows.length ? plural(rows.length, 'plant') : ''}</span>
      ${d === t && rows.length > 1 ? `<button class="btn mini" data-act="do-all">Do all</button>` : ''}</div>`;
    if (!rows.length) html += '<p class="muted pad-s">Nothing due today ✨</p>';
    byRoom(rows).forEach((g) => {
      html += `<div class="rg"><span>${esc(g.name)}</span>${d === t && g.rows.length > 1 ? `<button class="btn mini ghost" data-act="do-room" data-room="${g.id || ''}">Do all in ${esc(g.name)}</button>` : ''}</div>`;
      g.rows.forEach((e) => {
        const p = S.stMap[e.plantId].p, img = plantImg(p);
        const chips = [];
        if (e.water) chips.push(`💧 Water${e.water.feed ? ' + 🧪 feed' : ''}`);
        if (e.feed) chips.push('🧪 Feed');
        if (e.pole) chips.push(`🎋 Pole drip${e.pole.ml ? ' ' + e.pole.ml + ' ml' : ''}`);
        const own = e.water && e.water.offDay ? ' <span class="own" title="Needs water before the next water day">own day</span>' : '';
        const proj = (e.water && e.water.projected) || (e.pole && e.pole.projected) ? ' <span class="own">projected</span>' : '';
        html += `<div class="trow" data-act="open" data-id="${p.id}"><div class="t-th">${img ? `<img src="${esc(img)}" alt="">` : '🪴'}</div>
          <div class="tr-main"><b>${esc(p.name)}</b><small>${chips.join(' · ')}${own}${proj}</small></div>
          ${d === t ? `<button class="btn mini" data-act="do-task" data-id="${p.id}" data-w="${e.water ? 1 : 0}" data-f="${(e.water && e.water.feed) || e.feed ? 1 : 0}" data-p="${e.pole ? 1 : 0}">Done</button>` : ''}</div>`;
      });
    });
    html += '</section>';
  }
  html += '<p class="muted small">"Own day" means that plant would dry out too much waiting for the next water day, so it keeps its own date. Future days assume you do each job on its scheduled day.</p>';
  return html;
}
