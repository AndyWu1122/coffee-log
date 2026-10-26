// 濾杯清單（drippers）：舊紀錄的濾杯文字轉換、表單、備份匯入匯出
// 不需要 Supabase；Node 直接測 js/drippers.js，再用 headless Chrome（找不到時設 CHROME_PATH）開 App
// 「舊版」的資料用 1.7.0（commit 9b2c4c8）的 js/db.js（DB v5，git show 取得）在同一個網域寫入，再開新版 App 升級
// 確認：「V60」「v60」「V 60」合併成一支、名稱用最多次的寫法；空白＝未指定；dripper 文字保留；
// 重新整理不會重複建立；表單預設最近用過的、「再沖一杯」帶入濾杯；有紀錄的不能刪；
// 卡片、分享卡片、統計、上傳雲端的列都用濾杯名稱；舊備份（v3）匯入時用同一套規則轉換（合併時沿用本機的濾杯）
//
// 用法：node scripts/drippers-test.mjs

import { execFileSync } from 'node:child_process';
import { root, startServer, launchChrome, prepare, visit, click, fill, submit } from './chrome.mjs';
import { dripperKey, mergeDripperNames } from '../js/drippers.js';

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const q = JSON.stringify;
const DAY = 86400000;

/* ===== js/drippers.js（純函式） ===== */
let seq = 0;
const makeId = () => `new-${++seq}`;
check('dripperKey：去掉所有空白、忽略大小寫', dripperKey(' V 60 ') === 'v60' && dripperKey('v60') === 'v60' && dripperKey('  ') === '' && dripperKey(undefined) === '');
{
  const brews = [
    { id: 'a', dripper: 'V60', brewedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b', dripper: 'V60', brewedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'c', dripper: 'v60', brewedAt: '2026-01-05T00:00:00.000Z' },
    { id: 'd', dripper: ' V 60 ', brewedAt: '2026-01-03T00:00:00.000Z' },
    { id: 'e', dripper: ' Kalita 155 ', brewedAt: '2026-01-04T00:00:00.000Z' },
    { id: 'f', dripper: '', brewedAt: '2026-01-04T00:00:00.000Z' },
    { id: 'g', brewedAt: '2026-01-04T00:00:00.000Z' }, // v1 的紀錄可能沒有這個欄位
    { id: 'h', dripper: 'Origami', dripperId: 'already', brewedAt: '2026-01-04T00:00:00.000Z' }, // 已轉換過的不動
  ];
  const { drippers, idByBrew } = mergeDripperNames(brews, { makeId });
  check('合併後 2 支：V60（出現最多次的寫法）、Kalita 155（去掉前後空白）', q(drippers.map((d) => d.name)) === q(['V60', 'Kalita 155']), q(drippers));
  const v60 = drippers[0].id;
  check('V60、v60、V 60 都對到同一支', ['a', 'b', 'c', 'd'].every((id) => idByBrew.get(id) === v60));
  check('空白、沒有欄位的紀錄＝未指定', idByBrew.get('f') === '' && idByBrew.get('g') === '');
  check('已有 dripperId 的紀錄不處理', !idByBrew.has('h') && !drippers.some((d) => d.name === 'Origami'));
  check('建立時間＝最早一杯、未封存、筆記空白', drippers[0].createdAt === '2026-01-01T00:00:00.000Z' && drippers[0].archived === false && drippers[0].notes === '');

  const tie = mergeDripperNames([
    { id: 'x', dripper: 'kalita', brewedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'y', dripper: 'Kalita', brewedAt: '2026-02-01T00:00:00.000Z' },
  ], { makeId });
  check('同票時用最近一杯的寫法', tie.drippers.length === 1 && tie.drippers[0].name === 'Kalita', q(tie.drippers));

  const reuse = mergeDripperNames(brews, { existing: [{ id: 'local-v60', name: 'v 60', archived: true }], makeId });
  check('existing 名稱相同就沿用（含封存的），不新建', reuse.drippers.length === 1 && reuse.drippers[0].name === 'Kalita 155'
    && idByBrew.size === reuse.idByBrew.size && reuse.idByBrew.get('a') === 'local-v60');
}

/* ===== 舊版（DB v5）的資料 ===== */
const OLD_COMMIT = '9b2c4c8'; // 1.7.0：最後一個 DB v5 的版本
const OLD_DB_SOURCE = execFileSync('git', ['show', `${OLD_COMMIT}:js/db.js`], { cwd: root, encoding: 'utf8' });
const now = Date.now();
const at = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();
const oldBrew = (id, dripper, daysAgo, extra = {}) => ({
  id, beanId: 'bean-1', grinderId: '', brewedAt: at(daysAgo), dripper, grindSetting: '', coffeeG: 15, waterG: 240, tempC: 92,
  totalTimeS: 150, rating: 4, flavor: { acidity: 3, sweetness: 3, bitterness: 3, body: 3 }, flavorNotes: [], notes: '', visibility: 'private', ...extra,
});
const OLD = {
  beans: [{ id: 'bean-1', name: '耶加雪菲', origin: '', process: 'washed', roastLevel: 'light', roastDate: '', bagWeightG: null, archived: false, createdAt: at(30) }],
  brews: [
    oldBrew('old-1', 'V60', 10),
    oldBrew('old-2', 'V60', 9),
    oldBrew('old-3', 'v60', 8),
    oldBrew('old-4', 'V 60', 7),
    oldBrew('old-5', 'Kalita 155', 6),
    oldBrew('old-6', '', 5),
    oldBrew('old-8', 'Kalita 155', 4),
    oldBrew('old-7', 'kalita155 ', 1), // 最近一杯：表單預設應該是 Kalita 155
  ],
};

let server;
let chrome;
try {
  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();
  const page = await chrome.newPage(null, { isolated: true });

  // 同網域、沒有 App 的頁面：用舊版 db.js（blob 模組）寫入舊格式的資料
  await page.goto(`${base}manifest.json`);
  const wrote = await page.eval(`(async () => {
    const url = URL.createObjectURL(new Blob([${q(OLD_DB_SOURCE)}], { type: 'text/javascript' }));
    const db = await import(url);
    await db.bulkPut(${q(OLD)});
    const brews = (await db.getAll('brews')).length;
    const conn = await db.openDB();
    conn.close();
    return { version: conn.version, brews };
  })()`);
  check('舊版 db.js 建出 DB v5 並寫入 8 筆紀錄', wrote.version === 5 && wrote.brews === 8, q(wrote));

  const dbq = (code) => page.eval(`import('/js/db.js').then(async (db) => { ${code} })`);
  const m = (code) => page.eval(`import('/js/models.js').then(async (m) => { ${code} })`);
  const snapshot = () => dbq(`return { drippers: await db.getAll('drippers'), brews: await db.getAll('brews'), migration: await db.getMeta('dripperMigration') };`);

  /* ===== 升級 ===== */
  await visit(page, base, '#/');
  await page.waitFor(`document.querySelectorAll('#app .card').length >= 7`, { label: '紀錄列表' });
  const s1 = await snapshot();
  const byName = Object.fromEntries(s1.drippers.map((d) => [d.name, d.id]));
  check('升級後只有 2 支濾杯：V60、Kalita 155', q(Object.keys(byName).sort()) === q(['Kalita 155', 'V60']), q(s1.drippers.map((d) => d.name)));
  const idOf = Object.fromEntries(s1.brews.map((b) => [b.id, b.dripperId]));
  check('V60、v60、V 60 的紀錄對到 V60', ['old-1', 'old-2', 'old-3', 'old-4'].every((id) => idOf[id] === byName.V60), q(idOf));
  check('Kalita 155、kalita155 的紀錄對到 Kalita 155（寫法用多數的）', ['old-5', 'old-7', 'old-8'].every((id) => idOf[id] === byName['Kalita 155']));
  check('空白的紀錄＝未指定', idOf['old-6'] === '');
  check('原本的 dripper 文字原封不動', s1.brews.length === OLD.brews.length && s1.brews.every((b) => b.dripper === OLD.brews.find((o) => o.id === b.id).dripper));
  check('其他欄位不變', s1.brews.every((b) => { const o = OLD.brews.find((x) => x.id === b.id); const { dripperId, ...rest } = b; return q(rest) === q(o); }));
  check('meta 記下轉換過（2 支）', s1.migration?.count === 2 && Boolean(s1.migration.at), q(s1.migration));
  const version = await dbq(`return (await db.openDB()).version;`);
  check('DB 升到 v6 以上（濾杯轉換在 v6）', version >= 6, String(version));

  const cardText = await page.eval(`document.querySelector('#app').textContent`);
  check('紀錄卡片顯示濾杯清單的名稱', cardText.includes('Kalita 155') && cardText.includes('V60') && !cardText.includes('kalita155') && !cardText.includes('v60'));

  await page.reload();
  await prepare(page);
  await page.waitFor(`document.querySelectorAll('#app .card').length >= 7`, { label: '重新整理後的列表' });
  const s2 = await snapshot();
  check('重新整理後不會重複建立（還是同樣 2 支）', q(s2.drippers.map((d) => d.id).sort()) === q(s1.drippers.map((d) => d.id).sort()));
  check('重新整理後 meta 不變', q(s2.migration) === q(s1.migration));

  /* ===== 表單 ===== */
  await visit(page, base, '#/brew/new');
  await page.waitFor(`document.querySelector('#dripperId')`, { label: '新增紀錄表單' });
  const optionTexts = await page.eval(`[...document.querySelectorAll('#dripperId option')].map((o) => o.textContent.trim())`);
  check('濾杯是下拉選單（未指定＋2 支，新建的在前）', q(optionTexts) === q(['未指定', 'Kalita 155', 'V60']), q(optionTexts));
  check('預設最近用過的濾杯（Kalita 155）', (await page.eval(`document.querySelector('#dripperId').value`)) === byName['Kalita 155']);
  check('有濾杯時沒有「新增濾杯」連結', !(await page.eval(`document.querySelector('a[href="#/drippers/new"]')`)));

  await visit(page, base, '#/brew/new?from=old-2');
  await page.waitFor(`document.querySelector('#dripperId')`, { label: '再沖一杯' });
  check('「再沖一杯」帶入濾杯（V60）', (await page.eval(`document.querySelector('#dripperId').value`)) === byName.V60);
  await fill(page, '#coffeeG', '16');
  await submit(page, 'form');
  await page.waitFor(`location.hash === '#/'`, { label: '存檔後回列表' });
  const saved = await dbq(`return (await db.getAll('brews')).find((b) => b.coffeeG === 16);`);
  check('新紀錄存的是 dripperId、沒有濾杯文字', saved?.dripperId === byName.V60 && saved.dripper === '', q(saved));

  await visit(page, base, '#/brew/old-3');
  await page.waitFor(`document.querySelector('#dripperId')`, { label: '編輯舊紀錄' });
  check('編輯舊紀錄：選到轉換後的濾杯', (await page.eval(`document.querySelector('#dripperId').value`)) === byName.V60);
  await fill(page, '#notes', '改過');
  await submit(page, 'form');
  await page.waitFor(`location.hash === '#/'`, { label: '存檔後回列表' });
  const edited = await dbq(`return db.get('brews', 'old-3');`);
  check('編輯舊紀錄後，原本的濾杯文字還在', edited.notes === '改過' && edited.dripper === 'v60' && edited.dripperId === byName.V60, q(edited));

  /* ===== 濾杯管理 ===== */
  check('☰ 選單有「濾杯」', Boolean(await page.eval(`document.querySelector('.menu-list a[href="#/drippers"][role="menuitem"]')`)));
  await visit(page, base, '#/drippers');
  await page.waitFor(`document.querySelectorAll('#app .card').length === 2`, { label: '濾杯列表' });
  await click(page, '.fab');
  await page.waitFor(`location.hash === '#/drippers/new' && document.querySelector('#name')`, { label: '新增濾杯' });
  await fill(page, '#name', 'あ'.repeat(101));
  await submit(page, 'form');
  await page.waitFor(`document.querySelector('[data-field="name"] .error')?.textContent`, { label: '名稱太長的錯誤' });
  check('濾杯名稱超過 100 字被擋下', (await page.eval(`document.querySelector('[data-field="name"] .error').textContent`)).includes('100'));
  await fill(page, '#name', '  Origami  ');
  await submit(page, 'form');
  await page.waitFor(`location.hash === '#/drippers' && document.querySelectorAll('#app .card').length === 3`, { label: '新增後的列表' });
  const origami = await dbq(`return (await db.getAll('drippers')).find((d) => d.name === 'Origami');`);
  check('新增濾杯（名稱去掉前後空白）', Boolean(origami));
  const delUsed = await m(`return m.deleteDripper(${q(byName.V60)});`);
  check('有紀錄的濾杯不能刪除', delUsed.ok === false && delUsed.message.includes('封存'), q(delUsed));
  const delFree = await m(`return m.deleteDripper(${q(origami.id)});`);
  check('沒有紀錄的濾杯可以刪除', delFree.ok === true && !(await dbq(`return db.get('drippers', ${q(origami.id)});`)));

  await visit(page, base, `#/drippers/${byName['Kalita 155']}`);
  await click(page, '[data-action="archive"]');
  await page.waitFor(`location.hash === '#/drippers'`, { label: '封存後回列表' });
  await visit(page, base, '#/brew/new');
  await page.waitFor(`document.querySelector('#dripperId')`, { label: '新增紀錄表單' });
  const options = await page.eval(`[...document.querySelectorAll('#dripperId option')].map((o) => o.value)`);
  check('封存的濾杯不在新紀錄的下拉裡', !options.includes(byName['Kalita 155']) && options.includes(byName.V60));
  check('最近那支封存了：預設改用其他濾杯', (await page.eval(`document.querySelector('#dripperId').value`)) === byName.V60);
  await visit(page, base, '#/brew/old-7');
  await page.waitFor(`document.querySelector('#dripperId')`, { label: '編輯用封存濾杯的紀錄' });
  check('編輯時原本的濾杯即使封存也列出', (await page.eval(`document.querySelector('#dripperId').selectedOptions[0].textContent`)).includes('（已封存）'));
  await m(`return m.setDripperArchived(${q(byName['Kalita 155'])}, false);`);

  /* ===== 分享卡片、統計、上傳雲端的列 ===== */
  const card = await m(`return m.getShareCardData('old-4');`);
  check('分享卡片的濾杯＝清單名稱（不是原本的「V 60」）', card.dripper === 'V60', card.dripper);
  const stats = await m(`return (await m.getStats({ period: 'all' })).stats.drippers.map((d) => [d.name, d.cups]);`);
  check('統計依濾杯分組（只算有評分的：V60 4 杯、Kalita 155 3 杯；未指定的不算）', q(stats) === q([['V60', 4], ['Kalita 155', 3]]), q(stats));
  const row = await page.eval(`import('/js/sync.js').then(async (s) => {
    const db = await import('/js/db.js');
    const brew = await db.get('brews', 'old-3');
    return s.toSharedRow(brew, await db.get('beans', brew.beanId), null, await db.get('drippers', brew.dripperId), null);
  })`);
  check('上傳雲端的列：dripper 是濾杯名稱', row.dripper === 'V60' && row.grinder_name === '', q({ dripper: row.dripper }));
  const tooLong = await dbq(`await db.put('drippers', { id: 'long', name: 'あ'.repeat(101), notes: '', archived: false, createdAt: new Date().toISOString() }); return true;`)
    && await m(`const b = await m.getBrew('old-1'); return m.saveBrew({ ...b, dripperId: 'long', visibility: 'friends' });`);
  check('分享給好友時，濾杯名稱超過 100 字被擋下', tooLong.ok === false && tooLong.errors.dripperId?.includes('100'), q(tooLong.errors));
  await dbq(`await db.remove('drippers', 'long'); return true;`);
  const missing = await m(`const b = await m.getBrew('old-1'); return m.saveBrew({ ...b, dripperId: 'gone' });`);
  check('不存在的濾杯被擋下', missing.ok === false && Boolean(missing.errors.dripperId));

  /* ===== 備份 ===== */
  const exported = await m(`return m.exportData({ includePhotos: false });`);
  check('匯出 schemaVersion 7（≥ 4 才有 drippers）、含 drippers', exported.schemaVersion === 7 && exported.drippers.length === 2 && exported.brews.every((b) => 'dripperId' in b));
  const reimport = await m(`return m.importData(${q(JSON.stringify(exported))}, { replace: true });`);
  check('v4 備份「取代全部」匯入成功', reimport.ok && reimport.drippers === 2 && reimport.brews === 9, q(reimport));
  const after = await snapshot();
  check('匯入後濾杯與紀錄的對應不變', q(after.brews.map((b) => [b.id, b.dripperId]).sort()) === q(exported.brews.map((b) => [b.id, b.dripperId]).sort()));

  const broken = { ...exported, brews: exported.brews.map((b, i) => (i === 0 ? { ...b, dripperId: 'nope' } : b)) };
  const brokenResult = await m(`return m.importData(${q(JSON.stringify(broken))}, { replace: true });`);
  check('v4 備份的紀錄指向不存在的濾杯：整份不匯入', brokenResult.ok === false && brokenResult.errors.some((e) => e.includes('濾杯')), q(brokenResult));
  const noDrippers = { ...exported };
  delete noDrippers.drippers;
  check('v4 備份缺少 drippers：不匯入', (await m(`return m.importData(${q(JSON.stringify(noDrippers))}, { replace: true });`)).ok === false);

  // 舊版（v3）備份：沒有 drippers、紀錄沒有 dripperId
  const v3 = {
    schemaVersion: 3, exportedAt: at(0), photosIncluded: false, photos: [],
    beans: OLD.beans, grinders: [],
    brews: [oldBrew('v3-1', 'Origami', 3), oldBrew('v3-2', 'origami ', 2), oldBrew('v3-3', 'v 60', 1), oldBrew('v3-4', '', 1), oldBrew('v3-5', 'Origami', 1)],
  };
  const merged = await m(`return m.importData(${q(JSON.stringify(v3))}, { replace: false });`);
  const s3 = await snapshot();
  const names3 = s3.drippers.map((d) => d.name).sort();
  check('v3 備份「合併」：V60 沿用本機的、只新建 Origami', merged.ok && q(names3) === q(['Kalita 155', 'Origami', 'V60']), q({ merged, names3 }));
  const ids3 = Object.fromEntries(s3.brews.map((b) => [b.id, b.dripperId]));
  const origamiId = s3.drippers.find((d) => d.name === 'Origami')?.id;
  check('v3 備份的紀錄對應正確', ids3['v3-1'] === origamiId && ids3['v3-2'] === origamiId && ids3['v3-5'] === origamiId && ids3['v3-3'] === byName.V60 && ids3['v3-4'] === '', q(ids3));

  const replaced = await m(`return m.importData(${q(JSON.stringify(v3))}, { replace: true });`);
  const s4 = await snapshot();
  check('v3 備份「取代全部」：只有檔案裡的 2 支（Origami、v 60）', replaced.ok && replaced.drippers === 2
    && q(s4.drippers.map((d) => d.name).sort()) === q(['Origami', 'v 60']) && s4.brews.length === 5, q(s4.drippers.map((d) => d.name)));
  check('v3 備份「取代全部」的對應正確', s4.brews.every((b) => (b.dripper.trim() ? s4.drippers.find((d) => d.id === b.dripperId)?.name.replace(/\s/g, '').toLowerCase() === b.dripper.replace(/\s/g, '').toLowerCase() : b.dripperId === '')));

  const v1 = { schemaVersion: 1, beans: OLD.beans, brews: [{ ...oldBrew('v1-1', 'Chemex', 1), grinderId: undefined }] };
  const v1Result = await m(`return m.importData(${q(JSON.stringify(v1))}, { replace: true });`);
  check('v1 備份也會轉換濾杯', v1Result.ok && v1Result.drippers === 1 && (await snapshot()).brews[0].dripperId !== '', q(v1Result));

  await visit(page, base, '#/');
  await page.reload();
  await prepare(page);
  await page.waitFor(`document.querySelectorAll('#app .card').length >= 1`, { label: '匯入後重新整理' });
  const s5 = await snapshot();
  check('匯入後重新整理：不會再跑一次轉換（meta 不變、濾杯 1 支）', s5.drippers.length === 1 && q(s5.migration) === q(s1.migration));

  /* ===== 全新安裝：沒有濾杯時顯示「新增濾杯」連結 ===== */
  const fresh = await chrome.newPage(null, { isolated: true });
  await fresh.goto(`${base}#/`);
  await prepare(fresh);
  await fresh.eval(`import('/js/db.js').then((db) => db.put('beans', ${q(OLD.beans[0])})).then(() => true)`);
  await visit(fresh, base, '#/brew/new');
  await fresh.waitFor(`document.querySelector('#dripperId')`, { label: '全新安裝的表單' });
  check('沒有任何濾杯：下拉只有「未指定」、有「新增濾杯」連結',
    (await fresh.eval(`document.querySelectorAll('#dripperId option').length`)) === 1 && Boolean(await fresh.eval(`document.querySelector('a[href="#/drippers/new"]')`)));
  const freshMeta = await fresh.eval(`import('/js/db.js').then((db) => db.getMeta('dripperMigration'))`);
  check('全新安裝也記下轉換過（0 支）', freshMeta?.count === 0, q(freshMeta));

  // 寫入舊資料用的 manifest.json 頁面沒有 favicon，那個 404 不算
  const jsErrors = [...page.errors, ...fresh.errors].filter((e) => !e.includes('/favicon.ico'));
  check('沒有 JavaScript 錯誤', jsErrors.length === 0, jsErrors.join(' / '));
} catch (err) {
  failures.push(`執行錯誤：${err.message}`);
  console.log(err);
} finally {
  await chrome?.close();
  server?.close();
}

console.log(`\n${passed}/${passed + failures.length} 通過`);
if (failures.length) {
  console.log(`失敗：\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
