// 安全與隱私收尾的端對端測試（docs/social-spec.md 階段 5）
// 用 headless Chrome 開兩個互相隔離的瀏覽器環境（A、B），連本機 Supabase 操作真的畫面：
// B 在好友紀錄的詳細頁檢舉、封鎖 A → A 刪除帳號 → 用 admin 確認雲端的資料、照片、頭像、auth 使用者全部刪除，
// A 手機上的紀錄保留並改回只有我。另外確認：CSP 沒有違規、注入的 inline script 被擋下、Service Worker 沒有快取 Supabase 的網址、
// 刪除帳號的 Edge Function 沒登入不能呼叫、只會刪到呼叫者自己
//
// 用法：先 npx supabase@2.120.0 start（config.toml 要開 edge_runtime），再 node scripts/social-safety-test.mjs

import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  anonKey, serviceKey, check, failures, summary, setupUsers, realSession, cleanup, call, rest, rows,
  insertBrew, photoExists, photoPath, avatarPath, AVATARS,
} from './supabase-local.mjs';
import {
  root, startServer, launchChrome, prepare, visit, click, fill, submit, text, toast, fieldError, signIn, exifJpeg,
} from './chrome.mjs';

const q = JSON.stringify;
const m = (page, expr) => page.eval(`import('/js/models.js').then(async (m) => ${expr})`);
const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
/** 用 service_role 查資料表（不受 RLS 影響，確認資料真的刪掉了） */
const adminRows = async (pathAndQuery) => rows(await rest(pathAndQuery, { headers: admin }));
const deleteFn = (headers = {}, method = 'POST') => call('/functions/v1/delete-account', { method, headers });

/** 開一個隔離的頁面，在任何頁面腳本執行前開始記錄 CSP 違規 */
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

let server;
let chrome;
let fixtureDir;

try {
  /* ===== CSP 的設定和 js/config.js 一致 ===== */
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
  const directive = (name) => csp.split(';').map((d) => d.trim().split(/\s+/)).find(([n]) => n === name)?.slice(1) ?? [];
  const config = await readFile(path.join(root, 'js/config.js'), 'utf8');
  const origins = [...config.matchAll(/^\s+url: '([^']+)'/gm)].map(([, u]) => new URL(u).origin);
  check('index.html 有 CSP', csp.includes("default-src 'self'"), csp);
  check("CSP：script 只允許 'self'（沒有 unsafe-inline、unsafe-eval）", directive('script-src').join(' ') === "'self'", directive('script-src').join(' '));
  check("CSP：object-src 'none'、base-uri 'none'", directive('object-src').join() === "'none'" && directive('base-uri').join() === "'none'");
  check('CSP：connect-src、img-src 包含 config.js 所有 Supabase 網址', origins.length > 0
    && origins.every((o) => directive('connect-src').includes(o) && directive('img-src').includes(o)), origins.join(' '));
  check('index.html 沒有 inline script', !/<script(?![^>]*\bsrc=)[^>]*>/.test(html));

  /* ===== Edge Function：沒登入不能呼叫 ===== */
  check('刪除帳號：沒帶 token 被拒絕', (await deleteFn()).status === 401);
  check('刪除帳號：只帶 anon key 被拒絕', (await deleteFn({ Authorization: `Bearer ${anonKey}` })).status === 401);

  const { A, B, C } = await setupUsers(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']]);
  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'coffee-log-fixture-'));

  /* ===== A：分享一筆附照片的紀錄、設定頭像；對 B 的紀錄按讚 ===== */
  const pa = await openPage(chrome, base);
  await signIn(pa, await realSession(A));
  const jpeg = (await exifJpeg(pa)).toString('base64');
  const file = `new File([Uint8Array.from(atob(${q(jpeg)}), (c) => c.charCodeAt(0))], 'p.jpg', { type: 'image/jpeg' })`;
  const beanId = await m(pa, `(await m.saveBean({ name: '測試豆', process: 'washed', roastLevel: 'light' })).bean.id`);
  const brewId = await m(pa, `(await m.saveBrew({ beanId: ${q(beanId)}, brewedAt: new Date().toISOString(), coffeeG: 15, waterG: 240,
    notes: 'A 的筆記', visibility: 'friends' }, { photo: await m.preparePhoto(${file}) })).brew.id`);
  await m(pa, `(async () => { await m.saveBrew({ beanId: ${q(beanId)}, brewedAt: new Date().toISOString(), coffeeG: 14, waterG: 220 }); return true; })()`);
  const synced = await m(pa, 'm.syncNow()');
  check('A 分享的紀錄已同步', synced.status === 'done' && (await adminRows(`shared_brews?owner=eq.${A.id}`)).length === 1, JSON.stringify(synced));
  await m(pa, `m.saveAvatar(${q(A.id)}, await m.prepareAvatar(${file}))`);
  check('（A 的照片、頭像在 Storage）', await photoExists(photoPath(A.id, brewId)) && await photoExists(avatarPath(A.id), AVATARS));
  const bBrew = await insertBrew(B, { withPhoto: false });
  const like = await rest('likes', { method: 'POST', token: A.token, body: { brew_owner: B.id, brew_id: bBrew } });
  check('（A 對 B 的紀錄按讚）', like.status === 201, like.text);

  /* ===== B：檢舉 A 的紀錄 ===== */
  const pb = await openPage(chrome, base);
  await signIn(pb, await realSession(B));
  await visit(pb, base, `#/feed/${A.id}/${brewId}`);
  await pb.waitFor(`document.querySelector('[data-action="report"]')`, { label: '檢舉按鈕' });
  check('檢舉表單一開始是收起來的', await pb.eval(`document.querySelector('#report-form').hidden`));
  await click(pb, '[data-action="report"]');
  await submit(pb, '#report-form');
  check('沒選原因時擋下', (await fieldError(pb, '[data-field="reason"]')) === '請選擇原因');
  await click(pb, '.segmented[data-name="reason"] button[data-v="spam"]');
  await fill(pb, '#report-detail', '<script>alert(1)</script> 一直貼廣告');
  await submit(pb, '#report-form');
  await toast(pb, '已送出檢舉');
  const reports = await adminRows(`reports?brew_id=eq.${brewId}`);
  check('檢舉存進資料庫（reporter 是 B、原因、說明）', reports.length === 1 && reports[0].reporter === B.id
    && reports[0].reason === 'spam' && reports[0].detail === '<script>alert(1)</script> 一直貼廣告', JSON.stringify(reports));
  check('B 讀不到檢舉（只有站長在後台看得到）', (rows(await rest('reports', { token: B.token })) ?? []).length === 0);
  check('A 讀不到被檢舉的紀錄', (rows(await rest('reports', { token: A.token })) ?? []).length === 0);
  const cReport = await rest('reports', { method: 'POST', token: C.token, body: { brew_owner: A.id, brew_id: brewId, reason: 'spam' } });
  check('C（不是 A 的好友）不能檢舉 A 的紀錄', cReport.status >= 400, `HTTP ${cReport.status}`);

  /* ===== Service Worker 沒有快取 Supabase 的網址（API、signed URL） ===== */
  await pb.waitFor(`navigator.serviceWorker.controller !== null`, { label: 'Service Worker 接手', timeout: 15000 });
  // ☰ 選單的版本號＝sw.js 的 APP_VERSION（要在受 Service Worker 控制的頁面檢查：visit 的強制重新整理會略過 Service Worker）
  const swVersion = (await readFile(path.join(root, 'sw.js'), 'utf8')).match(/const APP_VERSION = '(\d+\.\d+\.\d+)';/)?.[1];
  const shownVersion = await pb.waitFor(`(() => { const el = document.querySelector('#app-version'); return !el.hidden && el.textContent; })()`,
    { label: '選單的版本號' });
  check('☰ 選單顯示的版本號等於 sw.js 的 APP_VERSION（x.y.z）', Boolean(swVersion) && shownVersion === `版本 ${swVersion}`, shownVersion);
  const cacheNames = await pb.eval(`caches.keys()`);
  check('快取名稱由 APP_VERSION 產生', JSON.stringify(cacheNames) === JSON.stringify([`coffee-log-v${swVersion}`]), JSON.stringify(cacheNames));
  // 舊版 Service Worker（1.0.0 以前）回的是整數：新版頁面照樣顯示、送出成字串
  const legacy = await pb.eval(`import('./js/views/ui.js').then((ui) => [18, '1.0.0', '1.0', 'abc', 0, 1.5, null, {}].map(ui.normalizeAppVersion))`);
  check('舊版 SW 回整數 18 → 字串 "18"；格式不對 → null', JSON.stringify(legacy) === JSON.stringify(['18', '1.0.0', null, null, null, null, null, null]),
    JSON.stringify(legacy));
  await visit(pb, base, `#/feed/${A.id}/${brewId}`);
  await pb.waitFor(`document.querySelector('.feed-photo')?.complete`, { label: '照片載入' });
  const cached = await pb.eval(`(async () => {
    const urls = [];
    for (const key of await caches.keys()) for (const req of await (await caches.open(key)).keys()) urls.push(req.url);
    return urls;
  })()`);
  check('Service Worker 的快取只有 App 自己的檔案', cached.length > 0 && cached.every((u) => u.startsWith(base)),
    cached.filter((u) => !u.startsWith(base)).join(' '));


  /* ===== B：從詳細頁封鎖 A ===== */
  await click(pb, '[data-action="block"]');
  await toast(pb, '已封鎖');
  await pb.waitFor(`location.hash === '#/feed' && document.querySelector('.empty')`, { label: '回到空的動態牆' });
  check('封鎖後回到動態牆，看不到 A 的紀錄', !(await pb.eval(`document.querySelector('.feed-card')`)));
  check('封鎖名單有 A', (await adminRows(`blocks?blocker=eq.${B.id}`)).some((b) => b.blocked === A.id));

  /* ===== A：刪除帳號 ===== */
  await visit(pa, base, '#/account');
  await click(pa, '[data-action="show-delete"]');
  check('刪除前提醒先匯出備份', (await text(pa, '#delete-form')).includes('匯出備份'));
  await fill(pa, '#delete-confirm', 'B');
  await submit(pa, '#delete-form');
  check('暱稱輸入不一致時擋下', (await fieldError(pa, '[data-field="confirm"]')) === '輸入的暱稱不一致');
  check('（擋下時帳號還在）', (await adminRows(`profiles?id=eq.${A.id}`)).length === 1);
  await fill(pa, '#delete-confirm', 'A');
  await submit(pa, '#delete-form');
  await toast(pa, '帳號已刪除');
  await pa.waitFor(`document.querySelector('[data-action="google"]')`, { label: '回到登入畫面' });
  check('刪除後回到「用 Google 登入」', true);
  // 帳號刪除後 session 已失效，登出時伺服器回 403 是預期的（supabase-js 照樣清掉本機的登入狀態）
  const logout403 = pa.errors.filter((e) => /403.*\/auth\/v1\/logout/.test(e));
  check('（刪除後登出：伺服器回 403，最多一次）', logout403.length <= 1, logout403.join(' / '));
  pa.errors.splice(0, pa.errors.length, ...pa.errors.filter((e) => !logout403.includes(e)));

  const authUser = await call(`/auth/v1/admin/users/${A.id}`, { headers: admin });
  check('auth 使用者已刪除', authUser.status === 404, `HTTP ${authUser.status}`);
  check('profile 已刪除', (await adminRows(`profiles?id=eq.${A.id}`)).length === 0);
  check('分享的紀錄已刪除', (await adminRows(`shared_brews?owner=eq.${A.id}`)).length === 0);
  check('A 按的讚已刪除', (await adminRows(`likes?user_id=eq.${A.id}`)).length === 0);
  check('好友關係已刪除', (await adminRows(`friendships?or=(requester.eq.${A.id},addressee.eq.${A.id})`)).length === 0);
  check('別人對 A 的封鎖、對 A 紀錄的檢舉一起刪除', (await adminRows(`blocks?blocked=eq.${A.id}`)).length === 0
    && (await adminRows(`reports?brew_owner=eq.${A.id}`)).length === 0);
  check('照片已從 Storage 刪除', !(await photoExists(photoPath(A.id, brewId))));
  check('頭像已從 Storage 刪除', !(await photoExists(avatarPath(A.id), AVATARS)));

  const local = await m(pa, `(async () => {
    const db = await import('/js/db.js');
    return { brews: (await db.getAll('brews')).map((b) => b.visibility), sync: (await db.getAll('sync')).length,
      photo: Boolean(await db.get('photos', ${q(brewId)})), auth: (await db.getAllKeys('meta')).filter((k) => k.startsWith('auth:')) };
  })()`);
  check('A 手機上的紀錄和照片保留', local.brews.length === 2 && local.photo, JSON.stringify(local));
  check('A 手機上分享過的紀錄改回「只有我」', local.brews.every((v) => v === 'private'), JSON.stringify(local.brews));
  check('同步狀態、登入狀態已清除', local.sync === 0 && local.auth.length === 0, JSON.stringify(local));
  check('刪除後同步不會再上傳任何東西', (await m(pa, 'm.syncNow()')).status === 'idle');

  /* ===== Edge Function：只刪呼叫者自己 ===== */
  check('不支援 POST 以外的方法', (await deleteFn({ Authorization: `Bearer ${C.token}` }, 'GET')).status === 405);
  const cDelete = await deleteFn({ Authorization: `Bearer ${C.token}`, 'Content-Type': 'application/json' });
  check('C 呼叫刪除帳號：成功', cDelete.status === 200, cDelete.text);
  check('C 呼叫刪除帳號：只刪掉 C', (await call(`/auth/v1/admin/users/${C.id}`, { headers: admin })).status === 404
    && (await call(`/auth/v1/admin/users/${B.id}`, { headers: admin })).status === 200);

  /* ===== 隱私說明 ===== */
  await visit(pa, base, '#/privacy');
  const privacy = await pa.waitFor(`document.querySelector('.privacy')?.textContent`);
  check('隱私說明：寫出會存 email、照片移除 GPS、怎麼刪除帳號',
    ['email', 'GPS', '刪除我的帳號', '東京'].every((w) => privacy.includes(w)));
  check('☰ 選單有隱私說明', await pa.eval(`Boolean(document.querySelector('#app-menu a[href="#/privacy"]:not([hidden])'))`));

  /* ===== CSP ===== */
  // App 的每一頁（含分享卡片的 canvas、照片的 blob 網址）都不能因為 CSP 壞掉
  for (const hash of ['#/', `#/brew/${brewId}`, `#/brew/${brewId}/share`, '#/brew/new', '#/beans', `#/beans/${beanId}`, '#/grinders', '#/backup', '#/feedback']) {
    await visit(pa, base, hash);
    await pa.waitFor(`document.querySelector('#app').children.length > 0 && !document.querySelector('#app > .hint')`, { label: `${hash} 載入` });
  }
  await visit(pa, base, `#/brew/${brewId}/share`);
  check('分享卡片畫得出來（CSP 下 canvas、照片正常）', await pa.waitFor(`(() => {
    const c = document.querySelector('canvas'); return c && c.width >= 1080;
  })()`, { label: '分享卡片' }));
  check('A 的頁面沒有 CSP 違規', (await violations(pa)).length === 0, (await violations(pa)).join(' / '));
  check('B 的頁面沒有 CSP 違規', (await violations(pb)).length === 0, (await violations(pb)).join(' / '));
  check('A 的頁面沒有 JavaScript 錯誤', pa.errors.length === 0, pa.errors.join(' / '));
  check('B 的頁面沒有 JavaScript 錯誤', pb.errors.length === 0, pb.errors.join(' / '));

  // 就算 HTML 被注入，inline script 和事件屬性也不會執行（Runtime.evaluate 本身不受 CSP 限制，所以用 DOM 插入）
  await pb.eval(`(() => {
    const s = document.createElement('script'); s.textContent = 'window.__inj = 1'; document.body.append(s);
    document.querySelector('#app').insertAdjacentHTML('beforeend', '<img src="x.png" onerror="window.__inj = 2">');
    return true;
  })()`);
  await pb.waitFor(`window.__csp.length >= 2`, { label: 'CSP 違規事件' });
  check('CSP 擋下注入的 inline script 和 onerror', !(await pb.eval('window.__inj')), (await violations(pb)).join(' / '));
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
