// 產地地圖（#/origins）與豆子表單的產地欄位：不需要 Supabase；headless Chrome（找不到時設 CHROME_PATH）
// 手機直向 390px：深色、淺色 × 世界地圖、單一國家各截一張圖（存到暫存資料夾，路徑印在最後）
// 確認：國家依杯數上色、清單依杯數排；打開時捲到喝最多的國家；點小國的圓點、清單進到國家；國家頁的產區圓點都在地圖裡，
// 點圓點／清單顯示風味和豆子，猜的產地有「確認」連結；認不出產地的豆子另外列（XSS）；豆子表單的「看起來是…［套用］」、
// 選國家才有產區；列表顯示國家＋產區；備份 v6 帶著國家、產區，v5 照樣匯入；離線可用；沒有 CSP 違規、沒有 JavaScript 錯誤
//
// 用法：node scripts/origin-map-ui-test.mjs

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer, launchChrome, prepare, visit, click, fill, submit, toast, noInjection } from './chrome.mjs';

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const q = JSON.stringify;
const DAY = 86400000;
const ATTACK = '<img src=x onerror=pwn()><b>配方</b>';
const LONG = '哥倫比亞薇拉粉紅波旁厭氧發酵特別批次限量版本第二號';

function fixtures() {
  const now = Date.now();
  const bean = (id, name, extra = {}) => ({
    id, name, origin: '', country: '', region: '', process: 'washed', roastLevel: 'light', roastDate: '', bagWeightG: null,
    archived: false, createdAt: new Date(now - 100 * DAY).toISOString(), ...extra,
  });
  const beans = [
    bean('b-yirga', '孔加 G1', { country: 'ET', region: 'ET.yirgacheffe' }),
    bean('b-guji', '衣索比亞 古吉 罕貝拉'),                       // 猜的：衣索比亞・古吉
    bean('b-eth', '日曬原生種', { country: 'ET' }),                 // 有國家、沒產區
    bean('b-kenya', '肯亞 AA', { country: 'KE', region: 'KE.nyeri', archived: true }),
    bean('b-rw', 'Huye 水洗'),                                      // 猜的：盧安達・南部省（小國）
    bean('b-long', LONG, { country: 'CO', region: 'CO.huila', origin: 'El Paraiso' }),
    bean('b-blend', ATTACK),                                         // 認不出產地
    bean('b-unused', '巴西 喜拉朵', { country: 'BR' }),              // 沒沖過：不在地圖上
  ];
  const plan = [['b-yirga', 8], ['b-guji', 3], ['b-eth', 2], ['b-kenya', 5], ['b-rw', 1], ['b-long', 2], ['b-blend', 2]];
  const notes = [['floral.floral.jasmine', 'fruity.citrus.lemon'], ['fruity.citrus.lemon'], ['fruity.berry.blueberry'], []];
  let i = 0;
  const brews = plan.flatMap(([beanId, n]) => Array.from({ length: n }, () => {
    i++;
    return {
      id: `brew-${i}`, beanId, grinderId: '', dripperId: '', brewedAt: new Date(now - i * DAY).toISOString(), dripper: '',
      grindSetting: '', coffeeG: 15, waterG: 240, tempC: 92, totalTimeS: 150, rating: i % 4 ? 3 + (i % 3) : null,
      flavor: { acidity: null, sweetness: null, bitterness: null, body: null }, flavorNotes: notes[i % 4], notes: '', visibility: 'private',
    };
  }));
  return { beans, brews };
}

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

async function screenshot(page, file) {
  const height = await page.eval('Math.ceil(document.documentElement.scrollHeight)');
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height, deviceScaleFactor: 2, mobile: true });
  await page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  const { data } = await page.cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(file, Buffer.from(data, 'base64'));
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
}

async function setTheme(page, theme) {
  await page.eval(`localStorage.setItem('theme', ${q(theme)}); window.__reloading = true; location.reload(); true`);
  await page.waitFor(`!window.__reloading && document.readyState === 'complete' && document.documentElement.dataset.theme === ${q(theme)}`, { label: `切到${theme}` });
  await prepare(page);
}

const openWorld = async (page, base) => {
  await visit(page, base, '#/origins');
  await page.waitFor(`document.querySelector('#origin-page .origin-world')`, { label: '產地地圖' });
};
const openCountry = async (page, base, code) => {
  await visit(page, base, `#/origins/${code}`);
  await page.waitFor(`document.querySelector('#origin-page .origin-country')`, { label: `${code} 的地圖` });
};
/** 在 SVG 元素的中心點擊（和手指點一樣，事件從那個元素冒泡） */
const tap = (page, sel) => page.eval(`(() => {
  const el = document.querySelector(${q(sel)});
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  return true;
})()`);

/** 版面：整頁不橫向捲動、橫條名稱不壓到數字、每列 ≥ 44px */
const layout = (page) => page.eval(`(() => {
  const rows = [...document.querySelectorAll('#origin-page .hbar-row')];
  return {
    pageWidth: document.documentElement.scrollWidth, viewport: window.innerWidth,
    rowHits: rows.filter((r) => r.querySelector('.hbar-name').getBoundingClientRect().right > r.querySelector('.hbar-value').getBoundingClientRect().left).length,
    shortRows: rows.filter((r) => r.getBoundingClientRect().height < 44).length,
  };
})()`);

let server;
let chrome;
const shotDir = await mkdtemp(path.join(tmpdir(), 'coffee-log-origins-'));
try {
  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();

  const page = await openPage(chrome, base);
  const data = fixtures();
  await page.eval(`import('/js/db.js').then((db) => db.bulkPut(${q(data)})).then(() => true)`);
  await page.waitFor('Boolean(navigator.serviceWorker.controller)', { label: 'Service Worker 接管' });
  check('☰ 選單有「🗺️ 產地地圖」', Boolean(await page.eval(`document.querySelector('.menu-list a[href="#/origins"][role="menuitem"]')`)));

  /* ===== 世界地圖 ===== */
  await openWorld(page, base);
  check('標題「產地地圖」、不屬於任何底部分頁',
    (await page.eval(`document.getElementById('page-title').textContent`)) === '產地地圖' && !(await page.eval(`Boolean(document.querySelector('.tabbar a.active'))`)));
  const rows = await page.eval(`[...document.querySelectorAll('[data-country]')].map((a) => [a.dataset.country, a.querySelector('.hbar-value').textContent.trim()])`);
  check('國家依杯數排（猜的、封存的豆子也算；沒沖過的不算）：衣索比亞 13、肯亞 5、哥倫比亞 2、盧安達 1',
    q(rows) === q([['ET', '13 杯'], ['KE', '5 杯'], ['CO', '2 杯'], ['RW', '1 杯']]), q(rows));
  const summaryHint = await page.eval(`document.querySelector('.origin-card > .hint').textContent`);
  check('摘要：4 個國家・5 個產區・共 21 杯（認不出的 2 杯不算）', summaryHint === '4 個國家・5 個產區・共 21 杯', summaryHint);
  const levels = await page.eval(`Object.fromEntries(['ET', 'KE', 'RW', 'BR'].map((c) => [c, document.querySelector('.origin-world path[data-code="' + c + '"]').getAttribute('class')]))`);
  check('顏色依杯數：衣索比亞第 2 級、肯亞第 2 級、盧安達第 1 級、巴西（沒沖過）第 0 級',
    levels.ET.includes('heat-2') && levels.KE.includes('heat-2') && levels.RW.includes('heat-1') && levels.BR.includes('heat-0'), q(levels));
  check('不在清單裡的國家（日本）不能點', !(await page.eval(`Boolean(document.querySelector('.origin-world [data-code="JP"]'))`)));
  const scroll = await page.eval(`(() => {
    const s = document.querySelector('.origin-scroll');
    const m = document.querySelector('.origin-hit[data-code="ET"]').getBoundingClientRect();
    const box = s.getBoundingClientRect();
    return { scrollable: s.scrollWidth > s.clientWidth, left: s.scrollLeft, inView: m.left >= box.left && m.right <= box.right };
  })()`);
  check('世界地圖在框裡橫向捲動，打開時喝最多的國家（衣索比亞）在畫面裡', scroll.scrollable && scroll.inView, q(scroll));
  const unknown = await page.eval(`[...document.querySelectorAll('.origin-unknown .origin-beans a')].map((a) => [a.getAttribute('href'), a.textContent])`);
  check('認不出產地的豆子另外列，連到豆子頁', q(unknown) === q([['#/beans/b-blend', ATTACK]]), q(unknown));
  check('豆子名稱的 HTML 不會執行（XSS）', await noInjection(page));
  let l = await layout(page);
  check('世界地圖：整頁不橫向捲動、橫條名稱不壓到數字、每列 ≥ 44px', l.pageWidth <= l.viewport && l.rowHits === 0 && l.shortRows === 0, q(l));
  const hitSize = await page.eval(`document.querySelector('.origin-hit[data-code="RW"]').getBoundingClientRect().width`);
  check('小國（盧安達）的圓點點擊範圍 ≥ 24px', hitSize >= 24, String(hitSize));
  await tap(page, '.origin-hit[data-code="RW"]');
  await page.waitFor(`location.hash === '#/origins/RW' && document.querySelector('.origin-country')`, { label: '點盧安達' });
  check('點小國的圓點：進到那個國家', true);
  const rwDetail = await page.eval(`document.querySelector('.origin-detail').textContent`);
  check('盧安達：從名稱 Huye 猜到南部省，一打開就顯示', rwDetail.startsWith('南部省：1 杯'), rwDetail);
  await openWorld(page, base);
  await click(page, '[data-country="CO"]');
  await page.waitFor(`location.hash === '#/origins/CO' && document.querySelector('.origin-country')`, { label: '點清單的哥倫比亞' });
  check('點清單：進到那個國家', true);
  l = await layout(page);
  check('長名稱的豆子：國家頁不橫向捲動', l.pageWidth <= l.viewport, q(l));

  /* ===== 國家：衣索比亞 ===== */
  await openCountry(page, base, 'ET');
  check('標題是國家名稱', (await page.eval(`document.getElementById('page-title').textContent`)) === '衣索比亞');
  const dots = await page.eval(`(() => {
    const svg = document.querySelector('.origin-country').getBoundingClientRect();
    const all = [...document.querySelectorAll('.origin-dot')];
    return { total: all.length, drunk: all.filter((d) => d.classList.contains('is-drunk')).map((d) => d.dataset.dot),
      outside: all.filter((d) => { const r = d.getBoundingClientRect(); return r.left < svg.left || r.right > svg.right || r.top < svg.top || r.bottom > svg.bottom; }).map((d) => d.dataset.dot) };
  })()`);
  check('9 個產區都畫出來，喝過的（耶加雪菲、古吉）是實心', dots.total === 9 && q(dots.drunk.sort()) === q(['ET.guji', 'ET.yirgacheffe']), q(dots));
  check('所有產區圓點都在地圖範圍裡', dots.outside.length === 0, dots.outside.join(', '));
  const first = await page.eval(`({ text: document.querySelector('.origin-detail').textContent,
    selected: document.querySelector('.origin-dot.is-selected')?.dataset.dot,
    notes: [...document.querySelectorAll('.origin-region-detail .note-tag')].map((n) => n.textContent.trim()),
    beans: [...document.querySelectorAll('.origin-region-detail .origin-beans li > a:first-child')].map((a) => a.getAttribute('href')) })`);
  check('打開時顯示喝最多的產區（耶加雪菲 8 杯）', first.text.startsWith('耶加雪菲：8 杯・平均') && first.selected === 'ET.yirgacheffe', q(first));
  check('最常選的風味（依次數）、喝過的豆子連到紀錄列表', first.notes.length === 3 && q(first.beans) === q(['#/?bean=b-yirga']), q(first));
  await tap(page, '.origin-hit[data-region="ET.guji"]');
  const guji = await page.eval(`({ text: document.querySelector('.origin-detail').textContent,
    confirm: document.querySelector('.origin-region-detail .origin-confirm')?.getAttribute('href'),
    selected: document.querySelector('.origin-dot.is-selected')?.dataset.dot, row: document.querySelector('.hbar-row.is-selected')?.dataset.region })`);
  check('點古吉的圓點：顯示 3 杯，清單和圓點一起標示', guji.text.startsWith('古吉：3 杯') && guji.selected === 'ET.guji' && guji.row === 'ET.guji', q(guji));
  check('產地是猜的：有「確認」連結到豆子頁', guji.confirm === '#/beans/b-guji', q(guji));
  await click(page, '.hbar-row[data-region=""]');
  const unassigned = await page.eval(`({ text: document.querySelector('.origin-detail').textContent, beans: [...document.querySelectorAll('.origin-region-detail .origin-beans li > a:first-child')].map((a) => a.textContent) })`);
  check('沒指定產區的另外一列', unassigned.text.startsWith('沒指定產區：2 杯') && q(unassigned.beans) === q(['日曬原生種']), q(unassigned));
  await tap(page, '.origin-hit[data-region="ET.harrar"]');
  check('點沒喝過的產區（哈拉）：「還沒喝過」', (await page.eval(`document.querySelector('.origin-detail').textContent`)) === '哈拉：還沒喝過');
  check('還沒喝過的產區列在下面', (await page.eval(`document.querySelector('.origin-untried').textContent`)).includes('哈拉'));
  l = await layout(page);
  check('國家頁：整頁不橫向捲動、橫條每列 ≥ 44px', l.pageWidth <= l.viewport && l.rowHits === 0 && l.shortRows === 0, q(l));
  await openCountry(page, base, 'US');
  const kona = await page.eval(`(() => { const svg = document.querySelector('.origin-country').getBoundingClientRect(); const d = document.querySelector('.origin-dot[data-dot="US.kona"]').getBoundingClientRect();
    return { w: svg.width, inside: d.left >= svg.left && d.right <= svg.right && d.top >= svg.top && d.bottom <= svg.bottom }; })()`);
  check('美國：放大到夏威夷（可娜在地圖裡）、沒喝過也能看', kona.inside && (await page.eval(`document.querySelector('.origin-card > .hint').textContent`)) === '還沒喝過美國的豆子', q(kona));
  await visit(page, base, '#/origins/ZZ');
  await page.waitFor(`location.hash === '#/origins' && document.querySelector('.origin-world')`, { label: '不認得的國家代碼' });
  check('不認得的國家代碼：回到世界地圖', true);
  await openCountry(page, base, 'ET');
  await click(page, '.origin-region-detail .origin-beans a[href="#/?bean=b-yirga"]');
  await page.waitFor(`location.hash === '#/' && document.querySelector('#filter-bean')?.value === 'b-yirga'`, { label: '點豆子跳到紀錄列表' });
  check('點豆子：紀錄列表只列那支豆子', (await page.eval(`document.querySelectorAll('.list > li').length`)) === 8);

  /* ===== 截圖：深淺色 × 世界、國家 ===== */
  for (const theme of ['dark', 'light']) {
    await setTheme(page, theme);
    await openWorld(page, base);
    await screenshot(page, path.join(shotDir, `origins-${theme}-world.png`));
    await openCountry(page, base, 'ET');
    await tap(page, '.origin-hit[data-region="ET.guji"]');
    await screenshot(page, path.join(shotDir, `origins-${theme}-ethiopia.png`));
  }

  /* ===== 豆子表單、列表 ===== */
  await visit(page, base, '#/beans');
  await page.waitFor(`document.querySelector('.list')`, { label: '豆子列表' });
  const cardText = await page.eval(`document.querySelector('a[href="#/beans/b-long"] .card-row').textContent.replace(/\\s+/g, ' ')`);
  check('豆子列表：國家＋產區＋莊園', cardText.includes('哥倫比亞 薇拉 El Paraiso'), cardText);
  await visit(page, base, '#/beans/b-guji');
  await page.waitFor(`document.querySelector('#country')`, { label: '豆子表單' });
  const guess = await page.eval(`({ hidden: document.querySelector('.origin-guess').hidden, text: document.querySelector('.origin-guess span').textContent, region: document.querySelector('[data-field="region"]').hidden })`);
  check('舊豆子：提示「看起來是 衣索比亞・古吉」，還沒選國家時沒有產區欄', !guess.hidden && guess.text === '看起來是 衣索比亞・古吉' && guess.region, q(guess));
  await click(page, '[data-action="apply-guess"]');
  const applied = await page.eval(`({ country: document.querySelector('#country').value, region: document.querySelector('#region').value, hint: document.querySelector('.origin-guess').hidden, regionField: document.querySelector('[data-field="region"]').hidden })`);
  check('按「套用」：選好國家和產區、提示消失', applied.country === 'ET' && applied.region === 'ET.guji' && applied.hint && !applied.regionField, q(applied));
  await submit(page, 'form');
  await toast(page, '已儲存');
  const saved = await page.eval(`import('/js/db.js').then((db) => db.get('beans', 'b-guji')).then((b) => ({ country: b.country, region: b.region, origin: b.origin }))`);
  check('存檔：國家、產區寫進豆子，莊園欄不動', q(saved) === q({ country: 'ET', region: 'ET.guji', origin: '' }), q(saved));
  await openCountry(page, base, 'ET');
  await tap(page, '.origin-hit[data-region="ET.guji"]');
  check('確認過的產地：不再顯示「確認」連結', !(await page.eval(`Boolean(document.querySelector('.origin-region-detail .origin-confirm'))`)));

  await visit(page, base, '#/beans/new');
  await page.waitFor(`document.querySelector('#country')`, { label: '新增豆子' });
  check('新增豆子：一開始沒有提示、沒有產區欄', await page.eval(`document.querySelector('.origin-guess').hidden && document.querySelector('[data-field="region"]').hidden`));
  await fill(page, '#name', 'Kenya Kirinyaga AB');
  check('輸入名稱就提示：看起來是 肯亞・基里尼亞加', (await page.eval(`document.querySelector('.origin-guess span').textContent`)) === '看起來是 肯亞・基里尼亞加');
  await page.eval(`(() => { const s = document.querySelector('#country'); s.value = 'PA'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const pa = await page.eval(`({ hint: document.querySelector('.origin-guess').hidden, options: [...document.querySelectorAll('#region option')].map((o) => o.value) })`);
  check('自己選了國家（巴拿馬）：提示消失、產區只有巴拿馬的', pa.hint && q(pa.options) === q(['', 'PA.boquete', 'PA.volcan']), q(pa));
  check('國家選單依地區分組', (await page.eval(`[...document.querySelectorAll('#country optgroup')].map((g) => g.label).join('|')`)) === '非洲・中東|美洲|亞洲・大洋洲');
  await submit(page, 'form');
  await toast(page, '已儲存');
  const created = await page.eval(`import('/js/db.js').then((db) => db.getAll('beans')).then((all) => all.find((b) => b.name === 'Kenya Kirinyaga AB')).then((b) => [b.country, b.region])`);
  check('新豆子：選的國家（不是猜的）、沒選產區', q(created) === q(['PA', '']), q(created));
  const invalid = await page.eval(`import('/js/models.js').then((m) => m.saveBean({ name: 'x', process: 'washed', roastLevel: 'light', country: 'KE', region: 'ET.guji' })).then((r) => r.errors)`);
  check('產區和國家對不上：存不進去', invalid?.region === '產區和國家對不上', q(invalid));
  const tooLong = await page.eval(`import('/js/models.js').then((m) => m.saveBean({ name: 'x', process: 'washed', roastLevel: 'light', country: 'CR', region: 'CR.centralvalley', origin: 'a'.repeat(95) })).then((r) => r.errors)`);
  check('國家＋產區＋莊園超過 100 字（分享的限制）：存不進去', Boolean(tooLong?.origin), q(tooLong));

  /* ===== 備份 ===== */
  const exported = await page.eval(`import('/js/models.js').then((m) => m.exportData({ includePhotos: false })).then((d) => ({ v: d.schemaVersion, guji: d.beans.find((b) => b.id === 'b-guji') }))`);
  check('匯出 schemaVersion 6，豆子帶著國家、產區', exported.v === 6 && exported.guji.country === 'ET' && exported.guji.region === 'ET.guji', q(exported));
  const v5 = await page.eval(`import('/js/models.js').then(async (m) => {
    const d = await m.exportData({ includePhotos: false });
    const old = { ...d, schemaVersion: 5, beans: d.beans.map(({ country, region, ...b }) => b) };
    const r = await m.importData(JSON.stringify(old), { replace: true });
    const b = (await import('/js/db.js')).get('beans', 'b-guji');
    return { ok: r.ok, bean: await b };
  }).then(({ ok, bean }) => ({ ok, country: bean.country, region: bean.region }))`);
  check('v5 備份（沒有國家、產區）照樣匯入，補成空的', q(v5) === q({ ok: true, country: '', region: '' }), q(v5));
  const bad = await page.eval(`import('/js/models.js').then(async (m) => {
    const d = await m.exportData({ includePhotos: false });
    d.beans[0].country = 'XX';
    return m.importData(JSON.stringify(d), { replace: true });
  })`);
  check('備份裡不認得的國家：整份不匯入', bad.ok === false && bad.errors.some((e) => e.includes('不認得的國家')), q(bad.errors));
  await openWorld(page, base);
  const afterImport = await page.eval(`[...document.querySelectorAll('[data-country]')].map((a) => a.dataset.country)`);
  check('匯入 v5 後地圖照樣從名稱猜（古吉又變回猜的）', q(afterImport) === q(['ET', 'KE', 'CO', 'RW']), q(afterImport));

  /* ===== 離線 ===== */
  await page.setOffline(true);
  await page.eval(`location.hash = '#/backup'; true`);
  await page.waitFor(`location.hash === '#/backup'`);
  await page.eval(`location.hash = '#/origins/KE'; true`);
  await page.waitFor(`document.querySelector('#origin-page .origin-country')`, { label: '離線開產地地圖' });
  check('離線：產地地圖照常顯示', true);
  await page.setOffline(false);

  check('沒有 CSP 違規', (await page.eval('window.__csp')).length === 0, (await page.eval('window.__csp')).join(' / '));
  const errors = page.errors.filter((e) => !(e.includes('ERR_INTERNET_DISCONNECTED') && e.includes('/icons/icon.svg')));
  check('沒有 JavaScript 錯誤', errors.length === 0, errors.join(' / '));

  /* ===== 沒有資料 ===== */
  const empty = await openPage(chrome, base);
  await openWorld(empty, base);
  const emptyState = await empty.eval(`({ hint: document.querySelector('.origin-card > .hint').textContent, rows: document.querySelectorAll('[data-country]').length,
    unknown: Boolean(document.querySelector('.origin-unknown')), map: document.querySelectorAll('.origin-world path').length })`);
  check('沒有紀錄：照樣畫地圖、提示記下第一杯，沒有清單', emptyState.hint.includes('記下第一杯') && emptyState.rows === 0 && !emptyState.unknown && emptyState.map > 150, q(emptyState));
  await screenshot(empty, path.join(shotDir, 'origins-empty.png'));
  check('沒有資料的頁面：沒有 CSP 違規、沒有 JavaScript 錯誤', (await empty.eval('window.__csp')).length === 0 && empty.errors.length === 0, empty.errors.join(' / '));
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
