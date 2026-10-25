// 留言與回覆、社群頁的端對端測試：三個互相隔離的 headless Chrome（A、B、D，像三支不同的手機）操作真的畫面
// A、B、D 互為好友；A 的紀錄由 App 分享（這台裝置有這筆，詳細頁有「編輯」），B 的紀錄直接從 API 新增
// 確認：留言與回覆的位置、@暱稱、收起／展開、刪除權限與確認、送出時先顯示（失敗改回）、300 字上限、
// 「社群」分頁的數字與歸零（含 99+）、「全部｜我的」與「我」、封鎖後互相看不到、XSS、CSP 沒有違規
//
// 用法：先 npx supabase@2.120.0 start，再 node scripts/social-comments-test.mjs

import { execFileSync } from 'node:child_process';
import {
  check, failures, summary, setupUsers, realSession, cleanup, rest, rows, insertBrew, serviceKey,
} from './supabase-local.mjs';
import { startServer, launchChrome, prepare, visit, click, fill, submit, text, toast, noInjection, signIn, sleep } from './chrome.mjs';

const B_NICK = '"><svg onload=pwn()>'; // 暱稱上限 20 字
const XSS_BODY = '<img src=x onerror=pwn()> 好喝 <b>粗體</b>';
const q = JSON.stringify;
const m = (page, expr) => page.eval(`import('/js/models.js').then(async (m) => ${expr})`);
const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'return=representation' };
const adminRows = async (pathAndQuery) => rows(await rest(pathAndQuery, { headers: admin })) ?? [];
const commentId = async (body) => (await adminRows(`comments?select=id&body=eq.${encodeURIComponent(body)}`))[0]?.id;

/** 開一個隔離的頁面，在任何頁面腳本執行前開始記錄 CSP 違規；confirm 記下訊息再按確定 */
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
async function go(page, base, hash) {
  await visit(page, base, hash);
  await page.eval(`window.confirm = (msg) => { window.__confirm = msg; return true; }; true`);
}

/* ----- 留言區的小工具 ----- */
// 依內容找留言（內容可能含 HTML 字元，比對 textContent）
const findComment = (body) => `[...document.querySelectorAll('.comment')].find((el) => el.querySelector(':scope > .comment-main > .comment-body')?.textContent.includes(${q(body)}))`;
const waitComments = (page) => page.waitFor(`(() => { const s = document.querySelector('#comments-status'); return Boolean(s) && s.textContent !== '載入留言中…'; })()`, { label: '留言載入' });
async function postComment(page, body) {
  await fill(page, '#comment-body', body);
  await submit(page, '#comment-form');
  await page.waitFor(`(() => { const el = ${findComment(body)}; return el && !el.classList.contains('pending'); })()`, { label: `留言「${body}」送出` });
}
const clickOn = (page, body, action) => page.eval(`(${findComment(body)}).querySelector('[data-action="${action}"]').click(), true`);
const badge = (page) => page.eval(`(() => { const b = document.querySelector('#social-badge'); return getComputedStyle(b).display === 'none' ? '' : b.textContent; })()`);
const recheck = (page) => page.eval(`document.dispatchEvent(new Event('visibilitychange')); true`);
async function badgeIs(page, expected, label) {
  await recheck(page);
  try {
    await page.waitFor(`(() => { const b = document.querySelector('#social-badge'); return (getComputedStyle(b).display === 'none' ? '' : b.textContent) === ${q(expected)}; })()`, { label, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

let server;
let chrome;

try {
  const { A, B, D } = await setupUsers(['A', 'B', 'D'], [['A', 'B'], ['A', 'D'], ['B', 'D']]);
  await rest(`profiles?id=eq.${B.id}`, { method: 'PATCH', token: B.token, body: { nickname: B_NICK } });
  const b1 = await insertBrew(B, { withPhoto: false });

  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();

  /* ===== A：從 App 分享一筆紀錄 ===== */
  const pa = await openPage(chrome, base);
  await signIn(pa, await realSession(A));
  const beanId = await m(pa, `(await m.saveBean(${q({ name: 'A 的豆子', process: 'washed', roastLevel: 'light', roastDate: '2026-10-01' })})).bean.id`);
  const a1 = await m(pa, `(await m.saveBrew(${q({ beanId, brewedAt: new Date().toISOString(), coffeeG: 15, waterG: 240, visibility: 'friends' })})).brew.id`);
  check('A 分享的紀錄同步到雲端', (await m(pa, 'm.syncNow()')).status === 'done');

  /* ===== 社群頁：全部｜我的、「我」 ===== */
  await go(pa, base, '#/social');
  await pa.waitFor(`document.querySelectorAll('.feed-card').length === 2`, { label: 'A 的社群頁有兩筆' });
  check('底部分頁叫「社群」', (await text(pa, '.tabbar [data-tab="social"]')).trim().endsWith('社群'));
  check('「全部」包含自己和好友的紀錄', (await pa.eval(`[...document.querySelectorAll('.feed-card')].map((c) => c.dataset.key).sort().join()`))
    === [`${A.id}/${a1}`, `${B.id}/${b1}`].sort().join());
  check('自己的卡片標「我」，好友的沒有', await pa.eval(`document.querySelector('.feed-card[data-key="${A.id}/${a1}"] .me-tag')?.textContent === '我'
    && !document.querySelector('.feed-card[data-key="${B.id}/${b1}"] .me-tag')`));
  check('卡片顯示留言數 0', (await text(pa, `.feed-card[data-key="${A.id}/${a1}"] .comment-link`)).trim().endsWith('0'));
  await click(pa, '.segmented[data-name="filter"] button[data-v="mine"]');
  await pa.waitFor(`location.hash === '#/social?mine=1' && document.querySelector('.segmented[data-name="filter"]')?.dataset.value === 'mine'
    && document.querySelectorAll('.feed-card').length === 1`, { label: '我的' });
  check('「我的」只有自己的紀錄', (await pa.eval(`document.querySelector('.feed-card').dataset.key`)) === `${A.id}/${a1}`);
  await click(pa, '.segmented[data-name="filter"] button[data-v="all"]');
  await pa.waitFor(`location.hash === '#/social' && document.querySelectorAll('.feed-card').length === 2`, { label: '切回全部' });
  check('切回「全部」', true);
  await pa.eval(`location.hash = '#/feed'; true`);
  await pa.waitFor(`location.hash === '#/social'`, { label: '舊網址轉址' });
  check('舊網址 #/feed 轉到 #/social', true);

  /* ===== 詳細頁：自己的紀錄有「編輯」、沒有檢舉／封鎖 ===== */
  await go(pa, base, `#/social/${A.id}/${a1}`);
  await waitComments(pa);
  check('自己的紀錄：有「編輯」連到 #/brew/<id>', (await pa.eval(`document.querySelector('[data-action="edit"]')?.getAttribute('href')`)) === `#/brew/${a1}`);
  check('自己的紀錄：沒有檢舉、封鎖', !(await pa.eval(`document.querySelector('[data-action="report"], [data-action="block"]')`)));
  check('還沒有留言', (await text(pa, '#comments-status')) === '還沒有留言');

  /* ===== B：留言（XSS 字串只顯示成文字） ===== */
  const pb = await openPage(chrome, base);
  await signIn(pb, await realSession(B));
  await go(pb, base, '#/social'); // 先看過社群頁：A 的新貼文不算進之後的數字
  await pb.waitFor(`document.querySelector('.feed-card')`, { label: 'B 的社群頁' });
  await go(pb, base, `#/social/${A.id}/${a1}`);
  await waitComments(pb);
  check('好友的紀錄：沒有「編輯」', !(await pb.eval(`document.querySelector('[data-action="edit"]')`)));
  await postComment(pb, XSS_BODY);
  check('B 的留言出現在留言區', true);
  check('留言數顯示 1 則', (await text(pb, '#comment-count')) === '1 則');
  check('B 的暱稱照原樣顯示成文字', (await pb.eval(`(${findComment(XSS_BODY)}).querySelector('.person-name').textContent`)) === B_NICK);
  check('留言內容照原樣顯示成文字', (await pb.eval(`(${findComment(XSS_BODY)}).querySelector('.comment-body').textContent`)) === XSS_BODY);
  check('相對時間顯示「剛剛」', (await pb.eval(`(${findComment(XSS_BODY)}).querySelector('.comment-meta .hint').textContent`)) === '剛剛');
  check('留言區沒有被注入 HTML', await noInjection(pb) && !(await pb.eval(`document.querySelector('#comments img, #comments b')`)));
  const bMainId = await commentId(XSS_BODY);
  check('雲端存下 B 的留言', Boolean(bMainId));

  /* ===== 徽章：A 的紀錄有新留言 ===== */
  check('A 的「社群」分頁顯示 1（我貼文的新留言）', await badgeIs(pa, '1', 'A 的數字 1'), await badge(pa));
  check('aria-label 說明有幾則新通知', (await pa.eval(`document.querySelector('.tabbar [data-tab="social"]').getAttribute('aria-label')`)) === '社群（1 則新通知）');
  await go(pa, base, '#/social');
  await pa.waitFor(`document.querySelector('.feed-card')`, { label: 'A 的社群頁' });
  check('A 的卡片：留言數 1、標示有新留言', await pa.eval(`(() => {
    const link = document.querySelector('.feed-card[data-key="${A.id}/${a1}"] .comment-link');
    return link.classList.contains('has-new') && link.textContent.trim().endsWith('1') && link.getAttribute('href').endsWith('?comments=1');
  })()`));
  check('看過社群頁後數字歸零', await badgeIs(pa, '', 'A 的數字歸零'), await badge(pa));

  /* ===== A 回覆 B；D 回覆 A 的回覆（同一則主留言下、@暱稱） ===== */
  await go(pa, base, `#/social/${A.id}/${a1}?comments=1`);
  await waitComments(pa);
  await clickOn(pa, XSS_BODY, 'reply');
  check('按「回覆」顯示回覆對象', (await text(pa, '#comment-target-text')) === `回覆 ${B_NICK}`);
  await postComment(pa, 'A 回覆 B');
  check('A 的回覆在 B 的主留言下', await pa.eval(`Boolean(document.querySelector('.comment-thread[data-id="${bMainId}"] .comment-replies').contains(${findComment('A 回覆 B')}))`));
  check('回覆主留言時沒有 @', !(await pa.eval(`(${findComment('A 回覆 B')}).querySelector('.mention')`)));

  const pd = await openPage(chrome, base);
  await signIn(pd, await realSession(D));
  await go(pd, base, `#/social/${A.id}/${a1}`);
  await waitComments(pd);
  await clickOn(pd, 'A 回覆 B', 'reply');
  await postComment(pd, 'D 回覆 A 的回覆');
  check('回覆的回覆也在同一則主留言下', await pd.eval(`Boolean(document.querySelector('.comment-thread[data-id="${bMainId}"] .comment-replies').contains(${findComment('D 回覆 A 的回覆')}))`));
  check('回覆的回覆開頭顯示「@A」', (await pd.eval(`(${findComment('D 回覆 A 的回覆')}).querySelector('.mention')?.textContent`)) === '@A');
  const [dRow] = await adminRows(`comments?select=parent_id,reply_to_user&body=eq.${encodeURIComponent('D 回覆 A 的回覆')}`);
  check('雲端：parent 是主留言、reply_to_user 是 A', dRow?.parent_id === bMainId && dRow?.reply_to_user === A.id, JSON.stringify(dRow));

  check('B 的「社群」分頁顯示 2（回覆我的留言）', await badgeIs(pb, '2', 'B 的數字 2'), await badge(pb));
  await go(pb, base, '#/social');
  await pb.waitFor(`document.querySelector('.feed-card')`, { label: 'B 的社群頁' });
  check('B 看過社群頁後數字歸零', await badgeIs(pb, '', 'B 的數字歸零'), await badge(pb));

  /* ===== 回覆超過 3 則先收起 ===== */
  for (const body of ['第 3 則回覆', '第 4 則回覆']) {
    await rest('comments', { method: 'POST', token: D.token, body: { brew_owner: A.id, brew_id: a1, parent_id: bMainId, body } });
  }
  await go(pb, base, `#/social/${A.id}/${a1}`);
  await waitComments(pb);
  check('回覆 4 則：先顯示 3 則', (await pb.eval(`document.querySelectorAll('.comment-thread[data-id="${bMainId}"] .comment-replies > .comment:not([hidden])').length`)) === 3);
  check('顯示「查看其他 1 則回覆」', (await text(pb, `.comment-thread[data-id="${bMainId}"] [data-action="expand"]`)) === '查看其他 1 則回覆');
  await click(pb, `.comment-thread[data-id="${bMainId}"] [data-action="expand"]`);
  check('展開後 4 則都顯示', (await pb.eval(`document.querySelectorAll('.comment-thread[data-id="${bMainId}"] .comment-replies > .comment:not([hidden])').length`)) === 4);

  /* ===== 刪除權限 ===== */
  const deletable = (page) => page.eval(`[...document.querySelectorAll('.comment')].map((el) => [
    el.querySelector('.comment-body').textContent, Boolean(el.querySelector(':scope > .comment-main [data-action="delete"]'))])`);
  const bDel = await deletable(pb);
  check('B 只能刪自己的留言', bDel.length === 5 && bDel.every(([body, can]) => can === (body === XSS_BODY)), q(bDel));
  await go(pa, base, `#/social/${A.id}/${a1}`);
  await waitComments(pa);
  check('A（紀錄主人）能刪全部留言', (await deletable(pa)).every(([, can]) => can));
  await clickOn(pa, '第 4 則回覆', 'delete');
  await pa.waitFor(`!(${findComment('第 4 則回覆')})`, { label: 'A 刪除 D 的回覆' });
  check('刪除前確認', (await pa.eval('window.__confirm')) === '確定刪除這則留言？');
  check('A 刪除 D 的回覆：雲端也刪除', !(await commentId('第 4 則回覆')));
  check('留言數跟著減少', (await text(pa, '#comment-count')) === '4 則');

  /* ===== 送出時先顯示、按鈕停用；失敗改回 ===== */
  await go(pb, base, `#/social/${A.id}/${a1}`);
  await waitComments(pb);
  await pb.cdp('Network.enable');
  await pb.cdp('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
  await fill(pb, '#comment-body', '慢慢送出的留言');
  await submit(pb, '#comment-form');
  check('送出時先顯示（傳送中）、按鈕停用', await pb.eval(`(() => {
    const el = ${findComment('慢慢送出的留言')};
    return Boolean(el?.classList.contains('pending')) && el.textContent.includes('傳送中')
      && document.querySelector('#comment-form [type="submit"]').disabled && document.querySelector('#comment-body').value === '';
  })()`));
  await pb.waitFor(`(() => { const el = ${findComment('慢慢送出的留言')}; return el && !el.classList.contains('pending'); })()`, { label: '慢慢送出完成', timeout: 15000 });
  await pb.cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  check('送出完成後按鈕恢復', await pb.eval(`!document.querySelector('#comment-form [type="submit"]').disabled`));

  await pb.setOffline(true);
  await fill(pb, '#comment-body', '離線時的留言');
  await submit(pb, '#comment-form');
  await toast(pb, '連不上伺服器');
  check('送出失敗：畫面上的留言移除', !(await pb.eval(findComment('離線時的留言'))));
  check('送出失敗：文字放回輸入框、顯示錯誤', (await pb.eval(`document.querySelector('#comment-body').value`)) === '離線時的留言'
    && (await text(pb, '#comment-form .error')).includes('連不上伺服器'));
  await pb.setOffline(false);
  pb.errors.length = 0; // 離線時的網路錯誤是預期的

  /* ===== 300 字上限：輸入框就提示 ===== */
  await fill(pb, '#comment-body', 'あ'.repeat(280));
  check('接近上限：字數變色', await pb.eval(`document.querySelector('#comment-length').classList.contains('near')`) && (await text(pb, '#comment-length')) === '280／300');
  await fill(pb, '#comment-body', 'あ'.repeat(301));
  check('超過上限：字數變紅、顯示錯誤', await pb.eval(`document.querySelector('#comment-length').classList.contains('over')`)
    && (await text(pb, '#comment-form .error')) === '最多 300 字');
  const before = (await adminRows(`comments?select=id&brew_id=eq.${a1}`)).length;
  await submit(pb, '#comment-form');
  await sleep(500);
  check('超過上限時不送出', (await adminRows(`comments?select=id&brew_id=eq.${a1}`)).length === before);
  check('textarea 有 maxlength', (await pb.eval(`document.querySelector('#comment-body').maxLength`)) === 300);
  await fill(pb, '#comment-body', '');

  /* ===== B 刪除自己的主留言：回覆一起刪 ===== */
  await clickOn(pb, XSS_BODY, 'delete');
  await pb.waitFor(`!document.querySelector('.comment-thread[data-id="${bMainId}"]')`, { label: 'B 刪除主留言' });
  check('刪主留言前提醒回覆會一起刪', (await pb.eval('window.__confirm')).includes('底下的 3 則回覆也會一起刪除'), await pb.eval('window.__confirm'));
  check('刪主留言：雲端的回覆一起刪除', (await adminRows(`comments?select=id&parent_id=eq.${bMainId}`)).length === 0 && !(await commentId(XSS_BODY)));

  /* ===== 99+ ===== */
  // 用資料庫管理者直接寫入（測試用，略過每日上限）：B 在 A 的紀錄留 100 則
  execFileSync('docker', ['exec', 'supabase_db_coffee-log', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
    `insert into public.comments (brew_owner, brew_id, author, body)
     select '${A.id}', '${a1}', '${B.id}', '灌水 ' || n from generate_series(1, 100) n`], { stdio: 'ignore' });
  check('（準備 100 則留言）', (await adminRows(`comments?select=id&author=eq.${B.id}&body=like.${encodeURIComponent('灌水*')}`)).length === 100);
  check('超過 99 顯示「99+」', await badgeIs(pa, '99+', 'A 的 99+'), await badge(pa));
  check('aria-label：99+ 則新通知', (await pa.eval(`document.querySelector('.tabbar [data-tab="social"]').getAttribute('aria-label')`)) === '社群（99+ 則新通知）');
  await go(pa, base, '#/social?mine=1');
  await pa.waitFor(`document.querySelector('.feed-card')`, { label: 'A 的「我的」' });
  check('看過「我的」後歸零', await badgeIs(pa, '', 'A 的數字歸零'), await badge(pa));

  /* ===== 封鎖：A 封鎖 D 後，在 B 的紀錄上互相看不到對方的留言 ===== */
  await rest('comments', { method: 'POST', token: A.token, body: { brew_owner: B.id, brew_id: b1, body: 'A 在 B 的紀錄留言' } });
  await rest('comments', { method: 'POST', token: D.token, body: { brew_owner: B.id, brew_id: b1, body: 'D 在 B 的紀錄留言' } });
  await rest('comments', { method: 'POST', token: D.token, body: { brew_owner: A.id, brew_id: a1, body: 'D 在 A 的紀錄留言' } });
  await rest('blocks', { method: 'POST', token: A.token, body: { blocked: D.id } });
  await go(pa, base, `#/social/${B.id}/${b1}`);
  await waitComments(pa);
  check('A 看不到 D 的留言', Boolean(await pa.eval(findComment('A 在 B 的紀錄留言'))) && !(await pa.eval(findComment('D 在 B 的紀錄留言'))));
  await go(pd, base, `#/social/${B.id}/${b1}`);
  await waitComments(pd);
  check('D 看不到 A 的留言', Boolean(await pd.eval(findComment('D 在 B 的紀錄留言'))) && !(await pd.eval(findComment('A 在 B 的紀錄留言'))));
  await go(pd, base, `#/social/${A.id}/${a1}`);
  check('D 打不開 A 的紀錄（和不是好友一樣：找不到）', (await pd.waitFor(`document.querySelector('.empty p')?.textContent`)).includes('找不到這筆紀錄'));
  check('封鎖不解除好友：D 在 A 紀錄的留言沒有刪除', Boolean(await commentId('D 在 A 的紀錄留言')));
  await go(pa, base, `#/social/${A.id}/${a1}`);
  await waitComments(pa);
  check('A 在自己的紀錄上看不到 D 的留言', !(await pa.eval(findComment('D 在 A 的紀錄留言'))));

  /* ===== 頁面錯誤、XSS、CSP ===== */
  for (const [name, page] of [['A', pa], ['B', pb], ['D', pd]]) {
    check(`${name}：XSS 偵測，pwn() 從未被呼叫`, !(await page.eval('window.__pwned')));
    check(`${name}：沒有 CSP 違規`, (await violations(page)).length === 0, (await violations(page)).join(' / '));
    check(`${name}：沒有 JavaScript 錯誤`, page.errors.length === 0, page.errors.join(' / '));
  }
} catch (err) {
  failures.push(`執行錯誤：${err.message}`);
  console.error(err);
} finally {
  await chrome?.close();
  server?.close();
  await cleanup();
}

summary();
