// 資料保存（1.20.0）：不需要 Supabase；headless Chrome（找不到時設 CHROME_PATH）
// navigator.storage.persist／persisted 換成假的（計算呼叫次數）；iPhone 用 User-Agent 模擬，從主畫面開啟用 navigator.standalone 模擬
// 確認：沒資料時不要求保留、有資料時啟動與存檔各最多要求一次；設定頁的「資料保存」三種狀態；
// iPhone 的 Safari：首頁有「加入主畫面」提示（沒資料時沒有「匯出備份」）、取代備份提醒、「稍後」7 天、過期再出現、「匯出備份」記下備份時間；
// 從主畫面開啟、電腦都沒有提示；新手教學最後一步在 iPhone 的 Safari 多一句；390px 不橫向捲動、深淺色截圖、沒有 CSP 違規、沒有 JavaScript 錯誤
//
// 用法：node scripts/storage-test.mjs

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer, launchChrome, prepare, sleep } from './chrome.mjs';

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const q = JSON.stringify;
const VIEW = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function fixtures() {
  // 最早的紀錄 30 天前、沒備份過 → 備份提醒也該出現（用來確認「加入主畫面」取代它）
  const createdAt = new Date(Date.now() - 60 * 86400000).toISOString();
  const beans = [{ id: 'bean-a', name: '耶加雪菲', origin: '', country: '', region: '', process: 'washed', roastLevel: 'light', roastDate: '', bagWeightG: null, archived: false, createdAt }];
  const brews = [{
    id: 'brew-1', beanId: 'bean-a', grinderId: '', dripperId: '', brewedAt: new Date(Date.now() - 30 * 86400000).toISOString(), dripper: '',
    grindSetting: '', coffeeG: 15, waterG: 240, tempC: 92, totalTimeS: 150, rating: 4,
    flavor: { acidity: 3, sweetness: 3, bitterness: 3, body: 3 }, flavorNotes: [], notes: '', visibility: 'private',
  }];
  return { beans, grinders: [], drippers: [], brews };
}

/**
 * 隔離的頁面（像一支新手機）；在頁面腳本執行前換掉 persist／persisted、記錄 CSP 違規
 * ios：iPhone 的 User-Agent；standalone：從主畫面開啟；persisted：瀏覽器一開始是否已經答應保留
 */
async function openPage(chrome, { ios = false, standalone = false, persisted = false, line = false, share = null } = {}) {
  const page = await chrome.newPage(null, { isolated: true });
  await page.cdp('Emulation.setDeviceMetricsOverride', VIEW);
  // line：LINE 內建的瀏覽器（User-Agent 後面多了 Line/x.y.z）
  if (ios || line) await page.cdp('Emulation.setUserAgentOverride', { userAgent: `${IPHONE_UA}${line ? ' Line/14.0.0' : ''}`, platform: 'iPhone' });
  // share：'ok' ＝可以分享檔案（記下分享了什麼；window.__shareFail 設了就當成使用者按取消）｜'none' ＝不能分享檔案
  if (share) await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__shared = [];
      window.__downloads = 0;
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads++; else click.call(this); };
      Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: (d) => ${share === 'ok'} && Boolean(d?.files?.length) });
      Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: async (d) => {
        if (window.__shareFail) throw new DOMException('cancelled', 'AbortError');
        window.__shared.push({ name: d.files[0].name, type: d.files[0].type, text: await d.files[0].text() });
      } });`,
  });
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI));
      window.__persistCalls = 0;
      let persisted = ${persisted};
      Object.defineProperty(navigator.storage, 'persisted', { value: async () => persisted });
      Object.defineProperty(navigator.storage, 'persist', { value: async () => { window.__persistCalls++; persisted = true; return true; } });
      ${standalone ? "Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true });" : ''}`,
  });
  return page;
}

/** 打開首頁（第一次打開要等 App 畫好）；seed：先寫入資料、看過新手教學與這一版的更新內容 */
async function start(page, base, { seed = false, onboarding = false } = {}) {
  await page.goto(`${base}#/settings`);
  await page.waitFor(`document.querySelector('#settings-storage')?.dataset.state`, { label: '設定頁' });
  const version = await page.eval(`import('/js/changelog.js').then((m) => m.CHANGELOG[0].version)`);
  await page.eval(`import('/js/db.js').then(async (db) => {
    ${seed ? `await db.bulkPut(${q(fixtures())});` : ''}
    ${onboarding ? '' : "await db.setMeta('onboardingSeen', true);"}
    await db.setMeta('changelogSeen', ${q(version)});
    return true;
  })`);
  await reload(page, '#/');
}

async function reload(page, hash) {
  await page.eval(`window.__reloading = true; location.hash = ${q(hash)}; location.reload(); true`);
  await page.waitFor(`!window.__reloading && document.readyState === 'complete' && document.querySelector('#app').childElementCount > 0`, { label: '重新載入' });
  await prepare(page);
  await sleep(300); // 啟動時的 ensurePersistentStorage 是背景執行的
}

const home = (page) => page.eval(`({
  hint: Boolean(document.querySelector('.home-screen-hint')),
  hintText: document.querySelector('.home-screen-hint')?.textContent.replace(/\\s+/g, '') ?? '',
  exportBtn: Boolean(document.querySelector('.home-screen-hint #backup-now')),
  backupReminder: Boolean(document.querySelector('.backup-reminder')),
  pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
})`);
const settingsState = async (page) => {
  // 已經在設定頁時，設同一個 hash 不會重畫：先離開再回來
  if ((await page.eval('location.hash')) === '#/settings') {
    await page.eval(`location.hash = '#/changelog'; true`);
    await page.waitFor(`document.querySelector('.changelog')`, { label: '離開設定頁' });
  }
  await page.eval(`location.hash = '#/settings'; true`);
  await page.waitFor(`document.querySelector('#settings-storage')?.dataset.state`, { label: '資料保存的狀態' });
  return page.eval(`({ state: document.querySelector('#settings-storage').dataset.state, text: document.querySelector('#storage-status').textContent,
    backupLink: document.querySelector('#settings-storage a[href="#/backup"]')?.textContent ?? '' })`);
};
const persistCalls = (page) => page.eval('window.__persistCalls');
const meta = (page, key) => page.eval(`import('/js/db.js').then((db) => db.getMeta(${q(key)}))`);

/** 新手教學一路按「下一步」到最後一步，回傳那一步的內容 */
async function lastTourStep(page) {
  await page.waitFor(`document.querySelector('.tour-card')`, { label: '新手教學' });
  for (let i = 0; i < 10; i++) {
    const title = await page.eval(`document.getElementById('tour-title').textContent`);
    if (title === '記得定期備份') return page.eval(`document.getElementById('tour-body').textContent`);
    await page.eval(`document.querySelector('.tour-card [data-act="next"]').click(); true`);
    await page.waitFor(`document.getElementById('tour-title').textContent !== ${q(title)}`, { label: `離開「${title}」`, timeout: 5000 });
  }
  throw new Error('找不到新手教學的最後一步');
}

async function screenshot(page, file) {
  const height = await page.eval('Math.ceil(document.documentElement.scrollHeight)');
  await page.cdp('Emulation.setDeviceMetricsOverride', { ...VIEW, height });
  await page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  const { data } = await page.cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(file, Buffer.from(data, 'base64'));
  await page.cdp('Emulation.setDeviceMetricsOverride', VIEW);
}

async function finish(page, label) {
  check(`${label}：沒有 CSP 違規`, (await page.eval('window.__csp')).length === 0, (await page.eval('window.__csp')).join(' / '));
  check(`${label}：沒有 JavaScript 錯誤`, page.errors.length === 0, page.errors.join(' / '));
  await page.close();
}

let server;
let chrome;
const shotDir = await mkdtemp(path.join(tmpdir(), 'coffee-log-storage-'));
try {
  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();

  /* ===== 電腦／Android：要求保留資料 ===== */
  let page = await openPage(chrome);
  await start(page, base);
  check('沒有資料：打開 App 不要求保留（Firefox 才不會一打開就跳詢問）', (await persistCalls(page)) === 0, String(await persistCalls(page)));
  let h = await home(page);
  check('不是 iPhone：首頁沒有「加入主畫面」提示', !h.hint, q(h));
  let s = await settingsState(page);
  check('設定頁「資料保存」：瀏覽器還沒答應 → 可能被清、建議加到主畫面和備份，有「備份與還原」連結',
    s.state === 'best-effort' && s.text.includes('可能會清掉') && s.text.includes('備份') && s.backupLink.includes('備份與還原'), q(s));
  const saved = await page.eval(`import('/js/models.js').then((m) => m.saveBean({ name: '肯亞 AA', process: 'washed', roastLevel: 'light' })).then((r) => r.ok)`);
  await page.waitFor('window.__persistCalls === 1', { label: '存豆子後要求保留' });
  check('存第一支豆子：要求保留一次', saved);
  await page.eval(`import('/js/models.js').then((m) => m.saveBean({ name: '哥倫比亞', process: 'washed', roastLevel: 'light' }))`);
  await sleep(300);
  check('同一次開啟再存：不重複要求', (await persistCalls(page)) === 1, String(await persistCalls(page)));
  s = await settingsState(page);
  check('瀏覽器答應後：設定頁顯示「不會自動清掉」', s.state === 'persisted' && s.text.startsWith('✓'), q(s));
  await finish(page, '電腦');

  page = await openPage(chrome);
  await start(page, base, { seed: true });
  check('已經有資料：打開 App 就要求保留', (await persistCalls(page)) === 1, String(await persistCalls(page)));
  h = await home(page);
  check('不是 iPhone：照常顯示備份提醒', !h.hint && h.backupReminder, q(h));
  await finish(page, '電腦（有資料）');

  page = await openPage(chrome, { persisted: true });
  await start(page, base, { seed: true });
  check('瀏覽器已經答應過：不再要求', (await persistCalls(page)) === 0, String(await persistCalls(page)));
  await finish(page, '電腦（已保留）');

  /* ===== iPhone 的 Safari ===== */
  page = await openPage(chrome, { ios: true });
  await start(page, base);
  h = await home(page);
  check('iPhone 的 Safari、沒資料：首頁有「加入主畫面」提示，沒有「匯出備份」', h.hint && h.hintText.includes('分享」→「加入主畫面') && !h.exportBtn, q(h));
  check('首頁不橫向捲動', h.pageWidth <= h.viewport, q(h));
  s = await settingsState(page);
  check('設定頁「資料保存」：iPhone 的 Safari 說明加入主畫面、資料要用備份搬過去', s.state === 'ios-browser' && s.text.includes('加入主畫面') && s.text.includes('匯入'), q(s));
  await finish(page, 'iPhone（沒資料）');

  page = await openPage(chrome, { ios: true });
  await start(page, base, { seed: true });
  h = await home(page);
  check('iPhone 的 Safari、有資料：提示說主畫面是另一份資料，有「匯出備份」', h.hint && h.hintText.includes('資料是分開的') && h.exportBtn, q(h));
  check('「加入主畫面」取代備份提醒（不會兩張卡片疊在一起）', !h.backupReminder, q(h));
  for (const theme of ['dark', 'light']) {
    await page.eval(`document.documentElement.dataset.theme = ${q(theme)}; true`);
    await screenshot(page, path.join(shotDir, `home-hint-${theme}.png`));
  }
  await page.eval(`document.querySelector('#home-screen-later').click(); true`);
  await page.waitFor(`!document.querySelector('.home-screen-hint') && document.querySelector('.backup-reminder')`, { label: '按「稍後」' });
  const until = new Date(await meta(page, 'homeScreenSnoozeUntil')).getTime() - Date.now();
  check('按「稍後」：提示消失、換成備份提醒，7 天內不再提示', Math.abs(until - 7 * 86400000) < 60000, String(until));
  await reload(page, '#/');
  check('重新打開：還在「稍後」期間，不提示', !(await home(page)).hint);
  await page.eval(`import('/js/db.js').then((db) => db.setMeta('homeScreenSnoozeUntil', new Date(Date.now() - 1000).toISOString()))`);
  await reload(page, '#/');
  check('7 天過了：再提示一次', (await home(page)).hint);
  await page.eval(`document.querySelector('.home-screen-hint #backup-now').click(); true`);
  await page.waitFor(`document.querySelector('.toast')?.textContent.includes('已匯出備份')`, { label: '匯出備份' });
  check('按「匯出備份」：記下備份時間（提示還在，加入主畫面之前都提醒）', Boolean(await meta(page, 'lastBackupAt')) && (await home(page)).hint);
  for (const theme of ['dark', 'light']) {
    await page.eval(`document.documentElement.dataset.theme = ${q(theme)}; true`);
    await settingsState(page);
    await screenshot(page, path.join(shotDir, `settings-ios-${theme}.png`));
  }
  await finish(page, 'iPhone（有資料）');

  page = await openPage(chrome, { ios: true });
  await start(page, base, { onboarding: true });
  const iosTour = await lastTourStep(page);
  check('新手教學最後一步：iPhone 的 Safari 多一句「加入主畫面」', iosTour.includes('加入主畫面'), iosTour);
  await finish(page, 'iPhone 新手教學');

  /* ===== iPhone 從主畫面開啟 ===== */
  page = await openPage(chrome, { ios: true, standalone: true });
  await start(page, base, { onboarding: true });
  const appTour = await lastTourStep(page);
  check('從主畫面開啟：新手教學沒有「加入主畫面」', !appTour.includes('加入主畫面') && appTour.includes('使用教學'), appTour);
  await page.eval(`document.querySelector('.tour-card [data-act="skip"]')?.click(); true`);
  h = await home(page);
  check('從主畫面開啟：首頁沒有提示', !h.hint, q(h));
  s = await settingsState(page);
  check('從主畫面開啟：設定頁不是 iPhone 的 Safari 那段說明', s.state !== 'ios-browser', q(s));
  await finish(page, 'iPhone 主畫面');

  /* ===== 匯出（1.22.3）：沒有資料不匯出；LINE 內建的瀏覽器不假裝匯出了 ===== */
  const toastText = (p) => p.eval(`document.getElementById('toast').classList.contains('show') ? document.getElementById('toast').textContent : ''`);
  const openBackup = async (p) => {
    await p.eval(`location.hash = '#/backup'; true`);
    await p.waitFor(`document.querySelector('#export')`, { label: '備份頁' });
  };

  page = await openPage(chrome, { share: 'none' });
  await start(page, base);
  await openBackup(page);
  check('沒有任何資料：備份頁寫「還沒有資料可以匯出」', (await page.eval(`document.querySelector('#export-section').textContent`)).includes('還沒有資料可以匯出'));
  await page.eval(`document.querySelector('#export').click(); true`);
  await page.waitFor(`document.getElementById('toast').classList.contains('show')`, { label: '沒有資料的提示' });
  check('沒有任何資料：按匯出只提示，不下載、不記成已備份',
    (await toastText(page)).includes('還沒有資料可以匯出') && (await page.eval('window.__downloads')) === 0 && !(await meta(page, 'lastBackupAt')), await toastText(page));
  await finish(page, '匯出（沒資料）');

  page = await openPage(chrome, { line: true, share: 'ok' });
  await start(page, base, { seed: true });
  await page.eval(`document.querySelector('.home-screen-hint #backup-now').click(); true`);
  await page.waitFor(`location.hash === '#/backup' && document.querySelector('#export')`, { label: 'LINE：首頁的匯出備份 → 備份頁' });
  check('LINE：首頁按「匯出備份」到備份頁，不下載、不記成已備份', (await page.eval('window.__downloads')) === 0 && !(await meta(page, 'lastBackupAt')));
  check('LINE：備份頁說明這裡不能直接下載、資料是分開的', (await page.eval(`document.querySelector('#in-app-notice')?.textContent ?? ''`)).includes('分開'));
  await page.eval(`document.querySelector('#export').click(); true`);
  await page.waitFor(`document.querySelector('#share-backup')`, { label: 'LINE：分享備份檔的按鈕' });
  check('LINE：按匯出後出現「分享備份檔」，還沒記成已備份、沒有「已匯出」',
    (await page.eval('window.__downloads')) === 0 && !(await meta(page, 'lastBackupAt')) && !(await toastText(page)).includes('已匯出'), await toastText(page));
  await page.eval(`window.__shareFail = true; document.querySelector('#share-backup').click(); true`);
  await sleep(300);
  check('LINE：分享時按取消 → 不記成已備份，按鈕還在', !(await meta(page, 'lastBackupAt')) && await page.eval(`Boolean(document.querySelector('#share-backup'))`));
  await page.eval(`window.__shareFail = false; document.querySelector('#share-backup').click(); true`);
  await page.waitFor(`document.getElementById('toast').textContent.includes('已匯出') && !document.querySelector('#share-backup')`, { label: 'LINE：分享完成' });
  const shared = await page.eval(`(() => { const s = window.__shared[0]; const d = JSON.parse(s.text); return { n: window.__shared.length, name: s.name, type: s.type, v: d.schemaVersion, brews: d.brews.length, beans: d.beans.length }; })()`);
  check('LINE：分享出去的是完整的備份檔（檔名、JSON、內容）',
    shared.n === 1 && /^coffee-log-\d{4}-\d{2}-\d{2}\.json$/.test(shared.name) && shared.type === 'application/json' && shared.v === 8 && shared.brews === 1 && shared.beans === 1, q(shared));
  check('LINE：分享完成才記下備份時間', Boolean(await meta(page, 'lastBackupAt')));
  for (const theme of ['dark', 'light']) {
    await page.eval(`document.documentElement.dataset.theme = ${q(theme)}; true`);
    await screenshot(page, path.join(shotDir, `backup-line-${theme}.png`));
  }
  await finish(page, 'LINE（可以分享）');

  page = await openPage(chrome, { line: true, share: 'none' });
  await start(page, base, { seed: true });
  await openBackup(page);
  await page.eval(`document.querySelector('#export').click(); true`);
  await page.waitFor(`document.querySelector('#in-app-blocked')`, { label: 'LINE：不能分享的說明' });
  check('LINE、不能分享檔案：說明還沒有備份、請用 Safari 或 Chrome，不記成已備份',
    (await page.eval(`document.querySelector('#in-app-blocked').textContent`)).includes('還沒有備份') && !(await meta(page, 'lastBackupAt'))
      && (await page.eval('window.__downloads')) === 0 && !(await toastText(page)).includes('已匯出'));
  await finish(page, 'LINE（不能分享）');

  /* ===== 從 Google 登入頁按上一頁回來（1.22.3）：Safari 原樣還原整頁，登入按鈕要能再按 ===== */
  // headless Chrome 不好真的做出 bfcache 還原：把按鈕弄成按下去的狀態，再送出和還原時一樣的 pageshow（persisted）
  page = await openPage(chrome);
  await start(page, base, { seed: true });
  const restore = `window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))`;
  await page.eval(`location.hash = '#/account'; true`);
  await page.waitFor(`document.querySelector('[data-action="google"]')`, { label: '帳號頁的登入按鈕' });
  await page.eval(`(() => { const b = document.querySelector('[data-action="google"]'); b.disabled = true; b.dataset.stale = '1'; ${restore}; return true; })()`);
  await page.waitFor(`(() => { const b = document.querySelector('[data-action="google"]'); return b && !b.dataset.stale; })()`, { label: '帳號頁重畫' });
  check('還原後：帳號頁重畫，「用 Google 登入」可以再按', await page.eval(`!document.querySelector('[data-action="google"]').disabled`));
  await page.eval(`location.hash = '#/beans/new'; true`);
  await page.waitFor(`document.querySelector('form [name="name"]')`, { label: '豆子表單' });
  await page.eval(`(() => { document.querySelector('form [name="name"]').value = '填到一半'; ${restore}; return true; })()`);
  await sleep(400);
  check('還原後：其他頁面不重畫（填到一半的表單還在）', (await page.eval(`document.querySelector('form [name="name"]')?.value`)) === '填到一半');
  await finish(page, '上一頁還原');
} catch (err) {
  console.error(err);
  failures.push(`例外：${err.message}`);
} finally {
  await chrome?.close();
  server?.close();
}

console.log(`\n截圖：${shotDir}`);
console.log(`\n${passed}/${passed + failures.length} 通過`);
if (failures.length) {
  console.log(`失敗：\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
