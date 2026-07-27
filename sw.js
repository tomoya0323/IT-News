/**
 * Service Worker — IT Info Hub
 * HTML/JSON: Network First（常に最新優先・オフライン時のみキャッシュ）
 * その他静的アセット: Cache First
 */

const CACHE_NAME = 'itinfohub-v4';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
];

// Install: precache core files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Precaching core assets');
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ネットワーク優先（成功時はキャッシュ更新、失敗時はキャッシュへフォールバック）
function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      }
      return response;
    })
    .catch(() => caches.match(request));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // HTML（ナビゲーション）と JSON/XML データは Network First
  // → フロント更新やデータ更新が即時反映される
  if (
    event.request.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.xml')
  ) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // 静的アセットは Cache First
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
