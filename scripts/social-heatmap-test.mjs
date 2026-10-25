// 沖煮熱度圖的端對端測試：互相隔離的 headless Chrome（手機直向 390px）
// A、B 好友；C 非好友；D 是 A 的好友但被 A 封鎖；A2 是 A 的第二台裝置
// 確認：自己（帳號頁、統計頁、自己的個人檔案）有「杯數｜平均評分」切換，好友只有杯數；點圓點顯示「m/d（週）：n 杯」；打開時捲到最右邊；
// A 沒開 → B 看 A 的檔案沒有熱度圖；打開 → 有；C、D 一直沒有；新增、刪除、改日期後雲端跟著變；
// 第二台裝置顯示「由另一台裝置更新」且不上傳，按「改用這台」才換；關閉後雲端清空、B 又看不到；
// 沒登入、沒有社群功能時帳號頁和統計頁照樣有自己的熱度圖；深色、淺色截圖（路徑印在最後）；不橫向捲動、沒有 CSP 違規、沒有 JavaScript 錯誤
//
// 用法：先 npx supabase@2.120.0 start，再 node scripts/social-heatmap-test.mjs

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { check, summary, setupUsers, realSession, cleanup, rest, psql } from './supabase-local.mjs';
import { startServer, launchChrome, prepare, visit, click, toast, signIn } from './chrome.mjs';

const q = JSON.stringify;
const PORTRAIT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

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

/** 本機的紀錄：n 天前中午各一杯（rating 可省略） */
async function seed(page, list, prefix = 'h') {
  await page.eval(`(async () => {
    const db = await import('/js/db.js');
    const at = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(12, 0, 0, 0); return d.toISOString(); };
    await db.put('beans', { id: 'bean-h', name: '熱度圖豆', origin: '', process: 'washed', roastLevel: 'light', roastDate: '', bagWeightG: null, archived: false, createdAt: at(500) });
    for (const [i, [n, rating]] of ${q(list)}.entries()) {
      await db.put('brews', { id: ${q(prefix)} + '-' + n + '-' + i, beanId: 'bean-h', grinderId: '', dripperId: '', brewedAt: at(n), dripper: '', grindSetting: '',
        coffeeG: 15, waterG: 240, tempC: 92, totalTimeS: 150, rating: rating ?? null, flavor: { acidity: null, sweetness: null, bitterness: null, body: null },
        flavorNotes: [], notes: '', visibility: 'private' });
    }
    return true;
  })()`);
}

const localDay = (page, n = 0) => page.eval(`import('/js/stats.js').then((m) => m.addDays(m.localDate(new Date()), ${-n}))`);
const dayLabel = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return `${m}/${d}（${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
};
/** 真的點一下那天的圓點（CDP 滑鼠事件，和手指點擊一樣有座標） */
async function tapDay(page, day) {
  const p = await page.eval(`(() => {
    const el = document.querySelector('.heatmap [data-day="${day}"]');
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
  }
  return page.eval(`document.querySelector('.heatmap-card .chart-detail').textContent`);
}
const cloudDays = (user) => Object.fromEntries(psql(`select day || '=' || cups from public.brew_activity where user_id = '${user.id}' order by day`)
  .split('\n').filter(Boolean).map((line) => line.split('=')).map(([d, c]) => [d, Number(c)]));
const syncNow = (page) => page.eval(`import('/js/models.js').then((m) => m.syncNow()).then((r) => r.activity)`);
const hasHeatmap = (page) => page.eval(`Boolean(document.querySelector('.heatmap-card'))`);
const noHScroll = (page) => page.eval('document.documentElement.scrollWidth <= document.documentElement.clientWidth');
/** 個人檔案頁畫完（貼文載入完，熱度圖要嘛已經畫好、要嘛不會畫） */
async function openProfile(page, base, user) {
  await visit(page, base, `#/user/${user.id}`);
  await page.waitFor(`document.querySelector('#profile-page, #app .empty')`, { label: '個人檔案頁' });
  await page.waitFor(`!document.querySelector('#posts-status') || document.querySelector('#posts-status').textContent !== '載入中…'`, { label: '貼文載入完' });
  await page.eval('new Promise((r) => setTimeout(() => r(true), 800))');
}

let server;
let chrome;
let shots;
try {
  const { A, B, C, D } = await setupUsers(['A', 'B', 'C', 'D'], [['A', 'B'], ['A', 'D']]);
  await rest('blocks', { method: 'POST', token: A.token, body: { blocked: D.id } });

  server = await startServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;
  chrome = await launchChrome({ extraArgs: ['--host-resolver-rules=MAP coffee.test 127.0.0.1'] });
  shots = await mkdtemp(path.join(tmpdir(), 'coffee-log-heatmap-'));
  const pa = await openPage(chrome, `${base}#/backup`);
  const pb = await openPage(chrome, `${base}#/backup`);
  const pc = await openPage(chrome, `${base}#/backup`);
  const pd = await openPage(chrome, `${base}#/backup`);
  for (const [page, user] of [[pa, A], [pb, B], [pc, C], [pd, D]]) await signIn(page, await realSession(user));
  // A：今天 2 杯（評分 5、4）、昨天 1、3 天前 1、30 天前 1、400 天前 1（超過一年，不上傳）
  await seed(pa, [[0, 5], [0, 4], [1], [3], [30], [400]]);
  const today = await localDay(pa);

  /* ===== A 自己：帳號頁 ===== */
  await visit(pa, base, '#/account');
  await pa.waitFor(`document.querySelector('#account-heatmap .heatmap') && !['讀取中…', undefined].includes(document.querySelector('#activity-share-status')?.textContent)`, { label: 'A 的帳號頁' });
  const scroll = await pa.eval(`(() => { const s = document.querySelector('.heatmap-scroll'); return { w: s.scrollWidth, c: s.clientWidth, left: s.scrollLeft }; })()`);
  check('390px：熱度圖在框裡橫向捲動、打開時捲到最右邊（今天）', scroll.w > scroll.c && scroll.left >= scroll.w - scroll.c - 2, q(scroll));
  check('390px：整頁不橫向捲動', await noHScroll(pa));
  check('53 欄：最右欄有今天、今天有外框', await pa.eval(`Boolean(document.querySelector('.heatmap [data-day="${today}"]')) && document.querySelectorAll('.heatmap .heat-today').length === 1`));
  check('左邊標一、三、五，上方標月份', (await pa.eval(`[...document.querySelectorAll('.heatmap-card .chart-axis text')].map((t) => t.textContent).join()`)) === '一,三,五'
    && (await pa.eval(`document.querySelectorAll('.heatmap text').length`)) >= 11);
  check('圖例「少 ○○○○○ 多」', (await pa.eval(`document.querySelector('.heatmap-legend').textContent.replace(/\\s/g, '')`)) === '少多'
    && (await pa.eval(`document.querySelectorAll('.heatmap-legend circle').length`)) === 5);
  check('自己的：有「杯數｜平均評分」切換', await pa.eval(`Boolean(document.querySelector('.heatmap-modes [data-v="rating"]'))`));
  const stats = await pa.eval(`[...document.querySelectorAll('.heatmap-stats dd')].map((d) => d.textContent)`);
  check('近一年 5 杯（不含 400 天前）、目前連續 2 天、最長連續 2 天', q(stats) === q(['5 杯', '2 天', '2 天']), q(stats));
  check('點今天的圓點：顯示「m/d（週）：2 杯」', (await tapDay(pa, today)) === `${dayLabel(today)}：2 杯`);
  check('點沒沖的日子：顯示 0 杯', (await tapDay(pa, await localDay(pa, 2))) === `${dayLabel(await localDay(pa, 2))}：0 杯`);
  check('開關預設關閉', !(await pa.eval(`document.querySelector('#activity-share').checked`)) && (await pa.eval(`document.querySelector('#activity-share-status').textContent`)).includes('關閉中'));
  check('沒開：雲端沒有任何資料', Object.keys(cloudDays(A)).length === 0);
  await pa.eval(`document.querySelector('#account-heatmap').scrollIntoView(); true`);
  const { data: darkShot } = await pa.cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(shots, 'dark-account.png'), Buffer.from(darkShot, 'base64'));

  await click(pa, '.heatmap-modes [data-v="rating"]');
  await pa.waitFor(`document.querySelector('.heatmap-card')?.dataset.mode === 'rating'`, { label: '切到平均評分' });
  check('平均評分：今天顯示平均 4.5 分', (await tapDay(pa, today)) === `${dayLabel(today)}：2 杯・平均 4.5 分`);
  check('平均評分：沒評分的日子寫「沒有評分」', (await tapDay(pa, await localDay(pa, 1))) === `${dayLabel(await localDay(pa, 1))}：1 杯・沒有評分`);

  /* ===== B 看 A：A 沒開 → 沒有熱度圖 ===== */
  await openProfile(pb, base, A);
  check('A 沒開：B 看 A 的檔案沒有熱度圖區塊（也沒有「未公開」之類的字）',
    !(await hasHeatmap(pb)) && !(await pb.eval(`document.querySelector('#app').textContent.includes('熱度圖')`)));

  /* ===== A 打開 ===== */
  await click(pa, '#activity-share');
  await toast(pa, '好友現在看得到你的熱度圖');
  await pa.waitFor(`document.querySelector('#activity-share-status').textContent.includes('這台裝置')`, { label: '狀態：由這台更新' });
  const uploaded = cloudDays(A);
  check('打開：上傳近一年有沖的 4 天、今天 2 杯（不含 400 天前）',
    Object.keys(uploaded).length === 4 && uploaded[today] === 2 && !(await localDay(pa, 400) in uploaded), q(uploaded));

  await openProfile(pb, base, A);
  check('A 打開：B 看得到 A 的熱度圖', await hasHeatmap(pb));
  check('好友看的：沒有平均評分的切換', !(await pb.eval(`Boolean(document.querySelector('.heatmap-modes'))`)));
  const bStats = await pb.eval(`[...document.querySelectorAll('.heatmap-stats dd')].map((d) => d.textContent)`);
  check('好友看的：近一年 5 杯、連續 2 天', q(bStats) === q(['5 杯', '2 天', '2 天']), q(bStats));
  check('好友點今天：只有杯數', (await tapDay(pb, today)) === `${dayLabel(today)}：2 杯`);
  check('390px：好友的檔案頁不橫向捲動', await noHScroll(pb));
  await pb.eval(`document.querySelector('#profile-heatmap').scrollIntoView(); true`);
  const { data: friendShot } = await pb.cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(shots, 'dark-friend-profile.png'), Buffer.from(friendShot, 'base64'));

  for (const [name, page] of [['非好友 C', pc], ['被封鎖的好友 D', pd]]) {
    await openProfile(page, base, A);
    check(`${name}看 A：沒有熱度圖`, !(await hasHeatmap(page)));
  }

  /* ===== A 自己的個人檔案：本機資料、有切換 ===== */
  await openProfile(pa, base, A);
  check('A 看自己的檔案：有熱度圖和切換', (await hasHeatmap(pa)) && (await pa.eval(`Boolean(document.querySelector('#profile-heatmap .heatmap-modes'))`)));

  /* ===== 紀錄改變後同步 ===== */
  await seed(pa, [[0, 3]], 'more'); // 今天多一杯
  await pa.eval(`import('/js/db.js').then((db) => db.remove('brews', 'h-3-3')).then(() => true)`); // 刪掉 3 天前的
  await pa.eval(`import('/js/db.js').then(async (db) => {
    const b = await db.get('brews', 'h-1-2'); const d = new Date(b.brewedAt); d.setDate(d.getDate() - 4);
    await db.put('brews', { ...b, brewedAt: d.toISOString() }); return true; })`); // 昨天那杯改成 5 天前
  const sync1 = await syncNow(pa);
  const after = cloudDays(A);
  check('新增、刪除、改日期後同步：今天 3 杯、3 天前和昨天沒了、5 天前 1 杯',
    sync1.status === 'done' && after[today] === 3 && !(await localDay(pa, 3) in after) && !(await localDay(pa, 1) in after) && after[await localDay(pa, 5)] === 1,
    q({ sync1, after }));
  const sync2 = await syncNow(pa);
  check('沒有變化時不送任何東西', sync2.upserted === 0 && sync2.deleted === 0, q(sync2));

  /* ===== 第二台裝置 ===== */
  const pa2 = await openPage(chrome, `${base}#/backup`);
  await signIn(pa2, await realSession(A));
  await seed(pa2, [[0], [7]]);
  await visit(pa2, base, '#/account');
  await pa2.waitFor(`document.querySelector('#activity-share-status')?.textContent.includes('另一台')`, { label: '第二台：由另一台裝置更新' });
  check('第二台：開關是開的、有「改用這台裝置的紀錄」',
    (await pa2.eval(`document.querySelector('#activity-share').checked`)) && !(await pa2.eval(`document.querySelector('[data-action="activity-here"]').hidden`)));
  const idle = await syncNow(pa2);
  check('第二台不上傳（雲端不變）', idle.status === 'idle' && q(cloudDays(A)) === q(after), q(idle));
  await click(pa2, '[data-action="activity-here"]');
  await toast(pa2, '已改用這台裝置的紀錄');
  const moved = cloudDays(A);
  check('改用第二台：雲端換成第二台的紀錄（今天 1 杯、7 天前 1 杯）', Object.keys(moved).length === 2 && moved[today] === 1, q(moved));
  const off = await syncNow(pa);
  check('第一台之後不再上傳（被接手）', off.status === 'off' && q(cloudDays(A)) === q(moved), q(off));
  await visit(pa, base, '#/account');
  await pa.waitFor(`document.querySelector('#activity-share-status')?.textContent.includes('另一台')`, { label: '第一台：由另一台裝置更新' });
  check('第一台的帳號頁：顯示由另一台裝置更新', true);

  /* ===== 關閉 ===== */
  await click(pa2, '#activity-share');
  await toast(pa2, '雲端的熱度圖資料已刪除');
  check('關閉：雲端清空', Object.keys(cloudDays(A)).length === 0);
  await openProfile(pb, base, A);
  check('關閉後 B 又看不到', !(await hasHeatmap(pb)));

  /* ===== 淺色截圖 ===== */
  await pa.eval(`import('/js/views/ui.js').then((m) => m.setThemePref('light')).then(() => true)`);
  await visit(pa, base, '#/stats');
  await pa.waitFor(`document.querySelector('#stats-page .heatmap')`, { label: '統計頁的熱度圖' });
  check('統計頁最上面是自己的熱度圖', await pa.eval(`document.querySelector('#stats-page').firstElementChild.matches('.heatmap-card')`));
  const { data: lightShot } = await pa.cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(shots, 'light-stats.png'), Buffer.from(lightShot, 'base64'));
  check('淺色：不橫向捲動', await noHScroll(pa));

  for (const [name, page] of [['A', pa], ['A2', pa2], ['B', pb], ['C', pc], ['D', pd]]) {
    check(`${name}：沒有 CSP 違規、沒有 JavaScript 錯誤`, (await page.eval('window.__csp')).length === 0 && page.errors.length === 0,
      `${(await page.eval('window.__csp')).join(' / ')} ${page.errors.join(' / ')}`);
  }

  /* ===== 沒登入、沒有社群功能 ===== */
  const out = await openPage(chrome, `${base}#/backup`);
  await seed(out, [[0], [1]]);
  await visit(out, base, '#/account');
  await out.waitFor(`document.querySelector('#account-heatmap .heatmap') && document.querySelector('[data-action="google"]')`, { label: '沒登入的帳號頁' });
  check('沒登入：帳號頁有自己的熱度圖和登入按鈕、沒有公開開關',
    !(await out.eval(`Boolean(document.querySelector('#activity-share'))`)) && (await out.eval(`document.querySelector('.heatmap-stats dd').textContent`)) === '2 杯');
  const plain = await openPage(chrome, `http://coffee.test:${port}/#/backup`);
  await seed(plain, [[0]]);
  await visit(plain, `http://coffee.test:${port}/`, '#/account');
  await plain.waitFor(`document.querySelector('#account-heatmap .heatmap') && document.querySelector('#account-main').textContent.includes('沒有開放社群功能')`, { label: '沒有社群功能的帳號頁' });
  check('沒有社群功能：帳號頁照樣有自己的熱度圖', true);
  await visit(plain, `http://coffee.test:${port}/`, '#/stats');
  await plain.waitFor(`document.querySelector('#stats-page .heatmap')`, { label: '沒有社群功能的統計頁' });
  check('沒有社群功能：統計頁有熱度圖', true);
  check('沒有社群功能：沒有 CSP 違規、沒有 JavaScript 錯誤', (await plain.eval('window.__csp')).length === 0 && plain.errors.length === 0, plain.errors.join(' / '));
} catch (err) {
  check(`執行錯誤：${err.message}`, false);
  console.error(err);
} finally {
  await chrome?.close();
  server?.close();
  await cleanup();
}
if (shots) console.log(`\n截圖：${shots}`);
summary();
