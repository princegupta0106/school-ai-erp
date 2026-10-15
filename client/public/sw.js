// App-shell cache. The portal's own page and scripts open instantly from this device (even on a slow
// network) and quietly update in the background. API calls are NEVER handled here - live data always
// comes from the server (the in-app data cache, src/cache.js, deals with that).
const VERSION = 'sp-shell-v3';
const MAX_ASSETS = 60; // hashed build files from old deploys are trimmed past this

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((c) => c.add(new Request('/', { cache: 'reload' }))).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function shell(e) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match('/');
  const net = fetch(e.request).then((res) => { if (res.ok) cache.put('/', res.clone()); return res; });
  if (cached) { e.waitUntil(net.catch(() => {})); return cached; } // show now, refresh for next time
  return net.catch(() => new Response('You appear to be offline. Reconnect and reload.', { status: 503, headers: { 'Content-Type': 'text/plain' } }));
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    const keys = (await cache.keys()).filter((k) => new URL(k.url).pathname.startsWith('/assets/'));
    if (keys.length > MAX_ASSETS) await Promise.all(keys.slice(0, keys.length - MAX_ASSETS).map((k) => cache.delete(k)));
  }
  return res;
}

async function staleWhileRevalidate(e) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(e.request);
  const net = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname === '/sw.js') return;
  if (req.mode === 'navigate') return e.respondWith(shell(e));
  if (url.pathname.startsWith('/assets/')) return e.respondWith(cacheFirst(req)); // filenames contain a content hash
  return e.respondWith(staleWhileRevalidate(e));
});
