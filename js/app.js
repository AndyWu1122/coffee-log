// 進入點 + hash 路由
import { esc } from './views/ui.js';

// 各 view 用動態 import 延遲載入；每個 view 匯出 render(container, params)
const routes = [
  { pattern: /^\/$/, tab: 'brews', load: () => import('./views/brewList.js') },
  { pattern: /^\/brew\/new$/, tab: 'brews', load: () => import('./views/brewForm.js') },
  { pattern: /^\/brew\/([\w-]+)$/, tab: 'brews', load: () => import('./views/brewForm.js') },
  { pattern: /^\/beans$/, tab: 'beans', load: () => import('./views/beanList.js') },
  { pattern: /^\/beans\/new$/, tab: 'beans', load: () => import('./views/beanForm.js') },
  { pattern: /^\/beans\/([\w-]+)$/, tab: 'beans', load: () => import('./views/beanForm.js') },
  { pattern: /^\/backup$/, tab: 'backup', load: () => import('./views/backup.js') },
];

/** 解析 "#/brew/new?from=abc" → { path: '/brew/new', query: { from: 'abc' } } */
function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}

const container = document.getElementById('app');
let cleanup = null;
let navToken = 0;

async function navigate() {
  const token = ++navToken;
  const { path, query } = parseHash();

  let match = null;
  const route = routes.find((r) => (match = path.match(r.pattern)));
  if (!route) {
    location.replace('#/');
    return;
  }

  for (const a of document.querySelectorAll('.tabbar a')) {
    a.classList.toggle('active', a.dataset.tab === route.tab);
  }

  try {
    const view = await route.load();
    if (token !== navToken) return; // 載入期間使用者已切到別頁

    if (typeof cleanup === 'function') cleanup();
    cleanup = null;
    container.innerHTML = '';
    window.scrollTo(0, 0);

    const result = await view.render(container, { id: match[1] ?? null, query, isCurrent: () => token === navToken });
    if (token === navToken) cleanup = result ?? null;
  } catch (err) {
    console.error(err);
    if (token !== navToken) return;
    container.innerHTML = `<div class="empty"><p>發生錯誤：${esc(err.message)}</p><a class="btn" href="#/">回首頁</a></div>`;
  }
}

/* ===== PWA：Service Worker 與新版本提示 ===== */

function setupServiceWorker() {
  // 區網 http 等非 secure context 沒有 serviceWorker，直接略過
  if (!('serviceWorker' in navigator)) return;

  const banner = document.getElementById('update-banner');
  let waitingWorker = null;
  let updateRequested = false;

  const showUpdate = (worker) => {
    waitingWorker = worker;
    banner.hidden = false;
  };

  document.getElementById('update-btn').addEventListener('click', () => {
    updateRequested = true;
    waitingWorker?.postMessage('skipWaiting');
  });

  // 新版接手後才重新整理；第一次安裝時的接手不重新整理
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) location.reload();
  });

  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(worker);
      });
    });
    // 加到主畫面的 App 可能長時間不重開，切回前景時檢查更新
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch((err) => console.warn('Service Worker 註冊失敗', err));
}

window.addEventListener('hashchange', navigate);
navigate();
setupServiceWorker();
// 申請持久儲存，降低瀏覽器（特別是 iOS）自動清除資料的機會
navigator.storage?.persist?.().catch(() => {});
