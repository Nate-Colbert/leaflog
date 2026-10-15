/* Insights tab: charts, seasonal view, weather correlation, problems, pole water, collection. */
import * as L from './logic.js';
import { S, hooks } from './state.js';
import { $, esc, plural, TYPES, ISSUE_KINDS, PROP_STAGES, PROP_METHODS, LIGHT_LEVELS, monthLabel, fmtDate } from './util.js';

const charts = [];
export function destroyCharts() { while (charts.length) charts.pop().destroy(); }

function loadChartLib() {
  if (window.Chart) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}

function lastMonths(n) {
  const out = [], d = new Date();
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${x.getFullYear()}-${L.pad(x.getMonth() + 1)}`); }
  return out;
}

/* --------------------------------------------------------------- weather */

const WKEY = 'leaflog-weather-v1';
const cacheGet = (k, ttl) => { try { const j = JSON.parse(localStorage.getItem(WKEY + k.slice(0, 1))); if (j && j.k === k && Date.now() - j.t < ttl) return j.d; } catch (e) { /* none */ } return null; };
const cacheSet = (k, d) => { try { localStorage.setItem(WKEY + k.slice(0, 1), JSON.stringify({ k, t: Date.now(), d })); } catch (e) { /* ignore */ } };
hooks.clearWeather = () => { try { ['h', 'f', 'a'].forEach((c) => localStorage.removeItem(WKEY + c)); } catch (e) { /* ignore */ } S.heat = null; };

const DAILY = 'temperature_2m_max,et0_fao_evapotranspiration,precipitation_sum';
function fold(j, into) {
  const d = j && j.daily; if (!d || !d.time) return into;
  d.time.forEach((day, i) => { if (d.temperature_2m_max[i] != null && !into[day]) into[day] = { tmax: d.temperature_2m_max[i], et0: d.et0_fao_evapotranspiration && d.et0_fao_evapotranspiration[i], rain: d.precipitation_sum && d.precipitation_sum[i] }; });
  return into;
}

/** daily weather for the whole watering history: { 'YYYY-MM-DD': { tmax, et0, rain } } */
export async function loadWeather() {
  const { latitude: lat, longitude: lon } = S.settings;
  if (lat == null || lon == null) return null;
  const waters = S.events.filter((e) => e.type === 'water').map((e) => e.occurred_on).sort();
  if (!waters.length) return {};
  const start = L.fromDnum(L.dnum(waters[0]) - 1), end = L.fromDnum(L.dnum(S.today) - 1);
  const key = `a${lat},${lon},${start},${end}`;
  const hit = cacheGet(key, 6 * 3600e3); if (hit) return hit;
  const map = {};
  const [arch, fc] = await Promise.all([
    fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&daily=${DAILY}&timezone=auto`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${DAILY}&past_days=14&forecast_days=1&timezone=auto`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (!arch && !fc) throw new Error('Could not reach the weather service');
  fold(arch, map); fold(fc, map);
  cacheSet(key, map);
  return map;
}

/** hot/cool spell banner for the home screen (past 30 days vs the next 5) */
export async function loadHeat() {
  const { latitude: lat, longitude: lon } = S.settings;
  if (lat == null || lon == null) { S.heat = null; return; }
  const key = `h${lat},${lon},${S.today}`;
  let d = cacheGet(key, 3 * 3600e3);
  if (!d) {
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&past_days=30&forecast_days=6&timezone=auto`);
      if (!r.ok) return;
      d = await r.json(); cacheSet(key, d);
    } catch (e) { return; }
  }
  const t = d.daily && d.daily.time, v = d.daily && d.daily.temperature_2m_max; if (!t || !v) return;
  const i0 = t.indexOf(S.today); if (i0 < 7) return;
  const past = L.mean(v.slice(Math.max(0, i0 - 30), i0).filter((x) => x != null));
  const next = L.mean(v.slice(i0, i0 + 5).filter((x) => x != null));
  if (past == null || next == null) return;
  if (next >= past + 4 && next >= 28) S.heat = `🔥 Hot spell ahead: highs around ${Math.round(next)}° versus ${Math.round(past)}° lately. Check the soil a day early; plants may dry out faster.`;
  else if (next <= past - 6) S.heat = `❄️ Cooler spell ahead: highs around ${Math.round(next)}° versus ${Math.round(past)}° lately. Plants will likely drink more slowly, so wait for the soil to dry.`;
  else S.heat = null;
}
hooks.loadHeat = () => loadHeat().then(() => hooks.render && hooks.render());

/* ------------------------------------------------------------------ view */

function seasonalTable() {
  const plants = S.st.filter((x) => x.w.waterCount >= 3);
  if (!plants.length) return '<p class="muted">Log at least 3 waterings on a plant to see its seasonal rhythm.</p>';
  const rows = plants.map(({ p, w }) => {
    const si = L.seasonalIntervals(p, S.events, S.settings), sg = L.winterSuggestion(p, S.events, S.settings, w.interval);
    const max = Math.max(...L.SEASONS.map((s) => si[s].mean || 0), 1);
    return `<tr><td><b>${esc(p.name)}</b></td>${L.SEASONS.map((s) => `<td>${si[s].n ? `<div class="sbar"><i style="width:${(si[s].mean / max) * 100}%"></i></div><small>${si[s].mean.toFixed(1)}d <span class="muted">(${si[s].n})</span></small>` : '<small class="muted">no data</small>'}</td>`).join('')}</tr>
      <tr class="sug"><td colspan="5"><small>💡 ${esc(sg.text)}</small></td></tr>`;
  });
  return `<div class="tscroll"><table class="tbl"><thead><tr><th>Plant</th>${L.SEASONS.map((s) => `<th>${s[0].toUpperCase() + s.slice(1)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>
    <p class="muted small">Average days between waterings in each season (number of gaps in brackets). Holiday-length gaps are ignored.</p>`;
}

function problemsPanel() {
  const is = L.issueStats(S.issues, S.today);
  if (!S.issues.length) return '<p class="muted">No problems logged. Report pests or issues from a plant to start tracking how long they take to fix.</p>';
  const plantName = (id) => (S.plants.find((p) => p.id === id) || {}).name || '?';
  return `${is.ongoing.length ? `<p><b>${plural(is.ongoing.length, 'ongoing problem')}:</b> ${is.ongoing.map((i) => `${esc(plantName(i.plant_id))} (${esc(i.title)}, ${i.openDays}d)`).join(', ')}</p>` : '<p>✅ No ongoing problems.</p>'}
    ${is.byKind.length ? `<table class="tbl"><thead><tr><th>Type</th><th>Fixed</th><th>Avg days to fix</th></tr></thead><tbody>${is.byKind.map((k) => `<tr><td>${esc(ISSUE_KINDS[k.kind] || k.kind)}</td><td>${k.n}</td><td>${k.avg.toFixed(1)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${is.resolved.filter((i) => i.what_worked).length ? `<h3 class="sec-h">What worked</h3><ul class="plain">${is.resolved.filter((i) => i.what_worked).slice(0, 8).map((i) => `<li><b>${esc(i.title)}</b> on ${esc(plantName(i.plant_id))} · ${i.days}d: ${esc(i.what_worked)}</li>`).join('')}</ul>` : ''}`;
}

function polePanel() {
  const rows = S.st.filter((x) => x.pole).map(({ p, pole }) => {
    const ev = S.events.filter((e) => e.plant_id === p.id && e.type === 'pole');
    const t = L.dnum(S.today), recent = ev.filter((e) => t - L.dnum(e.occurred_on) <= 30);
    const ml30 = recent.reduce((s, e) => s + (e.amount_ml || 0), 0), withMl = ev.filter((e) => e.amount_ml);
    return { name: p.name, drips30: recent.length, ml30, avg: withMl.length ? Math.round(L.mean(withMl.map((e) => e.amount_ml))) : p.pole_ml, interval: pole.interval, perWeek: Math.round((ml30 / 30) * 7) };
  });
  if (!rows.length) return '<p class="muted">No plants with a moss pole yet. Tick "This plant has a moss pole" when editing a plant.</p>';
  return `<table class="tbl"><thead><tr><th>Plant</th><th>Avg per drip</th><th>Every</th><th>Last 30 days</th><th>Per week</th></tr></thead><tbody>${rows.map((r) =>
    `<tr><td><b>${esc(r.name)}</b></td><td>${r.avg ? r.avg + ' ml' : '–'}</td><td>${r.interval}d</td><td>${r.drips30} drips · ${r.ml30} ml</td><td>${r.perWeek} ml</td></tr>`).join('')}</tbody></table>
    <p class="muted small">Log the ml each time (the Pole drip button remembers your usual amount) to see how much water each pole really takes.</p>`;
}

function collectionPanel() {
  const ps = S.plants;
  const priced = ps.filter((p) => p.price != null), spent = priced.reduce((s, p) => s + Number(p.price), 0);
  const pots = ps.filter((p) => p.pot_size_cm != null);
  const byLight = {}; ps.forEach((p) => { if (p.light_level) byLight[p.light_level] = (byLight[p.light_level] || 0) + 1; });
  const lights = ps.filter((p) => p.grow_light).length, poles = ps.filter((p) => p.has_pole).length;
  const cuttings = ps.filter((p) => p.parent_id), byMethod = {};
  cuttings.forEach((p) => { const k = p.prop_method || 'other'; const o = byMethod[k] || { n: 0, ok: 0, failed: 0 }; o.n++; if (['potted', 'established'].includes(p.prop_stage)) o.ok++; if (p.prop_stage === 'failed') o.failed++; byMethod[k] = o; });
  return `<div class="kvs">
    <div class="kv"><span>Total spent</span><b>$${spent.toFixed(2)}${priced.length < ps.length ? ` (${priced.length} of ${ps.length} priced)` : ''}</b></div>
    ${priced.length ? `<div class="kv"><span>Average price</span><b>$${(spent / priced.length).toFixed(2)}</b></div>` : ''}
    ${pots.length ? `<div class="kv"><span>Average pot</span><b>${(L.mean(pots.map((p) => Number(p.pot_size_cm)))).toFixed(1)} cm</b></div>` : ''}
    <div class="kv"><span>Under grow lights</span><b>${lights}</b></div><div class="kv"><span>With moss poles</span><b>${poles}</b></div>
    ${Object.keys(byLight).length ? `<div class="kv"><span>Light levels</span><b>${Object.entries(byLight).map(([k, v]) => `${LIGHT_LEVELS[k]} ${v}`).join(' · ')}</b></div>` : ''}</div>
    ${cuttings.length ? `<h3 class="sec-h">Propagation</h3><table class="tbl"><thead><tr><th>Method</th><th>Cuttings</th><th>Potted / established</th><th>Failed</th></tr></thead><tbody>${Object.entries(byMethod).map(([k, v]) => `<tr><td>${esc(PROP_METHODS[k] || k)}</td><td>${v.n}</td><td>${v.ok}</td><td>${v.failed}</td></tr>`).join('')}</tbody></table>` : ''}`;
}

export function viewInsights() {
  const today = L.dnum(S.today), within = (e, d) => today - L.dnum(e.occurred_on) <= d;
  const w30 = S.events.filter((e) => e.type === 'water' && within(e, 30)).length;
  const leaves90 = S.events.filter((e) => e.type === 'new_leaf' && within(e, 90)).length;
  const head = '<div class="top"><div><h1>Insights</h1><p>Patterns across your plants</p></div></div>';
  if (!S.events.length) return head + '<div class="empty"><div class="big">📊</div><h2>No data yet</h2><p>Log a few waterings and growth events and your charts will appear here.</p></div>';
  const open = S.issues.filter((i) => !i.resolved_on).length;
  return head + `<div class="stats">
    <div class="stat"><b>${S.plants.length}</b><small>plants</small></div>
    <div class="stat"><b>${w30}</b><small>waterings, last 30 days</small></div>
    <div class="stat"><b>${leaves90}</b><small>new leaves, last 90 days</small></div>
    <div class="stat"><b>${open}</b><small>ongoing problems</small></div></div>
    <div class="charts">
      <div class="panel-card wide"><h2>Activity by month</h2><p>Everything you've logged over the last year.</p><div class="chart-box"><canvas id="c-month"></canvas></div></div>
      <div class="panel-card"><h2>New leaves by season</h2><p>Growth across all your plants.</p><div class="chart-box"><canvas id="c-leaf"></canvas></div></div>
      <div class="panel-card"><h2>Soil when you watered</h2><p>Mostly "wet" can mean watering too soon.</p><div class="chart-box"><canvas id="c-soil"></canvas></div></div>
      <div class="panel-card wide"><h2>Seasonal view</h2><p>How each plant's watering rhythm changes through the year, with a winter slowdown suggestion.</p>${seasonalTable()}
        <div class="chart-box" style="height:200px;margin-top:10px"><canvas id="c-season"></canvas></div></div>
      <div class="panel-card wide" id="weather-card"><h2>Weather and watering</h2><div id="weather-box">${S.settings.latitude != null ? '<p class="muted">Loading weather…</p>' : '<p class="muted">Set your location in Settings to compare watering gaps with the weather (hotter spells should mean shorter gaps).</p>'}</div>
        <div class="chart-box" id="wchart" style="display:none"><canvas id="c-weather"></canvas></div><div id="weather-plants"></div></div>
      <div class="panel-card"><h2>Thirst by room</h2><p>Waterings per plant, last 90 days.</p><div class="chart-box"><canvas id="c-room"></canvas></div></div>
      <div class="panel-card"><h2>Watering rhythm</h2><p>Days between waterings (learned, or your starting guess).</p><div class="chart-box" style="height:${Math.max(220, S.plants.length * 28 + 40)}px"><canvas id="c-int"></canvas></div></div>
      <div class="panel-card"><h2>Problems</h2>${problemsPanel()}</div>
      <div class="panel-card"><h2>Moss poles</h2>${polePanel()}</div>
      <div class="panel-card wide"><h2>Collection</h2>${collectionPanel()}</div>
    </div>`;
}

/* ---------------------------------------------------------------- charts */

export async function drawCharts() {
  destroyCharts();
  if (!S.events.length) return;
  try { await loadChartLib(); } catch (e) { const el = $('.charts'); if (el) el.innerHTML = '<p class="muted">Charts need an internet connection.</p>'; return; }
  if (S.tab !== 'insights') return;
  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue('--muted').trim(), grid = css.getPropertyValue('--border').trim(), accent = css.getPropertyValue('--accent').trim();
  Chart.defaults.color = muted; Chart.defaults.borderColor = grid;
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const mk = (id, conf) => { const el = document.getElementById(id); if (el) charts.push(new Chart(el, conf)); };
  const base = { responsive: true, maintainAspectRatio: false };
  const months = lastMonths(12);
  const countBy = (pred) => months.map((m) => S.events.filter((e) => pred(e) && e.occurred_on.slice(0, 7) === m).length);
  const hemi = S.settings.hemisphere;

  mk('c-month', { type: 'bar', data: { labels: months.map(monthLabel), datasets: Object.entries(TYPES).filter(([t]) => t !== 'pest').map(([t, v]) => ({ label: v.label, data: countBy((e) => e.type === t), backgroundColor: v.color, borderRadius: 3 })) },
    options: { ...base, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } } });

  // new leaves by season (chronological)
  const lb = new Map();
  S.events.filter((e) => e.type === 'new_leaf').forEach((e) => { const k = L.seasonKey(e.occurred_on, hemi); const o = lb.get(k) || { n: 0, d: e.occurred_on }; o.n++; if (e.occurred_on < o.d) o.d = e.occurred_on; lb.set(k, o); });
  const leafRows = [...lb.entries()].sort((a, b) => a[1].d.localeCompare(b[1].d)).slice(-8);
  mk('c-leaf', { type: 'bar', data: { labels: leafRows.map((r) => r[0]), datasets: [{ label: 'New leaves', data: leafRows.map((r) => r[1].n), backgroundColor: TYPES.new_leaf.color, borderRadius: 4 }] },
    options: { ...base, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } } });

  const soil = ['dry', 'damp', 'wet'].map((k) => S.events.filter((e) => e.type === 'water' && e.soil === k).length);
  if (soil.some(Boolean)) mk('c-soil', { type: 'doughnut', data: { labels: ['Dry', 'Damp', 'Wet'], datasets: [{ data: soil, backgroundColor: ['#c98a4b', '#4fa3d9', '#2b5fa8'], borderWidth: 0 }] }, options: { ...base, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } } });
  else { const el = document.getElementById('c-soil'); if (el) el.parentElement.innerHTML = '<p class="muted">Tap Dry / Damp / Wet after you water and this chart fills in.</p>'; }

  // average gap by season across all plants
  const seasonal = S.plants.map((p) => L.seasonalIntervals(p, S.events, S.settings));
  const avgBy = (s) => { const a = seasonal.map((x) => x[s].mean).filter((v) => v != null); return a.length ? +L.mean(a).toFixed(1) : null; };
  mk('c-season', { type: 'bar', data: { labels: L.SEASONS.map((s) => s[0].toUpperCase() + s.slice(1)), datasets: [{ label: 'Average days between waterings', data: L.SEASONS.map(avgBy), backgroundColor: ['#e6a23c', '#c2773a', '#5b8bd9', '#6cbf84'], borderRadius: 6 }] },
    options: { ...base, plugins: { legend: { display: false }, title: { display: true, text: 'Average days between waterings, all plants' } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } } });

  const today = L.dnum(S.today);
  const roomRows = [...S.rooms.map((r) => ({ name: r.name, plants: S.plants.filter((p) => p.room_id === r.id) })), { name: 'No room', plants: S.plants.filter((p) => !S.rooms.find((r) => r.id === p.room_id)) }].filter((r) => r.plants.length).map((r) => {
    const ids = new Set(r.plants.map((p) => p.id));
    const n = S.events.filter((e) => e.type === 'water' && ids.has(e.plant_id) && today - L.dnum(e.occurred_on) <= 90).length;
    return { name: r.name, v: +(n / r.plants.length).toFixed(1) };
  });
  mk('c-room', { type: 'bar', data: { labels: roomRows.map((r) => r.name), datasets: [{ label: 'Waterings per plant', data: roomRows.map((r) => r.v), backgroundColor: accent, borderRadius: 6 }] },
    options: { ...base, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } } });

  const ints = [...S.st].sort((a, b) => b.w.interval - a.w.interval);
  mk('c-int', { type: 'bar', data: { labels: ints.map((x) => x.p.name), datasets: [{ label: 'Days between waterings', data: ints.map((x) => x.w.interval), backgroundColor: ints.map((x) => (x.w.learned ? accent : muted + '88')), borderRadius: 6 }] },
    options: { ...base, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => (ints[c.dataIndex].w.learned ? 'learned from your data' : 'starting guess / still learning') } } }, scales: { y: { grid: { display: false } }, x: { beginAtZero: true } } } });

  drawWeather(accent, muted);
}

async function drawWeather(accent, muted) {
  const box = document.getElementById('weather-box'); if (!box || S.settings.latitude == null) return;
  let weather;
  try { weather = await loadWeather(); } catch (e) { box.innerHTML = `<p class="muted">⚠️ ${esc(e.message)}. Try again later.</p>`; return; }
  if (S.tab !== 'insights' || !document.getElementById('weather-box')) return;
  const pts = L.gapWeatherPoints(S.plants, S.events, weather || {});
  const loc = esc(S.settings.location_name || 'your location');
  if (pts.length < 8) { box.innerHTML = `<p class="muted">Not enough data yet for ${loc}. Leaflog needs about 8 watering gaps (from plants with 3+ waterings) that overlap the weather record. You have ${pts.length}.</p>`; return; }
  const reg = L.linreg(pts.map((p) => p.tmax), pts.map((p) => p.rel * 100));
  let msg;
  if (!reg || Math.abs(reg.r) < 0.2) msg = `No clear link between heat and watering gaps yet (correlation ${reg ? reg.r.toFixed(2) : 'n/a'}).`;
  else { const eff = reg.slope * 5; msg = `For every 5°C hotter during a gap, your watering gaps are about <b>${Math.abs(Math.round(eff))}% ${eff < 0 ? 'shorter' : 'longer'}</b> (correlation ${reg.r.toFixed(2)}, ${pts.length} gaps).`; }
  box.innerHTML = `<p>${msg}</p><p class="muted small">Each dot is one gap between waterings: average daily high during the gap (${loc}) against gap length as a % of that plant's usual gap. Weather from Open-Meteo.</p>`;
  const wc = document.getElementById('wchart'); if (wc) wc.style.display = 'block';
  const xs = pts.map((p) => p.tmax), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const el = document.getElementById('c-weather'); if (!el) return;
  charts.push(new Chart(el, { type: 'scatter', data: { datasets: [
    { label: 'Gaps', data: pts.map((p) => ({ x: +p.tmax.toFixed(1), y: Math.round(p.rel * 100), name: p.name, g: p.g })), backgroundColor: accent + 'aa', pointRadius: 4 },
    ...(reg ? [{ label: 'Trend', type: 'line', data: [{ x: x0, y: reg.intercept + reg.slope * x0 }, { x: x1, y: reg.intercept + reg.slope * x1 }], borderColor: '#d9801a', borderWidth: 2, pointRadius: 0 }] : []),
  ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => (c.raw.name ? `${c.raw.name}: ${c.raw.g}-day gap, ${c.raw.y}% of usual` : '') } } },
    scales: { x: { title: { display: true, text: 'Average daily high during the gap (°C)' } }, y: { title: { display: true, text: 'Gap length (% of usual)' } } } } }));
  // per-plant
  const rows = S.plants.map((p) => { const a = pts.filter((q) => q.plantId === p.id); const r = a.length >= 5 ? L.linreg(a.map((q) => q.tmax), a.map((q) => q.rel * 100)) : null; return r && { name: p.name, n: a.length, r: r.r, eff: r.slope * 5 }; }).filter(Boolean).sort((a, b) => a.r - b.r);
  const pp = document.getElementById('weather-plants');
  if (pp && rows.length) pp.innerHTML = `<h3 class="sec-h">Most weather-sensitive plants</h3><table class="tbl"><thead><tr><th>Plant</th><th>Gaps</th><th>Per +5°C</th><th>Correlation</th></tr></thead><tbody>${rows.slice(0, 8).map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${r.n}</td><td>${r.eff < 0 ? '' : '+'}${Math.round(r.eff)}%</td><td>${r.r.toFixed(2)}</td></tr>`).join('')}</tbody></table>`;
}
