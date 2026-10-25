// 動態牆與同步的前端端對端測試（docs/social-spec.md 階段 4）
// 用 headless Chrome 開兩個互相隔離的瀏覽器環境：A 在紀錄表單選「好友」並附照片 → 同步到本機 Supabase →
// B 在社群頁看到、按讚、看詳細內容；A 離線時改的紀錄恢復網路後自動送出；改回只有我、刪除時雲端跟著刪
// 也確認：豆名、產地、筆記、暱稱裡的 HTML 只顯示成文字；照片沒有 EXIF；C（不是好友）讀不到；封鎖後 B 看不到
//
// 登入：Google 登入無法自動化，改用本機 admin API 拿真的 session 放進 App 的儲存空間（只在這支測試裡做）
// 用法：先 npx supabase@2.120.0 start，再 node scripts/social-feed-test.mjs

import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  check, failures, summary, setupUsers, realSession, cleanup, rest, rows, insertBrew, downloadPhoto, photoExists, photoPath,
} from './supabase-local.mjs';
import {
  startServer, launchChrome, inspectJpeg, extraMetadata, sleep,
  prepare, visit, click, fill, submit, text, toast, fieldError, noInjection, signIn, exifJpeg,
} from './chrome.mjs';

// 規格指定的攻擊字串放在筆記和豆名；暱稱上限 20 字，改用 20 字以內的
const ATTACK = '<script>alert(1)</script>';
const ATTR_ATTACK = '"><img src=x onerror=pwn()>';
const A_NICK = '"><svg onload=pwn()>';
const NOTES = `${ATTACK}\n第二行 <b>粗體</b>`;

const q = JSON.stringify;
/** 在頁面裡呼叫 App 的 models.js（和畫面用的是同一份模組） */
const m = (page, expr) => page.eval(`import('/js/models.js').then(async (m) => ${expr})`);
const sharedRow = async (user, id) => rows(await rest(`shared_brews?id=eq.${id}`, { token: user.token }));

/** 在 Node 端輪詢，直到 fn() 為真 */
async function until(fn, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`等待逾時：${label}`);
    await sleep(200);
  }
}

let server;
let chrome;
let fixtureDir;

try {
  const { A, B, C } = await setupUsers(['A', 'B', 'C'], [['A', 'B']]);
  await rest(`profiles?id=eq.${A.id}`, { method: 'PATCH', token: A.token, body: { nickname: A_NICK } });

  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'coffee-log-fixture-'));

  /* ===== A：新增一筆分享給好友的紀錄（透過表單） ===== */
  const pa = await chrome.newPage(base, { isolated: true });
  await prepare(pa);
  check('底部分頁有「社群」', await pa.eval(`!document.querySelector('.tabbar [data-tab="social"]').hidden`));
  await signIn(pa, await realSession(A));
  const bean = { name: ATTACK, origin: ATTR_ATTACK, process: 'washed', roastLevel: 'light', roastDate: '2026-10-01' };
  const beanId = await m(pa, `(await m.saveBean(${q(bean)})).bean.id`);

  // 雲端的限制在存檔時就擋下（否則永遠同步不上去，只顯示「內容不符合雲端的限制」）
  const sharedBrew = (extra) => q({ beanId, brewedAt: new Date().toISOString(), coffeeG: 15, waterG: 240, visibility: 'friends', ...extra });
  const allNotes = `(() => { const ks = []; const walk = (n) => { ks.push(n.key); n.children.forEach(walk); }; m.FLAVOR_WHEEL.forEach(walk); return ks; })()`;
  const tooManyNotes = await m(pa, `m.saveBrew({ ...${sharedBrew()}, flavorNotes: ${allNotes}.slice(0, 31) })`);
  check('分享給好友時風味輪超過 30 個被擋下', tooManyNotes.ok === false && tooManyNotes.errors.flavorNotes?.includes('30'), q(tooManyNotes.errors));
  const longBean = await m(pa, `m.saveBean(${q({ ...bean, name: 'あ'.repeat(101) })})`);
  check('豆子名稱超過 100 字被擋下', longBean.ok === false && longBean.errors.name?.includes('100'), q(longBean.errors));
  const longGrinder = await m(pa, `m.saveGrinder({ name: 'あ'.repeat(101) })`);
  check('磨豆機名稱超過 100 字被擋下', longGrinder.ok === false && longGrinder.errors.name?.includes('100'), q(longGrinder.errors));
  // 舊資料或匯入的豆子名稱可能超過：分享這支豆子的紀錄時擋下
  const longBeanId = 'b0000000-0000-4000-8000-000000000001';
  await pa.eval(`import('/js/db.js').then((db) => db.put('beans', ${q({ ...bean, id: longBeanId, name: 'あ'.repeat(101), archived: false, createdAt: new Date().toISOString() })})).then(() => true)`);
  const longBeanBrew = await m(pa, `m.saveBrew(${sharedBrew({ beanId: longBeanId })})`);
  check('豆子名稱超過 100 字時，分享這支豆子的紀錄被擋下', longBeanBrew.ok === false && longBeanBrew.errors.beanId?.includes('100'), q(longBeanBrew.errors));
  await pa.eval(`import('/js/db.js').then((db) => db.remove('beans', ${q(longBeanId)})).then(() => true)`);

  await visit(pa, base, '#/brew/new');
  await pa.waitFor(`document.querySelector('[data-field="visibility"]')`, { label: '可見度切換' });
  check('可見度預設「只有我」', (await pa.eval(`document.querySelector('.segmented[data-name="visibility"]').dataset.value`)) === 'private');
  await fill(pa, '#coffeeG', '15');
  await fill(pa, '#waterG', '240');
  await fill(pa, '#notes', 'あ'.repeat(501));
  await click(pa, '.segmented[data-name="visibility"] button[data-v="friends"]');
  check('選「好友」時提示會分享哪些內容', (await text(pa, '#visibility-hint')).includes('筆記和照片都會讓好友看到'));
  await submit(pa, 'form');
  check('分享給好友時筆記超過 500 字被擋下', (await fieldError(pa, '[data-field="notes"]')).includes('500'));

  await fill(pa, '#notes', NOTES);
  const photoFile = path.join(fixtureDir, 'photo.jpg');
  await writeFile(photoFile, await exifJpeg(pa));
  await pa.setFiles('#photo-input', [photoFile]);
  await pa.waitFor(`document.querySelector('.photo-preview')`, { label: '照片預覽' });
  await submit(pa, 'form');
  await toast(pa, '已儲存');
  const brewId = await m(pa, `(await m.listBrews())[0].id`);
  const first = await m(pa, 'm.syncNow()');
  check('存檔後同步成功', first.status === 'done', JSON.stringify(first));
  await pa.waitFor(`document.querySelector('.shared-badge')`, { label: '列表的 👥 標示' });
  check('紀錄列表標示「好友看得到」', true);

  const [row] = (await sharedRow(B, brewId)) ?? [];
  check('B 從 API 讀得到 A 分享的紀錄', Boolean(row));
  check('雲端的筆記、豆名、產地和本機一致', row?.notes === NOTES && row?.bean_name === ATTACK && row?.bean_origin === ATTR_ATTACK);
  check('雲端紀錄的照片路徑是 <A>/<brew>.jpg', row?.photo_path === photoPath(A.id, brewId), row?.photo_path);
  const photo = await downloadPhoto(B.token, photoPath(A.id, brewId));
  const info = inspectJpeg(photo.bytes);
  check('B 下載得到照片', photo.status === 200, `HTTP ${photo.status}`);
  check('上傳的照片沒有 EXIF 等中繼資料', photo.status === 200 && extraMetadata(info).length === 0
    && !Buffer.from(photo.bytes).includes('TestCam-EXIF-MARKER'), extraMetadata(info).map((s) => s.id).join(' '));
  check('C（不是好友）讀不到紀錄', (await sharedRow(C, brewId))?.length === 0);
  check('C 讀不到照片', (await downloadPhoto(C.token, photoPath(A.id, brewId))).status >= 400);

  await visit(pa, base, `#/brew/${brewId}`);
  check('編輯頁顯示「已分享給好友」', (await pa.waitFor(`document.querySelector('#share-status:not([hidden])')?.textContent`)) === '已分享給好友');

  /* ===== B：社群頁 ===== */
  const pb = await chrome.newPage(base, { isolated: true });
  await prepare(pb);
  await signIn(pb, await realSession(B));
  // 「社群」分頁的數字：好友有新貼文時出現（切回前景時檢查），顏色和 ☰ 的好友邀請提示不同
  // 檢查實際有沒有畫出來（不只看 hidden 屬性：CSS 的 display 會蓋掉它）
  const shown = (sel) => `getComputedStyle(document.querySelector('${sel}')).display !== 'none'`;
  const feedBadge = shown('#social-badge');
  const recheck = (page) => page.eval(`document.dispatchEvent(new Event('visibilitychange')); true`);
  await recheck(pb);
  await pb.waitFor(feedBadge, { label: 'B 的「社群」分頁出現數字' });
  check('好友有新貼文：「社群」分頁顯示 1', (await text(pb, '#social-badge')) === '1');
  check('「社群」分頁的 aria-label 提示有新通知', (await pb.eval(`document.querySelector('.tabbar [data-tab="social"]').getAttribute('aria-label')`)) === '社群（1 則新通知）');
  const badgeColors = await pb.eval(`['#menu-badge', '#social-badge'].map((s) => getComputedStyle(document.querySelector(s)).backgroundColor)`);
  check('新通知的數字和好友邀請的「!」顏色不同', badgeColors[0] !== badgeColors[1], badgeColors.join(' / '));
  check('沒有好友邀請時 ☰ 沒有「!」', !(await pb.eval(shown('[data-alert="friends"]'))));
  await visit(pb, base, '#/social');
  await pb.waitFor(`document.querySelector('.feed-card')`, { label: '動態牆的卡片' });
  await pb.waitFor(`!(${feedBadge})`, { label: '看過社群頁後數字消失' });
  check('看過社群頁後「社群」分頁的數字消失', true);
  check('B 的動態牆有 A 的紀錄', (await pb.eval(`document.querySelectorAll('.feed-card').length`)) === 1);
  check('A 的暱稱照原樣顯示成文字', (await text(pb, '.feed-card .person-name')) === A_NICK);
  check('豆名（<script>）照原樣顯示成文字', (await text(pb, '.feed-card .card-title')) === ATTACK);
  check('動態牆沒有被注入 HTML', await noInjection(pb) && !(await pb.eval(`document.querySelector('#app script, #app img[onerror]')`)));
  check('照片用 signed URL 顯示', (await pb.eval(`document.querySelector('.feed-photo')?.src ?? ''`)).includes(`/storage/v1/object/sign/brew-photos/${A.id}/`));

  await click(pb, '[data-action="like"]');
  await pb.waitFor(`document.querySelector('[data-action="like"]').getAttribute('aria-pressed') === 'true'`, { label: '按讚' });
  await until(async () => rows(await rest(`likes?brew_id=eq.${brewId}`, { token: A.token }))?.length === 1, 'A 看到讚');
  check('B 按讚後 A 看得到這個讚', true);
  const cLike = await rest('likes', { method: 'POST', token: C.token, body: { brew_owner: A.id, brew_id: brewId } });
  check('C 不能對 A 的紀錄按讚', cLike.status >= 400, `HTTP ${cLike.status}`);

  await visit(pb, base, `#/social/${A.id}/${brewId}`);
  await pb.waitFor(`document.querySelector('.detail-notes')`, { label: '詳細頁的筆記' });
  check('詳細頁：筆記（含換行、<script>、<b>）照原樣顯示成文字', (await text(pb, '.detail-notes')) === NOTES);
  check('詳細頁：產地（屬性跳脫攻擊）照原樣顯示', (await text(pb, '.detail-text')).includes(ATTR_ATTACK));
  check('詳細頁：顯示「你 說讚」', (await text(pb, '.like-names')) === '你 說讚');
  check('詳細頁沒有被注入 HTML', await noInjection(pb) && !(await pb.eval(`document.querySelector('#app script, #app img[onerror]')`)));
  await click(pb, '[data-action="like"]');
  await until(async () => rows(await rest(`likes?brew_id=eq.${brewId}`, { token: A.token }))?.length === 0, '收回讚');
  check('收回讚', true);

  // 換頁後按讚的監聽器不能殘留：同一份頁面（只改 hash）換頁，舊頁面的資料（未讚）和新的（已讚）不一致時，
  // 按一次「收回讚」只能送出收回（之前舊監聽器會同時送出按讚，互相抵消）
  const likeBtn = `document.querySelector('.feed-card[data-key="${A.id}/${brewId}"] [data-action="like"]')`;
  await pb.eval(`location.hash = '#/'`);
  await pb.waitFor(`location.hash === '#/' && document.querySelector('.fab, .empty')`, { label: '紀錄列表' });
  await rest('likes', { method: 'POST', token: B.token, body: { brew_owner: A.id, brew_id: brewId } }); // 另一台裝置按讚
  await pb.eval(`location.hash = '#/social'`);
  await pb.waitFor(`${likeBtn}?.getAttribute('aria-pressed') === 'true'`, { label: '動態牆顯示已讚' });
  await click(pb, `.feed-card[data-key="${A.id}/${brewId}"] [data-action="like"]`);
  await until(async () => rows(await rest(`likes?brew_id=eq.${brewId}`, { token: A.token }))?.length === 0, '換頁後收回讚', 5000);
  await sleep(500); // 等所有請求結束，確認沒有被另一個監聽器按回去
  check('換頁後收回讚：雲端沒有讚、畫面顯示未讚',
    rows(await rest(`likes?brew_id=eq.${brewId}`, { token: A.token }))?.length === 0
      && (await pb.eval(`${likeBtn}.getAttribute('aria-pressed')`)) === 'false');

  /* ===== 改豆子名稱：分享出去的紀錄跟著更新 ===== */
  await m(pa, `m.saveBean(${q({ ...bean, id: beanId, name: '改名的豆子' })})`);
  await m(pa, 'm.syncNow()');
  check('改豆子名稱後，雲端紀錄跟著更新', (await sharedRow(B, brewId))?.[0]?.bean_name === '改名的豆子');

  /* ===== 衝突以本機為準 ===== */
  await rest(`shared_brews?id=eq.${brewId}`, { method: 'PATCH', token: A.token, body: { notes: '別台改的' } });
  await m(pa, `m.getBrew(${q(brewId)}).then((b) => m.saveBrew({ ...b, rating: 5 }))`);
  await m(pa, 'm.syncNow()');
  const merged = (await sharedRow(B, brewId))?.[0];
  check('本機修改後，雲端以本機為準（筆記被覆蓋回來）', merged?.notes === NOTES && merged?.rating === 5);
  await recheck(pb);
  await sleep(1500);
  check('好友只是修改舊紀錄：「社群」分頁不出現數字', !(await pb.eval(feedBadge)));

  /* ===== 離線時新增，恢復網路後自動上傳 ===== */
  await pa.setOffline(true);
  check('（模擬離線）', await pa.eval('!navigator.onLine'));
  const offlineBrew = {
    beanId, brewedAt: new Date().toISOString(), coffeeG: 16, waterG: 250, notes: '離線時沖的', visibility: 'friends',
  };
  const offlineId = await m(pa, `(await m.saveBrew(${q(offlineBrew)})).brew.id`);
  const offlineSync = await m(pa, 'm.syncNow()');
  check('離線時同步會停下（offline）', offlineSync.status === 'offline', JSON.stringify(offlineSync));
  check('離線時分享狀態是「等待上傳」', (await m(pa, `m.getShareStatus(${q(offlineId)})`))?.text.includes('等待上傳'));
  check('離線時雲端還沒有這筆', (await sharedRow(A, offlineId))?.length === 0);
  await pa.setOffline(false);
  await until(async () => (await sharedRow(B, offlineId))?.length === 1, '恢復網路後自動上傳');
  check('恢復網路後自動上傳（online 事件）', true);
  await recheck(pb);
  await pb.waitFor(feedBadge, { label: 'A 又分享一篇後 B 的數字再出現' });
  check('看過社群頁之後好友又分享新的：數字再出現', (await text(pb, '#social-badge')) === '1');

  /* ===== 別台裝置上傳的紀錄不會被刪掉 ===== */
  const otherDevice = await insertBrew(A, { withPhoto: false });
  await m(pa, 'm.syncNow()');
  check('這台裝置不認得的雲端紀錄（別台上傳的）不會被刪除', (await sharedRow(A, otherDevice))?.length === 1);

  /* ===== 改回只有我、刪除：雲端的紀錄和照片一起刪掉 ===== */
  await m(pa, `m.getBrew(${q(brewId)}).then((b) => m.saveBrew({ ...b, visibility: 'private' }))`);
  await m(pa, 'm.syncNow()');
  check('改回只有我：B 讀不到紀錄', (await sharedRow(B, brewId))?.length === 0);
  check('改回只有我：雲端紀錄刪除', (await sharedRow(A, brewId))?.length === 0);
  check('改回只有我：雲端照片刪除', !(await photoExists(photoPath(A.id, brewId))));
  check('改回只有我：本機的紀錄和照片還在', await m(pa, `Promise.all([m.getBrew(${q(brewId)}), m.getPhoto(${q(brewId)})]).then(([b, p]) => Boolean(b && p))`));

  await m(pa, `m.deleteBrew(${q(offlineId)})`);
  await m(pa, 'm.syncNow()');
  check('刪除紀錄：雲端跟著刪除', (await sharedRow(A, offlineId))?.length === 0);

  await visit(pb, base, '#/social');
  await pb.waitFor(`document.querySelector('.feed-card')`);
  check('B 的動態牆只剩別台裝置上傳的那筆', (await pb.eval(`[...document.querySelectorAll('.feed-card')].map((c) => c.dataset.key)`)).join() === `${A.id}/${otherDevice}`);
  await visit(pb, base, `#/social/${A.id}/${brewId}`);
  check('改回只有我的紀錄：詳細頁顯示找不到', (await pb.waitFor(`document.querySelector('.empty p')?.textContent`)).includes('找不到這筆紀錄'));

  /* ===== 封鎖後 B 看不到 ===== */
  await rest('blocks', { method: 'POST', token: A.token, body: { blocked: B.id } });
  await visit(pb, base, '#/social');
  await pb.waitFor(`document.querySelector('.empty')`, { label: '空的動態牆' });
  check('A 封鎖 B 之後，B 的動態牆是空的', !(await pb.eval(`document.querySelector('.feed-card')`)));
  check('封鎖不解除好友（B 讀得到和 A 的好友關係）',
    (await rest(`friendships?status=eq.accepted&or=(requester.eq.${A.id},addressee.eq.${A.id})`, { token: B.token })).json?.length === 1);

  /* ===== 同一支手機換帳號：前一個帳號分享的不會傳到新帳號，也不會被刪 ===== */
  const ownRow = async (user, id) => rows(await rest(`shared_brews?owner=eq.${user.id}&id=eq.${id}`, { token: user.token }));
  const aBrew = await m(pa, `(await m.saveBrew(${q({ ...offlineBrew, notes: 'A 帳號分享的' })})).brew.id`);
  await m(pa, 'm.syncNow()');
  check('（A 分享的紀錄在 A 的雲端）', (await ownRow(A, aBrew))?.length === 1);
  await signIn(pa, await realSession(C));
  const asC = await m(pa, 'm.syncNow()');
  check('換成 C 登入後同步：A 的紀錄沒有傳到 C', asC.status === 'done' && (await ownRow(C, aBrew))?.length === 0, JSON.stringify(asC));
  check('換成 C 登入後同步：A 雲端的那筆沒被刪', (await ownRow(A, aBrew))?.length === 1);
  check('換成 C 登入：那筆顯示「用另一個帳號分享的」', (await m(pa, `m.getShareStatus(${q(aBrew)})`))?.text.includes('另一個帳號'));
  const cBrew = await m(pa, `(await m.saveBrew(${q({ ...offlineBrew, notes: 'C 帳號分享的' })})).brew.id`);
  await m(pa, 'm.syncNow()');
  check('C 新分享的紀錄傳到 C 的雲端', (await ownRow(C, cBrew))?.length === 1);
  await signIn(pa, await realSession(A));
  await m(pa, 'm.syncNow()');
  check('換回 A：A 的那筆還在、C 的沒有傳到 A', (await ownRow(A, aBrew))?.length === 1 && (await ownRow(A, cBrew))?.length === 0);
  check('換回 A：A 的那筆是「已分享」，C 的是「另一個帳號」',
    (await m(pa, `m.getShareStatus(${q(aBrew)})`))?.text === '已分享給好友'
      && (await m(pa, `m.getShareStatus(${q(cBrew)})`))?.text.includes('另一個帳號'));
  await m(pa, `Promise.all([${q(aBrew)}, ${q(cBrew)}].map((id) => m.deleteBrew(id)))`);
  await m(pa, 'm.syncNow()');
  check('刪掉後：A 的雲端跟著刪除，C 的那筆（A 刪不到）留在 C 的雲端', (await ownRow(A, aBrew))?.length === 0 && (await ownRow(C, cBrew))?.length === 1);

  check('A 的頁面沒有 JavaScript 錯誤', pa.errors.length === 0, pa.errors.join(' / '));
  pa.errors.length = 0;

  /* ===== 每天 30 筆上限：狀態顯示額度用完；同一天不再重送 ===== */
  for (let i = 0; i < 40; i++) {
    try { await insertBrew(A, { withPhoto: false }); } catch { break; }
  }
  const limitedId = await m(pa, `(await m.saveBrew(${q({ ...offlineBrew, notes: '額度用完後' })})).brew.id`);
  const limited = await m(pa, 'm.syncNow()');
  check('額度用完時同步記下失敗', limited.failed >= 1, JSON.stringify(limited));
  check('額度用完時分享狀態提示明天再上傳', (await m(pa, `m.getShareStatus(${q(limitedId)})`))?.text.includes('額度'));
  const again = await m(pa, 'm.syncNow()');
  check('額度用完後，同一天再同步不會重送', again.failed === 1 && pa.errors.length === 1 && /400.*shared_brews/.test(pa.errors[0]),
    `${JSON.stringify(again)} ${pa.errors.join(' / ')}`);
  pa.errors.length = 0; // 被資料庫拒絕的那一次 400 是預期的

  /* ===== 備份檔 ===== */
  const exported = JSON.parse(await m(pa, 'JSON.stringify(await m.exportData({ includePhotos: false }))'));
  check('備份檔保留可見度', exported.brews.some((b) => b.visibility === 'friends') && exported.brews.some((b) => b.visibility === 'private'));
  check('備份檔不含同步狀態', !('sync' in exported));

  /* ===== 頁面錯誤 ===== */
  check('A 的頁面沒有其他 JavaScript 錯誤', pa.errors.length === 0, pa.errors.join(' / '));
  check('B 的頁面沒有 JavaScript 錯誤', pb.errors.length === 0, pb.errors.join(' / '));
  check('XSS 偵測：pwn() 從未被呼叫', !(await pa.eval('window.__pwned')) && !(await pb.eval('window.__pwned')));
} catch (err) {
  failures.push(`執行錯誤：${err.message}`);
  console.error(err);
} finally {
  await chrome?.close();
  server?.close();
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
  await cleanup();
}

summary();
