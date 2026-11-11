// 安裝 App 的教學（js/install.js、js/views/installGuide.js，1.26.0）：不需要 Supabase；headless Chrome（找不到時設 CHROME_PATH）
// Node：裝置判斷（各種 User-Agent）、什麼時候主動顯示／首頁提示（3 天、7 天的邊界）
// headless Chrome（用 User-Agent 模擬裝置；beforeinstallprompt、appinstalled 用假的事件；從主畫面開啟用 navigator.standalone）：
//   Android Chrome（有／沒有安裝事件）、iPhone Safari、iPad、iPhone Chrome（新／舊）、LINE、電腦 Chrome／Firefox、認不出來 → 各自的內容
//   教學順序：安裝 → 新手教學；已安裝（standalone）不顯示、☰ 沒有「安裝 App」；略過後不再跳、沒有提示；稍後／Esc 3 天後首頁提示、✕ 後不再出現
//   已有紀錄：iPhone「先備份再安裝」、匯出；舊使用者跳一次、不接新手教學；安裝完成 → 這個分頁不跳新手教學，從主畫面打開才跳
//   390px 卡片在畫面內、不橫向捲動、dialog／焦點；深淺色截圖；沒有 CSP 違規、沒有 JavaScript 錯誤
//
// 用法：node scripts/install-test.mjs

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer, launchChrome, prepare, click, sleep, root } from './chrome.mjs';

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const q = JSON.stringify;

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidEdge: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadOld: 'Mozilla/5.0 (iPad; CPU OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iphoneChromeOld: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/110.0.5481.83 Mobile/15E148 Safari/604.1',
  iphoneChrome164: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/112.0 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 Line/14.0.0',
  instagram: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0 Android',
  facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0;FBDV/iPhone15,2]',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  desktopEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  desktopFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  unknown: 'SomeDevice/1.0',
};

/* ===== Node：裝置判斷與提醒的規則 ===== */
{
  const m = await import(pathToFileURL(path.join(root, 'js/install.js')).href);
  const kind = (ua, touch = 0) => { const p = m.detectPlatform({ userAgent: ua, maxTouchPoints: touch }); return `${p.kind}${p.tablet ? '+tablet' : ''}${p.oldIos ? '+old' : ''}`; };
  const cases = [
    ['Android Chrome', UA.androidChrome, 0, 'android'],
    ['Android Edge', UA.androidEdge, 0, 'android'],
    ['Android 平板', UA.androidTablet, 0, 'android+tablet'],
    ['iPhone Safari', UA.iphoneSafari, 5, 'ios-safari'],
    ['iPad（自稱 Mac＋觸控）', UA.mac, 5, 'ios-safari+tablet'],
    ['舊 iPad 的 Safari（Safari 一直都能加入主畫面）', UA.ipadOld, 5, 'ios-safari+tablet+old'],
    ['Mac 的 Safari（沒有觸控）', UA.mac, 0, 'desktop-other'],
    ['iPhone Chrome', UA.iphoneChrome, 5, 'ios-other'],
    ['iPhone Chrome（iOS 16.3，太舊）', UA.iphoneChromeOld, 5, 'ios-other+old'],
    ['iPhone Chrome（iOS 16.4，剛好可以）', UA.iphoneChrome164, 5, 'ios-other'],
    ['iPhone Firefox', UA.iphoneFirefox, 5, 'ios-other'],
    ['LINE', UA.line, 5, 'in-app'],
    ['Instagram（Android）', UA.instagram, 5, 'in-app'],
    ['Facebook', UA.facebook, 5, 'in-app'],
    ['電腦 Chrome', UA.desktopChrome, 0, 'desktop-chromium'],
    ['電腦 Edge', UA.desktopEdge, 0, 'desktop-chromium'],
    ['電腦 Firefox', UA.desktopFirefox, 0, 'desktop-other'],
    ['認不出來', UA.unknown, 0, 'unknown'],
    ['空字串', '', 0, 'unknown'],
  ];
  for (const [name, ua, touch, want] of cases) check(`判斷裝置：${name} → ${want}`, kind(ua, touch) === want, kind(ua, touch));

  const DAY = 86400000;
  const t0 = Date.UTC(2026, 10, 11, 3, 0, 0);
  const st = (meta, now, opts = {}) => q(m.guideState(meta, { now, ...opts }));
  check('沒看過：主動顯示、沒有提示', st(undefined, t0) === q({ auto: true, hint: false }));
  check('已安裝（從主畫面開啟）：都不顯示', st(undefined, t0, { standalone: true }) === q({ auto: false, hint: false }));
  const seen = m.guideSeen(t0);
  check('一顯示就記成看過（中途關掉算「稍後」）', seen.choice === 'later' && !seen.quiet && st(seen, t0 + 1000) === q({ auto: false, hint: false }));
  const later = m.afterChoice(seen, 'later', t0);
  check('稍後：3 天內沒有提示', st(later, t0 + 3 * DAY - 1) === q({ auto: false, hint: false }));
  check('稍後：滿 3 天首頁提示', st(later, t0 + 3 * DAY) === q({ auto: false, hint: true }));
  const closed = m.afterDismiss(later, t0 + 4 * DAY);
  check('關掉提示：不再出現', st(closed, t0 + 400 * DAY) === q({ auto: false, hint: false }));
  check('關掉提示、iPhone 的瀏覽器裡有資料：7 天內安靜', st(closed, t0 + 11 * DAY - 1, { sticky: true }) === q({ auto: false, hint: false }));
  check('關掉提示、iPhone 的瀏覽器裡有資料：滿 7 天再提醒', st(closed, t0 + 11 * DAY, { sticky: true }) === q({ auto: false, hint: true }));
  const skipped = m.afterChoice(seen, 'skip', t0);
  check('略過：不再主動跳出、沒有提示', st(skipped, t0 + 400 * DAY) === q({ auto: false, hint: false }));
  check('略過、iPhone 的瀏覽器裡有資料：7 天後提示', st(skipped, t0 + 7 * DAY - 1, { sticky: true }) === q({ auto: false, hint: false })
    && st(skipped, t0 + 7 * DAY, { sticky: true }) === q({ auto: false, hint: true }));
  const installed = m.afterChoice(later, 'installed', t0);
  check('已安裝（還在瀏覽器分頁）：沒有提示', st(installed, t0 + 400 * DAY, { sticky: true }) === q({ auto: false, hint: false }));
  check('沒有記過就選（☰ 打開後安裝）：也記得下來', m.afterChoice(undefined, 'installed', t0).choice === 'installed');
  check('自己選裝置：四種', q(m.PLATFORM_CHOICES.map((c) => c.value)) === q(['iphone', 'ipad', 'android', 'desktop']));
}

/* ===== headless Chrome ===== */

const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const SMALL = { width: 375, height: 667, deviceScaleFactor: 2, mobile: true };
const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };

/**
 * 隔離的頁面（像一台新裝置），不是「已安裝」
 * touch：navigator.maxTouchPoints；standalone：從主畫面開啟；clipboard：false ＝不能用剪貼簿
 */
async function openPage(chrome, { ua, touch = 5, standalone = false, clipboard = true, view = PHONE } = {}) {
  const page = await chrome.newPage(null, { isolated: true, installed: false });
  await page.cdp('Emulation.setDeviceMetricsOverride', view);
  if (ua) await page.cdp('Emulation.setUserAgentOverride', { userAgent: ua });
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI));
      // 真的 beforeinstallprompt（headless 不一定有）不算，只用測試派出去的假事件
      window.addEventListener('beforeinstallprompt', (e) => { if (!e.__fake) e.stopImmediatePropagation(); }, true);
      window.__downloads = 0;
      const anchorClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads++; else anchorClick.call(this); };
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { configurable: true, get: () => ${touch} });
      Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => window.__standalone ?? ${standalone} });
      // 「分頁變成 App 視窗」：display-mode 換成測試控制得了的（window.__displayMode.set(true) 會發出 change）
      const realMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        if (query !== '(display-mode: standalone)') return realMatchMedia(query);
        if (!window.__displayMode) {
          const mql = new EventTarget();
          let on = false;
          Object.defineProperty(mql, 'matches', { get: () => on });
          mql.media = query;
          mql.set = (value) => { on = value; mql.dispatchEvent(new Event('change')); };
          window.__displayMode = mql;
        }
        return window.__displayMode;
      };
      window.__copied = [];
      Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => (${clipboard}
        ? { writeText: async (t) => { window.__copied.push(t); } } : undefined) });`,
  });
  return page;
}

/** 開到某一頁，等 App 畫好 */
async function go(page, base, hash) {
  await page.goto(`${base}${hash}`);
  await page.waitFor(`document.querySelector('#app').childElementCount > 0`, { label: `打開 ${hash}` });
  await prepare(page);
}
async function reload(page, hash = '#/') {
  await page.eval(`window.__reloading = true; location.hash = ${q(hash)}; location.reload(); true`);
  await page.waitFor(`!window.__reloading && document.readyState === 'complete' && document.querySelector('#app').childElementCount > 0`, { label: `重新載入 ${hash}` });
  await prepare(page);
  await sleep(600); // 要不要顯示教學是啟動後在背景決定的
}
const frames = (page) => page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
const meta = (page, key) => page.eval(`import('/js/db.js').then((db) => db.getMeta(${q(key)}))`);
const setMeta = (page, key, value) => page.eval(`import('/js/db.js').then((db) => db.setMeta(${q(key)}, ${q(value)})).then(() => true)`);
/** 把「可以提示的時間」調到過去（＝等了好幾天） */
const makeHintDue = (page) => page.eval(`import('/js/db.js').then(async (db) =>
  db.setMeta('installGuide', { ...(await db.getMeta('installGuide')), hintAfter: new Date(Date.now() - 1000).toISOString() })).then(() => true)`);
const seedBean = (page) => page.eval(`import('/js/db.js').then((db) => db.put('beans', { id: 'bean-1', name: '測試豆', origin: '', country: '', region: '',
  process: 'washed', roastLevel: 'light', roastDate: '', bagWeightG: null, archived: false, createdAt: new Date().toISOString() })).then(() => true)`);

const guideShown = (page) => page.eval(`Boolean(document.querySelector('.install-guide'))`);
const tourShown = (page) => page.eval(`Boolean(document.querySelector('.tour:not(.install-guide)'))`);
const waitGuide = (page, label = '安裝教學') => page.waitFor(`document.querySelector('.install-guide .install-card')`, { label });
const waitTour = (page, label = '新手教學') => page.waitFor(`document.querySelector('.tour:not(.install-guide) .tour-card')`, { label });
const hint = (page) => page.eval(`document.querySelector('.install-hint')?.textContent.replace(/\\s+/g, '') ?? null`);

/** 安裝教學目前的內容與版面 */
const guide = (page) => page.eval(`(() => {
  const r = document.querySelector('.install-guide');
  if (!r) return null;
  const c = r.querySelector('.install-card');
  const b = c.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = innerHeight;
  const visible = (el) => el && !el.closest('[hidden]') && el.getClientRects().length > 0;
  return {
    screen: r.dataset.screen, kind: r.dataset.kind,
    title: c.querySelector('#install-title').textContent,
    text: c.textContent.replace(/\\s+/g, ''),
    art: c.querySelector('.install-art')?.getAttribute('aria-label') ?? '',
    steps: c.querySelectorAll('.install-steps li').length,
    installBtn: visible(c.querySelector('[data-act="install"]')),
    copyBtn: visible(c.querySelector('[data-act="copy"]')),
    buttons: [...c.querySelectorAll('.install-actions button')].filter(visible).map((x) => x.textContent),
    other: visible(c.querySelector('[data-act="other"]')),
    inView: b.left >= 0 && b.top >= 0 && b.right <= vw + 0.5 && b.bottom <= vh + 0.5,
    noHScroll: document.documentElement.scrollWidth <= vw && c.scrollWidth <= c.clientWidth + 1,
    dialog: c.getAttribute('role') === 'dialog' && c.getAttribute('aria-modal') === 'true'
      && document.getElementById(c.getAttribute('aria-labelledby'))?.textContent === c.querySelector('#install-title').textContent,
    focusInCard: c.contains(document.activeElement),
    bigButtons: [...c.querySelectorAll('button')].filter(visible).every((x) => x.getBoundingClientRect().height >= 44),
  };
})()`);
const layoutOk = (g) => g.inView && g.noHScroll && g.dialog && g.focusInCard && g.bigButtons;

let shots;
async function shot(page, name) {
  await frames(page);
  const { data } = await page.cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(shots, `${name}.png`), Buffer.from(data, 'base64'));
}
/** 目前的畫面深色、淺色各截一張 */
async function shotBoth(page, name) {
  for (const theme of ['dark', 'light']) {
    await page.eval(`document.documentElement.dataset.theme = ${q(theme)}; true`);
    await shot(page, `${name}-${theme}`);
  }
  await page.eval(`document.documentElement.dataset.theme = 'dark'; true`);
}
const fakePrompt = (page, outcome = 'accepted') => page.eval(`(() => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.__fake = true;
  window.__prompted = window.__prompted ?? 0;
  e.prompt = async () => { window.__prompted++; };
  e.userChoice = Promise.resolve({ outcome: ${q(outcome)} });
  window.dispatchEvent(e);
  return e.defaultPrevented;
})()`);
const key = async (page, k, code) => {
  await page.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code });
  await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
};
async function finish(page, label) {
  check(`${label}：沒有 CSP 違規`, (await page.eval('window.__csp')).length === 0, (await page.eval('window.__csp')).join(' / '));
  check(`${label}：沒有 JavaScript 錯誤`, page.errors.length === 0, page.errors.join(' / '));
  await page.close();
}

let server;
let chrome;
try {
  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();
  shots = await mkdtemp(path.join(tmpdir(), 'coffee-log-install-'));
  let page;
  let g;

  /* ===== Android Chrome：全新使用者，安裝 → 從主畫面打開才有新手教學 ===== */
  page = await openPage(chrome, { ua: UA.androidChrome });
  await go(page, base, '#/');
  await waitGuide(page);
  check('Android、全新使用者：打開首頁先顯示安裝教學（新手教學還沒出現）', !(await tourShown(page)));
  check('一顯示就記成看過；新手教學還沒記', Boolean((await meta(page, 'installGuide'))?.seenAt) && (await meta(page, 'onboardingSeen')) == null);
  g = await guide(page);
  check('Android、瀏覽器還沒說可以安裝：教「右上角 ⋮ → 安裝應用程式／加到主畫面」，沒有安裝按鈕',
    g.kind === 'android' && !g.installBtn && g.art.includes('右上角') && g.steps === 3 && g.text.includes('安裝應用程式') && g.text.includes('加到主畫面'), q(g));
  check('Android（選單教學）：卡片在畫面內、不橫向捲動、是 dialog、焦點在卡片裡、按鈕夠大', layoutOk(g), q(g));
  check('有「略過」「稍後」、可以改選裝置', q(g.buttons) === q(['略過', '稍後']) && g.other, q(g));
  await shotBoth(page, 'android-menu');
  check('攔下 beforeinstallprompt（不讓瀏覽器自己跳橫幅）', await fakePrompt(page));
  await page.waitFor(`document.querySelector('.install-guide [data-act="install"]')`, { label: '出現安裝按鈕' });
  g = await guide(page);
  check('Android、瀏覽器說可以安裝：換成大大的「安裝」按鈕', g.installBtn && g.text.includes('📲安裝') && layoutOk({ ...g, focusInCard: true }), q(g));
  check('「安裝」按鈕夠大（≥ 56px）', (await page.eval(`document.querySelector('.install-guide [data-act="install"]').getBoundingClientRect().height`)) >= 56);
  await shotBoth(page, 'android-button');
  await click(page, '.install-guide [data-act="install"]');
  await page.waitFor('window.__prompted === 1', { label: '叫出系統的安裝視窗' });
  check('按「安裝」：叫出系統的安裝視窗', true);
  await page.eval(`window.dispatchEvent(new Event('appinstalled')); true`);
  await page.waitFor(`document.querySelector('.install-guide')?.dataset.screen === 'done'`, { label: '安裝完成' });
  g = await guide(page);
  check('收到 appinstalled：顯示「安裝完成，請從主畫面打開」', g.title.includes('安裝完成') && g.text.includes('主畫面') && g.text.includes('打開') && g.buttons.length === 0, q(g));
  await shotBoth(page, 'android-done');
  await click(page, '.install-guide [data-act="done"]');
  await sleep(600);
  check('按「好」：教學關掉，這個分頁不接新手教學、也不記成看過',
    !(await guideShown(page)) && !(await tourShown(page)) && (await meta(page, 'onboardingSeen')) == null);
  check('記下已安裝', (await meta(page, 'installGuide'))?.choice === 'installed');
  await reload(page);
  check('裝好後重新整理瀏覽器分頁：不再跳安裝教學、不跳新手教學、沒有提示', !(await guideShown(page)) && !(await tourShown(page)) && (await hint(page)) == null);
  check('還在瀏覽器分頁：☰ 仍有「📲 安裝 App」', (await page.eval(`(() => { const b = document.getElementById('menu-install'); return !b.hidden && b.textContent; })()`)) === '📲安裝 App');
  // 從主畫面打開（同一份資料）
  await page.eval(`window.__standalone = true; true`);
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__standalone = true;' });
  await reload(page);
  await waitTour(page, '從主畫面第一次打開的新手教學');
  check('從主畫面第一次打開：沒有安裝教學，接著顯示新手教學', !(await guideShown(page)) && Boolean(await meta(page, 'onboardingSeen')));
  check('已安裝：☰ 沒有「安裝 App」', await page.eval(`document.getElementById('menu-install').hidden`));
  await finish(page, 'Android（安裝）');

  /* ===== Android：稍後（Esc）→ 新手教學 → 3 天後首頁提示 → 關掉不再出現 ===== */
  page = await openPage(chrome, { ua: UA.androidChrome });
  await go(page, base, '#/');
  await waitGuide(page);
  await key(page, 'Tab', 9);
  await key(page, 'Tab', 9);
  await key(page, 'Tab', 9);
  await key(page, 'Tab', 9);
  check('按 Tab：焦點留在卡片裡', await page.eval(`document.querySelector('.install-card').contains(document.activeElement)`));
  await key(page, 'Escape', 27);
  await waitTour(page, '稍後之後的新手教學');
  check('按 Esc（＝稍後）：安裝教學關掉，接著顯示新手教學', !(await guideShown(page)));
  let m = await meta(page, 'installGuide');
  const days = (new Date(m.hintAfter).getTime() - Date.now()) / 86400000;
  check('稍後：記下 3 天後才提示', m.choice === 'later' && !m.quiet && Math.abs(days - 3) < 0.01, q(m));
  await click(page, '.tour:not(.install-guide) [data-act="skip"]');
  await reload(page);
  check('重新整理：不再主動跳出，3 天內首頁沒有提示', !(await guideShown(page)) && !(await tourShown(page)) && (await hint(page)) == null);
  await makeHintDue(page);
  await reload(page);
  const h = await hint(page);
  check('3 天後：首頁顯示一條小提示', Boolean(h) && h.includes('安裝到主畫面'), String(h));
  check('小提示：一行（≤ 60px 高）、不橫向捲動、按鈕 ≥ 44px', await page.eval(`(() => {
    const el = document.querySelector('.install-hint'); const r = el.getBoundingClientRect();
    return r.height <= 60 && document.documentElement.scrollWidth <= document.documentElement.clientWidth
      && [...el.querySelectorAll('button')].every((b) => b.getBoundingClientRect().height >= 44 && b.getBoundingClientRect().width >= 44);
  })()`));
  await shotBoth(page, 'home-hint');
  await click(page, '#install-hint-open');
  await waitGuide(page, '從提示打開安裝教學');
  g = await guide(page);
  check('按提示：打開安裝教學，只有「關閉」', g.kind === 'android' && q(g.buttons) === q(['關閉']), q(g));
  await click(page, '.install-guide [data-act="later"]');
  check('關閉後提示還在（沒有改設定）', !(await guideShown(page)) && Boolean(await hint(page)) && q(await meta(page, 'installGuide')) === q({ ...m, hintAfter: (await meta(page, 'installGuide')).hintAfter }));
  await click(page, '#install-hint-close');
  await page.waitFor(`!document.querySelector('.install-hint')`, { label: '關掉提示' });
  await makeHintDue(page);
  await reload(page);
  check('按 ✕：之後不再出現（時間到了也不提示）', (await hint(page)) == null && (await meta(page, 'installGuide')).quiet === true);
  // ☰ 隨時重看
  const before = q(await meta(page, 'installGuide'));
  await click(page, '#menu-btn');
  await click(page, '#menu-install');
  await waitGuide(page, '☰ 的安裝 App');
  check('☰「📲 安裝 App」：選單關掉、打開安裝教學', await page.eval(`document.getElementById('app-menu').hidden`));
  await click(page, '#menu-install');
  check('重複按不會疊兩層', (await page.eval(`document.querySelectorAll('.install-guide').length`)) === 1);
  await key(page, 'Escape', 27);
  check('☰ 重看後關掉：焦點回到 ☰、設定沒變', !(await guideShown(page)) && (await page.eval('document.activeElement?.id')) === 'menu-btn' && q(await meta(page, 'installGuide')) === before);
  // 從瀏覽器選單自己安裝（教學沒開著）
  await page.eval(`window.dispatchEvent(new Event('appinstalled')); true`);
  await page.waitFor(`document.getElementById('toast').classList.contains('show') && document.getElementById('toast').textContent.includes('安裝完成')`, { label: '安裝完成的 toast' });
  check('教學沒開著時收到 appinstalled：toast「安裝完成，請從主畫面打開 App」、記下已安裝',
    (await page.eval(`document.getElementById('toast').textContent`)).includes('主畫面') && (await meta(page, 'installGuide')).choice === 'installed');
  await finish(page, 'Android（稍後）');

  /* ===== Android：略過 → 不再跳、沒有提示；按「安裝」後取消 ===== */
  page = await openPage(chrome, { ua: UA.androidEdge });
  await go(page, base, '#/');
  await waitGuide(page);
  await fakePrompt(page, 'dismissed');
  await click(page, '.install-guide [data-act="install"]');
  await page.waitFor(`window.__prompted === 1 && !document.querySelector('.install-guide [data-act="install"]')`, { label: '取消安裝後' });
  g = await guide(page);
  check('系統的安裝視窗按了取消：教學還在，改教 ⋮ 選單', g.screen === 'main' && !g.installBtn && g.steps === 3, q(g));
  await click(page, '.install-guide [data-act="skip"]');
  await waitTour(page, '略過之後的新手教學');
  check('按「略過」：接著顯示新手教學', !(await guideShown(page)));
  await key(page, 'Escape', 27);
  await makeHintDue(page);
  await reload(page);
  check('略過後重新整理：不再主動跳出，時間過了也沒有提示', !(await guideShown(page)) && !(await tourShown(page)) && (await hint(page)) == null);
  check('略過後：☰ 還是可以重看', !(await page.eval(`document.getElementById('menu-install').hidden`)));
  await finish(page, 'Android（略過）');

  /* ===== iPhone Safari ===== */
  page = await openPage(chrome, { ua: UA.iphoneSafari });
  await go(page, base, '#/');
  await waitGuide(page);
  g = await guide(page);
  check('iPhone Safari：3 步驟「下方分享按鈕 → 加入主畫面 → 新增」，圖上標出分享按鈕在下方',
    g.kind === 'ios-safari' && g.steps === 3 && g.art.includes('下方') && g.text.includes('下方的分享按鈕') && g.text.includes('加入主畫面') && g.text.includes('新增') && !g.installBtn, q(g));
  check('iPhone Safari：說明資料、登入是分開的；找不到分享按鈕時先按 ⋯', g.text.includes('分開的') && g.text.includes('登入') && g.text.includes('找不到？先按⋯'), g.text);
  check('iPhone Safari：好處（沒有網路也能用、全螢幕、收得到通知）', g.text.includes('沒有網路也能用') && g.text.includes('全螢幕') && g.text.includes('收得到通知'), g.text);
  check('iPhone Safari：卡片在畫面內、不橫向捲動、是 dialog、焦點在卡片裡', layoutOk(g), q(g));
  await shotBoth(page, 'iphone-safari');
  await page.cdp('Emulation.setDeviceMetricsOverride', SMALL);
  await sleep(200);
  g = await guide(page);
  check('375×667：卡片仍在畫面內（太長就在卡片裡捲動）', g.inView && g.noHScroll, q(g));
  await page.cdp('Emulation.setDeviceMetricsOverride', PHONE);
  // 自己選裝置
  await click(page, '.install-guide [data-act="other"]');
  g = await guide(page);
  check('「不是這個裝置？」：四個裝置可以選', g.screen === 'pick' && (await page.eval(`[...document.querySelectorAll('.install-pick button')].map((b) => b.textContent).join('|')`)) === 'iPhone|iPad|Android 手機|電腦', q(g));
  await shotBoth(page, 'pick');
  await click(page, '.install-pick [data-value="ipad"]');
  g = await guide(page);
  check('選 iPad：分享按鈕標在右上角', g.screen === 'main' && g.art.includes('右上角') && g.text.includes('右上角的分享按鈕'), q(g));
  await click(page, '.install-guide [data-act="other"]');
  await click(page, '.install-pick [data-value="android"]');
  g = await guide(page);
  check('選 Android：⋮ 選單的教學', g.text.includes('安裝應用程式') && g.steps === 3, q(g));
  await click(page, '.install-guide [data-act="later"]');
  await waitTour(page, 'iPhone 的新手教學');
  check('iPhone、稍後：接著顯示新手教學', true);
  await key(page, 'Escape', 27);
  await makeHintDue(page);
  await reload(page);
  check('iPhone、沒有資料：3 天後的提示可以永久關掉', (await hint(page))?.includes('安裝到主畫面')
    && (await page.eval(`document.querySelector('#install-hint-close').getAttribute('aria-label')`)) === '關閉，不再提醒');
  await finish(page, 'iPhone Safari');

  /* ===== iPad（自稱 Mac＋觸控） ===== */
  page = await openPage(chrome, { ua: UA.mac, touch: 5, view: { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true } });
  await go(page, base, '#/');
  await waitGuide(page);
  g = await guide(page);
  check('iPad：分享按鈕標在右上角', g.kind === 'ios-safari' && g.art.includes('右上角') && g.text.includes('右上角的分享按鈕') && layoutOk(g), q(g));
  await shot(page, 'ipad-dark');
  await finish(page, 'iPad');

  /* ===== iPhone 的 Chrome ===== */
  page = await openPage(chrome, { ua: UA.iphoneChrome });
  await go(page, base, '#/');
  await waitGuide(page);
  g = await guide(page);
  check('iPhone Chrome：同樣用分享選單加入主畫面（分享按鈕在網址列右邊），找不到就改用 Safari、可以複製網址',
    g.kind === 'ios-other' && g.steps === 3 && g.text.includes('網址列右邊的分享按鈕') && g.text.includes('加入主畫面') && g.text.includes('改用Safari開啟') && g.copyBtn && layoutOk(g), q(g));
  await shotBoth(page, 'iphone-chrome');
  await click(page, '.install-guide [data-act="copy"]');
  await page.waitFor('window.__copied.length === 1', { label: '複製網址' });
  check('「複製網址」：複製的是 App 的網址（不含 #）', (await page.eval('window.__copied[0]')) === base, await page.eval('window.__copied[0]'));
  await finish(page, 'iPhone Chrome');

  page = await openPage(chrome, { ua: UA.iphoneChromeOld });
  await go(page, base, '#/');
  await waitGuide(page);
  g = await guide(page);
  check('iPhone Chrome（iOS 16.3）：請改用 Safari 開啟、可以複製網址，沒有做不到的步驟',
    g.title === '請改用 Safari 開啟' && g.copyBtn && g.steps === 0 && layoutOk(g), q(g));
  await shotBoth(page, 'iphone-chrome-old');
  await finish(page, 'iPhone Chrome（舊）');

  /* ===== LINE 內建的瀏覽器 ===== */
  page = await openPage(chrome, { ua: UA.line, clipboard: false });
  await go(page, base, '#/');
  await waitGuide(page);
  g = await guide(page);
  check('LINE：明確說「請改用瀏覽器開啟」、右上角、不能安裝、資料可能消失',
    g.kind === 'in-app' && g.title === '請改用瀏覽器開啟' && g.text.includes('右上角') && g.text.includes('不能安裝') && g.text.includes('資料也可能消失')
      && g.text.includes('瀏覽器開啟') && g.art.includes('右上角') && g.copyBtn && !g.installBtn && layoutOk(g), q(g));
  await shotBoth(page, 'line');
  await click(page, '.install-guide [data-act="copy"]');
  await page.waitFor(`document.querySelector('.install-url')`, { label: '顯示網址' });
  check('LINE、不能用剪貼簿：把網址顯示出來讓使用者長按複製', (await page.eval(`document.querySelector('.install-url').textContent`)) === base);
  g = await guide(page);
  check('顯示網址後不橫向捲動', g.inView && g.noHScroll, q(g));
  await finish(page, 'LINE');

  /* ===== 電腦 ===== */
  page = await openPage(chrome, { ua: UA.desktopChrome, touch: 0, view: DESKTOP });
  await go(page, base, '#/');
  await waitGuide(page);
  g = await guide(page);
  check('電腦 Chrome：網址列右邊的安裝圖示', g.kind === 'desktop-chromium' && g.art.includes('網址列右邊') && g.text.includes('網址列右邊的安裝圖示') && !g.installBtn && layoutOk(g), q(g));
  await fakePrompt(page);
  await page.waitFor(`document.querySelector('.install-guide [data-act="install"]')`, { label: '電腦的安裝按鈕' });
  await shotBoth(page, 'desktop-chrome');
  // 電腦安裝後，這個分頁直接變成 App 的視窗
  await click(page, '.install-guide [data-act="install"]');
  await page.eval(`window.dispatchEvent(new Event('appinstalled')); true`);
  await page.waitFor(`document.querySelector('.install-guide')?.dataset.screen === 'done'`, { label: '電腦安裝完成' });
  await page.eval(`window.__displayMode.set(true); true`);
  await waitTour(page, '電腦安裝後當場接新手教學');
  check('電腦：安裝後分頁變成 App 視窗 → 安裝教學自己關掉、當場接新手教學、☰ 的「安裝 App」消失',
    !(await guideShown(page)) && await page.eval(`document.getElementById('menu-install').hidden`));
  await finish(page, '電腦 Chrome');

  page = await openPage(chrome, { ua: UA.desktopFirefox, touch: 0, view: DESKTOP });
  await go(page, base, '#/');
  await waitGuide(page);
  g = await guide(page);
  check('電腦的其他瀏覽器：一般說明（用 Chrome 或 Edge 開啟）、可以複製網址', g.kind === 'desktop-other' && g.text.includes('Chrome') && g.text.includes('Edge') && g.copyBtn && layoutOk(g), q(g));
  await shot(page, 'desktop-other-dark');
  await finish(page, '電腦 Firefox');

  /* ===== 認不出來：讓使用者自己選 ===== */
  page = await openPage(chrome, { ua: UA.unknown, touch: 0 });
  await go(page, base, '#/');
  await waitGuide(page);
  g = await guide(page);
  check('認不出裝置：先讓使用者選裝置', g.screen === 'pick' && g.title.includes('哪一種裝置') && layoutOk(g), q(g));
  await click(page, '.install-pick [data-value="iphone"]');
  g = await guide(page);
  check('選 iPhone：下方分享按鈕的教學', g.screen === 'main' && g.art.includes('下方') && g.steps === 3, q(g));
  await finish(page, '認不出來');

  /* ===== 已經從主畫面開啟：完全不顯示 ===== */
  page = await openPage(chrome, { ua: UA.iphoneSafari, standalone: true });
  await go(page, base, '#/');
  await waitTour(page, '已安裝：直接新手教學');
  check('從主畫面開啟：沒有安裝教學，直接新手教學；不記安裝教學', !(await guideShown(page)) && (await meta(page, 'installGuide')) == null);
  check('從主畫面開啟：☰ 沒有「安裝 App」', await page.eval(`document.getElementById('menu-install').hidden`));
  await key(page, 'Escape', 27);
  check('從主畫面開啟：首頁沒有提示', (await hint(page)) == null);
  await finish(page, 'iPhone 主畫面');

  /* ===== 從別的頁面打開：不打斷、不記 ===== */
  page = await openPage(chrome, { ua: UA.androidChrome });
  await go(page, base, '#/settings');
  await sleep(600);
  check('從首頁以外的頁面打開：不顯示、不記', !(await guideShown(page)) && (await meta(page, 'installGuide')) == null);

  /* ===== 已經在用的人（有紀錄、看過新手教學）：跳一次，不接新手教學 ===== */
  await seedBean(page);
  await setMeta(page, 'onboardingSeen', new Date().toISOString());
  await reload(page);
  await waitGuide(page, '舊使用者的安裝教學');
  g = await guide(page);
  check('Android、已有紀錄：直接是安裝步驟（和瀏覽器共用資料，不用先備份）', g.screen === 'main' && g.kind === 'android', q(g));
  await click(page, '.install-guide [data-act="later"]');
  await sleep(600);
  check('舊使用者關掉安裝教學：不接新手教學', !(await guideShown(page)) && !(await tourShown(page)));
  await reload(page);
  check('舊使用者：只跳一次', !(await guideShown(page)));
  await finish(page, 'Android（舊使用者）');

  /* ===== iPhone 的瀏覽器裡已經有紀錄：先備份再安裝 ===== */
  page = await openPage(chrome, { ua: UA.iphoneSafari });
  await go(page, base, '#/settings');
  await seedBean(page);
  await setMeta(page, 'onboardingSeen', new Date().toISOString());
  await reload(page);
  await waitGuide(page, 'iPhone 有紀錄的安裝教學');
  g = await guide(page);
  check('iPhone、已有紀錄：先顯示「先備份，再安裝」，有「立即匯出備份」，說明安裝後到 ☰ → 備份 匯入',
    g.screen === 'backup' && g.title === '先備份，再安裝' && g.text.includes('立即匯出備份') && g.text.includes('另一份資料')
      && g.text.includes('☰→「備份」→匯入') && layoutOk(g), q(g));
  await shotBoth(page, 'backup-first');
  await click(page, '.install-guide [data-act="backup"]');
  await page.waitFor(`document.querySelector('.install-guide')?.dataset.screen === 'main'`, { label: '匯出後到安裝步驟' });
  check('按「立即匯出備份」：下載備份檔、記下備份時間，接著顯示安裝步驟',
    (await page.eval('window.__downloads')) === 1 && Boolean(await meta(page, 'lastBackupAt')) && (await guide(page)).art.includes('下方'));
  await click(page, '.install-guide [data-act="skip"]');
  await sleep(500);
  check('iPhone 舊使用者略過：不接新手教學', !(await guideShown(page)) && !(await tourShown(page)));
  check('iPhone、有紀錄、略過：7 天內沒有提示', (await hint(page)) == null);
  await makeHintDue(page);
  await reload(page);
  check('iPhone、有紀錄：略過了 7 天後還是提示（資料可能被清掉），關掉只安靜 7 天',
    (await hint(page))?.includes('加入主畫面，資料才安全') && (await page.eval(`document.querySelector('#install-hint-close').getAttribute('aria-label')`)) === '關閉，7 天後再提醒');
  await click(page, '#install-hint-open');
  await waitGuide(page, '從提示打開（有紀錄）');
  check('從提示打開：一樣先顯示「先備份，再安裝」，可以按「下一步」跳過', (await guide(page)).screen === 'backup');
  await click(page, '.install-guide [data-act="continue"]');
  check('按「下一步」：安裝步驟', (await guide(page)).screen === 'main');
  await click(page, '.install-guide [data-act="later"]');
  await finish(page, 'iPhone（有紀錄）');

  /* ===== LINE 裡已經有紀錄：去備份頁（這裡不能直接下載） ===== */
  page = await openPage(chrome, { ua: UA.line });
  await go(page, base, '#/settings');
  await seedBean(page);
  await setMeta(page, 'onboardingSeen', new Date().toISOString());
  await reload(page);
  await waitGuide(page, 'LINE 有紀錄');
  g = await guide(page);
  check('LINE、已有紀錄：先備份，按鈕是「去備份」', g.screen === 'backup' && g.text.includes('去備份') && g.text.includes('改用瀏覽器開啟後'), q(g));
  await click(page, '.install-guide [data-act="backup"]');
  await page.waitFor(`location.hash === '#/backup' && document.querySelector('#export')`, { label: '備份頁' });
  check('LINE「去備份」：到備份頁、沒有假裝下載、沒記成已備份', !(await guideShown(page)) && (await page.eval('window.__downloads')) === 0 && !(await meta(page, 'lastBackupAt')));
  await finish(page, 'LINE（有紀錄）');
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
