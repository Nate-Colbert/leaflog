/* Leaflog: indoor plant tracker. Static front end + Supabase (database, auth, photo storage). */
import {
  S, ACTS, hooks, cfg, setClient, sb, recompute, loadAll, closeModal, resolvePending, fail,
} from './state.js';
import { $, esc } from './util.js';
import { viewHome, viewPlan } from './home.js';
import * as D from './detail.js';
import * as ST from './settings.js';
import { viewHub, hubOn, enterHub, startHub } from './hub.js';
import { viewInsights, drawCharts, destroyCharts, loadHeat } from './insights.js';

/* ---------------------------------------------------------------- render */

const TABS = [['home', '🪴', 'Plants'], ['plan', '🗓️', 'Plan'], ['insights', '📊', 'Insights'], ['settings', '⚙️', 'Settings']];

function render() {
  if (!S.session) return;
  const y = window.scrollY;
  recompute();
  destroyCharts();
  document.body.classList.toggle('hubmode', S.tab === 'hub');
  if (S.tab === 'hub') { $('#app').innerHTML = viewHub(); hooks.renderDetail(); return; }
  const view = S.tab === 'home' ? viewHome() : S.tab === 'plan' ? viewPlan() : S.tab === 'insights' ? viewInsights() : ST.viewSettings();
  const nav = TABS.map(([t, i, l]) => `<button class="${S.tab === t ? 'on' : ''}" data-act="tab" data-tab="${t}"><span>${i}</span>${l}</button>`).join('');
  $('#app').innerHTML = `<div class="wrap">${view}</div><nav class="nav"><div class="inner">${nav}</div></nav>` +
    (S.tab === 'home' && S.plants.length ? '<button class="fab" data-act="add-plant" aria-label="Add plant">+</button>' : '');
  if (S.tab === 'insights') drawCharts();
  if (S.tab === 'settings' && !S.push) ST.refreshPush().then(() => hooks.render());
  window.scrollTo(0, y);
  hooks.renderDetail();
}
hooks.render = render;

ACTS.tab = (t) => { S.tab = t.dataset.tab; render(); window.scrollTo(0, 0); };
ACTS['close-modal'] = () => closeModal();
ACTS['confirm-yes'] = () => resolvePending(true);

/* ----------------------------------------------------------------- boot */

function setupNeeded() {
  $('#app').innerHTML = `<div class="wrap"><div class="empty"><div class="big">🔧</div><h2>Almost there</h2>
    <p>Open <b>config.js</b> and paste in your Supabase project URL and key (the README explains where to find them).</p></div></div>`;
}

async function boot() {
  const bad = (v) => !v || /PASTE/i.test(v);
  if (bad(cfg.SUPABASE_URL) || bad(cfg.SUPABASE_ANON_KEY)) { setupNeeded(); return; }
  setClient(window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY));
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
  Object.assign(S, { rooms: [], plants: [], events: [], issues: [], urls: {}, urlsAt: 0, tab: 'home', filter: 'all', detail: null, push: null, heat: null });
  D.hideSheet(); closeModal();
}

async function start() {
  $('#app').innerHTML = '<div class="boot">🪴</div>';
  try { await loadAll(); } catch (e) { renderDbError(e); return; }
  if (hubOn()) { S.tab = 'hub'; startHub(); }
  render();
  loadHeat().then(render).catch(() => {});
  if (S.tab === 'hub') enterHub();
}

function renderDbError(e) {
  console.error(e);
  const schema = /schema cache|does not exist|relation|column/i.test(e.message || '');
  $('#app').innerHTML = `<div class="wrap"><div class="empty"><div class="big">🗄️</div><h2>${schema ? 'Database needs updating' : 'Could not load your data'}</h2>
    <p>${schema ? 'Open <b>schema.sql</b>, paste all of it into the Supabase <b>SQL Editor</b> and run it. It is safe to run again on top of what you already have.' : esc(e.message || String(e))}</p>
    <p class="muted small">${esc(e.message || '')}</p><button class="btn primary" onclick="location.reload()">Try again</button></div></div>`;
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

/* ------------------------------------------------------------ listeners */

document.addEventListener('click', (e) => {
  if (e.target.id === 'modal') { closeModal(); return; }
  const t = e.target.closest('[data-act]');
  if (!t) return;
  if (t.tagName === 'A') e.preventDefault();
  const fn = ACTS[t.dataset.act];
  if (fn) Promise.resolve().then(() => fn(t, e)).catch(fail);
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const run = (p) => Promise.resolve(p).catch(fail);
  if (f.id === 'lf') run(loginSubmit(f));
  else if (f.id === 'tf') resolvePending(new FormData(f).get('v'));
  else { const h = D.handleSubmit(f) || ST.handleSubmit(f); if (h) run(h); }
});

document.addEventListener('change', (e) => {
  D.handleChange(e);
  const r = ST.handleChange(e);
  if (r && r.catch) r.catch(fail);
});
document.addEventListener('input', (e) => D.handleInput(e));

window.addEventListener('popstate', () => { D.hideSheet(); closeModal(); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.session && sb && Date.now() - S.loadedAt > 60000 && $('#modal').hidden) {
    loadAll().then(render).catch(console.warn);
  }
});

boot();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
