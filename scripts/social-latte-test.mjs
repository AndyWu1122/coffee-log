// 拉花分享到社群（1.25.0）：API 層＋互相隔離的 headless Chrome（手機直向 390px）
// A、B 好友；C 非好友；D 是 A 的好友但被 A 封鎖
// 確認：A 在拉花表單選「👥 好友」→ 同步上傳 shared_latte_arts、照片沒有 EXIF；B 讀得到、C／D 讀不到（貼文和照片）；
// 分項 0／6、少一項被拒；不能改別人的、不能以別人的名義新增；手沖和拉花共用每天 30 筆；
// B 的社群頁：拉花卡片標「拉花」、總分、篩選「全部｜手沖｜拉花」、按讚、留言、詳細頁的四項自評、個人檔案列出拉花；
// A 改回只有我 → 雲端的貼文、讚、留言、照片都刪掉、B 看不到；XSS；深淺色截圖；不橫向捲動、沒有 CSP 違規、沒有 JavaScript 錯誤
//
// 用法：先 npx supabase@2.120.0 start，再 node scripts/social-latte-test.mjs

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  check, summary, setupUsers, realSession, cleanup, rest, rows, psql, downloadPhoto, photoExists, photoPath, insertBrew,
} from './supabase-local.mjs';
import {
  startServer, launchChrome, prepare, visit, click, fill, submit, inspectJpeg, extraMetadata, noInjection, signIn, exifJpeg,
} from './chrome.mjs';

const q = JSON.stringify;
const PORTRAIT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const XSS = '"><svg onload=pwn()>';

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
const m = (page, code) => page.eval(`import('/js/models.js').then(async (m) => ${code})`);
const noHScroll = (page) => page.eval('document.documentElement.scrollWidth <= document.documentElement.clientWidth');
const latteRows = (token, owner) => rest(`shared_latte_arts?select=id,pattern,pattern_note,score_completion,photo_path&owner=eq.${owner}`, { token });
const latteBody = (id, extra = {}) => ({
  id, made_at: new Date().toISOString(), pattern: 'heart', score_contrast: 3, score_foam: 3, score_symmetry: 3, score_completion: 3, ...extra,
});

let server;
let chrome;
let shots;
const pages = [];
try {
  const { A, B, C, D } = await setupUsers(['A', 'B', 'C', 'D'], [['A', 'B'], ['A', 'D']]);
  await rest('blocks', { method: 'POST', token: A.token, body: { blocked: D.id } });

  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();
  shots = await mkdtemp(path.join(tmpdir(), 'coffee-log-social-latte-'));
  const pa = await openPage(chrome, `${base}#/backup`);
  const pb = await openPage(chrome, `${base}#/backup`);
  pages.push(pa, pb);
  await signIn(pa, await realSession(A));
  await signIn(pb, await realSession(B));

  /* ===== A：新增一杯拉花，分享給好友 ===== */
  await visit(pa, base, '#/latte/new');
  await pa.waitFor(`document.querySelector('form.latte-form [data-name="visibility"]')`, { label: 'A 的拉花表單（有「誰看得到」）' });
  check('新增拉花：預設只有我', (await pa.eval(`document.querySelector('[data-name="visibility"]').dataset.value`)) === 'private');
  const photoFile = path.join(shots, 'exif-input.jpg');
  await writeFile(photoFile, await exifJpeg(pa));
  await pa.setFiles('#photo-input', [photoFile]);
  await pa.waitFor(`document.querySelector('#photo-field .photo-preview')`, { label: '照片預覽' });
  await click(pa, '[data-name="pattern"] button[data-v="other"]');
  await fill(pa, '#patternNote', XSS);
  for (const [key, v] of [['contrast', 4], ['foam', 3], ['symmetry', 4], ['completion', 5]]) {
    await click(pa, `[data-name="scores.${key}"] button[data-v="${v}"]`);
  }
  await fill(pa, '#milk', XSS);
  await fill(pa, '#notes', `筆記 ${XSS}`);
  await click(pa, '[data-name="visibility"] button[data-v="friends"]');
  check('選好友：說明會上傳哪些內容、豆子不上傳', (await pa.eval(`document.querySelector('#visibility-hint').textContent`)).includes('豆子不會上傳'));
  await submit(pa, 'form');
  await pa.waitFor(`location.hash === '#/' && document.querySelector('.latte-card-item .shared-badge')`, { label: 'A 存檔後的拉花列表（👥）' });
  const sync = await m(pa, 'm.syncNow()');
  check('同步完成、沒有失敗（存檔時已經在背景上傳）', sync.status === 'done' && sync.failed === 0, q(sync));
  const [artId] = await pa.eval(`import('/js/db.js').then((db) => db.getAllKeys('latteArts'))`);

  const mine = rows(await latteRows(A.token, A.id));
  check('雲端有這杯：圖案、說明、分項、照片路徑', mine?.length === 1 && mine[0].id === artId && mine[0].pattern === 'other' && mine[0].pattern_note === XSS
    && mine[0].score_completion === 5 && mine[0].photo_path === photoPath(A.id, artId), q(mine));
  check('posts 記成 latte', psql(`select kind from private.posts where owner = '${A.id}' and id = '${artId}'`) === 'latte');
  const photo = await downloadPhoto(B.token, photoPath(A.id, artId));
  const info = inspectJpeg(photo.bytes);
  check('B 下載得到照片，上傳的照片沒有 EXIF 等中繼資料', photo.status === 200 && !info.error && extraMetadata(info).length === 0, q({ status: photo.status, segs: extraMetadata(info) }));
  await visit(pa, base, `#/latte/${artId}`);
  await pa.waitFor(`document.querySelector('#share-status:not([hidden])')`, { label: 'A 編輯頁的分享狀態' });
  check('編輯頁：已分享給好友', (await pa.eval(`document.querySelector('#share-status').textContent`)).includes('已分享'));

  /* ===== API：誰讀得到 ===== */
  check('好友 B 讀得到', rows(await latteRows(B.token, A.id))?.length === 1);
  check('非好友 C 讀不到', rows(await latteRows(C.token, A.id))?.length === 0);
  check('被封鎖的 D 讀不到', rows(await latteRows(D.token, A.id))?.length === 0);
  check('C、D 下載不到照片', (await downloadPhoto(C.token, photoPath(A.id, artId))).status >= 400 && (await downloadPhoto(D.token, photoPath(A.id, artId))).status >= 400);
  check('C 在 feed_posts 也看不到', rows(await rest(`feed_posts?owner=eq.${A.id}`, { token: C.token }))?.length === 0);

  /* ===== API：內容與權限 ===== */
  const bad = async (body, token = B.token) => (await rest('shared_latte_arts', { method: 'POST', token, body })).json?.code;
  check('分項 0 被拒', (await bad(latteBody(crypto.randomUUID(), { score_foam: 0 }))) === '23514');
  check('分項 6 被拒', (await bad(latteBody(crypto.randomUUID(), { score_symmetry: 6 }))) === '23514');
  const missing = latteBody(crypto.randomUUID());
  delete missing.score_completion;
  check('少一項被拒', (await bad(missing)) === '23502');
  check('不能以別人的名義新增', (await bad({ ...latteBody(crypto.randomUUID()), owner: A.id })) === '42501');
  check('不能用 A 的 id 和 owner 探測（和沒權限一樣是 42501）', (await bad({ ...latteBody(artId), owner: A.id })) === '42501');
  const patch = await rest(`shared_latte_arts?owner=eq.${A.id}&id=eq.${artId}`, { method: 'PATCH', token: B.token, body: { notes: 'x' }, headers: { Prefer: 'return=representation' } });
  check('B 不能改 A 的', rows(patch)?.length === 0);
  const own = crypto.randomUUID();
  check('B 自己可以新增', (await rest('shared_latte_arts', { method: 'POST', token: B.token, body: latteBody(own) })).status === 201);
  const renamed = await rest(`shared_latte_arts?owner=eq.${B.id}&id=eq.${own}`, { method: 'PATCH', token: B.token, body: { id: crypto.randomUUID() } });
  check('不能改 id', renamed.status >= 400);
  // 手沖和拉花共用每天 30 筆：B 今天已經 1 筆（拉花），再塞 29 筆手沖
  for (let i = 0; i < 29; i++) await insertBrew(B, { withPhoto: false });
  check('手沖＋拉花滿 30 筆：再傳拉花被擋（P0001）', (await bad(latteBody(crypto.randomUUID()))) === 'P0001');
  check('手沖也被擋', (await rest('shared_brews', { method: 'POST', token: B.token, body: { id: crypto.randomUUID(), bean_name: 'x', brewed_at: new Date().toISOString(), coffee_g: 15, water_g: 240 } })).json?.code === 'P0001');
  psql(`delete from public.shared_brews where owner = '${B.id}'; delete from public.shared_latte_arts where owner = '${B.id}'`);

  /* ===== B 的社群頁 ===== */
  // A 再分享一筆手沖（篩選用）
  const brewId = await insertBrew(A, { withPhoto: false });
  await visit(pb, base, '#/social');
  await pb.waitFor(`document.querySelectorAll('#feed .feed-card').length === 2`, { label: 'B 的社群頁（手沖＋拉花）' });
  const card = await pb.eval(`(() => { const c = document.querySelector('#feed .feed-card.is-latte'); return c && {
    tag: c.querySelector('.kind-tag')?.textContent, title: c.querySelector('.card-title').textContent, total: c.querySelector('.latte-total')?.textContent,
    photo: Boolean(c.querySelector('img.latte-photo')), alt: c.querySelector('img.latte-photo')?.alt }; })()`);
  check('拉花卡片：標「拉花」、圖案說明（當文字）、總分 4.0、照片', card?.tag === '拉花' && card.title.includes(XSS) && card.total.includes('4.0') && card.photo && card.alt === '這杯拉花的照片', q(card));
  check('XSS：社群頁只當文字', await noInjection(pb));
  check('篩選「全部｜手沖｜拉花」', (await pb.eval(`[...document.querySelectorAll('.feed-kinds button')].map((b) => b.textContent.trim()).join('|')`)) === '全部|手沖|拉花');
  check('390px：社群頁不橫向捲動', await noHScroll(pb));
  await pb.eval(`new Promise((r) => { const img = document.querySelector('img.latte-photo'); if (img.complete) r(true); else img.onload = img.onerror = () => r(true); })`);
  await pb.eval(`document.querySelector('.feed-card.is-latte').scrollIntoView(); true`);
  const shot = async (page, name) => {
    await page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
    const { data } = await page.cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(shots, `${name}.png`), Buffer.from(data, 'base64'));
  };
  await shot(pb, 'dark-feed');

  await click(pb, '.feed-kinds button[data-v="latte"]');
  await pb.waitFor(`location.hash === '#/social?kind=latte' && document.querySelectorAll('#feed .feed-card').length === 1`, { label: '只看拉花' });
  check('只看拉花：1 篇、是拉花', await pb.eval(`document.querySelector('#feed .feed-card').classList.contains('is-latte')`));
  await click(pb, '.feed-kinds button[data-v="brew"]');
  await pb.waitFor(`location.hash === '#/social?kind=brew' && document.querySelectorAll('#feed .feed-card').length === 1`, { label: '只看手沖' });
  check('只看手沖：1 篇、不是拉花', !(await pb.eval(`document.querySelector('#feed .feed-card').classList.contains('is-latte')`)));
  await click(pb, '.feed-toolbar button[data-v="mine"]');
  await pb.waitFor(`location.hash === '#/social?mine=1&kind=brew'`, { label: '「我的」保留種類篩選' });
  check('「我的」＋手沖：B 自己沒有分享', Boolean(await pb.waitFor(`document.querySelector('#app .empty')`, { label: 'B 我的（空）' })));

  /* ===== 按讚、留言、詳細頁 ===== */
  await visit(pb, base, '#/social?kind=latte');
  await pb.waitFor(`document.querySelector('#feed .feed-card.is-latte [data-action="like"]')`, { label: '拉花的讚' });
  await click(pb, '#feed .feed-card.is-latte [data-action="like"]');
  await pb.waitFor(`document.querySelector('#feed .feed-card.is-latte [data-action="like"]').getAttribute('aria-pressed') === 'true'`, { label: '按讚' });
  await pb.eval('new Promise((r) => setTimeout(() => r(true), 500))');
  check('B 按讚：雲端有這個讚', psql(`select count(*) from public.likes where brew_owner = '${A.id}' and brew_id = '${artId}'`) === '1');
  await visit(pb, base, `#/social/${A.id}/${artId}`);
  await pb.waitFor(`document.querySelector('.latte-detail-scores') && document.querySelector('#comment-form #comment-body')`, { label: 'B 看 A 的拉花詳細' });
  const detail = await pb.eval(`({ title: document.title, scores: [...document.querySelectorAll('.latte-detail-scores dd')].map((d) => d.textContent).join(),
    head: document.querySelector('.latte-detail-scores h2').textContent, edit: Boolean(document.querySelector('[data-action="edit"]')),
    report: Boolean(document.querySelector('[data-action="report"]')) })`);
  check('詳細頁：四項自評、總分、標題「A 的拉花」、有檢舉、沒有編輯', detail.scores === '4 / 5,3 / 5,4 / 5,5 / 5' && detail.head.includes('4.0')
    && detail.title.startsWith('A 的拉花') && detail.report && !detail.edit, q(detail));
  await fill(pb, '#comment-body', `好看 ${XSS}`);
  await submit(pb, '#comment-form');
  await pb.waitFor(`[...document.querySelectorAll('.comment-body')].some((c) => c.textContent.includes('好看')) || document.querySelector('#toast')?.textContent.includes('失敗')`, { label: 'B 的留言' });
  check('B 在拉花留言：雲端有這則', psql(`select count(*) from public.comments where brew_owner = '${A.id}' and brew_id = '${artId}'`) === '1');
  check('XSS：詳細頁、留言只當文字', await noInjection(pb));
  check('390px：詳細頁不橫向捲動', await noHScroll(pb));
  await shot(pb, 'dark-detail');

  /* ===== B 看 A 的個人檔案 ===== */
  await visit(pb, base, `#/user/${A.id}`);
  await pb.waitFor(`document.querySelector('#profile-page .feed-card.is-latte')`, { label: 'A 的個人檔案列出拉花' });
  check('個人檔案：列出拉花、貼文數 2（手沖＋拉花）', (await pb.eval(`document.querySelectorAll('#profile-page .feed-card').length`)) === 2
    && (await pb.eval(`document.querySelector('#profile-page').textContent`)).includes('2'));

  /* ===== A 自己的詳細頁：編輯連到拉花表單 ===== */
  await visit(pa, base, `#/social/${A.id}/${artId}`);
  await pa.waitFor(`document.querySelector('[data-action="edit"]')`, { label: 'A 自己的拉花詳細' });
  check('自己的拉花：編輯連到 #/latte/<id>、沒有檢舉', (await pa.eval(`document.querySelector('[data-action="edit"]').getAttribute('href')`)) === `#/latte/${artId}`
    && !(await pa.eval(`Boolean(document.querySelector('[data-action="report"]'))`)));

  /* ===== 淺色截圖 ===== */
  await pb.eval(`import('/js/views/ui.js').then((m) => m.setThemePref('light')).then(() => true)`);
  await visit(pb, base, '#/social');
  await pb.waitFor(`document.querySelector('#feed .feed-card.is-latte img.latte-photo')`, { label: '淺色社群頁' });
  await pb.eval(`new Promise((r) => { const img = document.querySelector('img.latte-photo'); if (img.complete) r(true); else img.onload = img.onerror = () => r(true); })`);
  await shot(pb, 'light-feed');
  await pb.eval(`import('/js/views/ui.js').then((m) => m.setThemePref('dark')).then(() => true)`);

  /* ===== A 改回只有我：雲端全部刪掉 ===== */
  await visit(pa, base, `#/latte/${artId}`);
  await pa.waitFor(`document.querySelector('[data-name="visibility"]')`, { label: 'A 的編輯頁' });
  await click(pa, '[data-name="visibility"] button[data-v="private"]');
  await submit(pa, 'form');
  await pa.waitFor(`location.hash === '#/'`, { label: '存檔' });
  const back = await m(pa, 'm.syncNow()');
  check('改回只有我：同步完成、沒有失敗', back.failed === 0, q(back));
  check('雲端的拉花、posts、讚、留言都刪掉', rows(await latteRows(A.token, A.id))?.length === 0
    && psql(`select count(*) from private.posts where id = '${artId}'`) === '0'
    && psql(`select count(*) from public.likes where brew_id = '${artId}'`) === '0'
    && psql(`select count(*) from public.comments where brew_id = '${artId}'`) === '0');
  check('照片也刪掉', !(await photoExists(photoPath(A.id, artId))));
  await visit(pb, base, `#/social/${A.id}/${artId}`);
  await pb.waitFor(`document.querySelector('#app .empty')`, { label: 'B 看已刪除的拉花' });
  check('B 看到「找不到」', (await pb.eval(`document.querySelector('#app .empty').textContent`)).includes('找不到'));
  check('A 本機的拉花還在、照片還在', Boolean(await pa.eval(`import('/js/db.js').then(async (db) => Boolean(await db.get('latteArts', ${q(artId)})) && Boolean(await db.get('latteArtPhotos', ${q(artId)})))`)));
  check('手沖貼文不受影響', psql(`select count(*) from public.shared_brews where id = '${brewId}'`) === '1');

  for (const [name, page] of [['A', pa], ['B', pb]]) {
    check(`${name}：沒有 CSP 違規`, (await page.eval('window.__csp.length')) === 0, q(await page.eval('window.__csp')));
    const errors = page.errors.filter((e) => !e.includes('/favicon.ico'));
    check(`${name}：頁面沒有 JavaScript 錯誤`, errors.length === 0, errors.join(' / '));
  }
} catch (err) {
  check(`執行錯誤：${err.message}`, false);
  console.error(err);
} finally {
  await chrome?.close();
  server?.close();
  await cleanup().catch((err) => console.warn('清除測試帳號失敗', err));
}
if (shots) console.log(`\n截圖：${shots}`);
summary();
