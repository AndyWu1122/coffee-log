// 統計頁（#/stats）的畫面測試：不需要 Supabase；headless Chrome（找不到時設 CHROME_PATH）
// 手機直向 390px：深色、淺色 × 有資料、沒資料各截一張圖（存到暫存資料夾，路徑印在最後）
// 確認：整頁不會橫向捲動；圖表的文字互相不重疊、橫條的名稱不壓到數字；點圓點、長條會顯示詳細數字；
// 點「每支豆子」的長條跳到只列那支豆子的紀錄；資料不夠時只顯示提示、不畫圖；離線可用；沒有 CSP 違規、沒有 JavaScript 錯誤
//
// 用法：node scripts/stats-ui-test.mjs

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer, launchChrome, prepare, visit, click } from './chrome.mjs';

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const q = JSON.stringify;
const DAY = 86400000;

/** 測試資料：120 天內 45 杯（3 支豆子，其中一支已封存、一支名稱很長；部分沒評分；兩台磨豆機，一台已封存） */
function fixtures() {
  const now = Date.now();
  const beans = [
    { id: 'bean-a', name: '耶加雪菲', origin: '衣索比亞', process: 'washed', roastLevel: 'light', roastDate: '', bagWeightG: null, archived: false },
    { id: 'bean-b', name: '巴拿馬翡翠莊園藝伎水洗處理特級批次限量版本', origin: '', process: 'washed', roastLevel: 'light', roastDate: '', bagWeightG: null, archived: false },
    { id: 'bean-c', name: '肯亞', origin: '', process: 'natural', roastLevel: 'medium', roastDate: '', bagWeightG: null, archived: true },
  ].map((b) => ({ ...b, createdAt: new Date(now - 200 * DAY).toISOString() }));
  const grinders = [
    { id: 'g-1', name: 'Comandante C40', notes: '', archived: true, createdAt: new Date(now - 200 * DAY).toISOString() },
    { id: 'g-2', name: 'Fellow Ode', notes: '', archived: false, createdAt: new Date(now - 200 * DAY).toISOString() },
  ];
  const drippers = ['V60', 'Kalita Wave', 'Origami'].map((name, i) => ({ id: `d-${i}`, name, notes: '', archived: false, createdAt: new Date(now - 200 * DAY).toISOString() }));
  const brews = Array.from({ length: 45 }, (_, i) => {
    const beanId = ['bean-a', 'bean-a', 'bean-b', 'bean-c'][i % 4];
    return {
      id: `brew-${i}`, beanId, grinderId: i % 3 ? 'g-2' : 'g-1', dripperId: `d-${i % 3}`,
      brewedAt: new Date(now - (i * 2.6 + 0.2) * DAY).toISOString(),
      dripper: ['V60', 'Kalita Wave', 'Origami'][i % 3], grindSetting: '', coffeeG: 15, waterG: [240, 225, 250, 232][i % 4],
      tempC: [92, 93, 90, 92.5][i % 4], totalTimeS: 150, rating: i % 5 === 4 ? null : 2 + (i * 7) % 4,
      flavor: { acidity: null, sweetness: null, bitterness: null, body: null }, flavorNotes: [], notes: '', visibility: 'private',
    };
  });
  return { beans, grinders, drippers, brews };
}

/** 隔離的頁面（手機直向 390px），在任何頁面腳本執行前開始記錄 CSP 違規 */
async function openPage(chrome, url) {
  const page = await chrome.newPage(null, { isolated: true });
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI));`,
  });
  await page.goto(url);
  await prepare(page);
  return page;
}

/** 整頁截圖（先把視窗撐到內容的高度） */
async function screenshot(page, file) {
  const height = await page.eval('Math.ceil(document.documentElement.scrollHeight)');
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height, deviceScaleFactor: 2, mobile: true });
  await page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  const { data } = await page.cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(file, Buffer.from(data, 'base64'));
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
}

/** 換主題：和 ☰ 的「外觀」一樣寫 localStorage，重新載入後由 theme.js 套用 */
async function setTheme(page, theme) {
  await page.eval(`localStorage.setItem('theme', ${q(theme)}); window.__reloading = true; location.reload(); true`);
  await page.waitFor(`!window.__reloading && document.readyState === 'complete' && document.documentElement.dataset.theme === ${q(theme)}`, { label: `切到${theme}` });
  await prepare(page);
}

const openStats = async (page, base, period) => {
  await visit(page, base, '#/stats');
  await page.waitFor(`document.querySelector('#stats-page')`, { label: '統計頁' });
  if (period) {
    // 按下去時舊的頁面先標記起來，等重畫出新的頁面才往下（分段按鈕的值是按下當下就改的，不能拿來等）
    await page.eval(`document.querySelector('#stats-page').dataset.stale = '1'; true`);
    await click(page, `.segmented[data-name="period"] button[data-v="${period}"]`);
    await page.waitFor(`document.querySelector('#stats-page:not([data-stale]) .segmented[data-name="period"]')?.dataset.value === ${q(period)}`, { label: `期間 ${period}` });
  }
};

/** 版面檢查：整頁不橫向捲動、SVG 文字互不重疊、橫條的名稱和數字不重疊 */
const layout = (page) => page.eval(`(() => {
  const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const textHits = [];
  for (const svg of document.querySelectorAll('#stats-page svg')) {
    const boxes = [...svg.querySelectorAll('text')].map((t) => ({ t: t.textContent, r: t.getBoundingClientRect() }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      if (overlap(boxes[i].r, boxes[j].r)) textHits.push(boxes[i].t + '×' + boxes[j].t);
    }
  }
  const rowHits = [...document.querySelectorAll('.hbar-row:not(.hbar-axis)')].filter((row) => {
    const name = row.querySelector('.hbar-name').getBoundingClientRect();
    const value = row.querySelector('.hbar-value').getBoundingClientRect();
    return overlap(name, value); // 每支豆子、器材的名稱獨佔一行（在數值上面），所以上下也要比
  }).length;
  const tickHits = [...document.querySelectorAll('.hbar-ticks')].filter((t) => {
    const spans = [...t.querySelectorAll('span')].map((s) => s.getBoundingClientRect());
    return spans.some((a, i) => spans.slice(i + 1).some((b) => overlap(a, b)));
  }).length;
  const tiles = [...document.querySelectorAll('.stat-tile')].filter((t) => t.scrollWidth > t.clientWidth + 1).length;
  return {
    pageWidth: document.documentElement.scrollWidth, viewport: window.innerWidth,
    textHits, rowHits, tickHits, tiles,
    shortRows: [...document.querySelectorAll('.hbar-row:not(.hbar-axis)')].filter((r) => r.getBoundingClientRect().height < 44).length,
  };
})()`);

let server;
let chrome;
const shotDir = await mkdtemp(path.join(tmpdir(), 'coffee-log-stats-'));
try {
  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();

  /* ===== 有資料 ===== */
  const page = await openPage(chrome, base);
  const data = fixtures();
  await page.eval(`import('/js/db.js').then((db) => db.bulkPut(${q(data)})).then(() => true)`);
  await page.waitFor('Boolean(navigator.serviceWorker.controller)', { label: 'Service Worker 接管' });
  check('☰ 選單有「📊 統計」', Boolean(await page.eval(`document.querySelector('.menu-list a[href="#/stats"][role="menuitem"]')`)));

  for (const theme of ['dark', 'light']) {
    await setTheme(page, theme);
    for (const period of ['30', 'all']) {
      await openStats(page, base, period);
      const l = await layout(page);
      const label = `${theme === 'dark' ? '深色' : '淺色'}・${period === 'all' ? '全部' : '近 30 天'}`;
      check(`${label}：六個區塊都畫出來`, (await page.eval(`document.querySelectorAll('.stats-card').length`)) === 5
        && Boolean(await page.eval(`document.querySelector('.stats-overview')`)));
      check(`${label}：整頁不會橫向捲動（390px）`, l.pageWidth <= l.viewport, `${l.pageWidth} / ${l.viewport}`);
      check(`${label}：圖表裡的文字互不重疊`, l.textHits.length === 0, l.textHits.slice(0, 5).join(' / '));
      check(`${label}：橫條的名稱不壓到數字、刻度不重疊`, l.rowHits === 0 && l.tickHits === 0, `${l.rowHits} 列、${l.tickHits} 個刻度`);
      check(`${label}：總覽的數字不超出卡片`, l.tiles === 0);
      check(`${label}：橫條每列至少 44px 高`, l.shortRows === 0, `${l.shortRows} 列`);
      await screenshot(page, path.join(shotDir, `stats-${theme}-${period === 'all' ? 'all' : '30d'}.png`));
    }
  }

  /* ===== 期間：「全部」的每週圖很寬時在自己的框裡捲動，預設在最新一週 ===== */
  await openStats(page, base, 'all');
  const scroll = await page.eval(`(() => { const s = document.querySelector('.stats-card .chart-scroll'); return s && { w: s.scrollWidth, c: s.clientWidth, left: s.scrollLeft }; })()`);
  check('「全部」（18 週）：每週的圖在框裡橫向捲動、捲到最新', Boolean(scroll) && scroll.w > scroll.c && scroll.left >= scroll.w - scroll.c - 2, q(scroll));
  check('長名稱的豆子：名稱獨佔一行、完整顯示（不截斷），長條在下一行；完整名稱也在 aria-label',
    await page.eval(`(() => {
      const a = document.querySelector('[data-bean="bean-b"]'); const n = a.querySelector('.hbar-name'); const bar = a.querySelector('.hbar');
      const nr = n.getBoundingClientRect(); const br = bar.getBoundingClientRect();
      return n.scrollHeight <= n.clientHeight + 1 && n.textContent.includes('巴拿馬翡翠莊園藝伎水洗處理特級批次限量版本')
        && nr.bottom <= br.top + 0.5 && a.getAttribute('aria-label').includes('巴拿馬翡翠莊園藝伎水洗處理特級批次限量版本');
    })()`));
  check('每支豆子、器材的長條同寬（才能互相比較）', await page.eval(`(() => {
    const ws = [...document.querySelectorAll('.hbars.is-stacked .hbar-row:not(.hbar-axis) .hbar')].map((b) => Math.round(b.getBoundingClientRect().width));
    return ws.length > 2 && new Set(ws).size === 1;
  })()`));
  check('總覽「最常沖的豆子」：名稱用較小的字、最多兩行，不超出卡片', await page.eval(`(() => {
    const v = [...document.querySelectorAll('.stat-value.is-name')];
    return v.length === 1 && parseFloat(getComputedStyle(v[0]).fontSize) < 20 && v[0].scrollWidth <= v[0].clientWidth + 1;
  })()`));
  check('已封存的豆子、磨豆機也在統計裡', await page.eval(`Boolean(document.querySelector('[data-bean="bean-c"]')) && document.querySelector('#stats-page').textContent.includes('Comandante C40')`));
  check('豆子下拉：已封存的標「已封存」', await page.eval(`[...document.querySelectorAll('#stats-bean option')].some((o) => o.value === 'bean-c' && o.textContent.includes('已封存'))`));

  /* ===== 點擊顯示詳細數字（不是 hover） ===== */
  const tap = (sel) => page.eval(`(() => {
    const el = document.querySelector(${q(sel)});
    const r = el.getBoundingClientRect();
    const target = el.closest('svg')?.querySelector('.chart-hit') && el.matches('.chart-dot') ? el.closest('svg').querySelector('.chart-hit') : el;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    return true;
  })()`);
  const detailOf = (cardIndex) => page.eval(`document.querySelectorAll('.stats-card')[${cardIndex}].querySelector('.chart-detail').textContent`);
  await tap('.chart-rating .chart-dot[data-i="3"]');
  const ratingDetail = await detailOf(0);
  check('點評分的圓點：顯示那一杯的日期、豆子、分數', /^\d+\/\d+ .+：\d 分/.test(ratingDetail) && await page.eval(`document.querySelector('.chart-dot[data-i="3"]').classList.contains('is-selected')`), ratingDetail);
  await tap('.chart-rating .chart-dot[data-i="10"]');
  check('第 8 杯以後的點：也顯示 7 杯平均', (await detailOf(0)).includes('7 杯平均'), await detailOf(0));
  await tap('.chart-weeks .chart-hit-col:last-of-type');
  check('點每週的長條：顯示那一週和杯數', /^\d+\/\d+–\d+\/\d+：\d+ 杯$/.test(await detailOf(4)), await detailOf(4));
  await tap('.stats-card:nth-of-type(4) .hbar-row[data-detail]');
  check('點粉水比：顯示杯數和比例', /粉水比 1:[\d.]+–1:[\d.]+：\d+ 杯（\d+%）/.test(await detailOf(2)), await detailOf(2));
  await tap('.stats-card:nth-of-type(5) .hbar-row[data-detail]');
  check('點器材：顯示平均分數和杯數', /平均 [\d.]+ 分，\d+ 杯/.test(await detailOf(3)), await detailOf(3));

  /* ===== 點每支豆子的長條：跳到只列那支豆子的紀錄 ===== */
  await click(page, '[data-bean="bean-c"]');
  await page.waitFor(`location.hash === '#/' && document.querySelector('#filter-bean')?.value === 'bean-c'`, { label: '跳到紀錄列表' });
  const listed = await page.eval(`document.querySelectorAll('.list > li').length`);
  check('點豆子長條：紀錄列表只列那支豆子', listed === data.brews.filter((b) => b.beanId === 'bean-c').length, `${listed} 筆`);
  check('網址改回 #/（篩選照常保留在選單裡）', (await page.eval('location.hash')) === '#/');

  /* ===== 離線也能看 ===== */
  await page.setOffline(true);
  await page.eval(`location.hash = '#/backup'; true`);
  await page.waitFor(`location.hash === '#/backup'`);
  await page.eval(`location.hash = '#/stats'; true`);
  await page.waitFor(`document.querySelector('#stats-page .stats-card')`, { label: '離線開統計頁' });
  check('離線：統計頁照常顯示', true);
  await page.setOffline(false);

  check('有資料的頁面：沒有 CSP 違規', (await page.eval('window.__csp')).length === 0, (await page.eval('window.__csp')).join(' / '));
  // 離線時瀏覽器自己抓分頁圖示（favicon 的請求不經過 Service Worker），會記一筆載入失敗，和 App 無關
  const errors = page.errors.filter((e) => !(e.includes('ERR_INTERNET_DISCONNECTED') && e.includes('/icons/icon.svg')));
  check('有資料的頁面：沒有 JavaScript 錯誤', errors.length === 0, errors.join(' / '));

  /* ===== 沒資料、資料不夠 ===== */
  const empty = await openPage(chrome, base);
  for (const theme of ['dark', 'light']) {
    await setTheme(empty, theme);
    await openStats(empty, base);
    check(`${theme === 'dark' ? '深色' : '淺色'}・沒資料：只顯示提示、不畫圖`,
      (await empty.eval(`document.querySelector('.stats-empty')?.textContent ?? ''`)).includes('多記幾杯就能看到趨勢')
        && !(await empty.eval(`document.querySelector('#stats-page .stats-card')`))); // 熱度圖（.heatmap-card）不受影響、一直顯示
    const l = await layout(empty);
    check(`${theme === 'dark' ? '深色' : '淺色'}・沒資料：不會橫向捲動`, l.pageWidth <= l.viewport);
    await screenshot(empty, path.join(shotDir, `stats-${theme}-empty.png`));
  }
  const two = fixtures();
  two.brews = two.brews.slice(0, 2);
  await empty.eval(`import('/js/db.js').then((db) => db.bulkPut(${q(two)})).then(() => true)`);
  await openStats(empty, base, 'all');
  check('只有 2 杯：顯示「只有 2 杯，多記幾杯」、不畫圖',
    (await empty.eval(`document.querySelector('.stats-empty')?.textContent ?? ''`)).includes('只有 2 杯') && !(await empty.eval(`document.querySelector('#stats-page .stats-card svg')`)));
  check('沒資料的頁面：沒有 CSP 違規、沒有 JavaScript 錯誤', (await empty.eval('window.__csp')).length === 0 && empty.errors.length === 0,
    `${(await empty.eval('window.__csp')).join(' / ')} ${empty.errors.join(' / ')}`);
} catch (err) {
  failures.push(`執行錯誤：${err.message}`);
  console.error(err);
} finally {
  await chrome?.close();
  server?.close();
}

console.log(`\n截圖：${shotDir}`);
console.log(`${passed}/${passed + failures.length} 通過`);
if (failures.length) {
  console.log(`失敗：\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
