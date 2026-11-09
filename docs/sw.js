/* 離線可用：程式和開獎資料「先上網抓最新的」，3 秒抓不到才用手機裡的備份 */
const VER = 'lotto-1';
const FILES = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png',
  'data/draws.json', 'data/analysis.json', 'data/live.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.open(VER).then(async c => {
    const key = new Request(u.origin + u.pathname);
    const hit = await c.match(key);
    const net = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(key, r.clone()); return r; });
    if (!hit) return net;
    const timeout = new Promise(ok => setTimeout(() => ok(hit), 3000));
    return Promise.race([net.catch(() => hit), timeout]);
  }));
});
