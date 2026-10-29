// オフラインでも開けるようにするサービスワーカー
// 方針: ネットにつながる時は常に最新を取りに行き（更新がすぐ反映される）、つながらない時だけ保存済みを使う
const CACHE = 'genba-kanri-v19';
const APP_FILES = [
  './',
  'index.html',
  'style.css?v=19',
  'app.js?v=19',
  'cloud.js?v=19',
  'docs.js?v=19',
  'vendor/firebase-10.14.1/firebase-app-compat.js',
  'vendor/firebase-10.14.1/firebase-firestore-compat.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/badge-96.png',
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

// 期限の通知（tools/notify から送られてくる）
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || '現場管理', {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png', // ステータスバー用（形だけ白く表示される）
    tag: data.tag,
    data: { url: data.url || './' },
  }));
});

// 通知を押したらアプリを開く（開いていればそれを前に出す）
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => w.url.startsWith(self.registration.scope));
      return win ? win.focus() : self.clients.openWindow(e.notification.data.url);
    })
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
