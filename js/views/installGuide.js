// 安裝 App 的教學（把咖啡紀錄加到主畫面）：畫面變暗、中央一張說明卡片；不是路由
// 教學順序：安裝 → 新手教學（tour.js）。app.js 在首頁第一次打開、不是從主畫面開啟時先顯示這個；
// ☰ →「📲 安裝 App」、首頁的小提示可以隨時重看（manual：不讀寫「看過了」）
// 依裝置顯示不同內容（models.installPlatform）；認不出來、或按「不是這個裝置？」時讓使用者自己選
// 圖解是自己畫的 SVG（不用截圖，才不會和系統版本對不上）；顏色只用主題變數
import {
  socialAvailable, getInstallInfo, canPromptInstall, promptInstall, INSTALL_PROMPT_EVENT, INSTALL_CHOICES, isStandalone,
} from '../models.js';
import { esc, toast } from './ui.js';
import { exportBackup, errorReason } from './backup.js';

/* ===== 圖解 ===== */

const ICONS = {
  // 分享：方框＋往上的箭頭
  share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M7 11H6a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1"/>',
  // 加入主畫面：方框＋加號
  add: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>',
  // ⋮
  dotsV: '<circle cx="12" cy="5.5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="18.5" r="1.4" fill="currentColor"/>',
  // ⋯
  dotsH: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
  // 安裝：螢幕＋往下的箭頭
  install: '<path d="M9 5H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3M8 20h8M12 16v4"/><path d="M16 3v7M13 7.5l3 3 3-3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  browser: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17"/>',
};
const icon = (name) =>
  `<svg class="install-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

/**
 * 「按鈕在哪裡」的示意圖：一支手機（或平板、電腦視窗）的上半或下半，要按的按鈕用強調色圈起來
 * where：'bottom'（iPhone Safari：下方工具列中間）｜'top'（右上角）；wide：平板、電腦（比較寬）
 */
function deviceArt({ where, name, wide = false, label }) {
  const w = wide ? 220 : 150;
  const x0 = (240 - w) / 2;
  const bottom = where === 'bottom';
  const barY = bottom ? 70 : 22;
  const cx = bottom ? 120 : x0 + w - 24;
  const cy = barY + 14;
  // 裝置外框只畫靠近按鈕的那一半，另一邊淡出（虛線）
  const frame = bottom
    ? `<path class="art-frame" d="M${x0} 8V92a14 14 0 0 0 14 14H${x0 + w - 14}a14 14 0 0 0 14-14V8"/>`
    : `<path class="art-frame" d="M${x0} 106V22a14 14 0 0 1 14-14H${x0 + w - 14}a14 14 0 0 1 14 14V106"/>`;
  const others = bottom
    ? [-48, -24, 24, 48].map((dx) => `<circle class="art-dot" cx="${120 + dx}" cy="${cy}" r="3"/>`).join('')
    : `<rect class="art-url" x="${x0 + 14}" y="${cy - 8}" width="${w - 62}" height="16" rx="8"/>`;
  return `<svg class="install-art" viewBox="0 0 240 114" role="img" aria-label="${esc(label)}">
    ${frame}
    <rect class="art-bar" x="${x0 + 5}" y="${barY}" width="${w - 10}" height="28" rx="9"/>
    ${others}
    <circle class="art-ring" cx="${cx}" cy="${cy}" r="17"/>
    <g class="art-icon" transform="translate(${cx - 11} ${cy - 11}) scale(0.92)">${ICONS[name]}</g>
    ${bottom
      ? `<path class="art-arrow" d="M${cx} 36v14M${cx - 6} 44l6 7 6-7"/>`
      : `<path class="art-arrow" d="M${cx - 34} ${cy + 40}l14-14M${cx - 30} ${cy + 25}h11v11"/>`}
  </svg>`;
}

const steps = (items) => `<ol class="install-steps">${items.map(([name, html]) =>
  `<li>${icon(name)}<span>${html}</span></li>`).join('')}</ol>`;

/* ===== 每種裝置的內容 ===== */

const BENEFITS = `安裝後：沒有網路也能用、全螢幕${socialAvailable ? '、收得到通知' : ''}，資料也比較不會被清掉。`;
const COPY_BTN = '<button type="button" class="btn btn-block" data-act="copy">複製網址</button>';
const INSTALL_BTN = '<button type="button" class="btn btn-primary btn-block install-big" data-act="install">📲 安裝</button>';

/** → { title, html }（html 是 App 自己的固定文字，沒有使用者輸入） */
function content(platform, { canPrompt }) {
  const { kind, tablet, oldIos } = platform;

  if (kind === 'in-app') {
    return {
      title: '請改用瀏覽器開啟',
      html: `<p>這裡是 LINE、IG、FB 這類 App 裡面的瀏覽器：<strong>不能安裝，資料也可能消失</strong>。</p>
        ${deviceArt({ where: 'top', name: 'dotsH', label: '右上角的選單按鈕' })}
        ${steps([
          ['dotsH', '按<strong>右上角</strong>的 ⋯ 或 ⋮'],
          ['browser', '選「用預設瀏覽器開啟」或「在瀏覽器中開啟」'],
        ])}
        <p class="hint">找不到的話，複製網址貼到 Safari 或 Chrome。</p>
        ${COPY_BTN}`,
    };
  }

  if (kind === 'ios-other' && oldIos) {
    return {
      title: '請改用 Safari 開啟',
      html: `<p>這支 iPhone 的系統比較舊，這個瀏覽器不能加入主畫面。</p>
        <p>複製網址，貼到 <strong>Safari</strong> 開啟，再照畫面上的步驟安裝。</p>
        ${COPY_BTN}`,
    };
  }

  if (kind === 'ios-safari' || kind === 'ios-other') {
    const safari = kind === 'ios-safari';
    const top = tablet || !safari;
    return {
      title: '把咖啡紀錄加到主畫面',
      html: `${deviceArt({
        where: top ? 'top' : 'bottom', name: 'share', wide: tablet,
        label: top ? '分享按鈕在右上角' : '分享按鈕在畫面下方中間',
      })}
        ${steps([
          ['share', `按${top ? (safari ? '<strong>右上角</strong>' : '<strong>網址列右邊</strong>') : '<strong>下方</strong>'}的分享按鈕${safari && !tablet ? '<br><small>找不到？先按 ⋯</small>' : ''}`],
          ['add', '往下滑，按「<strong>加入主畫面</strong>」'],
          ['check', '按右上角「<strong>新增</strong>」'],
        ])}
        <p class="hint">${BENEFITS}</p>
        <p class="hint">主畫面的 App 和${safari ? ' Safari ' : '瀏覽器'}的資料、登入是<strong>分開的</strong>，之後請都從主畫面打開。</p>
        ${safari ? '' : `<p class="hint">找不到「加入主畫面」？複製網址，改用 Safari 開啟。</p>${COPY_BTN}`}`,
    };
  }

  if (kind === 'android') {
    return {
      title: '把咖啡紀錄裝到手機',
      html: canPrompt
        ? `<p>按下面的按鈕，再按「<strong>安裝</strong>」。</p>
           ${INSTALL_BTN}
           <p class="hint">${BENEFITS}</p>`
        : `${deviceArt({ where: 'top', name: 'dotsV', wide: tablet, label: '選單按鈕在右上角' })}
           ${steps([
             ['dotsV', '按<strong>右上角</strong>的 ⋮'],
             ['install', '按「<strong>安裝應用程式</strong>」或「<strong>加到主畫面</strong>」'],
             ['check', '按「<strong>安裝</strong>」'],
           ])}
           <p class="hint">${BENEFITS}</p>`,
    };
  }

  if (kind === 'desktop-chromium') {
    return {
      title: '把咖啡紀錄裝到電腦',
      html: `${canPrompt ? INSTALL_BTN : ''}
        ${deviceArt({ where: 'top', name: 'install', wide: true, label: '安裝圖示在網址列右邊' })}
        ${steps([
          ['install', `${canPrompt ? '或是按' : '按'}<strong>網址列右邊</strong>的安裝圖示`],
          ['check', '按「<strong>安裝</strong>」'],
        ])}
        <p class="hint">${BENEFITS}</p>`,
    };
  }

  // 電腦的其他瀏覽器（或使用者自己選了「電腦」）
  return {
    title: '把咖啡紀錄裝到電腦',
    html: `<p>用 <strong>Chrome</strong> 或 <strong>Edge</strong> 開啟這個網址，網址列右邊會出現安裝圖示。</p>
      ${deviceArt({ where: 'top', name: 'install', wide: true, label: '安裝圖示在網址列右邊' })}
      <p class="hint">Mac 的 Safari：選單列「檔案」→「加入 Dock」。</p>
      <p class="hint">${BENEFITS}</p>
      ${COPY_BTN}`,
  };
}

/** 先備份再安裝：瀏覽器裡已經有紀錄，而安裝後（iPhone 的主畫面、改用別的瀏覽器）是另一份資料 */
const backupContent = (inApp) => ({
  title: '先備份，再安裝',
  html: `<p>${inApp ? '改用瀏覽器開啟後' : '主畫面的 App '}是<strong>另一份資料</strong>，這裡的紀錄不會自己跟過去。</p>
    ${steps([
      ['share', '先在這裡<strong>匯出備份</strong>'],
      ['install', '照下一頁的步驟安裝'],
      ['check', '在新的 App 按 ☰ →「<strong>備份</strong>」→ 匯入'],
    ])}
    <button type="button" class="btn btn-primary btn-block install-big" data-act="backup">${inApp ? '去備份' : '立即匯出備份'}</button>
    <button type="button" class="btn btn-block" data-act="continue">下一步</button>`,
});

const pickContent = () => ({
  title: '你用的是哪一種裝置？',
  html: `<div class="install-pick">${INSTALL_CHOICES.map((c) =>
    `<button type="button" class="btn" data-act="pick" data-value="${esc(c.value)}">${esc(c.label)}</button>`).join('')}</div>`,
});

const doneContent = () => ({
  title: '安裝完成 🎉',
  html: `<p>請從<strong>主畫面</strong>打開「咖啡紀錄」。</p>
    <button type="button" class="btn btn-primary btn-block install-big" data-act="done">好</button>`,
});

/** 這個 App 的網址（不含 #、?） */
const appUrl = () => `${location.origin}${location.pathname}`;

let running = null;

/**
 * 顯示安裝教學（同一時間只會有一個）→ Promise<'installed' | 'later' | 'skip'>
 * manual：使用者自己打開的（☰、首頁的提示）：只有「關閉」，結果由呼叫的人決定要不要記
 * returnFocus：結束後焦點回到哪裡
 */
export function startInstallGuide({ manual = false, returnFocus = null } = {}) {
  if (running) return running;
  running = show({ manual, returnFocus }).finally(() => { running = null; });
  return running;
}

async function show({ manual, returnFocus }) {
  const previous = returnFocus ?? document.activeElement;
  const info = await getInstallInfo();
  let platform = info.platform;
  // 先備份：iPhone／iPad（主畫面是另一份資料）和 App 內建的瀏覽器（換瀏覽器也是另一份）
  const needsBackup = info.hasData && (platform.kind === 'in-app' || platform.kind.startsWith('ios-'));
  let screen = needsBackup ? 'backup' : platform.kind === 'unknown' ? 'pick' : 'main';

  // 開始前先關掉 ☰ 選單
  document.getElementById('app-menu').hidden = true;
  document.getElementById('menu-btn').setAttribute('aria-expanded', 'false');

  const root = document.createElement('div');
  root.className = 'tour tour-center install-guide';
  root.innerHTML = `
    <div class="tour-blocker"></div>
    <div class="tour-card install-card" role="dialog" aria-modal="true" aria-labelledby="install-title">
      <h2 class="tour-title install-title" id="install-title" tabindex="-1"></h2>
      <div class="install-body" id="install-body"></div>
      <button type="button" class="link-btn install-other" data-act="other">不是這個裝置？</button>
      <div class="tour-actions install-actions">
        ${manual
          ? '<button type="button" class="btn" data-act="later">關閉</button>'
          : `<button type="button" class="btn tour-skip" data-act="skip">略過</button>
             <button type="button" class="btn" data-act="later">稍後</button>`}
      </div>
    </div>`;
  document.body.append(root);
  const card = root.querySelector('.install-card');

  function render({ focus = true } = {}) {
    const c = screen === 'backup' ? backupContent(platform.kind === 'in-app')
      : screen === 'pick' ? pickContent()
        : screen === 'done' ? doneContent()
          : content(platform, { canPrompt: canPromptInstall() });
    root.dataset.screen = screen;
    root.dataset.kind = platform.kind;
    card.querySelector('#install-title').textContent = c.title;
    card.querySelector('#install-body').innerHTML = c.html;
    card.querySelector('[data-act="other"]').hidden = screen !== 'main';
    card.querySelector('.install-actions').hidden = screen === 'done';
    card.scrollTop = 0;
    // 焦點放在標題（讀螢幕的人從頭聽起；也不會一打開就停在「略過」上）
    if (focus) card.querySelector('#install-title').focus({ preventScroll: true });
  }

  return new Promise((resolve) => {
    function end(result, after) {
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('focusin', onFocusin);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener(INSTALL_PROMPT_EVENT, onPromptChange);
      standaloneQuery.removeEventListener('change', onStandalone);
      root.remove();
      if (after) after();
      else if (previous?.isConnected) previous.focus?.({ preventScroll: true });
      resolve(result);
    }

    /* 鍵盤：焦點留在卡片裡、Esc＝稍後 */
    function onKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        end(screen === 'done' ? 'installed' : 'later');
      } else if (e.key === 'Tab') {
        const items = [...card.querySelectorAll('button')].filter((b) => !b.closest('[hidden]'));
        const pos = items.indexOf(document.activeElement);
        const next = e.shiftKey ? (pos <= 0 ? items.length - 1 : pos - 1) : (pos === items.length - 1 ? 0 : pos + 1);
        e.preventDefault();
        items[next]?.focus();
      }
    }
    const onFocusin = (e) => {
      if (!card.contains(e.target)) card.querySelector('#install-title').focus({ preventScroll: true });
    };
    // 系統說裝好了（Android、電腦）：換成「安裝完成」
    const onInstalled = () => { screen = 'done'; render(); };
    // 教學開著的時候瀏覽器才說可以安裝（或不行了）：換成有／沒有「安裝」按鈕的內容
    const onPromptChange = () => { if (screen === 'main') render({ focus: false }); };
    // 電腦：安裝後這個分頁直接變成 App 的視窗 → 不用再請他「從主畫面打開」
    const standaloneQuery = matchMedia('(display-mode: standalone)');
    const onStandalone = () => { if (isStandalone()) end('installed'); };

    card.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-act]');
      const act = el?.dataset.act;
      if (act === 'later' || act === 'skip') end(act);
      else if (act === 'done') end('installed');
      else if (act === 'other') { screen = 'pick'; render(); }
      else if (act === 'pick') {
        platform = INSTALL_CHOICES.find((c) => c.value === el.dataset.value)?.platform ?? platform;
        screen = 'main';
        render();
      } else if (act === 'continue') { screen = 'main'; render(); }
      else if (act === 'install') {
        el.disabled = true;
        const outcome = await promptInstall(); // 按了「安裝」之後由 appinstalled 換成「安裝完成」
        if (outcome !== 'accepted' && root.isConnected && screen === 'main') render();
      } else if (act === 'copy') {
        try {
          await navigator.clipboard.writeText(appUrl());
          toast('已複製網址');
        } catch {
          // 不能用剪貼簿（內建瀏覽器常見）：把網址顯示出來讓他長按複製
          el.outerHTML = `<p class="install-url" id="install-url">${esc(appUrl())}</p><p class="hint">長按上面的網址複製。</p>`;
        }
      } else if (act === 'backup') {
        // App 內建的瀏覽器不能直接下載：到備份頁用「分享備份檔」（和首頁的備份提醒一樣）
        if (platform.kind === 'in-app') { end('later', () => { location.hash = '#/backup'; }); return; }
        el.disabled = true;
        try {
          await exportBackup();
        } catch (err) {
          console.error(err);
          toast(`匯出失敗：${errorReason(err)}`);
          el.disabled = false;
          return;
        }
        toast('已匯出備份');
        if (root.isConnected) { screen = 'main'; render(); }
      }
    });
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('focusin', onFocusin);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener(INSTALL_PROMPT_EVENT, onPromptChange);
    standaloneQuery.addEventListener('change', onStandalone);

    render();
  });
}
