// 拉花（1.24.0）：不需要 Supabase；headless Chrome（找不到時設 CHROME_PATH），390px
// 確認：用上一版的 db.js（DB v8）建出資料再開新版，升級到 v9 後舊資料都在；
// 首頁「手沖｜拉花」切換、重新整理後記得、＋ 依分頁；拉花表單（照片在最上面、必填、其他圖案的說明）、
// 選帶 EXIF／GPS 的照片 → 存下來沒有中繼資料、有縮圖；編輯、再拉一杯帶入的欄位、圖案篩選、刪除；
// 被拉花引用的豆子不能刪；備份 v9（含拉花與照片、預估大小、壞掉的整份擋下、v8／v1 舊備份）；
// 統計頁的拉花卡片（沒資料／有資料、點圖表）；XSS；深淺色截圖；不橫向捲動、沒有 CSP 違規、沒有 JavaScript 錯誤
//
// 用法：node scripts/latte-ui-test.mjs

import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  root, startServer, launchChrome, prepare, visit, click, fill, submit, exifJpeg, inspectJpeg, extraMetadata, noInjection,
} from './chrome.mjs';

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const q = JSON.stringify;

// 上一版（1.23.0、DB v8）的 db.js：import 的相對路徑換成伺服器上的網址，才能從 blob 模組載入
const OLD_COMMIT = 'e3af7c2';
const OLD_DB_SOURCE = execFileSync('git', ['show', `${OLD_COMMIT}:js/db.js`], { cwd: root, encoding: 'utf8' });

const PORTRAIT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const XSS = '"><svg onload=pwn()>';
// Canvas 輸出 JPEG 自帶的 sRGB ICC 不含個人資訊（上傳前 photoForUpload 會再移除）；其他中繼資料都不能留下
const MARKERS = ['Exif  ', 'TestCam-EXIF-MARKER', 'GPS'];
const privateMetadata = (bytes) => {
  const info = inspectJpeg(bytes);
  const segs = extraMetadata(info).filter((seg) => !(seg.marker === 0xe2 && seg.id === 'ICC_PROFILE'));
  return { info, segs, markers: MARKERS.filter((m) => bytes.includes(m)) };
};
const now = new Date().toISOString();
const bean = (id, name, extra = {}) => ({
  id, name, origin: '衣索比亞', country: '', region: '', process: 'washed', roastLevel: 'light', roastDate: '', bagWeightG: null, archived: false, createdAt: now, ...extra,
});
const brew = (id, beanId) => ({
  id, beanId, method: 'pourover', grinderId: '', dripperId: '', brewedAt: now, dripper: '', grindSetting: '', coffeeG: 15, waterG: 240, tempC: 92,
  totalTimeS: 150, rating: 4, flavor: { acidity: 3, sweetness: 3, bitterness: 3, body: 3 }, flavorNotes: [], notes: '', visibility: 'private',
});

let server;
let chrome;
let shots;
try {
  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();
  shots = await mkdtemp(path.join(tmpdir(), 'coffee-log-latte-'));
  const page = await chrome.newPage(null, { isolated: true });
  await page.cdp('Emulation.setDeviceMetricsOverride', PORTRAIT);
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI));`,
  });

  const db = (code) => page.eval(`import('/js/db.js').then(async (db) => { ${code} })`);
  const models = (code) => page.eval(`import('/js/models.js').then(async (m) => { ${code} })`);
  const blobB64 = (store, key) => db(`const row = await db.get(${q(store)}, ${q(key)});
    if (!row) return null;
    const bytes = new Uint8Array(await row.blob.arrayBuffer());
    let s = ''; for (const b of bytes) s += String.fromCharCode(b);
    return { b64: btoa(s), type: row.blob.type, width: row.width ?? null, height: row.height ?? null };`);
  const shot = async (name) => {
    await page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
    const { data } = await page.cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(shots, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const noHScroll = () => page.eval('document.documentElement.scrollWidth <= document.documentElement.clientWidth');
  const pressed = (sel) => page.eval(`document.querySelector(${q(sel)})?.getAttribute('aria-pressed') === 'true'`);
  const counts = () => db(`return { arts: (await db.getAll('latteArts')).length, photos: (await db.getAll('latteArtPhotos')).length,
    thumbs: (await db.getAll('latteArtThumbs')).length, brewPhotos: (await db.getAll('photos')).length };`);

  /* ===== 從 DB v8 升級 ===== */
  await page.goto(`${base}manifest.json`);
  const source = OLD_DB_SOURCE.replace(/from '\.\/([\w.]+\.js)'/g, (_, file) => `from '${base}js/${file}'`);
  const wrote = await page.eval(`(async () => {
    const url = URL.createObjectURL(new Blob([${q(source)}], { type: 'text/javascript' }));
    const db = await import(url);
    const c = Object.assign(document.createElement('canvas'), { width: 40, height: 30 });
    const photo = await new Promise((r) => c.toBlob(r, 'image/jpeg'));
    await db.bulkPut({
      beans: [${q(bean('old-bean', '舊的豆子'))}],
      brews: [${q(brew('old-brew', 'old-bean'))}],
      photos: [{ brewId: 'old-brew', blob: photo, width: 40, height: 30, createdAt: ${q(now)} }],
      thumbs: [{ brewId: 'old-brew', blob: photo }],
      wishlist: [{ key: 'region:ET.guji', kind: 'region', target: 'ET.guji', createdAt: ${q(now)} }],
    });
    const conn = await db.openDB();
    conn.close();
    return { version: conn.version, stores: [...conn.objectStoreNames] };
  })()`);
  check('上一版的 db.js 建出 DB v8（沒有拉花的 store）', wrote.version === 8 && !wrote.stores.includes('latteArts'), q(wrote));

  await page.goto(`${base}#/`);
  await prepare(page);
  await page.waitFor(`document.querySelector('#app .brew-card')`, { label: '紀錄列表' });
  const upgraded = await db(`const conn = await db.openDB();
    const t = conn.transaction('latteArts');
    return { version: conn.version, stores: [...conn.objectStoreNames], indexes: [...t.objectStore('latteArts').indexNames],
      beans: (await db.getAll('beans')).length, brews: (await db.getAll('brews')).length, wish: (await db.getAll('wishlist')).length,
      photo: Boolean(await db.get('photos', 'old-brew')), thumb: Boolean(await db.get('thumbs', 'old-brew')) };`);
  check('升級到 DB v9：多了 latteArts（索引 madeAt、espressoBeanId）、latteArtPhotos、latteArtThumbs',
    upgraded.version === 9 && ['latteArts', 'latteArtPhotos', 'latteArtThumbs'].every((s) => upgraded.stores.includes(s))
      && upgraded.indexes.includes('madeAt') && upgraded.indexes.includes('espressoBeanId'), q(upgraded));
  check('升級後舊的豆子、紀錄、照片、想買清單都還在', upgraded.beans === 1 && upgraded.brews === 1 && upgraded.photo && upgraded.thumb && upgraded.wish === 1, q(upgraded));
  check('有資料：不會跳出新手教學', !(await page.eval(`Boolean(document.querySelector('.tour-card'))`)));

  /* ===== 首頁的「手沖｜拉花」 ===== */
  check('首頁上方有「手沖｜拉花」，預設手沖', await pressed('.home-tabs button[data-v="brews"]')
    && (await page.eval(`[...document.querySelectorAll('.home-tabs button')].map((b) => b.textContent.trim()).join('|')`)) === '手沖|拉花');
  check('手沖分頁的 ＋ 新增沖煮紀錄', (await page.eval(`document.querySelector('.fab').getAttribute('href')`)) === '#/brew/new');

  // 統計頁：還沒有拉花時的卡片
  await visit(page, base, '#/stats');
  await page.waitFor(`document.querySelector('#stats-latte')`, { label: '統計頁的拉花卡片' });
  check('統計頁（沒有拉花）：拉花卡片寫「還沒有拉花紀錄」、有連結',
    (await page.eval(`document.querySelector('#stats-latte').textContent`)).includes('還沒有拉花紀錄')
      && (await page.eval(`document.querySelector('#stats-latte a').getAttribute('href')`)) === '#/latte/new');
  check('拉花卡片不是 .stats-card（手沖的圖表不受影響）', !(await page.eval(`document.querySelector('#stats-latte').classList.contains('stats-card')`)));

  await visit(page, base, '#/');
  await click(page, '.home-tabs button[data-v="latte"]');
  await page.waitFor(`document.querySelector('.latte-empty')`, { label: '拉花分頁（沒有紀錄）' });
  check('切到拉花：顯示還沒有紀錄、＋ 新增拉花', (await page.eval(`document.querySelector('.fab').getAttribute('href')`)) === '#/latte/new'
    && await pressed('.home-tabs button[data-v="latte"]'));
  check('選的分頁記在 meta（不放 localStorage）', (await db(`return db.getMeta('homeTab');`)) === 'latte'
    && (await page.eval(`Object.keys(localStorage).filter((k) => k !== 'theme').length`)) === 0);
  await page.reload();
  await prepare(page);
  await page.waitFor(`document.querySelector('.home-tabs')`, { label: '重新整理後的首頁' });
  check('重新整理後仍是拉花', await pressed('.home-tabs button[data-v="latte"]') && Boolean(await page.eval(`document.querySelector('.latte-empty')`)));
  await shot('dark-latte-empty');

  /* ===== 新增拉花 ===== */
  await click(page, '.latte-empty a.btn');
  await page.waitFor(`location.hash === '#/latte/new' && document.querySelector('form.latte-form')`, { label: '拉花表單' });
  check('照片欄位在表單最上面', (await page.eval(`document.querySelector('form.latte-form').firstElementChild.dataset.field`)) === 'photo');
  check('照片只收 JPEG／PNG／WebP', (await page.eval(`document.querySelector('#photo-input').accept`)) === 'image/jpeg,image/png,image/webp');
  check('圖案是五個大按鈕', (await page.eval(`[...document.querySelectorAll('[data-name="pattern"] button')].map((b) => b.dataset.v).join()`)) === 'heart,tulip,rosetta,swan,other'
    && (await page.eval(`document.querySelector('[data-name="pattern"] button').getBoundingClientRect().height`)) >= 56);
  check('「其他」的說明預設隱藏', await page.eval(`document.querySelector('[data-field="patternNote"]').hidden`));
  check('還不能分享：沒有「誰看得到」', !(await page.eval(`Boolean(document.querySelector('[data-field="visibility"]'))`)));
  check('新增時沒有「再拉一杯」、刪除', !(await page.eval(`Boolean(document.querySelector('[data-action="delete"], a[href*="from="]'))`)));
  await submit(page, 'form');
  await page.waitFor(`document.querySelector('[data-field="pattern"] .error')?.textContent && document.querySelector('[data-field="selfScore"] .error')?.textContent`, { label: '必填的錯誤' });
  check('沒選圖案、沒自評：顯示錯誤、不存檔', (await counts()).arts === 0);

  const jpegFile = path.join(shots, 'exif-input.jpg');
  await writeFile(jpegFile, await exifJpeg(page));
  await click(page, '[data-name="pattern"] button[data-v="other"]');
  check('選「其他」：出現說明欄', !(await page.eval(`document.querySelector('[data-field="patternNote"]').hidden`)));
  await fill(page, '#patternNote', XSS);
  await click(page, '[data-name="selfScore"] button[data-v="4"]');
  await fill(page, '#milk', XSS);
  await fill(page, '#cup', '300ml 拿鐵杯');
  await page.eval(`(() => { const s = document.querySelector('#espressoBeanId'); s.value = 'old-bean'; s.dispatchEvent(new Event('change')); return true; })()`);
  await fill(page, '#notes', `融合太早 ${XSS}`);
  await page.setFiles('#photo-input', [jpegFile]);
  await page.waitFor(`document.querySelector('#photo-field .photo-preview')`, { label: '照片預覽' });
  check('選完照片還沒按儲存：不會寫入', (await counts()).photos === 0);
  await shot('dark-latte-form');
  check('390px：拉花表單不橫向捲動', await noHScroll());
  await submit(page, 'form');
  await page.waitFor(`location.hash === '#/' && document.querySelector('.latte-card-item')`, { label: '存檔後回到拉花列表' });

  const [first] = await db(`return db.getAll('latteArts');`);
  check('存下來的欄位', first && first.pattern === 'other' && first.patternNote === XSS && first.selfScore === 4 && first.milk === XSS
    && first.cup === '300ml 拿鐵杯' && first.espressoBeanId === 'old-bean' && first.visibility === 'private' && Boolean(first.madeAt) && Boolean(first.createdAt), q(first));
  const c1 = await counts();
  check('照片和縮圖存在拉花自己的 store，紀錄的照片沒變', c1.photos === 1 && c1.thumbs === 1 && c1.brewPhotos === 1, q(c1));
  const stored = await blobB64('latteArtPhotos', first.id);
  const meta = privateMetadata(Buffer.from(stored.b64, 'base64'));
  check('照片是 JPEG、最長邊 ≤ 1600、沒有 EXIF／GPS／相機型號',
    stored.type === 'image/jpeg' && !meta.info.error && Math.max(stored.width, stored.height) <= 1600 && meta.segs.length === 0 && meta.markers.length === 0,
    q({ segs: meta.segs, markers: meta.markers }));
  const thumb = await blobB64('latteArtThumbs', first.id);
  const thumbInfo = inspectJpeg(Buffer.from(thumb.b64, 'base64'));
  check('縮圖 ≤ 300px', !thumbInfo.error && Math.max(thumbInfo.size.width, thumbInfo.size.height) <= 300, q(thumbInfo.size));

  check('卡片：圖案說明、自評星星、牛奶、杯子、豆子、縮圖',
    await page.eval(`(() => { const c = document.querySelector('.latte-card-item'); return c.querySelector('.card-title').textContent.includes(${q(XSS)})
      && c.querySelector('.stars').textContent === '★★★★☆' && c.textContent.includes('300ml 拿鐵杯') && c.textContent.includes('舊的豆子')
      && Boolean(c.querySelector('.card-thumb')); })()`));
  check('XSS：圖案說明、牛奶、筆記都只當文字', await noInjection(page));
  check('390px：拉花列表不橫向捲動', await noHScroll());

  /* ===== 編輯、再拉一杯 ===== */
  await click(page, '.latte-card-item');
  await page.waitFor(`document.querySelector('#photo-field .photo-preview') && document.querySelector('[data-action="delete"]')`, { label: '編輯頁' });
  check('編輯頁：照片、欄位帶回來', (await page.eval(`document.querySelector('#photo-field .photo-preview').alt`)) === '這杯拉花的照片'
    && (await page.eval(`document.querySelector('#milk').value`)) === XSS && await pressed('[data-name="selfScore"] button[data-v="4"]'));
  check('XSS：編輯頁也只當文字', await noInjection(page));
  await click(page, `a[href="#/latte/new?from=${first.id}"]`);
  await page.waitFor(`location.hash.startsWith('#/latte/new?from=') && document.querySelector('form .notice')`, { label: '再拉一杯' });
  const copied = await page.eval(`({ pattern: document.querySelector('[data-name="pattern"]').dataset.value, note: document.querySelector('#patternNote').value,
    milk: document.querySelector('#milk').value, cup: document.querySelector('#cup').value, bean: document.querySelector('#espressoBeanId').value,
    score: document.querySelector('[data-name="selfScore"]').dataset.value, notes: document.querySelector('#notes').value,
    photo: Boolean(document.querySelector('#photo-field .photo-preview')) })`);
  check('再拉一杯：帶入圖案、牛奶、杯子、豆子；自評、筆記、照片不帶',
    copied.pattern === 'other' && copied.note === XSS && copied.milk === XSS && copied.cup === '300ml 拿鐵杯' && copied.bean === 'old-bean'
      && copied.score === '' && copied.notes === '' && !copied.photo, q(copied));
  check('牛奶、杯子有以前用過的建議', (await page.eval(`[...document.querySelectorAll('#cup-list option')].map((o) => o.value).join()`)) === '300ml 拿鐵杯');
  await click(page, '[data-name="pattern"] button[data-v="heart"]');
  await click(page, '[data-name="selfScore"] button[data-v="5"]');
  await fill(page, '#milk', '燕麥奶');
  await submit(page, 'form');
  await page.waitFor(`location.hash === '#/' && document.querySelectorAll('.latte-card-item').length === 2`, { label: '第二杯' });

  /* ===== 圖案篩選 ===== */
  check('有拉花時：圖案篩選（全部＋5 種）', (await page.eval(`document.querySelectorAll('.latte-filter .chip').length`)) === 6
    && (await page.eval(`document.querySelector('.latte-filter .chip').getBoundingClientRect().height`)) >= 44);
  await click(page, '.latte-filter .chip[data-pattern="heart"]');
  await page.waitFor(`document.querySelectorAll('.latte-card-item').length === 1`, { label: '只看愛心' });
  check('篩選愛心：只剩那一杯', (await page.eval(`document.querySelector('.latte-card-item .card-title').textContent.trim()`)) === '愛心'
    && await pressed('.latte-filter .chip[data-pattern="heart"]'));
  await click(page, '.latte-filter .chip[data-pattern="swan"]');
  await page.waitFor(`document.querySelector('#app .empty')?.textContent.includes('沒有這個圖案')`, { label: '天鵝（沒有）' });
  check('篩選沒有的圖案：顯示沒有這個圖案的紀錄', true);
  await click(page, '.latte-filter .chip[data-pattern=""]');
  await page.waitFor(`document.querySelectorAll('.latte-card-item').length === 2`, { label: '全部' });

  // 從統計頁點豆子過來（#/?bean=）：一定切回手沖
  await visit(page, base, '#/?bean=old-bean');
  await page.waitFor(`document.querySelector('.brew-card:not(.latte-card-item)')`, { label: '手沖列表' });
  check('#/?bean= 會切回手沖分頁', await pressed('.home-tabs button[data-v="brews"]') && (await db(`return db.getMeta('homeTab');`)) === 'brews');
  await click(page, '.home-tabs button[data-v="latte"]');
  await page.waitFor(`document.querySelector('.latte-card-item')`, { label: '切回拉花' });

  /* ===== 被拉花引用的豆子不能刪 ===== */
  await db(`await db.put('beans', ${q(bean('latte-bean', '義式豆'))}); return true;`);
  await models(`const r = await m.saveLatteArt({ madeAt: new Date().toISOString(), pattern: 'tulip', selfScore: 3, espressoBeanId: 'latte-bean' }); return r.ok;`);
  const del = await models(`return m.deleteBean('latte-bean');`);
  check('只有拉花引用的豆子也不能刪（請改用封存）', !del.ok && del.message.includes('拉花'), q(del));
  const badBean = await models(`return m.saveLatteArt({ madeAt: new Date().toISOString(), pattern: 'heart', selfScore: 3, espressoBeanId: 'nope' });`);
  check('豆子不存在：不能存', !badBean.ok && Boolean(badBean.errors.espressoBeanId));
  const badScore = await models(`return Promise.all([0, 6, 2.5].map((s) => m.saveLatteArt({ madeAt: new Date().toISOString(), pattern: 'heart', selfScore: s })));`);
  check('自評 0、6、2.5 都不能存', badScore.every((r) => !r.ok && r.errors.selfScore));
  const badPattern = await models(`return m.saveLatteArt({ madeAt: new Date().toISOString(), pattern: 'dragon', selfScore: 3 });`);
  check('不認得的圖案不能存', !badPattern.ok && Boolean(badPattern.errors.pattern));
  const longText = await models(`return m.saveLatteArt({ madeAt: new Date().toISOString(), pattern: 'heart', selfScore: 3, milk: 'x'.repeat(51) });`);
  check('牛奶超過 50 字不能存', !longText.ok && Boolean(longText.errors.milk));

  /* ===== 備份 ===== */
  const summary = await models(`return m.getBackupSummary();`);
  check('備份摘要：3 杯拉花、照片數含拉花的（紀錄 1＋拉花 1）', summary.latteArts === 3 && summary.photos === 2 && !summary.empty, q(summary));
  const exported = await models(`return m.exportData();`);
  check('匯出 schemaVersion 9、含 latteArts 與 latteArtPhotos（base64）',
    exported.schemaVersion === 9 && exported.latteArts.length === 3 && exported.latteArtPhotos.length === 1
      && exported.latteArtPhotos[0].artId === first.id && exported.latteArtPhotos[0].data.length > 100);
  const actualBytes = new TextEncoder().encode(JSON.stringify(exported, null, 2)).length;
  check('預估檔案大小和實際差不到 1%', Math.abs(actualBytes - summary.sizeWithPhotos) / actualBytes < 0.01, `${summary.sizeWithPhotos} / ${actualBytes}`);
  const noPhotos = await models(`return m.exportData({ includePhotos: false });`);
  check('不含照片的匯出：latteArtPhotos 是空陣列、拉花紀錄照常', noPhotos.latteArtPhotos.length === 0 && noPhotos.latteArts.length === 3);

  const importText = (data) => q(JSON.stringify(data));
  const before = await counts();
  for (const [label, bad, expect] of [
    ['照片對不到拉花', { ...exported, latteArtPhotos: [{ ...exported.latteArtPhotos[0], artId: 'nope' }] }, '找不到對應的拉花紀錄'],
    ['同一杯兩張照片', { ...exported, latteArtPhotos: [exported.latteArtPhotos[0], exported.latteArtPhotos[0]] }, '同一杯拉花有多張照片'],
    ['照片不是 JPEG', { ...exported, latteArtPhotos: [{ ...exported.latteArtPhotos[0], data: btoa('not a jpeg at all') }] }, '不是合法的 JPEG'],
    ['不認得的圖案', { ...exported, latteArts: exported.latteArts.map((a, i) => (i ? a : { ...a, pattern: 'dragon' })) }, '請選擇圖案'],
    ['豆子不在檔案裡', { ...exported, latteArts: exported.latteArts.map((a, i) => (i ? a : { ...a, espressoBeanId: 'nope' })) }, '找不到對應的豆子'],
    ['latteArts 格式錯誤', { ...exported, latteArts: 'x' }, 'latteArts 格式錯誤'],
  ]) {
    const r = await models(`return m.importData(${importText(bad)}, { replace: true });`);
    check(`壞掉的拉花資料（${label}）：整份不匯入、寫出原因`, !r.ok && r.errors.join('').includes(expect), q(r.errors));
  }
  check('擋下後資料沒變', q(await counts()) === q(before));

  await db(`await db.remove('latteArtThumbs', ${q(first.id)}); return true;`);
  const replaced = await models(`return m.importData(${importText(exported)}, { replace: true });`);
  check('取代全部匯入：成功、筆數正確', replaced.ok && replaced.latteArts === 3 && replaced.photos === 2, q(replaced));
  check('取代全部匯入：拉花照片在、縮圖重新產生', q(await counts()) === q({ arts: 3, photos: 1, thumbs: 1, brewPhotos: 1 }), q(await counts()));

  const v8 = { ...exported, schemaVersion: 8 };
  delete v8.latteArts;
  delete v8.latteArtPhotos;
  const merged = await models(`return m.importData(${importText(v8)}, { replace: false });`);
  check('v8 舊備份合併匯入：成功、本機的拉花保留', merged.ok && merged.latteArts === 0 && (await counts()).arts === 3, q(merged));
  const replacedV8 = await models(`return m.importData(${importText(v8)}, { replace: true });`);
  check('v8 舊備份取代全部：成功、拉花與照片一起清空', replacedV8.ok && q(await counts()) === q({ arts: 0, photos: 0, thumbs: 0, brewPhotos: 1 }), q(await counts()));
  const v1 = { schemaVersion: 1, beans: [bean('v1-bean', 'v1 的豆子')], brews: [(({ grinderId, dripperId, method, ...rest }) => rest)(brew('v1-brew', 'v1-bean'))] };
  const replacedV1 = await models(`return m.importData(${importText(v1)}, { replace: true });`);
  check('v1 舊備份照常匯入（沒有拉花）', replacedV1.ok && replacedV1.brews === 1 && replacedV1.latteArts === 0, q(replacedV1));
  const back = await models(`return m.importData(${importText(exported)}, { replace: true });`);
  check('再匯回 v9 備份', back.ok && (await counts()).arts === 3);

  /* ===== 統計頁的拉花 ===== */
  await models(`for (const [p, s] of [['heart', 2], ['heart', 4], ['rosetta', 3], ['heart', 5]]) {
    await m.saveLatteArt({ madeAt: new Date(Date.now() - 3600000).toISOString(), pattern: p, selfScore: s }); } return true;`);
  await visit(page, base, '#/stats');
  await page.waitFor(`document.querySelector('#stats-latte .chart-latte')`, { label: '統計頁的拉花圖表' });
  const latteCard = await page.eval(`(() => { const c = document.querySelector('#stats-latte'); return {
    text: c.textContent, bars: [...c.querySelectorAll('.hbar-row[data-detail]')].map((r) => r.querySelector('.hbar-name').textContent) }; })()`);
  check('拉花卡片：本月練習 7 杯、每種圖案的平均自評', latteCard.text.includes('本月練習') && latteCard.text.includes('7 杯')
    && latteCard.bars[0] === '愛心' && latteCard.bars.includes('其他'), q(latteCard.bars)); // 依圖案分組：「其他」不分說明
  await page.eval(`document.querySelector('#stats-latte .chart-latte .chart-hit').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 10 })); true`);
  check('點進步曲線：顯示那一杯的自評', (await page.eval(`document.querySelector('#stats-latte .chart-detail').textContent`)).includes('分'));
  await click(page, '#stats-latte .hbar-row[data-detail]');
  check('點圖案的長條：顯示平均自評', (await page.eval(`document.querySelector('#stats-latte .chart-detail').textContent`)).includes('平均自評'));
  check('XSS：統計頁的圖案名稱只當文字', await noInjection(page));
  check('手沖的統計照舊（只有 1 杯：顯示多記幾杯）', Boolean(await page.eval(`document.querySelector('.stats-empty')`)));
  check('390px：統計頁不橫向捲動', await noHScroll());
  await page.eval(`document.querySelector('#stats-latte').scrollIntoView(); true`);
  await shot('dark-stats-latte');

  /* ===== 淺色截圖 ===== */
  await page.eval(`import('/js/views/ui.js').then((m) => m.setThemePref('light')).then(() => true)`);
  await shot('light-stats-latte');
  await visit(page, base, '#/');
  await page.waitFor(`document.querySelector('.latte-card-item')`, { label: '拉花列表' });
  await shot('light-latte-list');
  check('淺色：拉花列表不橫向捲動', await noHScroll());
  await visit(page, base, `#/latte/${first.id}`);
  await page.waitFor(`document.querySelector('#photo-field .photo-preview')`, { label: '編輯頁' });
  await shot('light-latte-form');
  await page.eval(`import('/js/views/ui.js').then((m) => m.setThemePref('dark')).then(() => true)`);
  await visit(page, base, '#/');
  await page.waitFor(`document.querySelector('.latte-card-item')`, { label: '拉花列表' });
  await shot('dark-latte-list');

  /* ===== 刪除 ===== */
  await visit(page, base, `#/latte/${first.id}`);
  await page.eval(`window.__confirmText = ''; window.confirm = (t) => { window.__confirmText = t; return true; }; true`);
  await click(page, '[data-action="delete"]');
  await page.waitFor(`location.hash === '#/'`, { label: '刪除後回首頁' });
  check('刪除前提醒照片也會刪除', (await page.eval('window.__confirmText')).includes('照片也會一起刪除'));
  check('刪除：紀錄、照片、縮圖一起刪',
    await db(`return [await db.get('latteArts', ${q(first.id)}), await db.get('latteArtPhotos', ${q(first.id)}), await db.get('latteArtThumbs', ${q(first.id)})].every((r) => r == null);`));

  check('沒有 CSP 違規', (await page.eval('window.__csp.length')) === 0, q(await page.eval('window.__csp')));
  const errors = page.errors.filter((e) => !e.includes('/favicon.ico'));
  check('頁面沒有 JavaScript 錯誤', errors.length === 0, errors.join(' / '));
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
