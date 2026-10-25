// 開發者後台的端對端測試：互相隔離的 headless Chrome（開發者 M、作者 A、一般使用者 U）操作真的畫面
// 確認：只有開發者看得到入口，一般使用者直接開 #/admin 顯示沒有權限；開發者看得到非好友的貼文和留言；
// 在畫面上刪留言、刪貼文、刪帳號（原因必填＋確認），刪完畫面更新；作者的手機顯示「已被開發者移除」且不會再上傳；
// 暱稱與內容的 XSS 只顯示成文字；每一頁沒有 CSP 違規、沒有 JavaScript 錯誤
//
// 用法：先 npx supabase@2.120.0 start，再 node scripts/admin-ui-test.mjs

import { execFileSync } from 'node:child_process';
import {
  call, check, summary, setupUsers, realSession, cleanup, rest, rows, insertBrew, serviceKey,
} from './supabase-local.mjs';
import { startServer, launchChrome, prepare, visit, fill, submit, text, toast, noInjection, signIn, sleep } from './chrome.mjs';

const XSS_NICK = '"><svg onload=pwn()>'; // 暱稱上限 20 字
const XSS_BODY = '<img src=x onerror=pwn()> 好喝 <b>粗體</b>';
const q = JSON.stringify;
const m = (page, expr) => page.eval(`import('/js/models.js').then(async (m) => ${expr})`);
const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const adminRows = async (pathAndQuery) => rows(await rest(pathAndQuery, { headers: admin })) ?? [];

function makeAdmin(user) {
  execFileSync('docker', ['exec', 'supabase_db_coffee-log', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
    `insert into private.admins (user_id) values ('${user.id}')`], { stdio: 'ignore' });
}

/** 隔離的頁面：在任何頁面腳本執行前開始記錄 CSP 違規 */
async function openPage(chrome, url) {
  const page = await chrome.newPage(null, { isolated: true });
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI));`,
  });
  await page.goto(url);
  await prepare(page);
  return page;
}
const violations = (page) => page.eval('window.__csp');
/** 換頁；confirm 記下訊息再按確定 */
async function go(page, base, hash) {
  await visit(page, base, hash);
  await page.eval(`window.confirm = (msg) => { window.__confirm = msg; return true; }; true`);
}
const adminEntryShown = (page) => page.eval(`!document.querySelector('[data-admin]').hidden`);
const recheck = (page) => page.eval(`document.dispatchEvent(new Event('visibilitychange')); true`);
const pageText = (page) => page.eval(`document.querySelector('#app').textContent`);

/** 在 sel 的刪除按鈕開出原因表單、填原因、送出 */
async function deleteWithReason(page, buttonSel, reason) {
  await page.eval(`document.querySelector(${q(buttonSel)}).click(), true`);
  await page.waitFor(`Boolean(document.querySelector('.admin-reason'))`, { label: '原因表單' });
  await fill(page, '.admin-reason textarea', reason);
  await submit(page, '.admin-reason');
}

let server;
let chrome;

try {
  const { M, A, B, C, U } = await setupUsers(['M', 'A', 'B', 'C', 'U'], [['A', 'B'], ['A', 'C']]);
  makeAdmin(M);
  await rest(`profiles?id=eq.${B.id}`, { method: 'PATCH', token: B.token, body: { nickname: XSS_NICK } });

  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();

  /* ===== A 從 App 分享一筆（筆記放攻擊字串）；B 留言、檢舉；C 有貼文 ===== */
  const pa = await openPage(chrome, base);
  await signIn(pa, await realSession(A));
  const beanId = await m(pa, `(await m.saveBean(${q({ name: '<b>A 的豆子</b>', process: 'washed', roastLevel: 'light', roastDate: '2026-10-01' })})).bean.id`);
  const brew = { beanId, brewedAt: new Date().toISOString(), coffeeG: 15, waterG: 240, visibility: 'friends', notes: XSS_BODY };
  const a1 = await m(pa, `(await m.saveBrew(${q(brew)})).brew.id`);
  check('（A 分享的紀錄同步到雲端）', (await m(pa, 'm.syncNow()')).status === 'done' && (await adminRows(`shared_brews?id=eq.${a1}`)).length === 1);
  const bComment = rows(await rest('comments', {
    method: 'POST', token: B.token, headers: { Prefer: 'return=representation' },
    body: { brew_owner: A.id, brew_id: a1, body: XSS_BODY },
  }))?.[0];
  await rest('reports', { method: 'POST', token: B.token, body: { brew_owner: A.id, brew_id: a1, reason: 'spam', detail: XSS_BODY } });
  await rest('feedback', { method: 'POST', token: B.token, body: { category: 'bug', message: XSS_BODY } });
  const c1 = await insertBrew(C, { withPhoto: false });
  check('（測試資料都建好了）', Boolean(bComment) && Boolean(c1));

  /* ===== 一般使用者：看不到入口，直接開也沒有權限 ===== */
  const pu = await openPage(chrome, base);
  await signIn(pu, await realSession(U));
  await go(pu, base, '#/');
  await recheck(pu);
  await sleep(1500);
  check('一般使用者：☰ 沒有「開發者後台」', !(await adminEntryShown(pu)));
  await go(pu, base, '#/admin');
  await pu.waitFor(`document.querySelector('#app .empty p')?.textContent.includes('沒有權限')`, { label: 'U 看到沒有權限' });
  check('一般使用者直接開 #/admin：顯示沒有權限', !(await pu.eval(`document.querySelector('#admin-page')`)));
  await go(pu, base, `#/admin/post/${A.id}/${a1}`);
  await pu.waitFor(`document.querySelector('#app .empty p')?.textContent.includes('沒有權限')`, { label: 'U 開貼文詳細' });
  check('一般使用者直接開貼文詳細：沒有權限、看不到內容', !(await pageText(pu)).includes('好喝'));

  /* ===== 開發者：入口、檢舉列表 ===== */
  const pm = await openPage(chrome, base);
  await signIn(pm, await realSession(M));
  await go(pm, base, '#/');
  await recheck(pm);
  await pm.waitFor(`!document.querySelector('[data-admin]').hidden`, { label: 'M 的 ☰ 出現開發者後台' });
  check('開發者：☰ 有「開發者後台」', true);
  await go(pm, base, '#/admin');
  await pm.waitFor(`document.querySelectorAll('#admin-list > li').length === 1`, { label: '檢舉列表' });
  check('預設是檢舉列表，顯示被檢舉的貼文與檢舉內容（只是文字）',
    (await text(pm, '#admin-list')).includes('垃圾訊息') && (await text(pm, '#admin-list')).includes(XSS_BODY));
  check('檢舉列表：XSS 沒有變成 HTML', await noInjection(pm));
  await pm.eval(`document.querySelector('#admin-list a.admin-link').click(), true`);
  await pm.waitFor(`location.hash === ${q(`#/admin/post/${A.id}/${a1}`)} && Boolean(document.querySelector('.admin-post'))`, { label: '從檢舉跳到貼文' });
  check('從檢舉直接跳到被檢舉的貼文', true);
  await prepare(pm);
  await pm.eval(`window.confirm = (msg) => { window.__confirm = msg; return true; }; true`);

  /* ===== 貼文詳細：非好友的內容、留言 ===== */
  const postText = await pageText(pm);
  check('開發者看得到非好友 A 的貼文（筆記、豆名照原樣）', postText.includes(XSS_BODY) && postText.includes('<b>A 的豆子</b>'));
  check('看得到 B 的留言與暱稱（照原樣）', (await text(pm, `[data-comment="${bComment.id}"]`)).includes(XSS_NICK)
    && (await text(pm, `[data-comment="${bComment.id}"] .admin-text`)) === XSS_BODY);
  check('貼文詳細頁：XSS 沒有變成 HTML', await noInjection(pm));

  /* ===== 刪留言：原因必填、確認 ===== */
  await pm.eval(`document.querySelector('[data-comment="${bComment.id}"] [data-action="delete-comment"]').click(), true`);
  await pm.waitFor(`Boolean(document.querySelector('.admin-reason'))`, { label: '原因表單' });
  await submit(pm, '.admin-reason');
  await pm.waitFor(`document.querySelector('.admin-reason .error').textContent === '請填寫原因'`, { label: '沒填原因' });
  check('沒填原因：擋下、沒有送出', (await adminRows(`comments?id=eq.${bComment.id}`)).length === 1);
  await fill(pm, '.admin-reason textarea', '不友善的留言');
  // 第一次送出失敗（斷網）：表單留著、按鈕恢復，同一個表單再按一次就能刪
  await pm.setOffline(true);
  await submit(pm, '.admin-reason');
  await toast(pm, '連不上伺服器');
  await pm.setOffline(false);
  check('刪除失敗：表單還在、按鈕可以再按、留言沒刪',
    await pm.eval(`Boolean(document.querySelector('.admin-reason')) && !document.querySelector('.admin-reason [type="submit"]').disabled`)
    && (await adminRows(`comments?id=eq.${bComment.id}`)).length === 1);
  await submit(pm, '.admin-reason');
  await pm.waitFor(`!document.querySelector('[data-comment="${bComment.id}"]')`, { label: '重試後留言從畫面消失' });
  check('刪留言前確認', (await pm.eval('window.__confirm')).includes('確定刪除'));
  check('留言從雲端刪除', (await adminRows(`comments?id=eq.${bComment.id}`)).length === 0);

  /* ===== 刪貼文 ===== */
  await pm.eval(`window.confirm = (msg) => { window.__confirm = msg; return true; }; true`);
  await deleteWithReason(pm, '[data-action="delete-post"]', '廣告');
  await pm.waitFor(`location.hash === '#/admin?tab=posts'`, { label: '刪完回到貼文列表' });
  check('刪貼文前確認', (await pm.eval('window.__confirm')).includes('確定刪除'));
  check('貼文從雲端刪除', (await adminRows(`shared_brews?id=eq.${a1}`)).length === 0);
  await pm.waitFor(`document.querySelectorAll('#admin-list > li').length === 1`, { label: '貼文列表只剩 C 的' });
  check('貼文列表更新（只剩 C 的貼文）', (await pm.eval(`document.querySelector('#admin-list > li').dataset.id`)) === c1);

  /* ===== 作者 A 的手機：顯示已被移除、修改後也不會再上傳 ===== */
  await m(pa, 'm.syncNow()');
  await go(pa, base, `#/brew/${a1}`);
  await pa.waitFor(`document.querySelector('#share-status')?.textContent.includes('已被開發者移除')`, { label: 'A 看到已被移除' });
  check('作者的紀錄頁：「這筆紀錄已被開發者移除，無法再分享」', true);
  await m(pa, `m.saveBrew(${q({ ...brew, id: a1, notes: '改一下' })}).then((r) => r.ok !== false)`);
  await m(pa, 'm.syncNow()');
  check('作者改了紀錄也不會再上傳', (await adminRows(`shared_brews?id=eq.${a1}`)).length === 0);
  check('作者手機上的紀錄保留', Boolean(await pa.eval(`import('/js/db.js').then((db) => db.get('brews', ${q(a1)})).then(Boolean)`)));

  /* ===== 用戶：搜尋、詳細頁、刪帳號 ===== */
  await go(pm, base, '#/admin?tab=users');
  await pm.waitFor(`document.querySelectorAll('#admin-list > li').length >= 5`, { label: '用戶列表' });
  await fill(pm, '#user-search input', 'svg');
  await submit(pm, '#user-search');
  await pm.waitFor(`document.querySelectorAll('#admin-list > li').length === 1`, { label: '搜尋結果' });
  check('搜尋暱稱：找到 B，暱稱照原樣顯示', (await text(pm, '#admin-list .person-name')) === XSS_NICK);
  check('用戶列表：XSS 沒有變成 HTML', await noInjection(pm));

  await go(pm, base, `#/admin/user/${M.id}`);
  await pm.waitFor(`Boolean(document.querySelector('.admin-profile'))`, { label: 'M 的用戶頁' });
  check('開發者自己的用戶頁：沒有刪除帳號按鈕', !(await pm.eval(`document.querySelector('[data-action="delete-user"]')`)));

  await go(pm, base, `#/admin/user/${C.id}`);
  await pm.waitFor(`Boolean(document.querySelector('.admin-profile'))`, { label: 'C 的用戶頁' });
  check('用戶詳細頁：看得到他的貼文', Boolean(await pm.eval(`document.querySelector('.admin-post[data-id="${c1}"]')`)));
  await deleteWithReason(pm, '[data-action="delete-user"]', '多次違規');
  await pm.waitFor(`location.hash === '#/admin?tab=users'`, { label: '刪完回到用戶列表' });
  check('刪帳號前確認', (await pm.eval('window.__confirm')).includes('無法復原'));
  check('C 的帳號與貼文都刪除', (await call(`/auth/v1/admin/users/${C.id}`, { headers: admin })).status === 404
    && (await adminRows(`shared_brews?owner=eq.${C.id}`)).length === 0);

  /* ===== 意見回饋、操作紀錄 ===== */
  await go(pm, base, '#/admin?tab=feedback');
  await pm.waitFor(`document.querySelectorAll('#admin-list > li').length === 1`, { label: '意見回饋列表' });
  check('意見回饋：內容照原樣顯示', (await text(pm, '#admin-list .admin-text')) === XSS_BODY && await noInjection(pm));
  await go(pm, base, '#/admin?tab=log');
  // 紀錄不能刪，本機資料庫可能還有之前測試留下的：只看最新的三筆（這次的操作，新→舊）
  await pm.waitFor(`document.querySelectorAll('#admin-list > li').length >= 3`, { label: '操作紀錄' });
  const latest = await pm.eval(`[...document.querySelectorAll('#admin-list > li')].slice(0, 3).map((li) => li.textContent)`);
  check('操作紀錄：這次的三個操作和原因都在（新→舊）',
    latest[0].includes('刪除帳號') && latest[0].includes('多次違規') && latest[1].includes('刪除貼文') && latest[1].includes('廣告')
    && latest[2].includes('刪除留言') && latest[2].includes('不友善的留言'), q(latest));

  /* ===== 頁面錯誤、XSS、CSP ===== */
  // A 的手機：同步時重新上傳被移除的那一筆，資料庫回 400（預期中，之後就不再送），瀏覽器會記一筆資源載入失敗
  const removedUpload = (e) => e.includes('status of 400') && e.includes('/rest/v1/shared_brews');
  check('A：被移除的那筆只被擋下一次（之後不再送）', pa.errors.filter(removedUpload).length === 1, pa.errors.join(' / '));
  // M 的頁面：刪留言時故意斷網一次，瀏覽器會記一筆斷網的載入失敗
  const offlineDelete = (e) => e.includes('ERR_INTERNET_DISCONNECTED') && e.includes('/rpc/admin_delete_comment');
  check('M：斷網的刪除只送了一次', pm.errors.filter(offlineDelete).length === 1, pm.errors.join(' / '));
  for (const [name, page] of [['M', pm], ['A', pa], ['U', pu]]) {
    const errors = page.errors.filter((e) => !(page === pa && removedUpload(e)) && !(page === pm && offlineDelete(e)));
    check(`${name}：pwn() 從未被呼叫`, !(await page.eval('window.__pwned')));
    check(`${name}：沒有 CSP 違規`, (await violations(page)).length === 0, (await violations(page)).join(' / '));
    check(`${name}：沒有 JavaScript 錯誤`, errors.length === 0, errors.join(' / '));
  }
} catch (err) {
  check(`執行錯誤：${err.message}`, false);
  console.error(err);
} finally {
  await chrome?.close();
  server?.close();
  await cleanup();
}

summary();
