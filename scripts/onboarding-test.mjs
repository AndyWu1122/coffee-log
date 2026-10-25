// 新手教學（js/views/tour.js）：不需要 Supabase；headless Chrome（找不到時設 CHROME_PATH）
// 確認：全新使用者第一次打開首頁自動顯示、略過（或 Esc）後重新整理不再出現；有資料的舊使用者不顯示、直接記成看過；
// 從其他頁面（好友 QR code）打開不顯示也不記；☰ 的「使用教學」可以重看、不影響設定；沒有社群功能時跳過社群那一步；
// 每一步：說明卡片在畫面內、不蓋住被標示的元素、390px 不橫向捲動、焦點在卡片裡；手機橫放時跟著重新定位；
// 深色、淺色每一步各截一張圖（存到暫存資料夾，路徑印在最後）；沒有 CSP 違規、沒有 JavaScript 錯誤
//
// 用法：node scripts/onboarding-test.mjs

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer, launchChrome, prepare, click } from './chrome.mjs';

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const q = JSON.stringify;

// 每一步要標示的元素（和 tour.js 的 STEPS 一致；沒有＝中央卡片）
const TARGETS = {
  welcome: null,
  beans: '.tabbar a[data-tab="beans"]',
  brew: '.fab[href="#/brew/new"]',
  menu: '#menu-btn',
  social: '.tabbar a[data-tab="social"]',
  done: null,
};
const PORTRAIT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const LANDSCAPE = { width: 844, height: 390, deviceScaleFactor: 2, mobile: true };

/** 隔離的頁面（手機直向 390px），在任何頁面腳本執行前開始記錄 CSP 違規 */
async function openPage(chrome, url) {
  const page = await chrome.newPage(null, { isolated: true });
  await page.cdp('Emulation.setDeviceMetricsOverride', PORTRAIT);
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI));`,
  });
  await page.goto(url);
  await prepare(page);
  return page;
}

const frames = (page) => page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
const tourShown = (page) => page.eval(`Boolean(document.querySelector('.tour'))`);
const meta = (page) => page.eval(`import('/js/db.js').then((db) => db.getMeta('onboardingSeen'))`);
// 一般的重新整理，等 App 啟動完（有沒有教學都已經決定：首頁畫好後再等一下）
async function reload(page, hash) {
  await page.eval(`window.__reloading = true; location.hash = ${q(hash)}; location.reload(); true`);
  await page.waitFor(`!window.__reloading && document.readyState === 'complete' && document.querySelector('#app').childElementCount > 0`, { label: `重新載入 ${hash}` });
  await prepare(page);
  await page.eval('new Promise((r) => setTimeout(() => r(true), 500))');
}

/** 目前這一步的版面 */
const layout = (page) => page.eval(`(() => {
  const TARGETS = ${q(TARGETS)};
  const root = document.querySelector('.tour');
  const card = root.querySelector('.tour-card');
  const step = root.dataset.step;
  const c = card.getBoundingClientRect();
  const el = TARGETS[step] && document.querySelector(TARGETS[step]);
  const t = el?.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = innerHeight;
  return {
    step,
    progress: card.querySelector('.tour-progress').textContent,
    title: card.querySelector('.tour-title').textContent,
    center: root.classList.contains('tour-center'),
    hasTarget: Boolean(TARGETS[step]),
    inView: c.left >= 0 && c.top >= 0 && c.right <= vw + 0.5 && c.bottom <= vh + 0.5,
    overlap: t ? (c.left < t.right && t.left < c.right && c.top < t.bottom && t.top < c.bottom) : false,
    noInnerScroll: card.scrollHeight <= card.clientHeight + 1,
    noHScroll: document.documentElement.scrollWidth <= vw,
    focusInCard: card.contains(document.activeElement),
    dialog: card.getAttribute('role') === 'dialog' && card.getAttribute('aria-modal') === 'true',
    labelled: document.getElementById(card.getAttribute('aria-labelledby'))?.textContent === card.querySelector('.tour-title').textContent,
    hash: location.hash,
  };
})()`);

/** 等這一步排好（換頁時等元素出現、亮出來的框移動完） */
async function settle(page, step) {
  await page.waitFor(`document.querySelector('.tour')?.dataset.step === ${q(step)}`, { label: `第「${step}」步` });
  if (TARGETS[step]) await page.waitFor(`!document.querySelector('.tour').classList.contains('tour-center')`, { label: `「${step}」標示出元素` });
  await page.eval('new Promise((r) => setTimeout(() => r(true), 300))');
  await frames(page);
}

async function shot(page, dir, name) {
  const { data } = await page.cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(dir, `${name}.png`), Buffer.from(data, 'base64'));
}

/** 從目前這一步一路按「下一步」走完，每一步檢查版面；回傳走過的步驟 */
async function walk(page, { label, steps, dir, theme }) {
  const seen = [];
  for (let i = 0; i < steps.length; i++) {
    await settle(page, steps[i]);
    const l = await layout(page);
    seen.push(l.step);
    check(`${label}：第 ${i + 1} 步「${l.title}」進度 ${i + 1} / ${steps.length}、卡片在畫面內、沒有蓋住標示、不橫向捲動、焦點在卡片裡`,
      l.progress === `${i + 1} / ${steps.length}` && l.inView && !l.overlap && l.noHScroll && l.focusInCard && l.dialog && l.labelled && l.noInnerScroll
        && (l.hasTarget ? !l.center : l.center), q(l));
    if (dir) await shot(page, dir, `${theme}-${i + 1}-${l.step}`);
    if (i < steps.length - 1) await click(page, '.tour-card [data-act="next"]');
  }
  return seen;
}

const ALL = ['welcome', 'beans', 'brew', 'menu', 'social', 'done'];
const NO_SOCIAL = ALL.filter((s) => s !== 'social');

let server;
let chrome;
let shots;
try {
  server = await startServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;
  chrome = await launchChrome({ extraArgs: ['--host-resolver-rules=MAP coffee.test 127.0.0.1'] });
  shots = await mkdtemp(path.join(tmpdir(), 'coffee-log-onboarding-'));

  /* ===== 全新使用者（有社群功能）：第一次打開首頁自動顯示 ===== */
  const page = await openPage(chrome, `${base}#/`);
  await page.waitFor(`document.querySelector('.tour-card')`, { label: '自動顯示教學' });
  check('全新使用者：第一次打開首頁自動顯示', true);
  check('一顯示就記成看過（中途關掉也算）', Boolean(await meta(page)));
  check('預設是深色主題', (await page.eval('document.documentElement.dataset.theme')) === 'dark');
  const darkSteps = await walk(page, { label: '深色', steps: ALL, dir: shots, theme: 'dark' });
  check('有社群功能：6 步都有、順序正確', q(darkSteps) === q(ALL), q(darkSteps));

  // 上一步
  await click(page, '.tour-card [data-act="prev"]');
  await settle(page, 'social');
  check('「上一步」回到社群那一步', (await layout(page)).step === 'social');
  await click(page, '.tour-card [data-act="next"]');
  await settle(page, 'done');
  check('最後一步沒有「略過」、有「新增第一支豆子」、按鈕寫「完成」',
    await page.eval(`(() => { const c = document.querySelector('.tour-card');
      return c.querySelector('[data-act="skip"]').hidden && !c.querySelector('[data-act="start"]').hidden && c.querySelector('[data-act="next"]').textContent === '完成'; })()`));
  await click(page, '.tour-card [data-act="start"]');
  await page.waitFor(`location.hash === '#/beans/new' && document.querySelector('#name')`, { label: '新增豆子頁' });
  check('「新增第一支豆子」：教學結束、到新增豆子頁', !(await tourShown(page)));

  await reload(page, '#/');
  check('看過之後重新整理首頁：不再自動顯示', !(await tourShown(page)));

  /* ===== ☰ 使用教學：重看、不影響設定 ===== */
  const before = await meta(page);
  await click(page, '#menu-btn');
  check('☰ 有「📖 使用教學」', (await page.eval(`document.querySelector('#menu-tour')?.textContent`)) === '📖使用教學');
  await click(page, '#menu-tour');
  await settle(page, 'welcome');
  check('☰ 使用教學：選單關掉、教學從第 1 步開始', await page.eval(`document.getElementById('app-menu').hidden`) && (await layout(page)).progress === '1 / 6');
  await click(page, '#menu-tour');
  check('重複按不會疊兩層', (await page.eval(`document.querySelectorAll('.tour').length`)) === 1);

  // 焦點：Tab 在卡片裡循環
  await page.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await page.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  check('按 Tab：焦點留在卡片裡', await page.eval(`document.querySelector('.tour-card').contains(document.activeElement)`));

  // 淺色：每一步截圖
  await page.eval(`import('/js/views/ui.js').then((m) => m.setThemePref('light')).then(() => true)`);
  check('切到淺色', (await page.eval('document.documentElement.dataset.theme')) === 'light');
  await walk(page, { label: '淺色', steps: ALL, dir: shots, theme: 'light' });
  await click(page, '.tour-card [data-act="next"]');
  check('按「完成」：教學結束、焦點回到 ☰', !(await tourShown(page)) && (await page.eval(`document.activeElement?.id`)) === 'menu-btn');
  check('重看完：設定沒變', (await meta(page)) === before, `${before} / ${await meta(page)}`);

  // 沒看過的人從 ☰ 重看，也不會寫入設定
  await page.eval(`import('/js/db.js').then((db) => db.remove('meta', 'onboardingSeen')).then(() => true)`);
  await click(page, '#menu-btn');
  await click(page, '#menu-tour');
  await settle(page, 'welcome');
  await click(page, '.tour-card [data-act="skip"]');
  check('☰ 重看後略過：不寫入「看過了」', !(await tourShown(page)) && (await meta(page)) == null);

  /* ===== 從別的頁面重看：第 3 步換到首頁、等 ＋ 出現才標示；手機橫放時重新定位 ===== */
  await page.eval(`import('/js/views/ui.js').then((m) => m.setThemePref('dark')).then(() => true)`);
  await page.eval(`location.hash = '#/stats'; true`);
  await page.waitFor(`document.querySelector('#stats-page')`, { label: '統計頁' });
  await click(page, '#menu-btn');
  await click(page, '#menu-tour');
  await settle(page, 'welcome');
  await click(page, '.tour-card [data-act="next"]');
  await click(page, '.tour-card [data-act="next"]');
  await settle(page, 'brew');
  check('從統計頁重看：第 3 步換到首頁並標示 ＋', (await layout(page)).hash === '#/' && !(await layout(page)).center);
  const portraitTop = (await page.eval(`document.querySelector('.tour-card').getBoundingClientRect().top`));
  await page.cdp('Emulation.setDeviceMetricsOverride', LANDSCAPE);
  await page.eval('new Promise((r) => setTimeout(() => r(true), 400))');
  await frames(page);
  let l = await layout(page);
  const landscapeTop = await page.eval(`document.querySelector('.tour-card').getBoundingClientRect().top`);
  check('橫放：卡片跟著移動、仍在畫面內、沒有蓋住 ＋、不用在卡片裡捲動', landscapeTop !== portraitTop && l.inView && !l.overlap && !l.center && l.noInnerScroll, q(l));
  await shot(page, shots, 'landscape-brew');
  await page.cdp('Emulation.setDeviceMetricsOverride', PORTRAIT);
  await page.eval('new Promise((r) => setTimeout(() => r(true), 400))');
  l = await layout(page);
  check('轉回直向：仍在畫面內、沒有蓋住 ＋', l.inView && !l.overlap, q(l));

  // Esc ＝略過
  await page.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  check('按 Esc：教學結束', !(await tourShown(page)));

  check('沒有 CSP 違規', (await page.eval('window.__csp.length')) === 0, q(await page.eval('window.__csp')));
  check('頁面沒有 JavaScript 錯誤', page.errors.length === 0, page.errors.join(' / '));
  await page.close();

  /* ===== 全新使用者按「略過」：重新整理後不再出現 ===== */
  const skipper = await openPage(chrome, `${base}#/`);
  await skipper.waitFor(`document.querySelector('.tour-card')`, { label: '自動顯示教學' });
  await click(skipper, '.tour-card [data-act="next"]');
  await settle(skipper, 'beans');
  await click(skipper, '.tour-card [data-act="skip"]');
  check('按「略過」：教學結束', !(await tourShown(skipper)));
  await reload(skipper, '#/');
  check('略過後重新整理：不再自動顯示', !(await tourShown(skipper)));
  await skipper.close();

  /* ===== 有資料的舊使用者：不自動顯示，直接記成看過 ===== */
  const old = await openPage(chrome, `${base}#/settings`);
  await old.waitFor(`document.querySelector('.settings')`, { label: '設定頁' });
  check('從首頁以外的頁面打開：不顯示', !(await tourShown(old)));
  await old.eval(`import('/js/db.js').then((db) => db.put('beans', { id: 'bean-1', name: '測試豆', origin: '', process: 'washed', roastLevel: 'light', roastDate: '', bagWeightG: null, archived: false, createdAt: new Date().toISOString() })).then(() => true)`);
  check('從首頁以外的頁面打開：也不記成看過', (await meta(old)) == null);
  await reload(old, '#/');
  check('有資料的舊使用者打開首頁：不自動顯示', !(await tourShown(old)));
  check('有資料的舊使用者：記成看過', Boolean(await meta(old)));
  await old.close();

  /* ===== 從好友的 QR code 打開：不打斷、不記 ===== */
  const qr = await openPage(chrome, `${base}#/friends/add?code=ABCD1234`);
  await qr.eval('new Promise((r) => setTimeout(() => r(true), 800))');
  check('從 QR code（#/friends/add）打開：不顯示、不記', !(await tourShown(qr)) && (await meta(qr)) == null);
  await reload(qr, '#/');
  await qr.waitFor(`document.querySelector('.tour-card')`, { label: '之後打開首頁才顯示' });
  check('之後打開首頁：才自動顯示', true);
  check('全新使用者的首頁有 ＋（教學標示用）', await qr.eval(`Boolean(document.querySelector('#app .fab[href="#/brew/new"]'))`));
  await qr.close();

  /* ===== 沒有社群功能：跳過社群那一步 ===== */
  const plain = await openPage(chrome, `http://coffee.test:${port}/#/`);
  await plain.waitFor(`document.querySelector('.tour-card')`, { label: '自動顯示教學（沒有社群功能）' });
  const plainSteps = await walk(plain, { label: '沒有社群功能', steps: NO_SOCIAL });
  check('沒有社群功能：沒有社群那一步、共 5 步', q(plainSteps) === q(NO_SOCIAL), q(plainSteps));
  check('沒有社群功能：沒有 CSP 違規、沒有 JavaScript 錯誤',
    (await plain.eval('window.__csp.length')) === 0 && plain.errors.length === 0, plain.errors.join(' / '));
  await plain.close();
} catch (err) {
  failures.push(`執行錯誤：${err.message}`);
  console.error(err);
} finally {
  await chrome?.close();
  server?.close();
}

if (shots) console.log(`\n截圖：${shots}`);
console.log(`\n${passed}/${passed + failures.length} 通過`);
if (failures.length) {
  console.log(`失敗：\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
