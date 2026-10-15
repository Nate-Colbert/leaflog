/* Leaflog service worker: opens the app instantly, works offline-ish, and shows push notifications.
   Data always comes live from Supabase, so this only caches the app's own files and CDN libraries. */
const CACHE = 'leaflog-v3';
const SHELL = ['./', './index.html', './styles.css', './app.js', './logic.js', './util.js', './state.js', './home.js', './detail.js', './settings.js', './insights.js', './hub.js',
  './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Own files: network first (so updates show up), cached copy if offline.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }
  // Library scripts from the CDN: cached copy first, refreshed in the background.
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
  // Everything else (Supabase, weather, photos) goes straight to the network.
});

/* ---- push notifications (morning summary) ---- */
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'Leaflog', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Leaflog', {
    body: data.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'leaflog-daily', data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(e.notification.data.url || './');
  }));
});
