// 帳號與好友的前端端對端測試（docs/social-spec.md 階段 3）
// 用 headless Chrome 開兩個互相隔離的瀏覽器環境（像兩支手機），各自登入 A、B，連本機 Supabase 操作真的畫面：
// 設定暱稱與頭像 → 用 QR code 網址加好友 → 接受 → 解除 → 重新加 → 封鎖 → 解除封鎖 → 重新產生代碼 → 登出
// 也確認：暱稱裡的 HTML 只顯示成文字、頭像沒有 EXIF、備份檔沒有 token、沒設定 Supabase 的網址沒有社群功能
//
// 登入：Google 登入無法自動化，改用本機 admin API 拿真的 session 放進 App 的儲存空間（只在這支測試裡做）
// 用法：先 npx supabase@2.120.0 start，再 node scripts/social-ui-test.mjs

import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { api, anonKey, check, failures, summary, createUser, realSession, cleanup, call } from './supabase-local.mjs';
import {
  startServer, launchChrome, inspectJpeg, extraMetadata, sleep,
  prepare, visit, click, fill, submit, text, toast, fieldError, metaKeys, noInjection, signIn, exifJpeg,
} from './chrome.mjs';

// 暱稱上限 20 字，規格的 <script>alert(1)</script> 放不進去，改用 20 字以內的攻擊字串
const A_NICK = 'Alice <b>&amp;</b>';
const B_NICK = '"><svg onload=pwn()>'; // 跳出屬性 + SVG 事件
const FRIEND_CODE = /^[A-HJKMNP-Z2-9]{10}$/;

const q = JSON.stringify;
let server;
let chrome;
let fixtureDir;

try {
  server = await startServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;
  chrome = await launchChrome({ extraArgs: [`--host-resolver-rules=MAP coffee.test 127.0.0.1`] });
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'coffee-log-fixture-'));

  /* ===== 沒有設定 Supabase 的網址：完全沒有社群功能 ===== */
  const other = await chrome.newPage(`http://coffee.test:${port}/`, { isolated: true });
  check('沒設定 Supabase 的網址：☰ 選單沒有帳號、好友', await other.eval(`[...document.querySelectorAll('[data-social]')].every((e) => e.hidden)`));
  await other.goto(`http://coffee.test:${port}/#/account`);
  await other.waitFor(`document.querySelector('#app')?.textContent.includes('沒有開放社群功能')`);
  check('沒設定 Supabase 的網址：直接開 #/account 顯示「沒有開放」', true);
  check('沒設定 Supabase 的網址：不會載入 supabase-js', await other.eval('!window.supabase'));
  await other.close();

  /* ===== A：還沒登入 ===== */
  const pa = await chrome.newPage(base, { isolated: true });
  await prepare(pa);
  check('本機：☰ 選單有帳號、好友', await pa.eval(`[...document.querySelectorAll('[data-social]')].every((e) => !e.hidden)`));
  check('開 App 時不會載入 supabase-js（用到社群功能才載入）', await pa.eval('!window.supabase'));
  check('沒登入：☰ 和「好友」分頁都沒有「!」',
    await pa.eval(`['#request-badge', '#feed-badge'].every((s) => getComputedStyle(document.querySelector(s)).display === 'none')`));
  await visit(pa, base, '#/account');
  await pa.waitFor(`document.querySelector('[data-action="google"]')`, { label: '「用 Google 登入」按鈕' });
  check('沒登入：顯示「用 Google 登入」', true);
  check('supabase-js 以 SRI 載入', await pa.eval(`[...document.scripts].some((s) => s.src.includes('supabase-js') && s.integrity.startsWith('sha384-'))`));

  // 按下登入：用 PKCE 轉到 Google（本機沒有設定 Google，只檢查轉過去的網址）
  await click(pa, '[data-action="google"]');
  const authorize = new URL(await pa.waitFor(`location.href.startsWith(${q(`${api}/auth/v1/authorize`)}) && location.href`, { label: '轉到 /auth/v1/authorize' }));
  check('登入轉到 Google（provider=google）', authorize.searchParams.get('provider') === 'google');
  check('登入用 PKCE（有 code_challenge、s256）',
    authorize.searchParams.get('code_challenge')?.length >= 43 && authorize.searchParams.get('code_challenge_method') === 's256',
    authorize.search.slice(0, 120));
  check('登入完成後回到 App 首頁', authorize.searchParams.get('redirect_to') === base, authorize.searchParams.get('redirect_to'));
  await pa.goto(base);
  pa.errors.length = 0; // 本機沒有 Google 設定，上一頁的錯誤不算
  await prepare(pa);
  check('code verifier 存在 IndexedDB 的 meta（不是 localStorage）',
    (await metaKeys(pa)).includes('auth:supabase-auth-code-verifier') && await pa.eval('localStorage.length === 0 || !Object.keys(localStorage).some((k) => k.includes("supabase"))'));

  // 在 Google 按取消：回到 ?error=access_denied
  await pa.goto(`${base}?error=access_denied&error_description=denied`);
  await toast(pa, '已取消登入');
  check('Google 登入取消：顯示「已取消登入」並清掉網址', await pa.eval(`location.search === '' && location.hash === '#/account'`));
  await prepare(pa);

  /* ===== 登入 A、B ===== */
  const A = await createUser('A');
  const B = await createUser('B');
  const sessionA = await realSession(A);
  const sessionB = await realSession(B);
  await signIn(pa, sessionA);
  await visit(pa, base, '#/account');
  await pa.waitFor(`document.querySelector('#profile-form')`, { label: '設定暱稱表單' });
  check('第一次登入：要求設定暱稱', true);
  check('顯示登入的 email', (await text(pa, '#profile-form')).includes(A.email));

  await fill(pa, '#nickname', '   ');
  await submit(pa, '#profile-form');
  check('暱稱空白被擋下', (await fieldError(pa, '[data-field="nickname"]')) === '請輸入暱稱');
  await fill(pa, '#nickname', '字'.repeat(21));
  await submit(pa, '#profile-form');
  await pa.waitFor(`document.querySelector('[data-field="nickname"] .error').textContent.includes('最多')`);
  check('暱稱 21 字被擋下', true);
  await fill(pa, '#nickname', A_NICK);
  await submit(pa, '#profile-form');
  await pa.waitFor(`document.querySelector('.profile-name')`, { label: '帳號頁' });
  check('A 的暱稱照原樣顯示成文字', (await text(pa, '.profile-name')) === A_NICK, await text(pa, '.profile-name'));
  check('A 的暱稱沒有變成 HTML', await noInjection(pa));

  const aCode = (await text(pa, '.friend-code')).replace(/\s/g, '');
  check('顯示 10 碼好友代碼', FRIEND_CODE.test(aCode), aCode);
  const qrLen = await pa.waitFor(`document.querySelector('#qr svg.qr path')?.getAttribute('d').length`, { label: 'QR code' });
  check('顯示 QR code', qrLen > 500, `path 長度 ${qrLen}`);

  // 頭像：帶 EXIF 的 JPEG → 上傳的是 256×256、沒有中繼資料的 JPEG
  const avatarFile = path.join(fixtureDir, 'avatar.jpg');
  await writeFile(avatarFile, await exifJpeg(pa));
  await pa.setFiles('#avatar-input', [avatarFile]);
  await toast(pa, '已更新頭像');
  const avatarSrc = await pa.waitFor(`document.querySelector('img.avatar-lg')?.src`, { label: '頭像圖片' });
  check('頭像用 signed URL 顯示', avatarSrc.startsWith(`${api}/storage/v1/object/sign/avatars/${A.id}/avatar.jpg?token=`), avatarSrc.slice(0, 90));
  const avatarBytes = Buffer.from(await (await fetch(avatarSrc)).arrayBuffer());
  const avatarInfo = inspectJpeg(avatarBytes);
  check('上傳的頭像是 256×256 JPEG', avatarInfo.size?.width === 256 && avatarInfo.size?.height === 256, JSON.stringify(avatarInfo.size ?? avatarInfo.error));
  check('上傳的頭像沒有 EXIF 等中繼資料', extraMetadata(avatarInfo).length === 0 && !avatarBytes.includes('TestCam-EXIF-MARKER'),
    extraMetadata(avatarInfo).map((s) => s.id).join(' '));
  check('頭像 ≤ 100KB', avatarBytes.length <= 100 * 1024, `${(avatarBytes.length / 1024).toFixed(1)}KB`);

  const pb = await chrome.newPage(base, { isolated: true });
  await prepare(pb);
  await signIn(pb, sessionB);
  await visit(pb, base, '#/account');
  await pb.waitFor(`document.querySelector('#profile-form')`);
  await fill(pb, '#nickname', B_NICK);
  await submit(pb, '#profile-form');
  await pb.waitFor(`document.querySelector('.profile-name')`);
  check('B 的暱稱（屬性跳脫攻擊字串）照原樣顯示成文字', (await text(pb, '.profile-name')) === B_NICK);
  check('B 的暱稱沒有變成 HTML', await noInjection(pb));
  check('A、B 是不同的瀏覽器環境（各自的登入狀態）', (await text(pa, '.profile-name')) === A_NICK);

  /* ===== B 用 QR code 的網址加 A ===== */
  await visit(pb, base, `#/friends/add?code=${aCode}`);
  const prefilled = await pb.waitFor(`document.querySelector('#code')?.value`, { label: '代碼欄位' });
  check('QR code 網址：代碼已填好', prefilled.replace(/\s/g, '') === aCode, prefilled);
  await submit(pb, '#add-form');
  await toast(pb, '已送出邀請');
  await pb.waitFor(`location.hash === '#/friends' && document.querySelector('#outgoing .person-name')`, { label: '送出的邀請' });
  check('送出後回到好友頁，A 出現在「送出的邀請」', (await text(pb, '#outgoing .person-name')) === A_NICK);
  check('B 的畫面上 A 的暱稱沒有變成 HTML', await noInjection(pb));

  /* ===== ☰ 的「!」：收到邀請的 A 有，送出邀請的 B 沒有 ===== */
  // 檢查實際有沒有畫出來（不只看 hidden 屬性：CSS 的 display 會蓋掉它）
  const badgeShown = `getComputedStyle(document.querySelector('#request-badge')).display !== 'none'`;
  const requestBadge = (page) => page.eval(badgeShown);
  await pa.eval(`document.dispatchEvent(new Event('visibilitychange')); true`); // 切回前景時重新檢查
  await pa.waitFor(badgeShown, { label: 'A 的 ☰ 出現「!」' });
  check('收到邀請：☰ 按鈕出現「!」', true);
  check('收到邀請：☰ 按鈕的 aria-label 提示有新的好友邀請', (await pa.eval(`document.querySelector('#menu-btn').getAttribute('aria-label')`)) === '選單（有新的好友邀請）');
  await sleep(1000); // B 的好友頁重畫後也重新檢查過了
  check('送出邀請的 B：☰ 按鈕沒有「!」', !(await requestBadge(pb)));

  /* ===== A 接受 ===== */
  await visit(pa, base, '#/friends');
  await pa.waitFor(`document.querySelector('#incoming .person')`, { label: '收到的邀請' });
  check('A 收到 B 的邀請，暱稱照原樣顯示', (await text(pa, '#incoming .person-name')) === B_NICK);
  check('B 的暱稱放在屬性裡也沒有跳出來', (await pa.eval(`document.querySelector('#incoming .person').dataset.name`)) === B_NICK);
  check('A 的畫面上 B 的暱稱沒有變成 HTML', await noInjection(pa));
  await click(pa, '#incoming [data-action="accept"]');
  await toast(pa, '已成為好友');
  await pa.waitFor(`document.querySelector('#friends .person-name')?.textContent === ${q(B_NICK)}`, { label: '好友名單有 B' });
  check('接受後 B 出現在好友名單', true);
  await pa.waitFor(`!(${badgeShown})`, { label: 'A 的 ☰「!」消失' });
  check('接受邀請後 ☰ 按鈕的「!」消失', (await pa.eval(`document.querySelector('#menu-btn').getAttribute('aria-label')`)) === '選單');

  await visit(pb, base, '#/friends');
  await pb.waitFor(`document.querySelector('#friends .person')`, { label: 'B 的好友名單' });
  check('B 的好友名單有 A', (await text(pb, '#friends .person-name')) === A_NICK);
  check('B 看得到 A 的頭像（signed URL）', (await pb.eval(`document.querySelector('#friends img.avatar')?.src ?? ''`)).includes('/storage/v1/object/sign/avatars/'));

  /* ===== 解除好友 ===== */
  await click(pa, '#friends [data-action="unfriend"]');
  await toast(pa, '已解除好友');
  await pa.waitFor(`document.querySelector('#friends')?.textContent.includes('還沒有好友')`);
  check('A 解除好友後名單是空的', true);

  // B 重新邀請（代碼用小寫、加空白和 -），A 用 B 的代碼送出 → 直接成為好友
  await visit(pb, base, '#/friends');
  await fill(pb, '#code', `${aCode.slice(0, 5).toLowerCase()} - ${aCode.slice(5).toLowerCase()}`);
  await submit(pb, '#add-form');
  await toast(pb, '已送出邀請');
  check('代碼大小寫、空白、- 都能接受', true);
  await visit(pb, base, '#/account');
  const bCode = (await pb.waitFor(`document.querySelector('.friend-code')?.textContent`)).replace(/\s/g, '');
  await visit(pa, base, '#/friends');
  await fill(pa, '#code', bCode);
  await submit(pa, '#add-form');
  await toast(pa, '你們已經是好友了');
  check('對方已邀請過我時，用對方的代碼直接成為好友', true);

  /* ===== 封鎖 ===== */
  await visit(pa, base, '#/friends');
  await pa.waitFor(`document.querySelector('#friends .person')`);
  await click(pa, '#friends [data-action="block"]');
  await toast(pa, '已封鎖');
  await pa.waitFor(`document.querySelector('#blocked .person-name')`, { label: '封鎖名單' });
  check('封鎖名單顯示 B 的暱稱（照原樣）', (await text(pa, '#blocked .person-name')) === B_NICK);
  check('封鎖後 A 的好友名單沒有 B', !(await pa.eval(`document.querySelector('#friends .person')`)));
  check('封鎖名單上 B 的暱稱沒有變成 HTML', await noInjection(pa));

  await visit(pb, base, '#/friends');
  await pb.waitFor(`document.querySelector('#add-form')`);
  check('被封鎖的 B：好友、邀請名單都看不到 A', !(await pb.eval(`document.querySelector('.person')`)));
  await fill(pb, '#code', aCode);
  await submit(pb, '#add-form');
  check('被封鎖的 B 用 A 的代碼只會得到「找不到」（不透露封鎖）',
    (await fieldError(pb, '[data-field="code"]')).includes('找不到這個好友代碼'));

  await click(pa, '#blocked [data-action="unblock"]');
  await toast(pa, '已解除封鎖');
  await pa.waitFor(`!document.querySelector('#blocked')`);
  check('解除封鎖後名單消失，也不會自動恢復好友', !(await pa.eval(`document.querySelector('#friends .person')`)));

  /* ===== 代碼格式、重新產生代碼 ===== */
  await fill(pb, '#code', 'ABC');
  await submit(pb, '#add-form');
  await pb.waitFor(`document.querySelector('[data-field="code"] .error').textContent.includes('10 個英文字母')`);
  check('代碼格式不對：在前端就擋下', true);

  await visit(pa, base, '#/account');
  await pa.waitFor(`document.querySelector('[data-action="regenerate"]')`);
  await click(pa, '[data-action="regenerate"]');
  await toast(pa, '已產生新的好友代碼');
  const newCode = (await pa.waitFor(`(() => { const t = document.querySelector('.friend-code')?.textContent.replace(/\\s/g, ''); return t && t !== ${q(aCode)} && t; })()`));
  check('重新產生代碼', FRIEND_CODE.test(newCode) && newCode !== aCode, `${aCode} → ${newCode}`);
  await visit(pb, base, '#/friends');
  await fill(pb, '#code', aCode);
  await submit(pb, '#add-form');
  check('舊代碼立即失效', (await fieldError(pb, '[data-field="code"]')).includes('找不到'));

  /* ===== 備份檔不含登入狀態 ===== */
  check('（登入狀態確實存在 IndexedDB）', (await metaKeys(pa)).includes('auth:supabase-auth'));
  const exported = await pa.eval(`import('/js/models.js').then(async (m) => JSON.stringify(await m.exportData()))`);
  check('匯出的備份檔不含 token', !exported.includes(sessionA.refresh_token) && !exported.includes('access_token') && !exported.includes('supabase-auth'));

  /* ===== 移除頭像 ===== */
  await click(pa, '[data-action="remove-avatar"]');
  await toast(pa, '已移除頭像');
  await pa.waitFor(`document.querySelector('.avatar-lg.avatar-initial')`);
  check('移除頭像後顯示暱稱的第一個字', (await text(pa, '.avatar-lg')) === 'A');
  const gone = await fetch(avatarSrc);
  check('移除後舊的頭像檔案已刪除', gone.status >= 400, `HTTP ${gone.status}`);

  /* ===== 登出 ===== */
  await click(pa, '[data-action="signout"]');
  await toast(pa, '已登出');
  await pa.waitFor(`document.querySelector('[data-action="google"]')`);
  check('登出後回到「用 Google 登入」', true);
  check('登出後 IndexedDB 沒有 session', !(await metaKeys(pa)).includes('auth:supabase-auth'));
  const refresh = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: sessionA.refresh_token } });
  check('登出後 refresh token 在伺服器端失效', refresh.status >= 400, `HTTP ${refresh.status}`);
  const brewsStill = await pa.eval(`import('/js/db.js').then((db) => db.getAll('beans')).then(() => true)`);
  check('登出不影響本機資料庫', brewsStill);

  /* ===== 頁面錯誤 ===== */
  check('A 的頁面沒有 JavaScript 錯誤', pa.errors.length === 0, pa.errors.join(' / '));
  check('B 的頁面沒有 JavaScript 錯誤', pb.errors.length === 0, pb.errors.join(' / '));
  check('XSS 偵測：pwn() 從未被呼叫', !(await pa.eval('window.__pwned')) && !(await pb.eval('window.__pwned')));
  void anonKey;
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
