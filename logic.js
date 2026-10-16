/* Leaflog core logic: pure functions with no DOM or network access.
   The same file is used by the app and (copied in) by the morning-summary Edge Function. */

/* ------------------------------------------------------------------ dates */

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** day number (days since 1970-01-01) of a YYYY-MM-DD string */
export const dnum = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
export const fromDnum = (n) => { const d = new Date(n * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
/** weekday of a day number, 0 = Sunday */
export const dow = (n) => new Date(n * 864e5).getUTCDay();
export const monthOf = (n) => new Date(n * 864e5).getUTCMonth() + 1;
export const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** YYYY-MM-DD for an ISO timestamp, in a given IANA time zone (or the runtime's own zone) */
export function localDate(iso, tz) {
  const d = new Date(iso);
  if (tz) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); } catch (e) { /* fall through */ }
  }
  return ymd(d);
}

/* ---------------------------------------------------------------- seasons */

export const SEASONS = ['summer', 'autumn', 'winter', 'spring'];
export const DEFAULT_SEASON_FACTORS = { summer: 1, autumn: 1.15, winter: 1.4, spring: 1.1 };
export const FLEX_DAYS = { strict: 0, normal: 2, hardy: 4 };

export function seasonOf(dateStr, hemisphere = 'south') {
  const m = Number(dateStr.slice(5, 7));
  const s = m === 12 || m <= 2 ? 'summer' : m <= 5 ? 'autumn' : m <= 8 ? 'winter' : 'spring';
  if (hemisphere !== 'north') return s;
  return { summer: 'winter', autumn: 'spring', winter: 'summer', spring: 'autumn' }[s];
}

/** e.g. "Summer 2025/26" so a December-to-February season stays in one bucket */
export function seasonKey(dateStr, hemisphere = 'south') {
  const s = seasonOf(dateStr, hemisphere);
  const y = Number(dateStr.slice(0, 4)), m = Number(dateStr.slice(5, 7));
  const name = s[0].toUpperCase() + s.slice(1);
  const dec2feb = m === 12 || m <= 2;
  if (dec2feb) { const y0 = m === 12 ? y : y - 1; return `${name} ${y0}/${String(y0 + 1).slice(2)}`; }
  return `${name} ${y}`;
}

/** months in which feeding pauses (the cool months) */
export const feedPauseMonths = (hemisphere = 'south') => (hemisphere === 'north' ? [12, 1, 2] : [6, 7, 8]);

export const DEFAULT_SETTINGS = {
  water_days: [], hemisphere: 'south', season_adjust: false, season_factors: DEFAULT_SEASON_FACTORS,
  latitude: null, longitude: null, location_name: null, notify_hour: 7, timezone: null, last_notified_on: null,
};
export function normSettings(s) {
  const o = { ...DEFAULT_SETTINGS, ...(s || {}) };
  o.season_factors = { ...DEFAULT_SEASON_FACTORS, ...((s && s.season_factors) || {}) };
  o.water_days = Array.isArray(o.water_days) ? o.water_days.map(Number) : [];
  return o;
}

/* ------------------------------------------------------- learning rhythm */

const soilFactor = (soil) => (soil === 'wet' ? 1.25 : soil === 'damp' ? 1.1 : 1);

/** sorted [{d, soil, ml}] of one event type for one plant */
export function entriesOf(events, plantId, type) {
  return events
    .filter((e) => e.plant_id === plantId && e.type === type)
    .map((e) => ({ d: dnum(e.occurred_on), soil: e.soil, ml: e.amount_ml }))
    .sort((a, b) => a.d - b.d);
}

export function collectGaps(entries) {
  const gaps = [];
  for (let i = 1; i < entries.length; i++) {
    const g = entries[i].d - entries[i - 1].d;
    if (g >= 1) gaps.push({ g, soil: entries[i].soil, start: entries[i - 1].d, end: entries[i].d });
  }
  return gaps;
}
/** drop very long gaps (holidays) once there is enough history to tell */
export function filterOutliers(gaps) {
  if (gaps.length < 3) return gaps;
  const med = median(gaps.map((x) => x.g));
  return gaps.filter((x) => x.g <= med * 3);
}

/** Learn a plant's rhythm from its logged gaps.
    - Prefers gaps from the same season if there are at least 3 of them.
    - Otherwise uses the most recent gaps, optionally scaled between seasons (settings.season_adjust).
    - Recent gaps count more; "damp"/"wet" soil at watering stretches that gap (watered too soon).
    - Under 3 gaps it blends in your starting guess. */
export function learnInterval(entries, guess, refDay, settings) {
  const hemi = settings.hemisphere;
  const f = settings.season_adjust ? settings.season_factors : { summer: 1, autumn: 1, winter: 1, spring: 1 };
  const target = seasonOf(fromDnum(refDay), hemi);
  const gaps = filterOutliers(collectGaps(entries)).map((x) => ({ ...x, season: seasonOf(fromDnum(Math.round((x.start + x.end) / 2)), hemi) }));
  const same = gaps.filter((x) => x.season === target);
  let use, mode;
  if (same.length >= 3) { use = same.slice(-6).map((x) => x.g * soilFactor(x.soil)); mode = 'season'; }
  else { use = gaps.slice(-6).map((x) => x.g * soilFactor(x.soil) * (f[target] / f[x.season])); mode = 'recent'; }
  const n = use.length;
  let learned = null;
  if (n) { let sw = 0, sv = 0; use.forEach((v, i) => { sw += i + 1; sv += (i + 1) * v; }); learned = sv / sw; }
  let interval = guess;
  if (learned !== null) interval = n >= 3 ? learned : (learned * n + guess * (3 - n)) / 3;
  return { interval: Math.max(1, Math.round(interval)), n, learned: n >= 3, mode, season: target };
}

/* ---------------------------------------------- water-day snapping */

/** Move a due date forward (never earlier) onto the next water day, if that costs no more than the plant's
    flexibility. Otherwise the plant is watered on its own due day (or today if already overdue). */
export function snapForward(rawDue, today, flex, waterDays, allowedOverride) {
  const ok = allowedOverride ?? (FLEX_DAYS[flex || 'normal'] ?? 2);
  const start = Math.max(rawDue, today);
  if (!waterDays || !waterDays.length) return { day: start, delay: Math.max(0, start - rawDue), offDay: false, snapped: false };
  let d = start;
  for (let i = 0; i < 8 && !waterDays.includes(dow(d)); i++) d++;
  const delay = d - rawDue;
  if (delay <= ok) return { day: d, delay, offDay: false, snapped: true };
  return { day: start, delay: Math.max(0, start - rawDue), offDay: true, snapped: false };
}

export function waterStats(p, events, settings, today, tz) {
  const t = dnum(today);
  const ws = entriesOf(events, p.id, 'water');
  const last = ws.length ? ws[ws.length - 1].d : null;
  const L = learnInterval(ws, p.interval_days, (last ?? t) + p.interval_days, settings);
  const base = last ?? dnum(localDate(p.created_at, tz));
  const rawDue = base + L.interval;
  const sn = snapForward(rawDue, t, p.flex, settings.water_days);
  return {
    interval: L.interval, n: L.n, learned: L.learned, mode: L.mode, last, rawDue,
    due: sn.day, delay: sn.delay, offDay: sn.offDay, snapped: sn.snapped, days: sn.day - t, late: Math.max(0, t - rawDue),
    waterCount: ws.length, sinceLast: last === null ? null : t - last,
  };
}

/** the plant's upcoming watering days, assuming it is watered on each scheduled day */
export function projectWaters(p, wstat, settings, today, horizon = 150) {
  const t = dnum(today), out = [wstat.due];
  let cur = wstat.due;
  while (out.length < 60 && cur < t + horizon) {
    const raw = cur + wstat.interval;
    cur = snapForward(raw, raw, p.flex, settings.water_days).day;
    out.push(cur);
  }
  return out;
}

/* -------------------------------------------------------------- feeding */

function inPause(day, hemisphere) { return feedPauseMonths(hemisphere).includes(monthOf(day)); }
function afterPause(day, hemisphere) { let d = day; for (let i = 0; i < 120 && inPause(d, hemisphere); i++) d++; return d; }

/** Feeding rides along on the plant's watering day: it is never earlier than due, and lands on the first
    scheduled watering on or after the due date. Pauses through the cool months unless turned off. */
export function feedStats(p, events, settings, today, wstat, tz) {
  if (!p.fert_every_weeks) return null;
  const t = dnum(today);
  const fe = entriesOf(events, p.id, 'fertilise');
  const lastFeed = fe.length ? fe[fe.length - 1].d : null;
  let base = lastFeed;
  if (base === null) { const rp = entriesOf(events, p.id, 'repot'); base = rp.length ? rp[rp.length - 1].d : dnum(localDate(p.created_at, tz)); }
  let raw = base + p.fert_every_weeks * 7;
  const pause = p.fert_winter_pause !== false;
  if (pause) raw = afterPause(raw, settings.hemisphere);
  const waters = projectWaters(p, wstat, settings, today);
  const pick = (from) => waters.find((d) => d >= from);
  let day = pick(Math.max(raw, t)) ?? Math.max(raw, t);
  if (pause && inPause(day, settings.hemisphere)) { const r2 = afterPause(day, settings.hemisphere); day = pick(r2) ?? r2; }
  return { rawDue: raw, due: day, days: day - t, last: lastFeed, aligned: day !== raw, paused: pause && inPause(t, settings.hemisphere) };
}

/* ------------------------------------------------------------ moss pole */

export function poleStats(p, events, settings, today, tz) {
  if (!p.has_pole) return null;
  const t = dnum(today);
  const pe = entriesOf(events, p.id, 'pole');
  const last = pe.length ? pe[pe.length - 1].d : null;
  const L = learnInterval(pe, p.pole_every_days || 3, (last ?? t) + (p.pole_every_days || 3), settings);
  const base = last ?? dnum(localDate(p.created_at, tz));
  const rawDue = base + L.interval;
  const sn = snapForward(rawDue, t, p.flex, settings.water_days, 2);
  const recent = pe.filter((x) => x.ml).slice(-5).map((x) => x.ml);
  return { interval: L.interval, n: L.n, learned: L.learned, last, rawDue, due: sn.day, days: sn.day - t, late: Math.max(0, t - rawDue), offDay: sn.offDay, ml: recent.length ? Math.round(mean(recent)) : p.pole_ml || null, count: pe.length };
}
export function projectPole(p, pstat, settings, today, horizon = 30) {
  const t = dnum(today), out = [pstat.due];
  let cur = pstat.due;
  while (out.length < 30 && cur < t + horizon) { const raw = cur + pstat.interval; cur = snapForward(raw, raw, p.flex, settings.water_days, 2).day; out.push(cur); }
  return out;
}

/* ---------------------------------------------------------- the plan */

/** Everything due, by plant: { plant, w, f, pole }. Archived-like filtering is the caller's job. */
export function allStats(plants, events, settings, today, tz) {
  return plants.map((p) => {
    const w = waterStats(p, events, settings, today, tz);
    return { p, w, f: feedStats(p, events, settings, today, w, tz), pole: poleStats(p, events, settings, today, tz) };
  });
}

/** Flat task list for the next `days` days plus anything overdue.
    Each task: { day, plantId, kind: 'water'|'feed'|'pole', feed?: bool, projected: bool } */
export function buildPlan(stats, settings, today, days = 14) {
  const t = dnum(today), end = t + days, tasks = [];
  stats.forEach(({ p, w, f, pole }) => {
    const waters = projectWaters(p, w, settings, today, days + 2);
    waters.forEach((d, i) => {
      if (d > end) return;
      const withFeed = !!f && f.due === d && i >= 0;
      tasks.push({ day: d, plantId: p.id, kind: 'water', feed: withFeed, projected: i > 0, offDay: i === 0 && w.offDay });
    });
    if (f && f.due <= end && !waters.includes(f.due)) tasks.push({ day: f.due, plantId: p.id, kind: 'feed', projected: false });
    if (pole) projectPole(p, pole, settings, today, days + 2).forEach((d, i) => { if (d <= end) tasks.push({ day: d, plantId: p.id, kind: 'pole', ml: pole.ml, projected: i > 0 }); });
  });
  return tasks.sort((a, b) => a.day - b.day);
}
export const dueNow = (tasks, today) => tasks.filter((x) => !x.projected && x.day <= dnum(today));

/** Text for the morning notification */
/** Acclimatisation timer for a newly bought plant. null when none is set. */
export function acclimStats(p, today) {
  if (!p || !p.acclim_weeks) return null;
  const t = dnum(today), start = dnum(p.acclim_started_on || p.purchased_on || today), total = p.acclim_weeks * 7, end = start + total;
  const elapsed = Math.max(0, t - start), done = !!p.acclim_done_on;
  return { start, end, total, elapsed, left: end - t, week: Math.min(p.acclim_weeks, Math.floor(elapsed / 7) + 1), pct: Math.min(100, Math.round((elapsed / total) * 100)),
    done, ready: !done && t >= end, goal: p.acclim_for || 'both' };
}
export const ACCLIM_GOALS = { repot: 'repot it', pole: 'put it on a pole', both: 'repot it or put it on a pole' };

export function summarizeDue(stats, settings, today) {
  const tasks = dueNow(buildPlan(stats, settings, today, 0), today);
  const name = (id) => (stats.find((s) => s.p.id === id) || { p: { name: '?' } }).p.name;
  const water = tasks.filter((x) => x.kind === 'water').map((x) => ({ name: name(x.plantId), feed: x.feed }));
  const feed = tasks.filter((x) => x.kind === 'feed').map((x) => name(x.plantId));
  const pole = tasks.filter((x) => x.kind === 'pole').map((x) => name(x.plantId));
  const parts = [];
  if (water.length) parts.push(`Water: ${water.map((x) => x.name + (x.feed ? ' (+feed)' : '')).join(', ')}`);
  if (feed.length) parts.push(`Feed: ${feed.join(', ')}`);
  if (pole.length) parts.push(`Pole drip: ${pole.join(', ')}`);
  const acc = stats.map((x) => ({ p: x.p, a: acclimStats(x.p, today) })).filter((x) => x.a && x.a.ready);
  if (acc.length) parts.push(`Acclimated: ${acc.map((x) => x.p.name).join(', ')}`);
  const count = water.length + feed.length + pole.length + acc.length;
  return { count, water, feed, pole, title: count ? `🪴 ${count} plant job${count === 1 ? '' : 's'} today` : '🪴 Nothing due today', body: parts.join('\n') || 'All caught up.' };
}

/* ----------------------------------------------------------- analysis */

/** per plant, per season: mean gap between waterings */
export function seasonalIntervals(p, events, settings) {
  const gaps = filterOutliers(collectGaps(entriesOf(events, p.id, 'water')));
  const out = {};
  SEASONS.forEach((s) => { out[s] = { n: 0, mean: null }; });
  const by = {};
  gaps.forEach((x) => { const s = seasonOf(fromDnum(Math.round((x.start + x.end) / 2)), settings.hemisphere); (by[s] = by[s] || []).push(x.g); });
  Object.entries(by).forEach(([s, a]) => { out[s] = { n: a.length, mean: mean(a) }; });
  return out;
}

/** "winter slowdown" suggestion from a plant's own data, or a typical figure while data is thin */
export function winterSuggestion(p, events, settings, currentInterval) {
  const si = seasonalIntervals(p, events, settings);
  const sum = si.summer, win = si.winter;
  const typical = settings.season_factors.winter;
  if (sum.n >= 2 && win.n >= 2) {
    const ratio = win.mean / sum.mean;
    if (ratio >= 1.2) return { kind: 'data', ratio, text: `Winter gaps run ${ratio.toFixed(1)}x summer's (${Math.round(sum.mean)}d to ${Math.round(win.mean)}d). Plan on about ${Math.round(win.mean)} days in winter.` };
    return { kind: 'data', ratio, text: 'No clear winter slowdown so far, so keep the same rhythm year-round.' };
  }
  return { kind: 'typical', ratio: typical, text: `Not enough winter data yet. Typically plants slow down about ${Math.round((typical - 1) * 100)}% in winter, roughly ${Math.round(currentInterval * typical)} days.` };
}

export function linreg(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
  if (!sxx || !syy) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r: sxy / Math.sqrt(sxx * syy), n };
}

/** One point per watering gap: how hot/dry the weather was during it vs how long the gap was.
    weather: { 'YYYY-MM-DD': { tmax, et0, rain } }. rel = gap / that plant's median gap. */
export function gapWeatherPoints(plants, events, weather) {
  const pts = [];
  plants.forEach((p) => {
    const gaps = filterOutliers(collectGaps(entriesOf(events, p.id, 'water')));
    if (gaps.length < 3) return;
    const med = median(gaps.map((x) => x.g));
    gaps.forEach((x) => {
      const days = [];
      for (let d = x.start + 1; d <= x.end; d++) { const w = weather[fromDnum(d)]; if (w && w.tmax != null) days.push(w); }
      if (days.length < Math.max(2, Math.ceil((x.end - x.start) * 0.8))) return;
      pts.push({
        plantId: p.id, name: p.name, g: x.g, rel: x.g / med, end: x.end,
        tmax: mean(days.map((w) => w.tmax)), et0: mean(days.filter((w) => w.et0 != null).map((w) => w.et0)),
        rain: days.reduce((s, w) => s + (w.rain || 0), 0),
      });
    });
  });
  return pts;
}

export function issueStats(issues, today) {
  const t = dnum(today);
  const resolved = issues.filter((i) => i.resolved_on);
  const days = (i) => Math.max(0, dnum(i.resolved_on) - dnum(i.started_on));
  const byKind = {};
  resolved.forEach((i) => { (byKind[i.kind] = byKind[i.kind] || []).push(days(i)); });
  return {
    ongoing: issues.filter((i) => !i.resolved_on).map((i) => ({ ...i, openDays: t - dnum(i.started_on) })),
    byKind: Object.entries(byKind).map(([kind, a]) => ({ kind, n: a.length, avg: mean(a) })).sort((a, b) => b.n - a.n),
    resolved: resolved.map((i) => ({ ...i, days: days(i) })),
  };
}
