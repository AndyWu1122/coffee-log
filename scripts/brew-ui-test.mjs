// 首頁紀錄卡片與紀錄表單的畫面測試（1.18.0）：不需要 Supabase；headless Chrome（找不到時設 CHROME_PATH）
// 手機直向 390px：首頁依日期分組（今天、昨天、10/24（六）、不是今年的加年份）、卡片的器材／數字各一行、研磨度加「刻度」、星星變大；
// 表單：「儲存」一打開就在畫面內、不被分頁列與「已更新」提示蓋住；酸甜苦醇一項一列（≤ 52px、按鈕 ≥ 44px）；
// 總時間的「分」「秒」一直顯示且不壓到數字；磨豆機獨佔一行、名稱不被截掉；風味輪總覽沒有最外圈的字、放大後才有；
// 存檔的值正確、編輯時帶回；沖煮方式（手沖／賽風：濾杯隱藏、預設跟上一杯、再沖一杯、卡片標示、統計篩選、備份 v8／v7）；深色、淺色的首頁與表單各截一張圖（存到暫存資料夾，路徑印在最後）；不會橫向捲動；沒有 CSP 違規、沒有 JavaScript 錯誤
//
// 用法：node scripts/brew-ui-test.mjs

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer, launchChrome, prepare, visit, click, fill } from './chrome.mjs';

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const q = JSON.stringify;
const VIEW = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

/** 本機時間 daysAgo 天前的 hour 點（測試和 App 在同一台電腦，時區一致） */
function at(daysAgo, hour) {
  const d = new Date();
  d.setHours(hour, 15, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function fixtures() {
  const createdAt = new Date(Date.now() - 800 * 86400000).toISOString();
  const beans = [
    { id: 'bean-a', name: '耶加雪菲', origin: '', country: '', region: '', process: 'washed', roastLevel: 'light', roastDate: '', bagWeightG: null, archived: false, createdAt },
  ];
  const grinders = [{ id: 'g-1', name: 'Comandante C40 MK4 Nitro Blade', notes: '', archived: false, createdAt }];
  const drippers = [{ id: 'd-1', name: 'Hario V60', notes: '', archived: false, createdAt }];
  const brew = (id, brewedAt, extra = {}) => ({
    id, beanId: 'bean-a', grinderId: 'g-1', dripperId: 'd-1', brewedAt, dripper: '', grindSetting: '24',
    coffeeG: 15, waterG: 240, tempC: 92, totalTimeS: 150, rating: 4,
    flavor: { acidity: 3, sweetness: 4, bitterness: 2, body: 3 }, flavorNotes: [], notes: '', visibility: 'private', ...extra,
  });
  // 前三天一定在今年（今天往前 4 天以內）；去年的那杯固定 400 天前
  const brews = [
    brew('brew-today-1', at(0, 0)),
    brew('brew-today-2', at(0, 0), { brewedAt: (() => { const d = new Date(); d.setHours(0, 1, 0, 0); return d.toISOString(); })(), grinderId: '', grindSetting: '' }),
    brew('brew-yesterday', at(1, 23), { rating: null }),
    brew('brew-older', at(4, 9)),
    brew('brew-last-year', at(400, 9)),
  ];
  return { beans, grinders, drippers, brews };
}

/** 隔離的頁面（手機直向 390px），在任何頁面腳本執行前開始記錄 CSP 違規 */
async function openPage(chrome, url) {
  const page = await chrome.newPage(null, { isolated: true });
  await page.cdp('Emulation.setDeviceMetricsOverride', VIEW);
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI));`,
  });
  await page.goto(url);
  await prepare(page);
  return page;
}

async function screenshot(page, file) {
  const height = await page.eval('Math.ceil(document.documentElement.scrollHeight)');
  await page.cdp('Emulation.setDeviceMetricsOverride', { ...VIEW, height });
  await page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  const { data } = await page.cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(file, Buffer.from(data, 'base64'));
  await page.cdp('Emulation.setDeviceMetricsOverride', VIEW);
}

async function reload(page, extra = '') {
  await page.eval(`${extra}; window.__reloading = true; location.reload(); true`);
  await page.waitFor(`!window.__reloading && document.readyState === 'complete' && document.querySelector('#app').childElementCount > 0`, { label: '重新載入' });
  await prepare(page);
}

const openList = async (page, base) => {
  await visit(page, base, '#/');
  await page.waitFor(`document.querySelector('.day-group')`, { label: '紀錄列表' });
};
const openForm = async (page, base, hash) => {
  await visit(page, base, hash);
  await page.waitFor(`document.querySelector('form .save-bar') && document.querySelector('#flavor-picker svg')`, { label: `表單 ${hash}` });
  await page.eval('scrollTo(0, 0), new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
};

/** 獨立算一次分組標題（和 brewList.js 的 groupByDay 規則一樣，不 import 它） */
function expectedLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (same(d, now)) return '今天';
  if (same(d, yest)) return '昨天';
  const md = `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}/${md}`;
}

/** 表單的版面 */
const formLayout = (page) => page.eval(`(() => {
  const r = (el) => el.getBoundingClientRect();
  const save = r(document.querySelector('.save-bar'));
  const tabbar = r(document.querySelector('.tabbar'));
  const banners = [...document.querySelectorAll('.update-banner')].filter((b) => !b.hidden).map(r);
  const rows = [...document.querySelectorAll('.score-row')];
  const buttons = rows.flatMap((row) => [...row.querySelectorAll('.segmented button')].map(r));
  const units = [...document.querySelectorAll('.unit-input')].map((w) => {
    const input = w.querySelector('input'), unit = w.querySelector('.unit');
    const ir = r(input), ur = r(unit), cs = getComputedStyle(input);
    return {
      text: unit.textContent, visible: getComputedStyle(unit).visibility !== 'hidden' && ur.width > 0,
      inside: ur.left >= ir.left && ur.right <= ir.right && ur.top >= ir.top && ur.bottom <= ir.bottom,
      // 數字最多寫到 padding-right 的左邊為止，單位要在那之後
      clear: ir.right - parseFloat(cs.paddingRight) <= ur.left + 0.5,
    };
  });
  const grinder = document.querySelector('#grinderId');
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = getComputedStyle(grinder).font;
  const name = grinder.selectedOptions[0].textContent.trim();
  const grinderFits = ctx.measureText(name).width + parseFloat(getComputedStyle(grinder).paddingLeft) + 28 <= grinder.clientWidth;
  return {
    saveInView: save.top >= 0 && save.bottom <= innerHeight,
    saveAboveTabbar: save.bottom <= tabbar.top + 0.5,
    saveClearOfBanners: banners.every((b) => save.bottom <= b.top + 0.5 || save.top >= b.bottom - 0.5),
    banners: banners.length,
    rows: rows.length,
    rowMax: Math.max(...rows.map((row) => r(row).height)),
    btnMinH: Math.min(...buttons.map((b) => b.height)),
    btnMinW: Math.min(...buttons.map((b) => b.width)),
    labelBeside: rows.every((row) => r(row.querySelector('.label')).right <= r(row.querySelector('.segmented')).left),
    units,
    grinderFits, grinderName: name, grinderWidth: grinder.clientWidth,
    grinderAlone: r(grinder).width > innerWidth * 0.8,
    pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
  };
})()`);

let server;
let chrome;
const shotDir = await mkdtemp(path.join(tmpdir(), 'coffee-log-brew-ui-'));
try {
  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();

  const page = await openPage(chrome, base);
  const data = fixtures();
  const version = await page.eval(`import('/js/changelog.js').then((m) => m.CHANGELOG[0].version)`);
  // 看過新手教學、看過這一版的更新內容（「已更新」提示另外測）
  await page.eval(`import('/js/db.js').then(async (db) => {
    await db.bulkPut(${q(data)});
    await db.setMeta('onboardingSeen', true);
    await db.setMeta('changelogSeen', ${q(version)});
    return true;
  })`);
  await page.waitFor('Boolean(navigator.serviceWorker.controller)', { label: 'Service Worker 接管' });

  for (const theme of ['dark', 'light']) {
    await reload(page, `localStorage.setItem('theme', ${q(theme)})`);
    const label = theme === 'dark' ? '深色' : '淺色';

    /* ===== 首頁 ===== */
    await openList(page, base);
    const groups = await page.eval(`[...document.querySelectorAll('.day-group')].map((g) => ({
      label: g.querySelector('.list-date').textContent,
      ids: [...g.querySelectorAll('a.card')].map((a) => a.getAttribute('href').split('/').pop()),
    }))`);
    if (theme === 'dark') {
      const want = [
        { label: '今天', ids: ['brew-today-1', 'brew-today-2'] },
        { label: '昨天', ids: ['brew-yesterday'] },
        { label: expectedLabel(data.brews[3].brewedAt), ids: ['brew-older'] },
        { label: expectedLabel(data.brews[4].brewedAt), ids: ['brew-last-year'] },
      ];
      check('依日期分組：今天、昨天、M/D（星期）、不是今年的加年份；00:01 和 00:15 同一天', q(groups) === q(want), q(groups));
      check('較早的日期標題格式「10/24（六）」', /^\d{1,2}\/\d{1,2}（[日一二三四五六]）$/.test(want[2].label), want[2].label);
      check('去年的標題格式「2025/9/21（日）」', /^\d{4}\/\d{1,2}\/\d{1,2}（[日一二三四五六]）$/.test(want[3].label), want[3].label);

      const card = await page.eval(`(() => {
        const c = document.querySelector('a[href="#/brew/brew-today-1"]');
        const one = (sel) => { const row = c.querySelector(sel); const spans = [...row.children].map((s) => s.getBoundingClientRect()); return { text: [...row.children].map((s) => s.textContent), lines: new Set(spans.map((s) => Math.round(s.top))).size }; };
        const plain = document.querySelector('a[href="#/brew/brew-today-2"]');
        return {
          gear: one('.card-gear'), numbers: one('.card-numbers'), time: one('.card-time'),
          plainGear: plain.querySelector('.card-gear')?.textContent.trim().replace(/\\s+/g, ' '),
          stars: parseFloat(getComputedStyle(c.querySelector('.stars')).fontSize),
          unrated: document.querySelector('a[href="#/brew/brew-yesterday"] .stars').textContent,
        };
      })()`);
      check('器材一行：濾杯、磨豆機＋「刻度 24」', q(card.gear.text) === q(['Hario V60', 'Comandante C40 MK4 Nitro Blade 刻度 24']), q(card.gear.text));
      check('數字一行：粉水量、粉水比、水溫、時間', q(card.numbers.text) === q(['15g → 240g', '1:16.0', '92°C', '2:30']) && card.numbers.lines === 1, q(card.numbers));
      check('時間那行只有時:分和養豆天數（日期在標題）', /^\d{2}:\d{2}$/.test(card.time.text[0]) && card.time.lines === 1, q(card.time.text));
      check('沒選磨豆機也沒填研磨度：器材那行只有濾杯', card.plainGear === 'Hario V60', card.plainGear);
      check('星星比內文大（≥ 18px）', card.stars >= 18, `${card.stars}px`);
      check('沒評分的不顯示星星', card.unrated === '');
    }
    const listWidth = await page.eval('document.documentElement.scrollWidth <= innerWidth');
    check(`${label}・首頁：不會橫向捲動`, listWidth);
    await screenshot(page, path.join(shotDir, `list-${theme}.png`));

    /* ===== 新增表單 ===== */
    await openForm(page, base, '#/brew/new');
    const l = await formLayout(page);
    check(`${label}・表單：「儲存」一打開就在畫面內、在分頁列上方`, l.saveInView && l.saveAboveTabbar, q(l));
    check(`${label}・表單：酸甜苦醇一項一列（≤ 52px）、名稱在按鈕左邊`, l.rows === 4 && l.rowMax <= 52 && l.labelBeside, `${l.rowMax}px`);
    check(`${label}・表單：1–5 的按鈕至少 44×44px`, l.btnMinH >= 44 && l.btnMinW >= 44, `${l.btnMinW}×${l.btnMinH}`);
    check(`${label}・表單：磨豆機獨佔一行、長名稱放得下`, l.grinderAlone && l.grinderFits, `${l.grinderName} / ${l.grinderWidth}px`);
    check(`${label}・表單：不會橫向捲動`, l.pageWidth <= l.viewport);
    await screenshot(page, path.join(shotDir, `form-${theme}.png`));
  }

  /* ===== 總時間的單位 ===== */
  await openForm(page, base, '#/brew/new');
  await fill(page, '[name="totalMin"]', '12');
  await fill(page, '[name="totalSec"]', '45');
  const units = (await formLayout(page)).units;
  check('總時間：填了數字仍顯示「分」「秒」，在格子裡、不壓到數字',
    q(units.map((u) => u.text)) === q(['分', '秒']) && units.every((u) => u.visible && u.inside && u.clear), q(units));
  check('總時間：輸入框仍有「分」「秒」的 aria-label',
    await page.eval(`document.querySelector('[name="totalMin"]').getAttribute('aria-label') === '分' && document.querySelector('[name="totalSec"]').getAttribute('aria-label') === '秒'`));

  /* ===== 捲到最下面：「儲存」回到原本的位置，不蓋住其他按鈕 ===== */
  await page.eval('scrollTo(0, document.documentElement.scrollHeight), new Promise((r) => setTimeout(() => r(true), 100))');
  const bottom = await page.eval(`(() => {
    const s = document.querySelector('.save-bar').getBoundingClientRect();
    const a = document.querySelector('.actions').getBoundingClientRect();
    const t = document.querySelector('.tabbar').getBoundingClientRect();
    return { below: s.bottom <= a.top + 0.5, aboveTabbar: s.bottom <= t.top + 0.5 };
  })()`);
  check('捲到最下面：「儲存」在其他按鈕上方、不被分頁列蓋住', bottom.below && bottom.aboveTabbar, q(bottom));

  /* ===== 風味輪：總覽沒有最外圈的字，放大後才有 ===== */
  // SVG 的 path 沒有 click()：自己送 click 事件
  const tapSector = (key) => page.eval(`(document.querySelector('#flavor-picker .sector[data-key="${key}"]').dispatchEvent(new MouseEvent('click', { bubbles: true })), true)`);
  const leafNames = await page.eval(`import('/js/models.js').then((m) => {
    const out = [];
    const walk = (nodes) => nodes.forEach((n) => { if (n.depth === 3) out.push(n.zh); walk(n.children); });
    walk(m.FLAVOR_WHEEL);
    return out;
  })`);
  const wheelText = () => page.eval(`[...document.querySelectorAll('#flavor-picker svg text')].map((t) => ({ t: t.textContent.replace('✓', ''), fs: parseFloat(t.getAttribute('font-size')) }))`);
  const overview = await wheelText();
  check('風味輪總覽：沒有最外圈（細項）的字，也沒有小於 7 的字', overview.every((x) => !leafNames.includes(x.t)) && overview.every((x) => x.fs >= 7),
    overview.filter((x) => leafNames.includes(x.t) || x.fs < 7).map((x) => `${x.t}:${x.fs}`).join(' / '));
  await tapSector('fruity');
  await page.waitFor(`document.querySelector('#flavor-picker .wheel.is-zoomed')`, { label: '放大水果類' });
  const zoomed = await wheelText();
  check('風味輪放大後：最外圈的字顯示出來（≥ 8）', zoomed.some((x) => leafNames.includes(x.t)) && zoomed.every((x) => x.fs >= 8),
    zoomed.map((x) => x.t).slice(0, 8).join(' '));
  await tapSector('fruity.berry.blueberry');

  /* ===== 存檔：值正確，編輯時帶回 ===== */
  await page.eval(`(() => {
    document.querySelector('#grinderId').value = 'g-1';
    document.querySelector('#dripperId').value = 'd-1';
    return true;
  })()`);
  await fill(page, '#grindSetting', '22');
  await fill(page, '#tempC', '93');
  await fill(page, '#coffeeG', '16');
  await fill(page, '#waterG', '250');
  await fill(page, '[name="totalMin"]', '2');
  await fill(page, '[name="totalSec"]', '40');
  await click(page, '.segmented[data-name="rating"] button[data-v="5"]');
  await click(page, '.segmented[data-name="flavor.acidity"] button[data-v="4"]');
  await click(page, '.segmented[data-name="flavor.body"] button[data-v="2"]');
  await page.eval(`window.__before = new Set([...document.querySelectorAll('a.card')].map((a) => a.href)); true`);
  await click(page, '.save-bar');
  await page.waitFor(`location.hash === '#/' && document.querySelector('.day-group')`, { label: '存檔後回首頁' });
  const saved = await page.eval(`import('/js/db.js').then((db) => db.getAll('brews')).then((all) => all.find((b) => !b.id.startsWith('brew-')))`);
  check('存檔：器材、研磨度、水溫、粉水量、總時間、評分、酸甜苦醇、風味輪都正確',
    saved && saved.grinderId === 'g-1' && saved.dripperId === 'd-1' && saved.grindSetting === '22' && saved.tempC === 93
      && saved.coffeeG === 16 && saved.waterG === 250 && saved.totalTimeS === 160 && saved.rating === 5
      && q(saved.flavor) === q({ acidity: 4, sweetness: null, bitterness: null, body: 2 })
      && q(saved.flavorNotes) === q(['fruity.berry.blueberry']), q(saved));
  check('存檔後：出現在「今天」那組最上面',
    await page.eval(`document.querySelector('.day-group .list-date').textContent === '今天' && document.querySelector('.day-group a.card').getAttribute('href') === ${q(`#/brew/${saved?.id}`)}`));

  await openForm(page, base, `#/brew/${saved.id}`);
  const back = await page.eval(`({
    min: document.querySelector('[name="totalMin"]').value, sec: document.querySelector('[name="totalSec"]').value,
    acidity: document.querySelector('.segmented[data-name="flavor.acidity"]').dataset.value,
    body: document.querySelector('.segmented[data-name="flavor.body"]').dataset.value,
    grinder: document.querySelector('#grinderId').value, setting: document.querySelector('#grindSetting').value, temp: document.querySelector('#tempC').value,
  })`);
  check('編輯：值都帶回表單', q(back) === q({ min: '2', sec: '40', acidity: '4', body: '2', grinder: 'g-1', setting: '22', temp: '93' }), q(back));
  const edit = await formLayout(page);
  check('編輯頁：「儲存」一打開就在畫面內', edit.saveInView && edit.saveAboveTabbar);
  // 1.22.0：分享、再沖一杯並排；刪除是紅色文字按鈕（≥ 44px），和上面隔開
  const editBtns = await page.eval(`(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    const share = r('.actions [data-action="share"]'), again = r('.actions a[href^="#/brew/new?from="]'), del = r('.actions [data-action="delete"]');
    const delEl = document.querySelector('.actions [data-action="delete"]');
    return {
      sideBySide: Math.abs(share.top - again.top) < 1 && share.right <= again.left,
      equalWidth: Math.abs(share.width - again.width) < 1,
      delBelow: del.top - Math.max(share.bottom, again.bottom) >= 20,
      delTap: del.height >= 44 && del.width >= 44,
      delText: !delEl.classList.contains('btn') && getComputedStyle(delEl).borderTopWidth === '0px',
      againLabel: document.querySelector('.actions a[href^="#/brew/new?from="]').getAttribute('aria-label'),
    };
  })()`);
  check('編輯頁：「分享」「再沖一杯」並排、同寬', editBtns.sideBySide && editBtns.equalWidth, q(editBtns));
  check('編輯頁：「刪除」是文字按鈕、點擊範圍 ≥ 44px、和上面隔開 ≥ 20px', editBtns.delText && editBtns.delTap && editBtns.delBelow, q(editBtns));
  check('編輯頁：「再沖一杯」的 aria-label 寫完整', editBtns.againLabel === '用這次參數再沖一杯');

  /* ===== 沖煮方式（1.21.0）：手沖／賽風 ===== */
  const methodState = () => page.eval(`({
    method: document.querySelector('.segmented[data-name="method"]').dataset.value,
    dripperHidden: document.querySelector('[data-field="dripperId"]').hidden
      && getComputedStyle(document.querySelector('[data-field="dripperId"]')).display === 'none',
  })`);
  check('舊紀錄沒有 method：讀出來算手沖', saved.method === 'pourover'
    && await page.eval(`import('/js/models.js').then(async (m) => m.brewMethod(await m.getBrew('brew-older')) === 'pourover')`));
  await openForm(page, base, '#/brew/new');
  check('新紀錄：上一杯是手沖 → 預設手沖、濾杯顯示', q(await methodState()) === q({ method: 'pourover', dripperHidden: false }));
  await click(page, '.segmented[data-name="method"] button[data-v="siphon"]');
  check('選賽風：濾杯欄位隱藏', q(await methodState()) === q({ method: 'siphon', dripperHidden: true }));
  await page.eval(`(document.querySelector('#dripperId').value = 'd-1', true)`); // 隱藏前選了濾杯，賽風也不存
  await fill(page, '#coffeeG', '20');
  await fill(page, '#waterG', '300');
  // 上一杯（剛存的手沖）往前一小時，最近一杯一定是賽風（datetime-local 只到分鐘）
  await page.eval(`import('/js/db.js').then(async (db) => { const b = await db.get('brews', ${q(saved.id)}); await db.put('brews', { ...b, brewedAt: new Date(Date.now() - 3600000).toISOString() }); return true; })`);
  await click(page, '.save-bar');
  await page.waitFor(`location.hash === '#/' && document.querySelector('.day-group')`, { label: '賽風存檔後回首頁' });
  const siphon = await page.eval(`import('/js/db.js').then((db) => db.getAll('brews')).then((all) => all.find((b) => b.method === 'siphon'))`);
  check('存檔：method siphon、濾杯不存', siphon && siphon.dripperId === '' && siphon.coffeeG === 20, q(siphon));
  const siphonGear = await page.eval(`[...document.querySelectorAll('a[href="#/brew/${siphon?.id}"] .card-gear span')].map((s) => s.textContent)`);
  check('首頁卡片：器材那行標「賽風」（取代濾杯）', siphonGear[0] === '賽風' && !siphonGear.includes('Hario V60'), q(siphonGear));
  const pourGear = await page.eval(`document.querySelector('a[href="#/brew/brew-today-1"] .card-gear').textContent`);
  check('手沖的卡片不另外標「手沖」', !pourGear.includes('手沖'), pourGear);
  const card = await page.eval(`import('/js/models.js').then((m) => m.getShareCardData(${q(siphon.id)})).then((d) => ({ method: d.method, dripper: d.dripper }))`);
  check('分享卡片的資料：method siphon、沒有濾杯', q(card) === q({ method: 'siphon', dripper: '' }), q(card));

  await openForm(page, base, `#/brew/${siphon.id}`);
  check('編輯賽風：帶回賽風、濾杯隱藏', q(await methodState()) === q({ method: 'siphon', dripperHidden: true }));
  await openForm(page, base, '#/brew/new');
  check('新紀錄：上一杯是賽風 → 預設賽風', (await methodState()).method === 'siphon');
  await openForm(page, base, '#/brew/new?from=brew-older');
  check('「再沖一杯」手沖的紀錄 → 手沖、濾杯帶入', q(await methodState()) === q({ method: 'pourover', dripperHidden: false })
    && await page.eval(`document.querySelector('#dripperId').value === 'd-1'`));
  await openForm(page, base, `#/brew/new?from=${siphon.id}`);
  check('「再沖一杯」賽風的紀錄 → 賽風', (await methodState()).method === 'siphon');

  // 賽風改回手沖：濾杯出現、可以選
  await openForm(page, base, `#/brew/${siphon.id}`);
  await click(page, '.segmented[data-name="method"] button[data-v="pourover"]');
  check('改回手沖：濾杯欄位出現', (await methodState()).dripperHidden === false);
  await page.eval(`(document.querySelector('#dripperId').value = 'd-1', true)`);
  await click(page, '.save-bar');
  await page.waitFor(`location.hash === '#/'`, { label: '改回手沖存檔' });
  const back2 = await page.eval(`import('/js/db.js').then((db) => db.get('brews', ${q(siphon.id)}))`);
  check('改回手沖：method pourover、濾杯存下', back2.method === 'pourover' && back2.dripperId === 'd-1', q(back2));
  await page.eval(`import('/js/db.js').then(async (db) => { await db.put('brews', { ...(await db.get('brews', ${q(siphon.id)})), method: 'siphon', dripperId: '' }); return true; })`);

  // 統計：兩種都有才出現篩選；只看賽風時沒有濾杯比較
  await visit(page, base, '#/stats');
  await page.waitFor(`document.querySelector('#stats-page')`, { label: '統計' });
  const statsFilter = await page.eval(`[...document.querySelectorAll('#stats-method option')].map((o) => o.textContent.trim())`);
  check('統計：有兩種沖煮方式時出現篩選', q(statsFilter) === q(['全部沖煮方式', '手沖', '賽風']), q(statsFilter));
  const byMethod = await page.eval(`import('/js/models.js').then(async (m) => {
    const all = await m.getStats({ period: 'all' });
    const s = await m.getStats({ period: 'all', method: 'siphon' });
    const p = await m.getStats({ period: 'all', method: 'pourover' });
    const bad = await m.getStats({ period: 'all', method: 'french' });
    return { all: all.stats.cups, siphon: s.stats.cups, pour: p.stats.cups, sDrippers: s.stats.drippers.length, bad: bad.method, badCups: bad.stats.cups };
  })`);
  check('統計：依沖煮方式篩選杯數；只看賽風沒有濾杯比較；不認得的值當全部',
    byMethod.siphon === 1 && byMethod.pour === byMethod.all - 1 && byMethod.sDrippers === 0 && byMethod.bad === '' && byMethod.badCups === byMethod.all, q(byMethod));
  await page.eval(`(() => { const s = document.querySelector('#stats-method'); s.value = 'siphon'; s.dispatchEvent(new Event('change')); return true; })()`);
  await page.waitFor(`document.querySelector('#stats-method')?.value === 'siphon'`, { label: '只看賽風' });
  check('統計只看賽風：不顯示濾杯比較', !(await page.eval(`[...document.querySelectorAll('.stats-sub')].some((h) => h.textContent === '濾杯')`)));
  await page.eval(`(() => { const s = document.querySelector('#stats-method'); s.value = ''; s.dispatchEvent(new Event('change')); return true; })()`);
  await page.waitFor(`document.querySelector('#stats-method')?.value === ''`, { label: '統計回到全部' });

  // 備份：v8 匯出帶 method；v7 舊檔補成手沖；不認得的值整份不匯入
  const backup = await page.eval(`import('/js/models.js').then(async (m) => {
    const d = await m.exportData({ includePhotos: false });
    const exported = { v: d.schemaVersion, method: d.brews.find((b) => b.id === ${q(siphon.id)}).method };
    const v7 = { ...d, schemaVersion: 7, brews: d.brews.map(({ method, ...b }) => b) };
    const r7 = await m.importData(JSON.stringify(v7), { replace: true });
    const after7 = await m.getBrew(${q(siphon.id)});
    const bad = { ...d, brews: d.brews.map((b) => (b.id === ${q(siphon.id)} ? { ...b, method: 'french' } : b)) };
    const rBad = await m.importData(JSON.stringify(bad), { replace: true });
    const r8 = await m.importData(JSON.stringify(d), { replace: true });
    const after8 = await m.getBrew(${q(siphon.id)});
    return { exported, r7: r7.ok, after7: after7.method, rBad: rBad.ok, r8: r8.ok, after8: after8.method, after8Dripper: after8.dripperId };
  })`);
  check('備份：匯出 schemaVersion 8、帶 method', backup.exported.v === 8 && backup.exported.method === 'siphon', q(backup));
  check('備份：v7 舊檔匯入後算手沖', backup.r7 && backup.after7 === 'pourover', q(backup));
  check('備份：不認得的沖煮方式整份不匯入', backup.rBad === false, q(backup));
  check('備份：v8 匯入還原賽風', backup.r8 && backup.after8 === 'siphon' && backup.after8Dripper === '', q(backup));
  for (const theme of ['dark', 'light']) {
    await reload(page, `localStorage.setItem('theme', ${q(theme)})`);
    await openForm(page, base, `#/brew/${siphon.id}`);
    await screenshot(page, path.join(shotDir, `form-siphon-${theme}.png`));
  }

  /* ===== 「已更新」提示出現時，「儲存」往上讓開 ===== */
  await page.eval(`import('/js/db.js').then((db) => db.remove('meta', 'changelogSeen')).then(() => true)`);
  await reload(page);
  await page.waitFor(`document.querySelector('form .save-bar') && !document.querySelector('#updated-banner').hidden`, { label: '已更新提示' });
  await page.eval('scrollTo(0, 0), new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  const withBanner = await formLayout(page);
  check('「已更新」提示出現時：「儲存」在提示上方、不被蓋住', withBanner.banners === 1 && withBanner.saveInView && withBanner.saveClearOfBanners, q(withBanner));

  /* ===== 豆子列表（1.22.0）：用完的變淡、排到後面；用量比整包多寫清楚；「顯示已封存」是開關 ===== */
  await page.eval(`import('/js/db.js').then((db) => db.bulkPut({
    beans: [
      { id: 'sb-over', name: '超量的豆子', origin: '', country: '', region: '', process: 'washed', roastLevel: 'light', roastDate: '', bagWeightG: 20, archived: false, createdAt: '2099-01-03T00:00:00.000Z' },
      { id: 'sb-full', name: '還很多的豆子', origin: '', country: '', region: '', process: 'washed', roastLevel: 'light', roastDate: '', bagWeightG: 500, archived: false, createdAt: '2099-01-01T00:00:00.000Z' },
    ],
    brews: [{ id: 'sb-brew', beanId: 'sb-over', method: 'pourover', grinderId: '', dripperId: '', dripper: '', brewedAt: new Date().toISOString(),
      grindSetting: '', coffeeG: 32, waterG: 480, tempC: null, totalTimeS: null, rating: null,
      flavor: { acidity: null, sweetness: null, bitterness: null, body: null }, flavorNotes: [], notes: '', visibility: 'private' }],
  })).then(() => true)`);
  await page.eval(`location.hash = '#/beans'`);
  await page.waitFor(`document.querySelector('a.card[href="#/beans/sb-over"]')`, { label: '豆子列表' });
  const beanList = await page.eval(`(() => {
    const cards = [...document.querySelectorAll('.list a.card')];
    const over = document.querySelector('a.card[href="#/beans/sb-over"]');
    const full = document.querySelector('a.card[href="#/beans/sb-full"]');
    const archived = document.querySelector('#show-archived');
    return {
      overAfterFull: cards.indexOf(over) > cards.indexOf(full),
      overLast: cards.at(-1) === over,
      faded: over.classList.contains('is-empty') && !full.classList.contains('is-empty'),
      badge: over.querySelector('.badge')?.textContent,
      stock: over.querySelector('.stock-row')?.textContent.trim(),
      switchRow: Boolean(archived.closest('.switch-row')),
    };
  })()`);
  check('豆子列表：用完的豆子排到最後、變淡', beanList.overAfterFull && beanList.overLast && beanList.faded, q(beanList));
  check('豆子列表：用量比整包多 → 標籤「已用完」＋「記錄的用量比整包多 12g」', beanList.badge === '已用完' && beanList.stock === '記錄的用量比整包多 12g', q(beanList));
  check('豆子列表：「顯示已封存」是開關', beanList.switchRow);
  for (const theme of ['dark', 'light']) {
    await reload(page, `localStorage.setItem('theme', ${q(theme)})`);
    await page.waitFor(`document.querySelector('a.card[href="#/beans/sb-over"]')`, { label: '豆子列表' });
    await screenshot(page, path.join(shotDir, `beans-${theme}.png`));
  }

  check('沒有 CSP 違規', (await page.eval('window.__csp')).length === 0, (await page.eval('window.__csp')).join(' / '));
  check('沒有 JavaScript 錯誤', page.errors.length === 0, page.errors.join(' / '));
} catch (err) {
  console.error(err);
  failures.push(`例外：${err.message}`);
} finally {
  await chrome?.close();
  server?.close();
}

console.log(`\n截圖：${shotDir}`);
console.log(`${passed} 通過、${failures.length} 失敗`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exitCode = 1;
}
