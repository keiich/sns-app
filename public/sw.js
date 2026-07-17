// みんたつのサービスワーカー。
// 常にネットワーク優先(デプロイが即反映される)で、オフライン時だけキャッシュに落ちる。
// APIはキャッシュしない(タイムラインは常に最新を取りに行く)。
const CACHE_NAME = 'mintatsu-v1';
const STATIC_ASSETS = [
  '/',
  '/style.css',
  '/app.js',
  '/mascot.png',
  '/mouse-tatsu.png',
  '/mouse-min.png',
  '/mouse-tsu.png',
  '/icon.png',
  '/icon-192.png',
  '/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
