// オフラインでも開けるようにするサービスワーカー
// 方針: ネットにつながる時は常に最新を取りに行き（更新がすぐ反映される）、つながらない時だけ保存済みを使う
const CACHE = 'genba-kanri-v12';
const APP_FILES = [
  './',
  'index.html',
  'style.css?v=12',
  'app.js?v=12',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit
          || caches.match(req, { ignoreSearch: true })
          || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
