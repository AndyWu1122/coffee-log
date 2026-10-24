// 進入點 + hash 路由
import { esc } from './views/ui.js';

// 各 view 用動態 import 延遲載入；每個 view 匯出 render(container, params)
const routes = [
  { pattern: /^\/$/, tab: 'brews', load: () => import('./views/brewList.js') },
  { pattern: /^\/brew\/new$/, tab: 'brews', load: () => import('./views/brewForm.js') },
  { pattern: /^\/brew\/([\w-]+)$/, tab: 'brews', load: () => import('./views/brewForm.js') },
  { pattern: /^\/brew\/([\w-]+)\/share$/, tab: 'brews', load: () => import('./views/shareCard.js') },
  { pattern: /^\/beans$/, tab: 'beans', load: () => import('./views/beanList.js') },
  { pattern: /^\/beans\/new$/, tab: 'beans', load: () => import('./views/beanForm.js') },
  { pattern: /^\/beans\/([\w-]+)$/, tab: 'beans', load: () => import('./views/beanForm.js') },
  // ☰ 選單裡的頁面：不屬於任何底部分頁（tab: null）
  { pattern: /^\/backup$/, tab: null, load: () => import('./views/backup.js') },
  { pattern: /^\/grinders$/, tab: null, load: () => import('./views/grinderList.js') },
  { pattern: /^\/grinders\/new$/, tab: null, load: () => import('./views/grinderForm.js') },
  { pattern: /^\/grinders\/([\w-]+)$/, tab: null, load: () => import('./views/grinderForm.js') },
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
    a.classList.toggle('active', route.tab !== null && a.dataset.tab === route.tab);
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

/* ===== 右上角 ☰ 選單 ===== */

function setupMenu() {
  const btn = document.getElementById('menu-btn');
  const list = document.getElementById('app-menu');
  const setOpen = (open) => {
    list.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };
  const isOpen = () => !list.hidden;

  btn.addEventListener('click', () => {
    setOpen(!isOpen());
    if (isOpen()) list.querySelector('[role="menuitem"]')?.focus();
  });
  // 點選單項目、點選單外面、按 Esc、換頁都關閉
  list.addEventListener('click', (e) => { if (e.target.closest('[role="menuitem"]')) setOpen(false); });
  document.addEventListener('click', (e) => {
    if (isOpen() && !e.target.closest('.menu')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      setOpen(false);
      btn.focus();
    }
  });
  window.addEventListener('hashchange', () => setOpen(false));
}

/* ===== 外觀：自動（跟系統）／淺色／深色 ===== */
// 第一次套用在 index.html <head>（避免閃爍）；這裡負責切換，判斷方式要和 <head> 那段一致

function setupTheme() {
  const systemLight = matchMedia('(prefers-color-scheme: light)');
  const readPref = () => { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } };
  const savePref = (pref) => { try { localStorage.setItem('theme', pref); } catch { /* 無痕模式等：只在這次有效 */ } };
  let pref = readPref();

  const apply = () => {
    const light = pref === 'light' || (pref === 'auto' && systemLight.matches);
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    document.querySelector('meta[name="theme-color"]').content = light ? '#ffffff' : '#2b1d14';
    for (const btn of document.querySelectorAll('[data-theme-pref]')) {
      btn.setAttribute('aria-checked', String(btn.dataset.themePref === pref));
    }
  };

  document.querySelector('.theme-options').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme-pref]');
    if (!btn) return;
    pref = btn.dataset.themePref;
    savePref(pref);
    apply();
  });
  // 「自動」時，系統切換深淺色要即時跟上
  systemLight.addEventListener('change', () => { if (pref === 'auto') apply(); });
  apply();
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
setupMenu();
setupTheme();
setupServiceWorker();
// 申請持久儲存，降低瀏覽器（特別是 iOS）自動清除資料的機會
navigator.storage?.persist?.().catch(() => {});
