// Service Worker：安裝時預先快取所有檔案，之後一律從快取讀取（離線可用）
// ⚠ 修改任何前端檔案後，CACHE_VERSION 要 +1，使用者才會收到新版本
const CACHE_VERSION = 13;
const CACHE_NAME = `coffee-log-v${CACHE_VERSION}`;

const ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/app.js',
  'js/theme.js',
  'js/db.js',
  'js/models.js',
  'js/flavorWheel.js',
  'js/image.js',
  'js/cardLayout.js',
  'js/config.js',
  'js/cloud.js',
  'js/sync.js',
  'js/vendor/supabase-js-2.117.3.js',
  'js/vendor/qrcode-generator-2.0.4.js',
  'js/views/ui.js',
  'js/views/flavorPicker.js',
  'js/views/brewList.js',
  'js/views/brewForm.js',
  'js/views/beanList.js',
  'js/views/beanForm.js',
  'js/views/backup.js',
  'js/views/shareCard.js',
  'js/views/grinderList.js',
  'js/views/grinderForm.js',
  'js/views/account.js',
  'js/views/friends.js',
  'js/views/feed.js',
  'js/views/feedDetail.js',
  'js/views/privacy.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' 略過 HTTP 快取，確保拿到這一版的檔案
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE_NAME) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// 頁面上按「更新」時才切換到新版，避免填表單時被重新整理
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true })
      ?? (request.mode === 'navigate' ? await cache.match('index.html') : undefined);
    return cached ?? fetch(request);
  })());
});
