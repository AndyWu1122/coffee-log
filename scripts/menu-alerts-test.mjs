// ☰ 選單的「!」（該備份了、還沒看過的更新內容）、設定與關於頁、更新內容頁
// 不需要 Supabase（沒登入時社群提示只讀本機）；headless Chrome（找不到時設 CHROME_PATH）
// 確認：☰ 選單在小螢幕（375×667）放得下、不常用的項目在設定頁；設定頁的版本號、切換外觀；
// 全新安裝不提示；超過 14 天沒備份時 ☰ 和「備份」有「!」，按「稍後」照樣顯示、匯出後消失；
// 更新後顯示「已更新」、☰ 的「設定與關於」與設定頁「更新內容」的「!」，打開更新內容頁或按 ✕ 後消失；已經在用、沒記過版本的人算剛更新；
// js/changelog.js 第一段的版本＝sw.js 的 APP_VERSION
//
// 用法：node scripts/menu-alerts-test.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root, startServer, launchChrome, click, prepare } from './chrome.mjs';
import { CHANGELOG, compareVersions } from '../js/changelog.js';

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const q = JSON.stringify;
const DAY = 86400000;

/* ===== 更新內容的資料 ===== */
const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
const APP_VERSION = sw.match(/const APP_VERSION = '([\d.]+)'/)?.[1];
check('更新內容第一段的版本＝sw.js 的 APP_VERSION', CHANGELOG[0]?.version === APP_VERSION, `${CHANGELOG[0]?.version} / ${APP_VERSION}`);
check('更新內容由新到舊、沒有重複', CHANGELOG.every((e, i) => i === 0 || compareVersions(CHANGELOG[i - 1].version, e.version) > 0));
check('每一段都有內容', CHANGELOG.every((e) => e.items.length > 0 && e.items.every((t) => typeof t === 'string' && t.trim())));
check('sw.js 的 ASSETS 有更新內容的檔案', sw.includes("'js/changelog.js'") && sw.includes("'js/views/changelog.js'"));
check('compareVersions：1.10.0 比 1.9.9 新、舊版整數當最舊',
  compareVersions('1.10.0', '1.9.9') > 0 && compareVersions('1.0.0', '18') > 0 && compareVersions('1.0.0', null) > 0);

let server;
let chrome;
try {
  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();
  const page = await chrome.newPage(`${base}#/backup`, { isolated: true });
  await prepare(page);

  const shown = (sel) => page.eval(`(() => { const el = document.querySelector(${q(sel)}); return Boolean(el) && getComputedStyle(el).display !== 'none'; })()`);
  const waitShown = (sel, yes, label) => page.waitFor(`(() => { const el = document.querySelector(${q(sel)}); return Boolean(el) && (getComputedStyle(el).display !== 'none') === ${yes}; })()`, { label });
  const recheck = () => page.eval(`window.dispatchEvent(new Event('social-badges-changed')); true`);
  const db = (code) => page.eval(`import('/js/db.js').then(async (db) => { ${code} })`);
  const menuLabel = () => page.eval(`document.querySelector('#menu-btn').getAttribute('aria-label')`);
  // 一般的重新整理（chrome.mjs 的 reload 是強制重新整理，會略過 Service Worker，就問不到版本號）
  const open = async (hash) => {
    await page.eval(`window.__reloading = true; location.hash = ${q(hash)}; location.reload(); true`);
    await page.waitFor('!window.__reloading && document.readyState === "complete" && Boolean(navigator.serviceWorker.controller)', { label: `重新載入 ${hash}` });
    await prepare(page);
  };

  /* ===== 全新安裝：沒有任何「!」 ===== */
  await page.waitFor('Boolean(navigator.serviceWorker.controller)', { label: 'Service Worker 接管' });
  await page.waitFor(`import('/js/db.js').then((db) => db.getMeta('changelogSeen')).then((v) => v === ${q(APP_VERSION)})`, { label: '記下看過的版本' });
  await recheck();
  await open('#/settings');
  await page.waitFor(`document.querySelector('#app-version a')?.textContent === ${q(`版本 ${APP_VERSION}`)}`, { label: '設定頁的版本號' });
  check('全新安裝：記成看過這一版、不提示',
    !(await shown('#menu-badge')) && !(await shown('[data-alert="settings"]')) && !(await shown('[data-alert="changelog"]')) && !(await shown('#updated-banner')));
  check('設定頁的版本號連到更新內容', (await page.eval(`document.querySelector('#app-version a').getAttribute('href')`)) === '#/changelog');
  const settingsLinks = await page.eval(`[...document.querySelectorAll('.settings a.settings-row')].map((a) => a.getAttribute('href'))`);
  check('設定頁有通知設定、隱私說明、更新內容、意見回饋',
    ['#/notifications', '#/privacy', '#/changelog', '#/feedback'].every((h) => settingsLinks.includes(h)), q(settingsLinks));
  check('沒登入：設定頁看不到開發者後台', !(await shown('.settings [data-admin]')));

  /* ===== ☰ 選單：只放常用的，小螢幕放得下 ===== */
  const menuHrefs = await page.eval(`[...document.querySelectorAll('#app-menu a[role="menuitem"]:not([hidden])')].map((a) => a.getAttribute('href'))`);
  check('☰ 選單只有常用的項目＋設定與關於',
    q(menuHrefs) === q(['#/account', '#/friends', '#/stats', '#/grinders', '#/drippers', '#/backup', '#/settings']), q(menuHrefs));
  check('☰ 選單沒有外觀、版本號', !(await page.eval(`Boolean(document.querySelector('#app-menu [data-theme-pref], #app-menu #app-version'))`)));
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 2, mobile: true });
  await click(page, '#menu-btn');
  const menuBox = await page.eval(`(() => { const el = document.getElementById('app-menu'); const r = el.getBoundingClientRect();
    return { hidden: el.hidden, bottom: r.bottom, left: r.left, right: r.right, vh: innerHeight, vw: innerWidth, scroll: el.scrollHeight - el.clientHeight }; })()`);
  check('375×667：☰ 選單整個在畫面內、不用捲動',
    !menuBox.hidden && menuBox.bottom <= menuBox.vh && menuBox.left >= 0 && menuBox.right <= menuBox.vw && menuBox.scroll <= 0, q(menuBox));
  await click(page, '#app-menu a[href="#/settings"]');
  await page.waitFor(`Boolean(document.querySelector('.settings')) && document.getElementById('app-menu').hidden`, { label: '從 ☰ 到設定頁' });
  check('設定頁不屬於任何底部分頁', !(await page.eval(`Boolean(document.querySelector('.tabbar a.active'))`)));
  await page.cdp('Emulation.clearDeviceMetricsOverride');

  /* ===== 設定頁：外觀 ===== */
  const themeState = () => page.eval(`({ theme: document.documentElement.dataset.theme, saved: localStorage.getItem('theme'),
    checked: document.querySelector('[data-theme-pref][aria-checked="true"]')?.dataset.themePref,
    color: document.querySelector('meta[name="theme-color"]').content })`);
  await click(page, '[data-theme-pref="light"]');
  let ts = await themeState();
  check('選淺色：套用、記住、按鈕標示', ts.theme === 'light' && ts.saved === 'light' && ts.checked === 'light' && ts.color === '#ffffff', q(ts));
  await open('#/settings');
  await page.waitFor(`Boolean(document.querySelector('[data-theme-pref]'))`);
  ts = await themeState();
  check('重新整理後還是淺色', ts.theme === 'light' && ts.checked === 'light', q(ts));
  await click(page, '[data-theme-pref="dark"]');
  ts = await themeState();
  check('選深色', ts.theme === 'dark' && ts.saved === 'dark' && ts.checked === 'dark' && ts.color === '#2b1d14', q(ts));
  // 模擬系統切換：等頁面真的收到 change 事件才做下一步（瀏覽器在畫面更新時才比對，連續切兩次可能被當成沒變）
  const setSystem = async (value) => {
    await page.eval(`window.__mqChanged = false; window.__mq ??= matchMedia('(prefers-color-scheme: light)');
      __mq.addEventListener('change', () => { window.__mqChanged = true; }, { once: true }); true`);
    await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
    await page.waitFor('window.__mqChanged', { label: `系統切到${value}` });
  };
  await setSystem('light');
  await click(page, '[data-theme-pref="auto"]');
  await page.waitFor(`document.documentElement.dataset.theme === 'light'`, { label: '自動：系統是淺色' });
  await setSystem('dark');
  await page.waitFor(`document.documentElement.dataset.theme === 'dark'`, { label: '自動：系統切到深色時跟著換' });
  check('自動：跟著系統即時切換', (await themeState()).saved === 'auto');
  await page.cdp('Emulation.setEmulatedMedia', { features: [] });

  /* ===== 超過 14 天沒備份 ===== */
  await open('#/backup');
  const brewedAt = new Date(Date.now() - 20 * DAY).toISOString();
  await db(`
    await db.put('beans', { id: 'bean-1', name: '測試豆', origin: '', process: 'washed', roastLevel: 'light', roastDate: '', bagWeightG: null, archived: false, createdAt: ${q(brewedAt)} });
    await db.put('brews', { id: 'brew-1', beanId: 'bean-1', grinderId: '', dripperId: '', brewedAt: ${q(brewedAt)}, dripper: 'V60', grindSetting: '', coffeeG: 15, waterG: 240, tempC: 92, totalTimeS: 150, rating: 4, flavor: { acidity: 3, sweetness: 3, bitterness: 3, body: 3 }, flavorNotes: [], notes: '', visibility: 'private' });
    return true;`);
  await recheck();
  await waitShown('[data-alert="backup"]', true, '「備份」的「!」');
  check('20 天前的紀錄、沒備份過：☰ 和「備份」都有「!」', await shown('#menu-badge'));
  check('☰ 的 aria-label 說明是哪一項', (await menuLabel()) === '選單（該備份了）', await menuLabel());
  check('「備份」項目的 aria-label', (await page.eval(`document.querySelector('[data-alert="backup"]').closest('a').getAttribute('aria-label')`)) === '備份（該備份了）');
  check('沒有好友邀請、更新內容的「!」', !(await shown('[data-alert="friends"]')) && !(await shown('[data-alert="settings"]')));

  await db(`await db.setMeta('backupSnoozeUntil', ${q(new Date(Date.now() + 3 * DAY).toISOString())}); return true;`);
  await recheck();
  await page.eval('new Promise((r) => setTimeout(r, 300))');
  check('首頁按「稍後」後，「!」照樣顯示', await shown('[data-alert="backup"]') && await shown('#menu-badge'));

  await click(page, '#export');
  await waitShown('[data-alert="backup"]', false, '匯出後「!」消失');
  check('匯出後 ☰ 和「備份」的「!」消失', !(await shown('#menu-badge')) && (await menuLabel()) === '選單');

  /* ===== 更新後：「已更新」與「更新內容」的「!」 ===== */
  await db(`await db.setMeta('changelogSeen', '1.0.0'); return true;`);
  await open('#/backup');
  await waitShown('#updated-banner', true, '「已更新」的提示');
  check('「已更新」的提示寫出目前版本', (await page.eval(`document.querySelector('#updated-text').textContent`)) === `已更新到 ${APP_VERSION}`);
  check('「設定與關於」有「!」、☰ 也有', await shown('[data-alert="settings"]') && await shown('#menu-badge'));
  check('☰ 的 aria-label', (await menuLabel()) === '選單（有新版的更新內容）', await menuLabel());
  check('「設定與關於」項目的 aria-label',
    (await page.eval(`document.querySelector('[data-alert="settings"]').closest('a').getAttribute('aria-label')`)) === '設定與關於（有新版的更新內容）');
  await click(page, '#app-menu a[href="#/settings"]');
  await waitShown('.settings [data-alert="changelog"]', true, '設定頁「更新內容」的「!」');
  check('設定頁「更新內容」的 aria-label', (await page.eval(`document.getElementById('settings-changelog').getAttribute('aria-label')`)) === '更新內容（有新版的更新內容）');
  check('只進設定頁不算看過', await shown('[data-alert="settings"]') && await shown('#updated-banner'));

  await click(page, '#updated-link');
  await page.waitFor(`location.hash === '#/changelog' && Boolean(document.querySelector('.changelog'))`, { label: '更新內容頁' });
  await waitShown('[data-alert="settings"]', false, '看過後「!」消失');
  check('打開更新內容頁：提示和「!」消失', !(await shown('#updated-banner')) && !(await shown('#menu-badge')));
  const tags = await page.eval(`[...document.querySelectorAll('.changelog .section')].map((s) => [s.dataset.version, Boolean(s.querySelector('.changelog-new'))])`);
  check('比上次看過（1.0.0）新的每一段都標「新」', tags.length === CHANGELOG.length && tags.every(([, isNew]) => isNew), q(tags));
  check('記成看過目前版本', (await db(`return db.getMeta('changelogSeen');`)) === APP_VERSION);
  check('頁面寫出目前的版本', (await page.eval(`document.querySelector('.changelog > .hint').textContent`)).includes(APP_VERSION));

  if (CHANGELOG.length > 1) {
    await db(`await db.setMeta('changelogSeen', ${q(CHANGELOG[1].version)}); return true;`);
    await open('#/changelog');
    await page.waitFor(`Boolean(document.querySelector('.changelog'))`);
    const only = await page.eval(`[...document.querySelectorAll('.changelog .changelog-new')].map((el) => el.closest('.section').dataset.version)`);
    check('上次看過前一版：只有這一版標「新」', q(only) === q([APP_VERSION]), q(only));
  }

  /* ===== 按 ✕ ===== */
  await db(`await db.setMeta('changelogSeen', '1.0.0'); return true;`);
  await open('#/backup');
  await waitShown('#updated-banner', true, '「已更新」的提示');
  await click(page, '#updated-close');
  await waitShown('[data-alert="settings"]', false, '按 ✕ 後「!」消失');
  check('按 ✕：提示和「!」消失、記成看過', !(await shown('#updated-banner')) && (await db(`return db.getMeta('changelogSeen');`)) === APP_VERSION);

  /* ===== 已經在用、沒記過版本（更新到有這個功能的版本）：算剛更新 ===== */
  await db(`await db.remove('meta', 'changelogSeen'); return true;`);
  await open('#/backup');
  await waitShown('[data-alert="settings"]', true, '已經在用的人：「設定與關於」的「!」');
  check('有紀錄、沒記過看到哪一版：顯示「已更新」', await shown('#updated-banner'));
  await open('#/changelog');
  await page.waitFor(`Boolean(document.querySelector('.changelog'))`);
  const firstTime = await page.eval(`[...document.querySelectorAll('.changelog .changelog-new')].map((el) => el.closest('.section').dataset.version)`);
  check('第一次看：只有目前這一版標「新」', q(firstTime) === q([APP_VERSION]), q(firstTime));

  /* ===== 「有新版本可用」出現時，「已更新」先讓它 ===== */
  await db(`await db.setMeta('changelogSeen', '1.0.0'); return true;`);
  await open('#/backup');
  await waitShown('#updated-banner', true, '「已更新」的提示');
  await page.eval(`document.getElementById('update-banner').hidden = false; true`);
  check('「有新版本可用」出現時不顯示「已更新」', !(await shown('#updated-banner')));

  check('頁面沒有 JavaScript 錯誤', page.errors.length === 0, page.errors.join(' / '));

  /* ===== 防點擊劫持：被別的網頁用 iframe 嵌入 ===== */
  // 用 tests/photo.html 當「別的網頁」：不能換掉最上層的 iframe（sandbox）整頁不顯示；一般的 iframe 會把最上層換成 App
  const framer = await chrome.newPage(`${base}tests/photo.html`, { isolated: true });
  const embed = (sandbox) => framer.eval(`(() => {
    const f = Object.assign(document.createElement('iframe'), { src: ${q(`${base}#/`)}, id: 'embed' });
    ${sandbox ? `f.setAttribute('sandbox', 'allow-scripts allow-same-origin');` : ''}
    document.body.append(f);
    return true;
  })()`);
  await embed(true);
  await framer.waitFor(`document.getElementById('embed').contentDocument?.documentElement.dataset.theme`, { label: 'iframe 裡的 theme.js 執行完' });
  check('被 sandbox 的 iframe 嵌入：整頁不顯示、最上層沒被換掉',
    await framer.eval(`getComputedStyle(document.getElementById('embed').contentDocument.documentElement).display === 'none' && location.pathname === '/tests/photo.html'`));
  await framer.eval(`document.getElementById('embed').remove(), true`);
  await embed(false);
  await framer.waitFor(`location.pathname === '/' && document.readyState === 'complete' && Boolean(document.querySelector('#app'))`, { label: '最上層被換成 App' });
  check('被一般的 iframe 嵌入：最上層換成 App 本身，正常顯示',
    await framer.eval(`window.top === window.self && getComputedStyle(document.documentElement).display !== 'none'`));
} catch (err) {
  failures.push(`執行錯誤：${err.message}`);
  console.error(err);
} finally {
  await chrome?.close();
  server?.close();
}

console.log(`\n${passed}/${passed + failures.length} 通過`);
if (failures.length) {
  console.log(`失敗：\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
