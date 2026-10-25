// 進入點 + hash 路由
import { esc, toast, appVersion, BADGES_EVENT } from './views/ui.js';
import {
  socialAvailable, completeSignIn, requestSync, getSocialBadges, badgeText,
  getBackupStatus, getChangelogStatus, markChangelogSeen, isAdmin, isPushRoute,
} from './models.js';

// 各 view 用動態 import 延遲載入；每個 view 匯出 render(container, params)
const routes = [
  { pattern: /^\/$/, tab: 'brews', load: () => import('./views/brewList.js') },
  { pattern: /^\/brew\/new$/, tab: 'brews', load: () => import('./views/brewForm.js') },
  { pattern: /^\/brew\/([\w-]+)$/, tab: 'brews', load: () => import('./views/brewForm.js') },
  { pattern: /^\/brew\/([\w-]+)\/share$/, tab: 'brews', load: () => import('./views/shareCard.js') },
  { pattern: /^\/beans$/, tab: 'beans', load: () => import('./views/beanList.js') },
  { pattern: /^\/beans\/new$/, tab: 'beans', load: () => import('./views/beanForm.js') },
  { pattern: /^\/beans\/([\w-]+)$/, tab: 'beans', load: () => import('./views/beanForm.js') },
  // 社群：動態牆與紀錄的詳細頁（底部分頁，js/config.js 沒設定時不顯示）；#/social?mine=1 只看自己的
  { pattern: /^\/social$/, tab: 'social', load: () => import('./views/feed.js') },
  { pattern: /^\/social\/([\w-]+)\/([\w-]+)$/, tab: 'social', load: () => import('./views/feedDetail.js') },
  // 個人檔案（頭像、暱稱點過來；自己的從 ☰ →「帳號」進來）
  { pattern: /^\/user\/([\w-]+)$/, tab: 'social', load: () => import('./views/profile.js') },
  // ☰ 選單裡的頁面：不屬於任何底部分頁（tab: null）
  { pattern: /^\/stats$/, tab: null, load: () => import('./views/stats.js') },
  { pattern: /^\/backup$/, tab: null, load: () => import('./views/backup.js') },
  { pattern: /^\/privacy$/, tab: null, load: () => import('./views/privacy.js') },
  { pattern: /^\/changelog$/, tab: null, load: () => import('./views/changelog.js') },
  { pattern: /^\/grinders$/, tab: null, load: () => import('./views/grinderList.js') },
  { pattern: /^\/grinders\/new$/, tab: null, load: () => import('./views/grinderForm.js') },
  { pattern: /^\/grinders\/([\w-]+)$/, tab: null, load: () => import('./views/grinderForm.js') },
  { pattern: /^\/drippers$/, tab: null, load: () => import('./views/dripperList.js') },
  { pattern: /^\/drippers\/new$/, tab: null, load: () => import('./views/dripperForm.js') },
  { pattern: /^\/drippers\/([\w-]+)$/, tab: null, load: () => import('./views/dripperForm.js') },
  // 咖啡社群（js/config.js 沒設定時選單不顯示；直接輸入網址會顯示「沒有開放」）
  { pattern: /^\/account$/, tab: null, load: () => import('./views/account.js') },
  { pattern: /^\/friends(?:\/add)?$/, tab: null, load: () => import('./views/friends.js') },
  { pattern: /^\/feedback$/, tab: null, load: () => import('./views/feedback.js') },
  { pattern: /^\/notifications$/, tab: null, load: () => import('./views/notifications.js') },
  // 開發者後台（只有開發者看得到入口；權限在資料庫與 Edge Function 檢查）
  { pattern: /^\/admin$/, tab: null, load: () => import('./views/admin.js') },
  { pattern: /^\/admin\/user\/([\w-]+)$/, tab: null, load: () => import('./views/admin.js') },
  { pattern: /^\/admin\/post\/([\w-]+)\/([\w-]+)$/, tab: null, load: () => import('./views/admin.js') },
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

  // 1.1.0 以前的網址（#/feed、#/feed/<owner>/<id>）改名成 #/social
  if (/^\/feed(\/|$)/.test(path)) {
    location.replace(`#/social${path.slice('/feed'.length)}`);
    return;
  }

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

    const result = await view.render(container, {
      id: match[1] ?? null, params: match.slice(1), query, isCurrent: () => token === navToken,
    });
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

  // 社群項目（☰ 選單、底部分頁）只在有設定 Supabase 的環境顯示
  for (const el of document.querySelectorAll('[data-social]')) el.hidden = !socialAvailable;

  btn.addEventListener('click', () => {
    setOpen(!isOpen());
    if (isOpen()) list.querySelector('[role="menuitem"]:not([hidden])')?.focus();
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

  // ☰ 選單的版本號（sw.js 的 APP_VERSION，點了到更新內容）；問不到（更舊的 Service Worker 不會回覆）就維持隱藏
  const showVersion = async () => {
    const version = await appVersion();
    if (version == null) return;
    const el = document.getElementById('app-version');
    el.firstElementChild.textContent = `版本 ${version}`;
    el.hidden = false;
  };
  showVersion();

  const showUpdate = (worker) => {
    waitingWorker = worker;
    banner.hidden = false;
  };

  document.getElementById('update-btn').addEventListener('click', () => {
    updateRequested = true;
    waitingWorker?.postMessage('skipWaiting');
  });

  // 點推播通知時 App 已經開著：sw.js 叫這個視窗換到那篇貼文（不開新視窗）；只接受 App 內部的社群路由
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && isPushRoute(e.data.path)) location.hash = e.data.path;
  });

  // 新版接手後才重新整理；第一次安裝時的接手不重新整理
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) location.reload();
    else showVersion(); // 第一次安裝：剛接手，現在才問得到
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

/* ===== Google 登入完成回到 App ===== */
// 回來的網址是 <App>/?code=...（PKCE）或 ?error=...；換成 session 後清掉網址，改到帳號頁

async function start() {
  const params = new URLSearchParams(location.search);
  if (socialAvailable && (params.has('code') || params.has('error'))) {
    const result = await completeSignIn(location.search);
    history.replaceState(null, '', `${location.pathname}#/account`);
    toast(result.message);
  }
  window.addEventListener('hashchange', navigate);
  navigate();
  setupSync();
  setupBadges();
}

/* ===== 提示：☰ 選單的「!」、底部「社群」分頁的數字 ===== */
// ☰ 選單裡需要注意的那一項後面有「!」（強調色）：好友管理＝收到好友邀請、備份＝超過 14 天沒備份、更新內容＝還沒看過這一版的說明
// ☰ 按鈕上的「!」＝其中任何一項；備份、更新內容只看本機，沒有社群功能也會顯示
// 底部「社群」分頁的數字（--badge-new）：好友新貼文＋我貼文的新留言＋回覆我的，超過 99 顯示 99+，0 不顯示
// 時機和同步一樣（啟動、恢復網路、切回前景），另外 views 操作完會發出 BADGES_EVENT
// （推播通知只負責叫使用者回來；點通知打開 App 或切回前景時，這裡的數字跟著更新）

const MENU_ALERTS = {
  friends: { name: '好友管理', reason: '有新的好友邀請' },
  backup: { name: '備份', reason: '該備份了' },
  changelog: { name: '更新內容', reason: '有新版的更新內容' },
};

function setupBadges() {
  const menuBtn = document.getElementById('menu-btn');
  const menuBadge = document.getElementById('menu-badge');
  const socialTab = document.querySelector('.tabbar [data-tab="social"]');
  const socialBadge = document.getElementById('social-badge');
  const updatedBanner = document.getElementById('updated-banner');
  const alerts = { friends: false, backup: false, changelog: false };
  let version = null;

  const show = () => {
    for (const [key, { name, reason }] of Object.entries(MENU_ALERTS)) {
      const el = document.querySelector(`[data-alert="${key}"]`);
      el.hidden = !alerts[key];
      const item = el.closest('[role="menuitem"]');
      if (alerts[key]) item.setAttribute('aria-label', `${name}（${reason}）`);
      else item.removeAttribute('aria-label');
    }
    const reasons = Object.keys(MENU_ALERTS).filter((key) => alerts[key]).map((key) => MENU_ALERTS[key].reason);
    menuBadge.hidden = !reasons.length;
    menuBtn.setAttribute('aria-label', reasons.length ? `選單（${reasons.join('、')}）` : '選單');
    // 「已更新」的提示：在更新內容頁上就不用了
    updatedBanner.hidden = !alerts.changelog || parseHash().path === '/changelog';
    if (version) document.getElementById('updated-text').textContent = `已更新到 ${version}`;
  };

  let token = 0;
  const update = async () => {
    const t = ++token; // 連續觸發時只採用最後一次的結果
    try {
      version ??= await appVersion(); // 第一次安裝時 Service Worker 還沒接管，之後再問
      const [backup, changelog] = await Promise.all([getBackupStatus(), getChangelogStatus(version)]);
      if (t !== token) return;
      alerts.backup = backup.overdue;
      alerts.changelog = changelog.unseen;
    } catch (err) {
      console.warn('本機提示檢查失敗', err);
    }
    if (socialAvailable) {
      try {
        const [{ requests, count }, admin] = await Promise.all([getSocialBadges(), isAdmin()]);
        if (t !== token) return;
        for (const el of document.querySelectorAll('[data-admin]')) el.hidden = !admin; // ☰ 的「開發者後台」
        alerts.friends = requests;
        const text = badgeText(count);
        socialBadge.textContent = text;
        socialBadge.hidden = !text;
        socialTab.setAttribute('aria-label', text ? `社群（${text} 則新通知）` : '社群');
      } catch (err) {
        console.warn('社群提示檢查失敗', err); // 離線等：維持原本的顯示
      }
    }
    if (t === token) show();
  };

  document.getElementById('updated-close').addEventListener('click', async () => {
    updatedBanner.hidden = true;
    if (version) await markChangelogSeen(version);
    update();
  });
  window.addEventListener('hashchange', show);

  update();
  window.addEventListener(BADGES_EVENT, update);
  window.addEventListener('online', update);
  navigator.serviceWorker?.addEventListener('controllerchange', update);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') update();
  });
}

/* ===== 咖啡社群：分享給好友的紀錄在背景同步 ===== */
// 存檔、刪除、匯入時由 models.js 觸發；這裡補上啟動、恢復網路、切回前景（離線時改的紀錄會在這些時候送出）

function setupSync() {
  if (!socialAvailable) return;
  requestSync();
  window.addEventListener('online', requestSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestSync();
  });
}

start();
setupMenu();
setupTheme();
setupServiceWorker();
// 申請持久儲存，降低瀏覽器（特別是 iOS）自動清除資料的機會
navigator.storage?.persist?.().catch(() => {});
