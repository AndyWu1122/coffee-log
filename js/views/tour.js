// 新手教學：在真實介面上逐步標示（畫面變暗、只亮出要介紹的按鈕，旁邊放說明卡片）
// 全新裝置第一次打開首頁時自動顯示一次（app.js 問 models.claimOnboarding）；☰ →「使用教學」可以重看，重看不讀寫任何設定
// ⚠ 新增主要功能時，想一下這裡的步驟要不要跟著改
import { socialAvailable } from '../models.js';

/**
 * target：要標示的元素（找不到、或被隱藏時改成畫面中央的卡片）
 * route：標示前先換到這一頁（只在按「下一步／上一步」時換頁）
 * when：false 的步驟不放進教學（進度跟著變少）
 */
const STEPS = [
  {
    id: 'welcome',
    title: '歡迎使用手沖紀錄 ☕',
    body: '記下每一杯的豆子、粉量、水溫、時間和風味，慢慢找出自己最喜歡的沖法。資料存在這支手機上，不用登入也能用。',
  },
  {
    id: 'beans',
    target: '.tabbar a[data-tab="beans"]',
    title: '先新增一支豆子',
    body: '到「豆子」分頁按右下角 ＋，填豆名、產地、處理法和烘焙日期。每一杯紀錄都會選一支豆子。',
  },
  {
    id: 'brew',
    target: '.fab[href="#/brew/new"]',
    route: '#/',
    title: '記錄一杯',
    body: '沖完咖啡按右下角 ＋。填好粉量和水量，粉水比、養豆天數會自動算出來，也可以拍一張照片。',
  },
  {
    id: 'menu',
    target: '#menu-btn',
    title: '☰ 選單',
    body: '磨豆機、濾杯、統計和備份都在這裡。先把常用的磨豆機、濾杯建好，記錄時就能直接選。',
  },
  {
    id: 'social',
    target: '.tabbar a[data-tab="social"]',
    when: () => socialAvailable,
    title: '咖啡社群',
    body: '登入後可以加好友，把紀錄分享給好友看，互相按讚、留言。紀錄預設只有自己看得到。',
  },
  {
    id: 'done',
    title: '記得定期備份',
    body: '資料只存在這支手機上，換手機或清除資料就會不見，記得到 ☰ →「備份」匯出檔案保存。想再看一次教學，在 ☰ →「使用教學」。',
  },
];

const WAIT_MS = 3000; // 換頁後等元素出現的上限，逾時就用中央卡片
const PAD = 4;        // 亮出來的範圍比元素大一點
const GAP = 12;       // 卡片和亮出來的範圍之間
const MARGIN = 16;    // 卡片離畫面邊緣

/** 看得到的元素（存在、沒有被 hidden、有大小） */
function visibleEl(selector) {
  const el = selector ? document.querySelector(selector) : null;
  return el && !el.closest('[hidden]') && el.getClientRects().length ? el : null;
}

/** 目前的路由（"#/?bean=x" → "#/"） */
const currentRoute = () => `#${location.hash.slice(1).split('?')[0] || '/'}`;

let running = false;

/**
 * 開始教學（同一時間只會有一個）
 * returnFocus：結束後焦點回到哪裡（沒給就回到開始前有焦點的元素）
 */
export function startTour({ returnFocus = null } = {}) {
  if (running) return;
  running = true;
  const steps = STEPS.filter((s) => s.when?.() ?? true);
  const previous = returnFocus ?? document.activeElement;

  // 開始前先關掉 ☰ 選單
  document.getElementById('app-menu').hidden = true;
  document.getElementById('menu-btn').setAttribute('aria-expanded', 'false');

  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = `
    <div class="tour-blocker"></div>
    <div class="tour-spot" hidden></div>
    <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      <p class="tour-progress" id="tour-progress"></p>
      <h2 class="tour-title" id="tour-title"></h2>
      <p class="tour-body" id="tour-body"></p>
      <button type="button" class="btn btn-primary btn-block" data-act="start" hidden>新增第一支豆子</button>
      <div class="tour-actions">
        <button type="button" class="btn tour-skip" data-act="skip">略過</button>
        <button type="button" class="btn" data-act="prev">上一步</button>
        <button type="button" class="btn btn-primary" data-act="next">下一步</button>
      </div>
    </div>`;
  document.body.append(root);
  const spot = root.querySelector('.tour-spot');
  const card = root.querySelector('.tour-card');
  const btn = (act) => card.querySelector(`[data-act="${act}"]`);

  let index = 0;
  let stopWaiting = null;

  /* ===== 位置：亮出 target、卡片放在上方或下方空間比較多的那邊 ===== */
  function place() {
    const step = steps[index];
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const width = Math.min(360, vw - MARGIN * 2);
    card.style.width = `${width}px`;
    card.style.maxHeight = `${vh - MARGIN * 2}px`;

    let target = visibleEl(step.target);
    if (target) {
      const r = target.getBoundingClientRect();
      if (r.top < 0 || r.bottom > vh) {
        target.scrollIntoView({ block: 'nearest' });
        target = visibleEl(step.target);
      }
    }
    root.classList.toggle('tour-center', !target);
    spot.hidden = !target;

    if (!target) {
      card.style.left = `${(vw - width) / 2}px`;
      card.style.top = `${Math.max(MARGIN, (vh - card.offsetHeight) / 2)}px`;
      return;
    }

    const r = target.getBoundingClientRect();
    // 亮出來的框不超出畫面（☰ 在最右上角）
    const box = {
      left: Math.max(2, r.left - PAD), top: Math.max(2, r.top - PAD),
      right: Math.min(vw - 2, r.right + PAD), bottom: Math.min(vh - 2, r.bottom + PAD),
    };
    Object.assign(spot.style, {
      left: `${box.left}px`, top: `${box.top}px`,
      width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px`,
      borderRadius: getComputedStyle(target).borderRadius === '50%' ? '50%' : '12px',
    });

    const h = card.offsetHeight; // 完整高度（maxHeight 是整個畫面）
    const clampX = (x) => Math.min(Math.max(MARGIN, x), vw - MARGIN - width);
    const clampY = (y) => Math.min(Math.max(MARGIN, y), vh - MARGIN - h);
    const above = box.top - GAP - MARGIN;
    const below = vh - box.bottom - GAP - MARGIN;
    const left = box.left - GAP - MARGIN;
    const right = vw - box.right - GAP - MARGIN;
    const middleY = clampY((box.top + box.bottom) / 2 - h / 2);

    if (below >= h || above >= h) {
      // 上方或下方放得下：放在 target 正上／正下
      card.style.left = `${clampX((box.left + box.right) / 2 - width / 2)}px`;
      card.style.top = `${below >= h ? box.bottom + GAP : box.top - GAP - h}px`;
    } else if (Math.max(left, right) >= width && h <= vh - MARGIN * 2) {
      // 手機橫放等：上下放不下，放在旁邊
      card.style.left = `${left >= width ? box.left - GAP - width : box.right + GAP}px`;
      card.style.top = `${middleY}px`;
    } else {
      // 都放不下：縮短卡片、在卡片裡捲動，絕不蓋住亮出來的範圍
      const placeBelow = below >= above;
      card.style.maxHeight = `${Math.max(0, placeBelow ? below : above)}px`;
      card.style.left = `${clampX((box.left + box.right) / 2 - width / 2)}px`;
      card.style.top = `${placeBelow ? box.bottom + GAP : box.top - GAP - card.offsetHeight}px`;
    }
  }

  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(place);
  };

  /** 換頁後等 target 出現（MutationObserver），最多 WAIT_MS；在那之前卡片在中央 */
  function waitForTarget(selector) {
    stopWaiting?.();
    const obs = new MutationObserver(() => { if (visibleEl(selector)) { stop(); schedule(); } });
    const timer = setTimeout(() => stop(), WAIT_MS);
    function stop() {
      obs.disconnect();
      clearTimeout(timer);
      if (stopWaiting === stop) stopWaiting = null;
    }
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    stopWaiting = stop;
  }

  /* ===== 步驟 ===== */
  function show(i) {
    index = i;
    const step = steps[i];
    const last = i === steps.length - 1;
    root.dataset.step = step.id;
    card.querySelector('#tour-progress').textContent = `${i + 1} / ${steps.length}`;
    card.querySelector('#tour-title').textContent = step.title;
    card.querySelector('#tour-body').textContent = step.body;
    btn('prev').hidden = i === 0;
    btn('skip').hidden = last;
    btn('start').hidden = !last;
    btn('next').textContent = last ? '完成' : '下一步';
    btn('next').classList.toggle('btn-primary', !last);

    if (step.route && currentRoute() !== step.route) location.hash = step.route;
    place();
    if (step.target && !visibleEl(step.target)) waitForTarget(step.target);
    else stopWaiting?.();
    (last ? btn('start') : btn('next')).focus({ preventScroll: true });
  }

  /* ===== 鍵盤：焦點留在卡片裡、Esc＝略過 ===== */
  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      end();
    } else if (e.key === 'Tab') {
      const items = [...card.querySelectorAll('button:not([hidden])')];
      const pos = items.indexOf(document.activeElement);
      const next = e.shiftKey ? (pos <= 0 ? items.length - 1 : pos - 1) : (pos === items.length - 1 ? 0 : pos + 1);
      e.preventDefault();
      items[next].focus();
    }
  }
  const onFocusin = (e) => { if (!card.contains(e.target)) btn('next').focus({ preventScroll: true }); };

  function end(after) {
    stopWaiting?.();
    cancelAnimationFrame(frame);
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('focusin', onFocusin);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('hashchange', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    root.remove();
    running = false;
    if (after) after();
    else if (previous?.isConnected) previous.focus?.({ preventScroll: true });
  }

  card.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'next') {
      if (index === steps.length - 1) end();
      else show(index + 1);
    } else if (act === 'prev') show(index - 1);
    else if (act === 'skip') end();
    else if (act === 'start') end(() => { location.hash = '#/beans/new'; });
  });
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('focusin', onFocusin);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('hashchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);

  show(0);
}
