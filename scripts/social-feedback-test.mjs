// 意見回饋的端對端測試：☰ →「意見回饋」→ Edge Function feedback → 存進 feedback 表 → 寄 Email 給站長
// 寄信：本機的 Edge Function 一律把 Email 寄到這支測試開的假 Resend 伺服器（port 54399，寫在 supabase/functions/feedback/index.ts），
// 確認收件人、寄件人、主旨、內容；假伺服器回錯誤時回饋照樣存下來，function log（docker logs）寫出看得懂的原因、不含金鑰
// 也確認：沒登入看不到表單、Edge Function 的權限、每天 5 則、誰都讀不到回饋、XSS 字串原樣保存、隱私說明
//
// 用法：先 npx supabase@2.120.0 start，再 node scripts/social-feedback-test.mjs

import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  anonKey, serviceKey, check, failures, summary, setupUsers, createUser, realSession, cleanup, call, rest, rows,
} from './supabase-local.mjs';
import { root, startServer, launchChrome, prepare, click, fill, submit, text, toast, fieldError, signIn, sleep } from './chrome.mjs';

const MOCK_PORT = 54399;
const XSS = '<script>alert(1)</script>\n第二行 <img src=x onerror=pwn()>';
const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const adminRows = async (pathAndQuery) => rows(await rest(pathAndQuery, { headers: admin }));
const feedbackFn = (token, body, method = 'POST') => call('/functions/v1/feedback', {
  method, body, headers: token ? { Authorization: `Bearer ${token}` } : {},
});

/** 假的 Resend：記下收到的請求；failNext 設成 { status, body } 時下一封回那個錯誤 */
const mail = { received: [], failNext: null };
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const fail = mail.failNext;
    mail.failNext = null;
    mail.received.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body || 'null') });
    res.writeHead(fail?.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(fail?.body ?? { id: 'mock-email' }));
  });
});

/** 本機 Edge Function 從 since 之後的 log（console.log／error 都在 docker logs 裡） */
const EDGE_CONTAINER = 'supabase_edge_runtime_coffee-log';
const functionLogs = async (since) => {
  await sleep(1000); // log 寫出有一點延遲
  return execSync(`docker logs --since ${since} ${EDGE_CONTAINER} 2>&1`, { encoding: 'utf8' });
};

let server;
let chrome;

try {
  await new Promise((resolve) => mock.listen(MOCK_PORT, '0.0.0.0', resolve));
  const logSince = new Date(Date.now() - 2000).toISOString();
  const swVersion = (await readFile(path.join(root, 'sw.js'), 'utf8')).match(/const APP_VERSION = '(\d+\.\d+\.\d+)';/)[1];

  /* ===== Edge Function：權限 ===== */
  const ok = { category: 'bug', message: 'x' };
  check('沒帶 token 被拒絕', (await feedbackFn(null, ok)).status === 401);
  check('只帶 anon key 被拒絕', (await feedbackFn(anonKey, ok)).status === 401);
  const { A, B } = await setupUsers(['A', 'B']);
  const D = await createUser('D'); // 沒有 profile
  check('不支援 POST 以外的方法', (await feedbackFn(A.token, undefined, 'GET')).status === 405);
  const noProfile = await feedbackFn(D.token, ok);
  check('還沒設定暱稱：no_profile', noProfile.status === 400 && noProfile.json?.error === 'no_profile', noProfile.text);
  const badCategory = await feedbackFn(A.token, { category: 'spam', message: 'x' });
  check('類型不對：invalid', badCategory.status === 400 && badCategory.json?.error === 'invalid', badCategory.text);
  const blank = await feedbackFn(A.token, { category: 'bug', message: '   ' });
  check('內容空白：invalid', blank.status === 400 && blank.json?.error === 'invalid', blank.text);
  check('（被擋下的都沒有存進資料庫、沒有寄信）', (await adminRows('feedback?select=id')).length === 0 && mail.received.length === 0);

  /* ===== 畫面：沒登入 ===== */
  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();
  const pa = await chrome.newPage(base, { isolated: true });
  await prepare(pa);
  await pa.waitFor(`navigator.serviceWorker.controller !== null`, { label: 'Service Worker 接手', timeout: 15000 });
  await pa.eval(`location.hash = '#/settings'; true`);
  check('「設定與關於」有「意見回饋」', Boolean(await pa.waitFor(`document.querySelector('.settings a[href="#/feedback"]')`, { label: '設定頁的意見回饋' })));
  await pa.eval(`location.hash = '#/feedback'; true`); // 只改 hash：保持受 Service Worker 控制（才問得到版本號）
  await pa.waitFor(`document.querySelector('#app .empty a[href="#/account"]')`, { label: '要先登入' });
  check('沒登入：提示要先登入，沒有表單', !(await pa.eval(`document.querySelector('#feedback-form')`)));

  /* ===== 畫面：A 送出回饋 ===== */
  await signIn(pa, await realSession(A));
  // 一般的重新整理（不是 visit 的強制重新整理）：頁面仍受 Service Worker 控制
  await pa.eval(`window.__old = true; location.reload(); true`);
  await pa.waitFor(`!window.__old && document.readyState === 'complete' && navigator.serviceWorker.controller !== null`, { label: '重新整理' });
  await prepare(pa);
  await pa.waitFor(`document.querySelector('#feedback-form')`, { label: '回饋表單' });
  check('表單提示只有開發者看得到、不附 email', (await text(pa, '#feedback-form')).includes('只有開發者看得到'));
  await submit(pa, '#feedback-form');
  check('沒選類型時擋下', (await fieldError(pa, '[data-field="category"]')) === '請選擇類型');
  check('沒寫內容時擋下', (await fieldError(pa, '[data-field="message"]')) === '請輸入內容');
  await click(pa, '.segmented[data-name="category"] button[data-v="bug"]');
  await fill(pa, '#feedback-message', XSS);
  check('顯示字數', (await text(pa, '#feedback-count')) === `${[...XSS].length}／1000`, await text(pa, '#feedback-count'));
  await submit(pa, '#feedback-form');
  await pa.waitFor(`document.querySelector('#app')?.textContent.includes('謝謝你的回饋')`, { label: '送出成功' });
  check('送出後顯示「謝謝你的回饋」', true);

  const [saved] = await adminRows(`feedback?author=eq.${A.id}`);
  check('存進資料庫：作者是 A、類型、內容原樣保存', saved?.category === 'bug' && saved?.message === XSS, JSON.stringify(saved));
  check('附上 App 版本號（＝sw.js 的 APP_VERSION，字串）', saved?.app_version === swVersion, `${saved?.app_version} / ${swVersion}`);
  check('畫面沒有被注入 HTML', !(await pa.eval(`window.__pwned || document.querySelector('#app script, #app img[onerror]')`)));

  /* ===== 寄給站長的 Email ===== */
  const email = mail.received.at(-1);
  check('寄出一封 Email', mail.received.length === 1, `${mail.received.length} 封`);
  check('用 Resend 的 API key、寄到站長的信箱', email?.auth === 'Bearer local-test-key' && email?.body?.to?.[0] === 'developer@test.local',
    JSON.stringify({ auth: email?.auth, to: email?.body?.to }));
  check('寄件人是 onboarding@resend.dev（免費方案不用自己的網域）', email?.body?.from?.includes('<onboarding@resend.dev>'), email?.body?.from);
  check('主旨：類型＋內容開頭（換行改成空白）', email?.body?.subject?.startsWith('[咖啡紀錄] 問題回報：<script>alert(1)</script>')
    && !/[\r\n]/.test(email?.body?.subject ?? ''), email?.body?.subject);
  check('內容是純文字（不是 HTML）：有暱稱、版本號、完整回饋', !email?.body?.html && email?.body?.text?.includes('暱稱：A')
    && email.body.text.includes(`App 版本：${swVersion}`) && email.body.text.includes(XSS));
  check('Email 不含送出者的 email', !email?.body?.text?.includes(A.email));

  /* ===== 誰都讀不到 ===== */
  const aRead = await rest('feedback', { token: A.token });
  check('送出的人自己也讀不到回饋', aRead.status >= 400 || rows(aRead)?.length === 0, `HTTP ${aRead.status}`);
  const bRead = await rest('feedback', { token: B.token });
  check('跨帳號：B 讀不到 A 的回饋', bRead.status >= 400 || rows(bRead)?.length === 0, `HTTP ${bRead.status}`);

  /* ===== 寄信失敗：回饋照樣存下來 ===== */
  mail.failNext = { status: 500, body: { message: 'mock failure' } };
  const bSend = await feedbackFn(B.token, { category: 'idea', message: '想要統計頁', appVersion: 3 });
  check('寄信失敗時仍回傳成功（notified: false）', bSend.status === 200 && bSend.json?.notified === false, bSend.text);
  check('寄信失敗時回饋照樣存下來', (await adminRows(`feedback?author=eq.${B.id}`)).length === 1);
  check('舊版 App 送整數版本 3 → 存成字串 "3"', (await adminRows(`feedback?author=eq.${B.id}`))[0]?.app_version === '3');

  /* ===== function log：寄信的結果看得懂、不含金鑰 ===== */
  // Resend 免費方案收件人不是註冊的 email 時，回的就是這個（正式環境最常見的原因）
  mail.failNext = {
    status: 403,
    body: {
      statusCode: 403, name: 'validation_error',
      message: 'You can only send testing emails to your own email address (owner@gmail.com). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address to an email using this domain.',
    },
  };
  const ownOnly = await feedbackFn(B.token, { category: 'other', message: '第 2 則' });
  check('Resend 回 403 時仍回傳成功（notified: false）', ownOnly.status === 200 && ownOnly.json?.notified === false, ownOnly.text);
  const logs = await functionLogs(logSince);
  check('log：寄出成功時記下 Resend 的 email id', logs.includes('[feedback] 已交給 Resend 寄出（id mock-email'));
  check('log：Resend 500 有狀態碼與原文', /\[feedback\] 沒有寄信：Resend 回傳 500.*mock failure/.test(logs));
  check('log：Resend 403（只能寄給自己）說明 FEEDBACK_TO 要和 Resend 帳號 email 一樣',
    logs.includes('[feedback] 沒有寄信：Resend 回傳 403（validation_error）') && logs.includes('一字不差'));
  check('log 不含 API key', !logs.includes('local-test-key'));

  /* ===== 每天 5 則 ===== */
  for (let i = 3; i <= 5; i++) await feedbackFn(B.token, { category: 'other', message: `第 ${i} 則` });
  const sixth = await feedbackFn(B.token, { category: 'other', message: '第 6 則' });
  check('第 6 則被擋下：rate_limited', sixth.status === 429 && sixth.json?.error === 'rate_limited', sixth.text);
  check('B 存下 5 則', (await adminRows(`feedback?author=eq.${B.id}`)).length === 5);

  const pb = await chrome.newPage(base, { isolated: true });
  await prepare(pb);
  await signIn(pb, await realSession(B));
  await pb.eval(`location.hash = '#/feedback'; true`);
  await pb.waitFor(`document.querySelector('#feedback-form')`, { label: 'B 的回饋表單' });
  await click(pb, '.segmented[data-name="category"] button[data-v="other"]');
  await fill(pb, '#feedback-message', '第 7 則');
  await submit(pb, '#feedback-form');
  await toast(pb, '今天已經送出 5 則回饋');
  check('超過上限：畫面提示明天再試', true);

  /* ===== 隱私說明 ===== */
  await pa.eval(`location.hash = '#/privacy'; true`);
  const privacy = await pa.waitFor(`document.querySelector('.privacy')?.textContent`);
  check('隱私說明寫出意見回饋：只有站長看得到、經過 Resend 寄 Email', ['意見回饋', 'Resend', '只有站長看得到'].every((w) => privacy.includes(w)));

  await sleep(200);
  check('A 的頁面沒有 JavaScript 錯誤', pa.errors.length === 0, pa.errors.join(' / '));
  // 第 7 則被資料庫擋下時，Edge Function 回 429 是預期的
  const unexpected = pb.errors.filter((e) => !/429/.test(e));
  check('B 的頁面沒有其他 JavaScript 錯誤', unexpected.length === 0, unexpected.join(' / '));
} catch (err) {
  failures.push(`執行錯誤：${err.message}`);
  console.error(err);
} finally {
  await chrome?.close();
  server?.close();
  mock.close();
  await cleanup();
}

summary();
