/* Plant detail screen, plant form, event / problem / propagation modals, Claude advice. */
import * as L from './logic.js';
import {
  S, ACTS, hooks, cfg, sb, room, plantImg, tz, todayStr, modal, closeModal, confirmBox, showToast, fail, loadAll,
  refreshUrls, insertEvent, insertEvents, deleteEvents, addRoom, uploadPhoto, removePhotos, resizeImage, callFn,
} from './state.js';
import {
  $, esc, plural, num, TYPES, SOIL, ISSUE_KINDS, PROP_STAGES, PROP_METHODS, LIGHT_LEVELS, FLEX, fmtDate, fmtDay, dayName, toBase64,
} from './util.js';
import { waterStatus } from './home.js';

/* ----------------------------------------------------------------- sheet */

export function openSheet(id) {
  S.detail = id;
  const sh = $('#sheet');
  sh.hidden = false; sh.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  history.pushState({ sheet: 1 }, '');
  renderDetail();
}
export function hideSheet() { const sh = $('#sheet'); if (sh) sh.hidden = true; S.detail = null; document.body.style.overflow = ''; }
export function closeSheet() { if (history.state && history.state.sheet) history.back(); else hideSheet(); }
hooks.openSheet = openSheet;
hooks.renderDetail = () => { if (S.detail && !$('#sheet').hidden) renderDetail(); };

const kv = (k, v) => (v ? `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>` : '');

function photoList(p) {
  const arr = [];
  if (plantImg(p)) arr.push({ url: plantImg(p), date: L.localDate(p.created_at, tz()), label: 'Profile photo' });
  S.events.filter((e) => e.plant_id === p.id && e.photo_path && S.urls[e.photo_path])
    .forEach((e) => arr.push({ url: S.urls[e.photo_path], date: e.occurred_on, label: TYPES[e.type].label }));
  return arr.sort((a, b) => a.date.localeCompare(b.date));
}

function whyLine(p, w) {
  if (!S.settings.water_days.length) return '';
  if (w.offDay) return `${w.late > 0 ? 'Needs water now' : `Ideal day is ${fmtDay(w.rawDue)}`}. The next water day is too far off for a ${FLEX[p.flex || 'normal'].label.toLowerCase()} plant, so it keeps its own day.`;
  if (w.snapped && w.delay > 0) return `Ideal day is ${fmtDay(w.rawDue)}. Moved ${plural(w.delay, 'day')} later onto your ${dayName(w.due)} water day.`;
  if (w.snapped) return `Lands on your ${dayName(w.due)} water day.`;
  return '';
}

export function renderDetail() {
  const p = S.plants.find((x) => x.id === S.detail);
  if (!p) { hideSheet(); return; }
  const x = S.stMap[p.id] || { w: L.waterStats(p, S.events, S.settings, S.today, tz()), f: null, pole: null };
  const { w, f, pole } = x;
  const acc = L.acclimStats(p, S.today);
  const st = waterStatus(w), rm = room(p), img = plantImg(p);
  const evs = S.events.filter((e) => e.plant_id === p.id);
  const count = (t) => evs.filter((e) => e.type === t).length;
  const lastTxt = w.sinceLast === null ? 'Never' : w.sinceLast === 0 ? 'Today' : `${w.sinceLast}d ago`;
  const learnTxt = w.learned
    ? `Learned ${w.mode === 'season' ? 'from this season\'s' : 'from your last'} ${plural(w.n, 'gap')}: about every ${w.interval} days.`
    : w.n ? `Still learning (${plural(w.n, 'gap')} so far). Using about every ${w.interval} days.`
    : `Using your starting guess: every ${p.interval_days} days. Log a few waterings and Leaflog learns the real rhythm.`;
  const why = whyLine(p, w);
  const issues = S.issues.filter((i) => i.plant_id === p.id);
  const ongoing = issues.filter((i) => !i.resolved_on), done = issues.filter((i) => i.resolved_on);
  const parent = p.parent_id && S.plants.find((q) => q.id === p.parent_id);
  const kids = S.plants.filter((q) => q.parent_id === p.id);
  const photos = photoList(p);
  const hemi = S.settings.hemisphere;

  // new leaves by season
  const lb = new Map();
  evs.filter((e) => e.type === 'new_leaf').forEach((e) => { const k = L.seasonKey(e.occurred_on, hemi); const o = lb.get(k) || { n: 0, d: e.occurred_on }; o.n++; if (e.occurred_on < o.d) o.d = e.occurred_on; lb.set(k, o); });
  const leafRows = [...lb.entries()].sort((a, b) => a[1].d.localeCompare(b[1].d)).slice(-6);
  const leafMax = Math.max(1, ...leafRows.map((r) => r[1].n));

  // compare
  const cmp = S.cmp[p.id] || { a: 0, b: Math.max(0, photos.length - 1) };
  S.cmp[p.id] = cmp;
  if (cmp.a >= photos.length) cmp.a = 0;
  if (cmp.b >= photos.length) cmp.b = Math.max(0, photos.length - 1);
  const opts = (sel) => photos.map((ph, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${fmtDate(ph.date)} · ${esc(ph.label)}</option>`).join('');

  const acts = [
    ['fertilise', '🧪', 'Feed'], ['repot', '🪴', 'Repot'], ['new_leaf', '🍃', 'New leaf'], ['prune', '✂️', 'Prune'], ['note', '📝', 'Note'],
    ...(p.has_pole ? [['pole', '🎋', 'Pole drip']] : []),
  ];

  $('#sheet').innerHTML = `<div class="panel">
    <div class="hero" data-act="${img ? 'zoom' : 'edit-plant'}" data-src="${esc(img)}">
      ${img ? `<img src="${esc(img)}" alt="">` : '🪴'}
      <button class="back" data-act="close-sheet">‹ Back</button><button class="edit" data-act="edit-plant">Edit</button>
    </div>
    <div class="pad">
      <h1 class="d-title">${esc(p.name)}</h1>
      <p class="d-sub">${[p.species, rm && rm.name].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</p>
      ${parent ? `<p class="tagline" data-act="open" data-id="${parent.id}">🌱 ${p.prop_stage ? esc(PROP_STAGES[p.prop_stage]) + ' · ' : ''}Cutting of <u>${esc(parent.name)}</u>${p.propagated_on ? ' · ' + fmtDate(p.propagated_on) : ''}</p>` : ''}

      <div class="status ${st.cls}"><div><b>${esc(st.long)}</b><small>${esc(learnTxt)}</small>${why ? `<small>${esc(why)}</small>` : ''}</div>
        <button class="btn water" data-act="do-water" data-id="${p.id}">${f && f.days <= 0 && w.days <= 0 && f.due === w.due ? '💧🧪' : '💧'} Water</button></div>
      ${acc && !acc.done ? (acc.ready
        ? `<div class="status sub acl ready"><div><b>✅ Acclimated: time to ${L.ACCLIM_GOALS[acc.goal]}</b><small>Finished settling in ${fmtDay(acc.end)}.</small></div>
          <button class="btn" data-act="acclim-done" data-id="${p.id}">Done</button></div>`
        : `<div class="status sub acl"><div><b>⏳ Acclimatising: week ${acc.week} of ${p.acclim_weeks}</b><small>Ready ${fmtDay(acc.end)} (${plural(acc.left, 'day')} to go) to ${L.ACCLIM_GOALS[acc.goal]}.</small>
          <div class="bar"><i style="width:${acc.pct}%"></i></div></div><button class="btn ghost" data-act="acclim-done" data-id="${p.id}">Done early</button></div>`) : ''}
      ${f ? `<div class="status sub"><div><b>🧪 Feed ${f.days <= 0 ? 'due now' : 'due ' + fmtDay(f.due)}</b>
        <small>Every ${plural(p.fert_every_weeks, 'week')}${f.aligned ? ', matched to a watering day' : ''}${f.paused ? ' · paused for the cool months' : ''}.</small></div>
        ${f.days <= 0 ? `<button class="btn" data-act="do-feed" data-id="${p.id}">Fed it</button>` : ''}</div>` : ''}
      ${pole ? `<div class="status sub"><div><b>🎋 Pole drip ${pole.days <= 0 ? 'due now' : 'due ' + fmtDay(pole.due)}</b>
        <small>${pole.ml ? `Usually ${pole.ml} ml · ` : ''}every ~${pole.interval} days${pole.learned ? ' (learned)' : ''}${pole.count ? ` · ${plural(pole.count, 'drip')} logged` : ''}.</small></div>
        <button class="btn" data-act="do-pole" data-id="${p.id}">${pole.ml ? pole.ml + ' ml' : 'Drip'}</button></div>` : ''}

      <div class="actions">${acts.map(([t, i, l]) => `<button class="act" data-act="log" data-type="${t}"><span>${i}</span>${l}</button>`).join('')}
        <button class="act" data-act="log" data-type="water"><span>📅</span>Past water</button>
        <button class="act" data-act="report-problem"><span>🐛</span>Problem</button>
        <button class="act" data-act="propagate"><span>🌱</span>Propagate</button>
        ${cfg.AI_ENABLED ? '<button class="act" data-act="ask-claude"><span>✨</span>Ask Claude</button>' : ''}</div>

      <div class="facts"><div class="fact"><b>${lastTxt}</b><small>last watered</small></div>
        <div class="fact"><b>${w.waterCount}</b><small>waterings</small></div>
        <div class="fact"><b>${count('new_leaf')}</b><small>new leaves</small></div></div>

      <h3 class="sec-h">Problems</h3>
      ${ongoing.map((i) => `<div class="issue open"><div><b>${ISSUE_KINDS[i.kind] || i.kind}: ${esc(i.title)}</b><small>Open ${plural(L.dnum(S.today) - L.dnum(i.started_on), 'day')} · since ${fmtDate(i.started_on)}</small>
        ${i.treatment ? `<p>Tried: ${esc(i.treatment)}</p>` : ''}</div><button class="btn mini" data-act="resolve-issue" data-id="${i.id}">Resolve</button></div>`).join('')}
      ${done.map((i) => `<div class="issue"><div><b>${ISSUE_KINDS[i.kind] || i.kind}: ${esc(i.title)}</b>
        <small>Fixed in ${plural(Math.max(0, L.dnum(i.resolved_on) - L.dnum(i.started_on)), 'day')} · ${fmtDate(i.started_on)} to ${fmtDate(i.resolved_on)}</small>
        ${i.what_worked ? `<p>✅ What worked: ${esc(i.what_worked)}</p>` : ''}</div><button class="del" data-act="del-issue" data-id="${i.id}" aria-label="Delete">🗑</button></div>`).join('')}
      ${issues.length ? '' : '<p class="muted">No problems logged. 🎉</p>'}

      ${kids.length || p.prop_stage ? '<h3 class="sec-h">Propagation</h3>' : ''}
      ${p.prop_stage ? `<div class="issue"><div><b>${esc(PROP_STAGES[p.prop_stage])}</b><small>${[p.prop_method && PROP_METHODS[p.prop_method], p.propagated_on && 'started ' + fmtDate(p.propagated_on)].filter(Boolean).join(' · ')}</small></div>
        ${['cutting', 'rooting', 'potted'].includes(p.prop_stage) ? `<button class="btn mini" data-act="prop-next" data-id="${p.id}">Next stage ›</button>` : ''}</div>` : ''}
      ${kids.length ? `<div class="kids">${kids.map((k) => `<span class="chip" data-act="open" data-id="${k.id}">🌱 ${esc(k.name)}${k.prop_stage ? ' · ' + esc(PROP_STAGES[k.prop_stage]) : ''}</span>`).join('')}</div>
        <p class="muted small">${kids.filter((k) => ['potted', 'established'].includes(k.prop_stage)).length} of ${kids.length} cuttings established or potted up.</p>` : ''}

      <h3 class="sec-h">Care and setup</h3>
      <div class="kvs">${[
        kv('Light', p.light_level && LIGHT_LEVELS[p.light_level]), kv('Watering style', FLEX[p.flex || 'normal'].label + ' · ' + FLEX[p.flex || 'normal'].hint),
        kv('Pot', p.pot_size_cm ? p.pot_size_cm + ' cm' : ''), kv('Soil mix', p.soil_mix),
        kv('Feeding', p.fert_every_weeks ? `every ${plural(p.fert_every_weeks, 'week')}${p.fert_winter_pause === false ? '' : ', paused in cool months'}` : ''),
        kv('Moss pole', p.has_pole ? `${p.pole_ml ? p.pole_ml + ' ml, ' : ''}every ${p.pole_every_days || 3} days${p.pole_notes ? ' · ' + p.pole_notes : ''}` : ''),
        kv('Grow light', p.grow_light ? [p.light_model || 'On', p.light_watts && p.light_watts + ' W', p.light_hours && p.light_hours + ' h/day', p.light_distance_cm && p.light_distance_cm + ' cm away'].filter(Boolean).join(' · ') + (p.light_notes ? ' · ' + p.light_notes : '') : ''),
        kv('Bought', [p.purchased_on && fmtDate(p.purchased_on), p.purchased_from, p.price != null && '$' + Number(p.price).toFixed(2)].filter(Boolean).join(' · ')),
      ].join('') || '<p class="muted">Tap Edit to add light, pot, soil and purchase details.</p>'}</div>
      ${p.notes ? `<p class="notes">${esc(p.notes)}</p>` : ''}

      ${photos.length ? `<h3 class="sec-h">Growth timeline</h3>
        ${photos.length > 1 ? `<div class="cmp-sel"><label>Before<select data-cmp="a">${opts(cmp.a)}</select></label><label>After<select data-cmp="b">${opts(cmp.b)}</select></label></div>
        <div class="cmp" style="--pos:50%"><img class="cmp-b" src="${esc(photos[cmp.b].url)}" alt=""><img class="cmp-a" src="${esc(photos[cmp.a].url)}" alt=""><span class="cmp-line"></span></div>
        <input type="range" class="cmp-range" min="0" max="100" value="50" aria-label="Slide to compare">
        <div class="cmp-cap"><span>${fmtDate(photos[cmp.a].date)}</span><span>${fmtDate(photos[cmp.b].date)}</span></div>` : ''}
        <div class="gallery">${[...photos].reverse().map((ph) => `<img src="${esc(ph.url)}" alt="" loading="lazy" title="${esc(fmtDate(ph.date))}" data-act="zoom" data-src="${esc(ph.url)}">`).join('')}</div>` : ''}
      ${leafRows.length ? `<h3 class="sec-h">New leaves by season</h3><div class="bars">${leafRows.map(([k, v]) => `<div class="bar-row"><span>${esc(k)}</span><i style="width:${(v.n / leafMax) * 100}%"></i><b>${v.n}</b></div>`).join('')}</div>` : ''}

      <h3 class="sec-h">History</h3>
      ${evs.length ? `<ul class="tl">${evs.slice(0, 150).map((e) => {
        const t = TYPES[e.type] || TYPES.note, u = e.photo_path && S.urls[e.photo_path];
        return `<li><div class="ic" style="background:${t.color}22">${t.icon}</div><div class="bd">
          <b>${t.label}${e.soil ? `<span class="badge">${SOIL[e.soil]} soil</span>` : ''}${e.amount_ml ? `<span class="badge">${e.amount_ml} ml</span>` : ''}</b><small>${fmtDate(e.occurred_on)}</small>
          ${e.note ? `<p>${esc(e.note)}</p>` : ''}${u ? `<img src="${esc(u)}" alt="" loading="lazy" data-act="zoom" data-src="${esc(u)}">` : ''}</div>
          <button class="del" data-act="del-event" data-id="${e.id}" aria-label="Delete entry">🗑</button></li>`;
      }).join('')}</ul>` : '<p class="muted">Nothing logged yet. Tap Water or any action above.</p>'}
    </div></div>`;
}

/* ------------------------------------------------------------ plant form */

const sec = (title, open, body) => `<details class="fs" ${open ? 'open' : ''}><summary>${title}</summary><div class="fs-b">${body}</div></details>`;
const field = (label, input) => `<label>${label}${input}</label>`;
const val = (v) => (v == null ? '' : esc(v));
const sel = (name, map, cur, blank) => `<select name="${name}">${blank != null ? `<option value="">${esc(blank)}</option>` : ''}${Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(typeof v === 'string' ? v : v.label)}</option>`).join('')}</select>`;

const LR = 'leaflog-lastroom';
function lastRoom() { try { const v = localStorage.getItem(LR); return v && S.rooms.some((r) => r.id === v) ? v : ''; } catch (e) { return ''; } }
function rememberRoom(id) { try { if (id) localStorage.setItem(LR, id); } catch (e) { /* ignore */ } }

export function openPlantForm(id, preset = {}) {
  const base = { name: '', species: '', room_id: S.filter !== 'all' && S.filter !== 'none' ? S.filter : lastRoom(), interval_days: 7, notes: '', flex: 'normal', fert_winter_pause: true, ...preset };
  const p = id ? S.plants.find((x) => x.id === id) : base;
  const img = id ? plantImg(p) : '';
  const others = S.plants.filter((q) => q.id !== id);
  modal(`<form id="pf" class="form" data-id="${id || ''}"><h2>${id ? 'Edit plant' : 'New plant'}</h2>
    <div class="photo-field"><span class="lbl">Photo</span>${img ? `<img class="photo-prev" src="${esc(img)}" alt="">` : ''}${photoButtons()}</div>
    ${cfg.AI_ENABLED ? `<button type="button" class="btn ai" data-act="ai-identify">✨ Identify plant &amp; suggest care</button><div id="ai-out"></div>` : ''}
    ${field('Name', `<input name="name" required value="${val(p.name)}" placeholder="e.g. Monty the monstera">`)}
    ${field('Type / species (optional)', `<input name="species" value="${val(p.species)}" placeholder="e.g. Monstera deliciosa">`)}
    ${field('Room', `<select name="room"><option value="">No room</option>${S.rooms.map((r) => `<option value="${r.id}" ${r.id === p.room_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}<option value="__new">+ New room…</option></select>`)}
    <input name="newroom" placeholder="New room name" hidden>
    ${sec('💧 Watering and feeding', true, `
      ${field('Starting guess: water every (days)', `<input type="number" name="interval" min="1" max="365" inputmode="numeric" value="${val(p.interval_days)}">`)}
      ${field('Watering style', sel('flex', FLEX, p.flex || 'normal'))}
      <p class="muted small">Thirsty plants keep their own day. Normal plants may be pushed up to 2 days later, hardy plants up to 4, so they bunch onto your water days. Never earlier.</p>
      ${field('Feed every (weeks, blank = no feeding)', `<input type="number" name="fert_weeks" min="1" max="26" inputmode="numeric" value="${val(p.fert_every_weeks)}">`)}
      <label class="check"><input type="checkbox" name="fert_pause" ${p.fert_winter_pause === false ? '' : 'checked'}> Pause feeding through the cool months</label>`)}
    ${sec('🎋 Moss pole', !!p.has_pole, `
      <label class="check"><input type="checkbox" name="has_pole" ${p.has_pole ? 'checked' : ''}> This plant has a moss pole</label>
      <div class="row">${field('Drip every (days)', `<input type="number" name="pole_every" min="1" max="30" inputmode="numeric" value="${val(p.pole_every_days)}" placeholder="3">`)}
        ${field('Usual amount (ml)', `<input type="number" name="pole_ml" min="0" inputmode="numeric" value="${val(p.pole_ml)}" placeholder="250">`)}</div>
      ${field('Pole notes', `<input name="pole_notes" value="${val(p.pole_notes)}" placeholder="e.g. 90 cm, drip bottle on the left">`)}`)}
    ${sec('💡 Light', !!(p.light_level || p.grow_light), `
      ${field('Natural light level', sel('light_level', LIGHT_LEVELS, p.light_level || '', 'Not set'))}
      <label class="check"><input type="checkbox" name="grow_light" ${p.grow_light ? 'checked' : ''}> Uses a grow light</label>
      ${field('Light model', `<input name="light_model" value="${val(p.light_model)}" placeholder="e.g. Spider Farmer SF1000">`)}
      <div class="row">${field('Watts', `<input type="number" name="light_watts" min="0" inputmode="numeric" value="${val(p.light_watts)}">`)}
        ${field('Hours / day', `<input type="number" step="0.5" name="light_hours" min="0" max="24" inputmode="decimal" value="${val(p.light_hours)}">`)}
        ${field('Distance (cm)', `<input type="number" name="light_distance" min="0" inputmode="numeric" value="${val(p.light_distance_cm)}">`)}</div>
      ${field('Light notes', `<input name="light_notes" value="${val(p.light_notes)}" placeholder="e.g. 4000K, on timer 7am-9pm">`)}`)}
    ${sec('🛍️ Pot, soil and purchase', !!(p.pot_size_cm || p.soil_mix || p.purchased_on), `
      <div class="row">${field('Pot size (cm)', `<input type="number" step="0.5" name="pot_size" min="0" inputmode="decimal" value="${val(p.pot_size_cm)}">`)}
        ${field('Price ($)', `<input type="number" step="0.01" name="price" min="0" inputmode="decimal" value="${val(p.price)}">`)}</div>
      ${field('Soil mix', `<input name="soil_mix" value="${val(p.soil_mix)}" placeholder="e.g. 50% aroid mix, 30% bark, 20% perlite">`)}
      <div class="row">${field('Date bought', `<input type="date" name="purchased_on" value="${val(p.purchased_on)}">`)}
        ${field('Bought from', `<input name="purchased_from" value="${val(p.purchased_from)}" placeholder="e.g. Bunnings">`)}</div>`)}
    ${sec('🌱 Propagation', !!(p.parent_id || p.prop_stage), `
      ${field('Cutting of…', `<select name="parent"><option value="">Not a cutting</option>${others.map((q) => `<option value="${q.id}" ${q.id === p.parent_id ? 'selected' : ''}>${esc(q.name)}</option>`).join('')}</select>`)}
      <div class="row">${field('Stage', sel('prop_stage', PROP_STAGES, p.prop_stage || '', 'None'))}${field('Method', sel('prop_method', PROP_METHODS, p.prop_method || '', 'Not set'))}</div>
      ${field('Date started', `<input type="date" name="propagated_on" value="${val(p.propagated_on)}">`)}`)}
    ${sec('⏳ Acclimatisation', !!p.acclim_weeks, `
      <p class="muted small">For a newly bought plant: you'll get an alert when it has settled in and is ready to repot or go on a pole.</p>
      <div class="row">${field('Acclimatise for (weeks)', `<input type="number" name="acclim_weeks" min="1" max="52" inputmode="numeric" value="${val(p.acclim_weeks)}" placeholder="e.g. 4">`)}
        ${field('Started', `<input type="date" name="acclim_started" value="${val(p.acclim_started_on)}">`)}</div>
      ${field('Then I want to…', sel('acclim_for', { both: 'Repot or put on a pole', repot: 'Repot it', pole: 'Put it on a pole' }, p.acclim_for || 'both'))}
      <p class="muted small">Leave Started blank to count from the date bought (or today).</p>`)}
    ${field('Notes (optional)', `<textarea name="notes" placeholder="Quirks, care tips">${esc(p.notes || '')}</textarea>`)}
    <div class="row"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Save</button></div>
    ${id ? '<button type="button" class="link-danger" data-act="delete-plant">Delete this plant…</button>' : ''}</form>`);
}

async function savePlant(f) {
  const id = f.dataset.id || null, fd = new FormData(f);
  const btn = $('button.primary', f); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    let room_id = fd.get('room') || null;
    if (room_id === '__new') { const n = (fd.get('newroom') || '').trim(); room_id = n ? (await addRoom(n)).id : null; }
    if (!id) rememberRoom(room_id);
    const on = (k) => fd.get(k) === 'on';
    const str = (k) => (fd.get(k) || '').toString().trim() || null;
    const row = {
      name: fd.get('name').trim(), species: str('species'), room_id, notes: str('notes'),
      interval_days: Math.min(365, Math.max(1, parseInt(fd.get('interval'), 10) || 7)), flex: fd.get('flex') || 'normal',
      fert_every_weeks: num(fd.get('fert_weeks')), fert_winter_pause: on('fert_pause'),
      has_pole: on('has_pole'), pole_every_days: num(fd.get('pole_every')), pole_ml: num(fd.get('pole_ml')), pole_notes: str('pole_notes'),
      light_level: fd.get('light_level') || null, grow_light: on('grow_light'), light_model: str('light_model'), light_watts: num(fd.get('light_watts')),
      light_hours: num(fd.get('light_hours')), light_distance_cm: num(fd.get('light_distance')), light_notes: str('light_notes'),
      pot_size_cm: num(fd.get('pot_size')), soil_mix: str('soil_mix'), purchased_on: fd.get('purchased_on') || null, purchased_from: str('purchased_from'), price: num(fd.get('price')),
      acclim_weeks: num(fd.get('acclim_weeks')), acclim_for: fd.get('acclim_for') || 'both',
      parent_id: fd.get('parent') || null, prop_stage: fd.get('prop_stage') || null, prop_method: fd.get('prop_method') || null, propagated_on: fd.get('propagated_on') || null,
    };
    const prev = id ? S.plants.find((x) => x.id === id) : null;
    row.acclim_started_on = row.acclim_weeks ? (fd.get('acclim_started') || row.purchased_on || todayStr()) : null;
    row.acclim_done_on = row.acclim_weeks && prev && prev.acclim_done_on && !(row.acclim_weeks > (prev.acclim_weeks || 0)) ? prev.acclim_done_on : null;
    const file = pickedFile(f);
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
    closeModal(); hooks.render();
    showToast('🌿 Plant saved', 1800);
  } catch (err) { fail(err); btn.disabled = false; btn.textContent = 'Save'; }
}

async function deletePlant() {
  const id = S.detail; const p = S.plants.find((x) => x.id === id); if (!p) return;
  const kids = S.plants.filter((q) => q.parent_id === id).length;
  const ok = await confirmBox(`Delete ${p.name} and its whole history? ${kids ? `Its ${plural(kids, 'cutting')} will be kept. ` : ''}This can't be undone.`, 'Delete plant');
  if (!ok) return;
  const paths = [p.photo_path, ...S.events.filter((e) => e.plant_id === id).map((e) => e.photo_path)];
  const { error } = await sb.from('plants').delete().eq('id', id);
  if (error) throw error;
  S.plants = S.plants.filter((x) => x.id !== id);
  S.plants.forEach((q) => { if (q.parent_id === id) q.parent_id = null; });
  S.events = S.events.filter((e) => e.plant_id !== id);
  S.issues = S.issues.filter((i) => i.plant_id !== id);
  removePhotos(paths);
  closeSheet(); hooks.render();
  showToast('Plant deleted', 2000);
}

/* ---------------------------------------------------------- event modal */

const EVENT_TYPES = ['water', 'fertilise', 'pole', 'repot', 'new_leaf', 'prune', 'propagate', 'note'];

export function openEventModal(plantId, type = 'water') {
  const p = S.plants.find((x) => x.id === plantId); if (!p) return;
  const pole = S.stMap[p.id] && S.stMap[p.id].pole;
  const types = EVENT_TYPES.filter((t) => t !== 'pole' || p.has_pole);
  modal(`<form id="ef" class="form" data-plant="${p.id}" data-poleml="${pole && pole.ml ? pole.ml : ''}"><h2>${esc(p.name)}</h2>
    <label>What happened?<span class="seg">${types.map((k) => `<label><input type="radio" name="type" value="${k}" ${k === type ? 'checked' : ''}><span>${TYPES[k].icon} ${TYPES[k].short}</span></label>`).join('')}</span></label>
    <label>Date<input type="date" name="date" value="${todayStr()}" max="${todayStr()}" required></label>
    <div id="soilbox" ${type === 'water' ? '' : 'hidden'}><label>How was the soil before watering?<span class="seg">
      <label><input type="radio" name="soil" value="" checked><span>Skip</span></label>
      ${Object.entries(SOIL).map(([k, v]) => `<label><input type="radio" name="soil" value="${k}"><span>${v}</span></label>`).join('')}</span></label></div>
    <div id="mlbox" ${type === 'water' || type === 'pole' ? '' : 'hidden'}><label>Amount (ml, optional)<input type="number" name="ml" min="0" inputmode="numeric" value="${type === 'pole' && pole && pole.ml ? pole.ml : ''}" placeholder="e.g. 250"></label></div>
    <label>Note (optional)<textarea name="note" placeholder="e.g. 2 new leaves, brown tips, moved to brighter spot"></textarea></label>
    <div class="photo-field"><span class="lbl">Photo (optional)</span>${photoButtons()}</div>
    <div class="row"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Save</button></div></form>`);
}

async function saveEvent(f) {
  const fd = new FormData(f), type = fd.get('type');
  const btn = $('button.primary', f); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const file = pickedFile(f);
    const photo_path = file ? await uploadPhoto(file) : null;
    await insertEvent({
      plant_id: f.dataset.plant, type, occurred_on: fd.get('date') || todayStr(),
      soil: type === 'water' ? fd.get('soil') || null : null,
      amount_ml: type === 'water' || type === 'pole' ? num(fd.get('ml')) : null,
      note: (fd.get('note') || '').trim() || null, photo_path,
    });
    await refreshUrls();
    closeModal(); hooks.render();
    showToast(`${TYPES[type].icon} Saved`, 1800);
  } catch (err) { fail(err); btn.disabled = false; btn.textContent = 'Save'; }
}

/* ----------------------------------------------------------- problems */

function openIssueModal(plantId) {
  const p = S.plants.find((x) => x.id === plantId);
  modal(`<form id="if" class="form" data-plant="${plantId}"><h2>Report a problem · ${esc(p.name)}</h2>
    ${field('Type', `<select name="kind">${Object.entries(ISSUE_KINDS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>`)}
    ${field('What is it?', `<input name="title" required placeholder="e.g. Fungus gnats, spider mites, yellow leaves">`)}
    ${field('Noticed on', `<input type="date" name="started" value="${todayStr()}" max="${todayStr()}" required>`)}
    ${field('What are you trying? (optional)', `<textarea name="treatment" placeholder="e.g. Neem oil spray, let soil dry out, sticky traps"></textarea>`)}
    <div class="row"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Save</button></div></form>`);
}
async function saveIssue(f) {
  const fd = new FormData(f);
  const { data, error } = await sb.from('issues').insert({
    plant_id: f.dataset.plant, kind: fd.get('kind'), title: fd.get('title').trim(), started_on: fd.get('started'), treatment: (fd.get('treatment') || '').trim() || null,
  }).select().single();
  if (error) throw error;
  S.issues.unshift(data);
  closeModal(); hooks.render(); showToast('⚠️ Problem logged', 1800);
}
function openResolveModal(id) {
  const i = S.issues.find((x) => x.id === id);
  modal(`<form id="rf" class="form" data-id="${id}"><h2>Resolved: ${esc(i.title)}</h2>
    ${field('Fixed on', `<input type="date" name="resolved" value="${todayStr()}" min="${i.started_on}" max="${todayStr()}" required>`)}
    ${field('What worked?', `<textarea name="worked" placeholder="e.g. Yellow sticky traps plus letting the top 3 cm dry out">${esc(i.treatment || '')}</textarea>`)}
    <div class="row"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Mark resolved</button></div></form>`);
}
async function saveResolve(f) {
  const fd = new FormData(f), id = f.dataset.id;
  const patch = { resolved_on: fd.get('resolved'), what_worked: (fd.get('worked') || '').trim() || null };
  const { error } = await sb.from('issues').update(patch).eq('id', id);
  if (error) throw error;
  Object.assign(S.issues.find((x) => x.id === id), patch);
  closeModal(); hooks.render(); showToast('✅ Marked resolved', 1800);
}

/* -------------------------------------------------------- propagation */

function openPropagate(plantId) {
  const p = S.plants.find((x) => x.id === plantId);
  modal(`<form id="prf" class="form" data-plant="${plantId}"><h2>Propagate ${esc(p.name)}</h2>
    <p class="muted small">This adds the cutting as its own plant, linked to ${esc(p.name)}, and logs it in the history.</p>
    ${field('Name of the cutting', `<input name="name" required value="${esc(p.name)} cutting">`)}
    <div class="row">${field('Method', sel('method', PROP_METHODS, 'water'))}${field('Date', `<input type="date" name="date" value="${todayStr()}" max="${todayStr()}" required>`)}</div>
    ${field('Note (optional)', `<textarea name="note" placeholder="e.g. Node with aerial root, 2 leaves"></textarea>`)}
    <div class="photo-field"><span class="lbl">Photo (optional)</span>${photoButtons()}</div>
    <div class="row"><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">Create cutting</button></div></form>`);
}
async function savePropagate(f) {
  const fd = new FormData(f), pid = f.dataset.plant, p = S.plants.find((x) => x.id === pid);
  const btn = $('button.primary', f); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const file = pickedFile(f);
    const photo_path = file ? await uploadPhoto(file) : null;
    const date = fd.get('date');
    const { data, error } = await sb.from('plants').insert({
      name: fd.get('name').trim(), species: p.species, room_id: p.room_id, interval_days: p.interval_days, flex: p.flex,
      parent_id: pid, prop_stage: 'cutting', prop_method: fd.get('method'), propagated_on: date, photo_path,
    }).select().single();
    if (error) throw error;
    S.plants.push(data);
    await insertEvent({ plant_id: pid, type: 'propagate', occurred_on: date, note: `${PROP_METHODS[fd.get('method')]}: ${data.name}${fd.get('note') ? ' · ' + fd.get('note') : ''}` });
    await refreshUrls();
    closeModal(); hooks.render(); showToast('🌱 Cutting created', 2000);
  } catch (err) { fail(err); btn.disabled = false; btn.textContent = 'Create cutting'; }
}
async function nextStage(id) {
  const order = ['cutting', 'rooting', 'potted', 'established'];
  const p = S.plants.find((x) => x.id === id); const next = order[order.indexOf(p.prop_stage) + 1]; if (!next) return;
  const { data, error } = await sb.from('plants').update({ prop_stage: next }).eq('id', id).select().single();
  if (error) throw error;
  S.plants = S.plants.map((x) => (x.id === id ? data : x));
  hooks.render(); showToast(`🌱 Now: ${PROP_STAGES[next]}`, 1800);
}

/* ------------------------------------------------------------- Claude */

function renderAi(r) {
  const row = (k, v) => (v ? `<li><b>${esc(k)}:</b> ${esc(v)}</li>` : '');
  return `<div class="ai-card"><div class="ai-h"><b>${esc(r.common_name || 'Unknown')}</b>${r.species ? ` <i>${esc(r.species)}</i>` : ''}
    <span class="badge">${esc(r.confidence || '?')} confidence</span></div>
    ${r.summary ? `<p>${esc(r.summary)}</p>` : ''}
    <ul>${row('Light', r.light_level && LIGHT_LEVELS[r.light_level])}${row('Water', r.water_every_days ? `about every ${r.water_every_days} days. ${r.water_notes || ''}` : '')}
      ${row('Feed', r.feed_every_weeks ? `every ${r.feed_every_weeks} weeks in the growing season` : '')}${row('Soil', r.soil_mix)}${row('Humidity', r.humidity)}
      ${row('Moss pole', r.needs_pole ? 'Benefits from one. ' + (r.pole_notes || '') : '')}${row('Pets', r.pet_safe === true ? 'Generally pet-safe' : r.pet_safe === false ? 'Toxic to pets' : '')}
      ${row('Watch for', Array.isArray(r.watch_for) ? r.watch_for.join(', ') : r.watch_for)}</ul>
    <button type="button" class="btn block" data-act="ai-apply">Apply these suggestions</button></div>`;
}

async function aiBlob(f) {
  const file = pickedFile(f);
  if (file) return resizeImage(file, 1024, 0.8);
  const p = f.dataset.id && S.plants.find((x) => x.id === f.dataset.id);
  const u = p && plantImg(p);
  if (u) { const r = await fetch(u); return r.blob(); }
  return null;
}

const AI_STEPS = ['Looking at the leaves…', 'Working out the species…', 'Checking light and water needs…', 'Picking a soil mix and feeding plan…', 'Nearly done…'];
/** show an animated "thinking" card in `out`; returns a function that stops the animation */
function aiLoading(out, btn) {
  let i = 0;
  out.innerHTML = `<div class="ai-load" role="status" aria-live="polite"><div class="ai-orb"><span></span><span></span><span></span></div>
    <div class="ai-step">${AI_STEPS[0]}</div><div class="ai-skel"><i></i><i></i><i></i></div></div>`;
  const step = out.querySelector('.ai-step');
  const t = setInterval(() => {
    i = Math.min(i + 1, AI_STEPS.length - 1);
    step.classList.add('swap');
    setTimeout(() => { step.textContent = AI_STEPS[i]; step.classList.remove('swap'); }, 180);
  }, 2200);
  if (btn) { btn.disabled = true; btn.classList.add('busy'); btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class="spin"></span> Thinking…'; }
  return () => {
    clearInterval(t);
    if (btn) { btn.disabled = false; btn.classList.remove('busy'); if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  };
}

async function aiIdentify(auto) {
  const f = $('#pf'), out = $('#ai-out'), btn = f && f.querySelector('[data-act=ai-identify]');
  if (btn && btn.disabled) return; // already working
  const blob = await aiBlob(f);
  if (!blob) { showToast('Add a photo first, then tap Identify', 3000); return; }
  const stop = aiLoading(out, btn);
  try {
    const res = await callFn('plant-advisor', { mode: 'identify', image: await toBase64(blob), media_type: 'image/jpeg', hint: f.elements.name.value || '' });
    stop();
    S.ai = res.result || res;
    out.innerHTML = renderAi(S.ai);
    out.firstElementChild && out.firstElementChild.classList.add('ai-in');
    if (auto && $('#pf') === f) { aiApply(); showToast('✨ Filled in from your photo. Check it, then Save.', 4000); }
  } catch (e) { stop(); out.innerHTML = ''; fail(e); }
}

function aiApply() {
  const r = S.ai, f = $('#pf'); if (!r) return;
  const set = (name, v, onlyEmpty) => { const el = f.elements[name]; if (el && v != null && v !== '' && (!onlyEmpty || !el.value)) el.value = v; };
  set('name', r.common_name, true); set('species', r.species, true);
  if (r.water_every_days) set('interval', Math.min(365, Math.max(1, Math.round(r.water_every_days))));
  if (['strict', 'normal', 'hardy'].includes(r.flex)) set('flex', r.flex);
  if (r.feed_every_weeks) set('fert_weeks', Math.round(r.feed_every_weeks));
  if (LIGHT_LEVELS[r.light_level]) set('light_level', r.light_level);
  set('soil_mix', r.soil_mix, true);
  if (r.needs_pole) { f.elements.has_pole.checked = true; set('pole_every', 3, true); set('pole_notes', r.pole_notes, true); }
  const notes = [r.summary, r.humidity && `Humidity: ${r.humidity}`, r.water_notes, r.watch_for && 'Watch for: ' + (Array.isArray(r.watch_for) ? r.watch_for.join(', ') : r.watch_for)].filter(Boolean).join('\n');
  if (notes && !f.elements.notes.value) f.elements.notes.value = `✨ Claude's care notes:\n${notes}`;
  f.querySelectorAll('details.fs').forEach((d) => { d.open = true; });
  showToast('Applied. Review the fields, then Save.', 3000);
}

function plantSummary(p) {
  const x = S.stMap[p.id], rm = room(p);
  const evs = S.events.filter((e) => e.plant_id === p.id).slice(0, 20).map((e) => `${e.occurred_on} ${e.type}${e.soil ? ' (soil ' + e.soil + ')' : ''}${e.amount_ml ? ' ' + e.amount_ml + 'ml' : ''}${e.note ? ': ' + e.note : ''}`);
  const open = S.issues.filter((i) => i.plant_id === p.id && !i.resolved_on).map((i) => `${i.kind}: ${i.title} since ${i.started_on}`);
  return [
    `Plant: ${p.name}${p.species ? ' (' + p.species + ')' : ''}`, rm && `Room: ${rm.name}`, p.light_level && `Natural light: ${p.light_level}`,
    p.grow_light && `Grow light: ${[p.light_model, p.light_watts && p.light_watts + 'W', p.light_hours && p.light_hours + 'h/day', p.light_distance_cm && p.light_distance_cm + 'cm away'].filter(Boolean).join(', ')}`,
    p.pot_size_cm && `Pot: ${p.pot_size_cm} cm`, p.soil_mix && `Soil: ${p.soil_mix}`, p.has_pole && `Moss pole: yes, drip ${p.pole_ml || '?'} ml every ${p.pole_every_days || '?'} days`,
    x && `Watering rhythm: about every ${x.w.interval} days (${x.w.learned ? 'learned from logs' : 'starting guess'}); last watered ${x.w.sinceLast == null ? 'never' : x.w.sinceLast + ' days ago'}`,
    p.fert_every_weeks && `Feeding: every ${p.fert_every_weeks} weeks`, open.length && `Open problems: ${open.join('; ')}`,
    p.notes && `Notes: ${p.notes}`, evs.length && `Recent history:\n${evs.join('\n')}`, `Today: ${S.today}, hemisphere: ${S.settings.hemisphere}`,
  ].filter(Boolean).join('\n');
}

function openAskClaude(plantId) {
  const p = S.plants.find((x) => x.id === plantId);
  modal(`<form id="af" class="form" data-plant="${plantId}"><h2>✨ Ask Claude about ${esc(p.name)}</h2>
    ${field('Your question', `<textarea name="q" placeholder="e.g. Why are the lower leaves yellowing? Should I repot?">How is this plant doing, and is there anything I should change?</textarea>`)}
    ${plantImg(p) ? '<label class="check"><input type="checkbox" name="photo" checked> Include its profile photo</label>' : ''}
    <p class="muted small">Claude sees this plant's care history and (optionally) its photo. It's advice, not a diagnosis.</p>
    <div id="ai-reply"></div>
    <div class="row"><button type="button" class="btn ghost" data-act="close-modal">Close</button><button class="btn primary">Ask</button></div></form>`);
}
async function submitAsk(f) {
  const fd = new FormData(f), p = S.plants.find((x) => x.id === f.dataset.plant), out = $('#ai-reply', f);
  const btn = $('button.primary', f); btn.disabled = true; btn.textContent = 'Thinking…';
  const stop = aiLoading(out, null);
  try {
    let image = null;
    if (fd.get('photo') === 'on' && plantImg(p)) { try { image = await toBase64(await (await fetch(plantImg(p))).blob()); } catch (e) { /* ask without the photo */ } }
    const res = await callFn('plant-advisor', { mode: 'advice', plant: plantSummary(p), question: fd.get('q'), image, media_type: 'image/jpeg' });
    const text = (res.result && res.result.advice) || res.advice || '';
    stop();
    out.innerHTML = `<div class="ai-card ai-in"><div class="ai-text">${esc(text)}</div></div>`;
  } catch (e) { stop(); out.innerHTML = ''; fail(e); }
  btn.disabled = false; btn.textContent = 'Ask again';
}

/* --------------------------------------------------------------- wiring */

Object.assign(ACTS, {
  'add-plant': () => openPlantForm(null),
  'edit-plant': () => openPlantForm(S.detail),
  'delete-plant': () => deletePlant(),
  log: (t) => openEventModal(S.detail, t.dataset.type),
  'close-sheet': () => closeSheet(),
  zoom: (t) => { const src = t.dataset.src; if (src) modal(`<img src="${esc(src)}" alt="">`, 'lightbox'); },
  'del-event': async (t) => { if (await confirmBox('Delete this entry?')) { await deleteEvents([t.dataset.id]); hooks.render(); showToast('Entry deleted', 1800); } },
  'report-problem': () => openIssueModal(S.detail),
  'resolve-issue': (t) => openResolveModal(t.dataset.id),
  'del-issue': async (t) => {
    if (!(await confirmBox('Delete this problem record?'))) return;
    const { error } = await sb.from('issues').delete().eq('id', t.dataset.id); if (error) throw error;
    S.issues = S.issues.filter((i) => i.id !== t.dataset.id); hooks.render();
  },
  propagate: () => openPropagate(S.detail),
  'prop-next': (t) => nextStage(t.dataset.id),
  'ask-claude': () => openAskClaude(S.detail),
  'ai-identify': () => aiIdentify(),
  'ai-apply': () => aiApply(),
  refresh: async () => { await loadAll(); hooks.render(); showToast('Up to date ✓', 1200); },
});

/** returns a promise if it handled the form, otherwise null */
export function handleSubmit(f) {
  switch (f.id) {
    case 'pf': return savePlant(f);
    case 'ef': return saveEvent(f);
    case 'if': return saveIssue(f);
    case 'rf': return saveResolve(f);
    case 'prf': return savePropagate(f);
    case 'af': return submitAsk(f);
    default: return null;
  }
}

export function handleChange(e) {
  const t = e.target;
  if (t.name === 'type') {
    const soil = $('#soilbox'), ml = $('#mlbox'), form = t.form;
    if (soil) soil.hidden = t.value !== 'water';
    if (ml) {
      ml.hidden = !(t.value === 'water' || t.value === 'pole');
      const inp = $('input[name=ml]', ml);
      if (inp) inp.value = t.value === 'pole' ? form.dataset.poleml || '' : '';
    }
  }
  if (t.name === 'room') { const n = $('[name=newroom]', t.form); if (n) { n.hidden = t.value !== '__new'; if (!n.hidden) n.focus(); } }
  if (t.type === 'file' && t.files[0]) {
    const pp = t.closest('.photo-pick'); if (!pp) return;
    let img = $('img', pp);
    if (!img) { img = document.createElement('img'); img.alt = ''; pp.prepend(img); }
    img.src = URL.createObjectURL(t.files[0]);
    const hint = $('.ph-hint', pp); if (hint) hint.remove();
  }
  if (t.dataset && t.dataset.cmp) {
    const c = S.cmp[S.detail]; if (c) { c[t.dataset.cmp] = Number(t.value); const y = $('#sheet').scrollTop; renderDetail(); $('#sheet').scrollTop = y; }
  }
}

export function handleInput(e) {
  const t = e.target;
  if (t.classList && t.classList.contains('cmp-range')) { const box = $('#sheet .cmp'); if (box) box.style.setProperty('--pos', t.value + '%'); }
}

/* ---- photo picking: one button opens the camera directly, the other opens the gallery ---- */
function photoButtons() {
  return `<div class="photo-btns">
    <label class="btn ghost">📷 Take photo<input type="file" name="photo_cam" accept="image/*" capture="environment" hidden></label>
    <label class="btn ghost">🖼️ Choose photo<input type="file" name="photo_gal" accept="image/*" hidden></label>
    <span class="photo-name muted small"></span></div>`;
}
function pickedFile(f) {
  const ins = f.querySelectorAll('input[type=file]');
  for (let i = 0; i < ins.length; i++) if (ins[i].files && ins[i].files[0]) return ins[i].files[0];
  return null;
}
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t || t.type !== 'file' || !t.closest('.photo-field')) return;
  const box = t.closest('.photo-field'), file = t.files[0];
  box.querySelectorAll('input[type=file]').forEach((x) => { if (x !== t) x.value = ''; }); // only one source at a time
  const nm = box.querySelector('.photo-name'); if (nm) nm.textContent = file ? '✓ ' + file.name : '';
  if (file && file.type.indexOf('image') === 0) {
    let img = box.querySelector('.photo-prev');
    if (!img) { img = document.createElement('img'); img.className = 'photo-prev'; img.alt = ''; box.insertBefore(img, box.querySelector('.photo-btns')); }
    img.src = URL.createObjectURL(file);
    const pf = box.closest('#pf');
    if (cfg.AI_ENABLED && pf && !pf.dataset.id) aiIdentify(true); // new plant: auto-fill from the photo
  }
});
