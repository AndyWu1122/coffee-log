// Service Worker：安裝時預先快取所有檔案，之後一律從快取讀取（離線可用）
// ⚠ 修改任何前端檔案後，APP_VERSION 至少第三碼 +1，使用者才會收到新版本（規則見 CLAUDE.md「版本號」）
// 它也是「設定與關於」頁顯示的版本號、意見回饋附的版本（app.js 用 'version' 訊息詢問）
const APP_VERSION = '1.14.2';
const CACHE_NAME = `coffee-log-v${APP_VERSION}`;

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
  'js/changelog.js',
  'js/image.js',
  'js/cardLayout.js',
  'js/config.js',
  'js/cloud.js',
  'js/sync.js',
  'js/stats.js',
  'js/heatmap.js',
  'js/drippers.js',
  'js/id.js',
  'js/push.js',
  'js/vendor/supabase-js-2.117.3.js',
  'js/vendor/qrcode-generator-2.0.4.js',
  'js/views/ui.js',
  'js/views/settings.js',
  'js/views/flavorPicker.js',
  'js/views/brewList.js',
  'js/views/brewForm.js',
  'js/views/beanList.js',
  'js/views/beanForm.js',
  'js/views/backup.js',
  'js/views/shareCard.js',
  'js/views/grinderList.js',
  'js/views/grinderForm.js',
  'js/views/dripperList.js',
  'js/views/dripperForm.js',
  'js/views/account.js',
  'js/views/friends.js',
  'js/views/feed.js',
  'js/views/feedDetail.js',
  'js/views/comments.js',
  'js/views/profile.js',
  'js/views/stats.js',
  'js/views/privacy.js',
  'js/views/changelog.js',
  'js/views/admin.js',
  'js/views/feedback.js',
  'js/views/notifications.js',
  'js/views/tour.js',
  'js/views/heatmap.js',
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
  // ☰ 選單的版本號：回覆到頁面傳來的 MessagePort
  if (event.data === 'version') event.ports[0]?.postMessage(APP_VERSION);
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

/* ===== 推播通知（留言、回覆、好友新貼文、按讚） ===== */
// 內容由 Edge Function send-push 送來：{ v, kind, nickname, owner, brewId }，新貼文多 bean（豆子名稱），
// 新貼文與讚多 others（30 分鐘內合併了幾則）、quiet（安靜地取代舊的通知）；不含留言原文、筆記
// 只當成文字顯示；點擊後的網址由這裡用驗證過的 uuid 組出 App 內部的路由（不接受任何網址，不會跳到外部網站）

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IS_UUID = new RegExp(`^${UUID}$`);
// 和 models.js 的 isPushRoute 一致
const PUSH_ROUTE = new RegExp(`^#/social(/${UUID}/${UUID}(\\?comments=1)?)?$`);
const NICKNAME_MAX = 20;
const BEAN_MAX = 30;
const KINDS = ['comment', 'reply', 'post', 'like'];

/** 只當文字顯示：去掉控制字元與改變文字方向的字元（避免假冒內容），最多 max 字 */
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return [...value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').trim()].slice(0, max).join('');
}

/** 推播內容 → 要顯示的通知；格式不對時顯示通用的提示（iOS 規定每則推播都要顯示通知） */
function notificationFor(data) {
  const ok = data && IS_UUID.test(data.owner) && IS_UUID.test(data.brewId) && KINDS.includes(data.kind);
  if (!ok) return { body: '有新的留言', tag: 'comments', path: '#/social', quiet: false };
  const who = cleanText(data.nickname, NICKNAME_MAX) || '有人';
  const others = Number.isInteger(data.others) && data.others > 0 && data.others < 10000 ? data.others : 0;
  const post = `#/social/${data.owner}/${data.brewId}`;
  // 同一個 tag（和 send-push 的 Topic 相同）：新的通知取代舊的；合併在伺服器那邊判斷
  if (data.kind === 'post') {
    const bean = cleanText(data.bean, BEAN_MAX) || '咖啡';
    return {
      body: others ? `${who} 分享了 ${others + 1} 杯，最新：${bean}` : `${who} 分享了一杯 ${bean}`,
      tag: `friend:${data.owner}`, path: post, quiet: data.quiet === true,
    };
  }
  if (data.kind === 'like') {
    return {
      body: others ? `${who} 和其他 ${others} 人說你的貼文讚` : `${who} 說你的貼文讚`,
      tag: `like:${data.owner}/${data.brewId}`, path: post, quiet: data.quiet === true,
    };
  }
  return {
    body: data.kind === 'reply' ? `${who} 回覆了你的留言` : `${who} 留言了你的貼文`,
    tag: `post:${data.owner}/${data.brewId}`, path: `${post}?comments=1`, quiet: false,
  };
}

self.addEventListener('push', (event) => {
  let data = null;
  try { data = event.data?.json() ?? null; } catch { /* 不是 JSON：顯示通用的提示 */ }
  const n = notificationFor(data);
  // quiet：30 分鐘內合併的後續通知，只更新內容、不再響（iPhone 可能仍會響）
  event.waitUntil(self.registration.showNotification('咖啡紀錄', {
    body: n.body, tag: n.tag, renotify: !n.quiet, silent: n.quiet, icon: 'icons/icon-192.png', data: { path: n.path },
  }));
});

/** 打開 App 到 path：已經開著就在那個視窗換頁（不開新視窗），沒有才開新的 */
async function openApp(path) {
  if (!PUSH_ROUTE.test(path)) path = '#/social';
  const scope = self.registration.scope;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const app = windows.find((c) => c.url.startsWith(scope));
  if (app) {
    app.postMessage({ type: 'navigate', path });
    return app.focus().catch(() => app);
  }
  return self.clients.openWindow(new URL(path, scope).href);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openApp(event.notification.data?.path));
});
