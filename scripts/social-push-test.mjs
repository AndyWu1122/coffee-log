// 推播通知的畫面與 Service Worker：互相隔離的 headless Chrome 操作真的畫面
// A、B 好友。確認：
//   - 打開 App、打開通知設定頁都不會詢問通知權限，按「在這台裝置啟用通知」才問
//   - 開關存到雲端；拒絕權限時顯示到系統設定開啟的說明；啟用後訂閱存到資料庫
//   - iPhone 不是從主畫面開啟：只有加入主畫面的說明、沒有啟用按鈕；從主畫面開啟才有按鈕
//   - B 留言 → 假推播伺服器收到加密的通知 → 解密後用 DevTools 的 ServiceWorker.deliverPushMessage 送進 A 的 sw.js
//     → 通知內容（暱稱＋動作，沒有留言原文、tag）→ 點通知（在 sw.js 執行點擊的處理）→ A 開著的視窗換到那篇貼文，沒有開新視窗
//   - 惡意的推播內容、外部網址、App 頁面收到的假換頁訊息都只會到 #/social 或被忽略
//   - 登出時刪掉這台裝置的訂閱；390px、深淺色截圖、沒有橫向捲動；沒有 CSP 違規、沒有 JavaScript 錯誤
// 推播服務（FCM）沒辦法在測試裡用：PushManager.subscribe 換成假的（金鑰由這支測試產生），不連任何真的推播服務
//
// 用法：先 npx supabase@2.120.0 start（新增 send-push 後要 stop 再 start），再 node scripts/social-push-test.mjs

import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  check, summary, setupUsers, realSession, cleanup, rest, rows, insertBrew, serviceKey, setupPushVault, pushEndpoint,
} from './supabase-local.mjs';
import { startServer, launchChrome, prepare, visit, click, text, toast, signIn, sleep } from './chrome.mjs';
import { browserKeys, decrypt, fakePushServer } from './push-helpers.mjs';

const q = JSON.stringify;
const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const LOCAL_VAPID_PUBLIC = (await readFile(new URL('../js/config.js', import.meta.url), 'utf8')).match(/vapidPublicKey: '([\w-]+)'/)[1];

/**
 * 換掉 PushManager 與 Notification 的權限（在頁面的任何腳本前執行）
 * 訂閱與權限記在 localStorage（只有測試用），重新整理後還在；__permAsked 記錄詢問了幾次
 */
const fakePushScript = (sub) => `(() => {
  const keys = ${q(sub)};
  const bytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0)).buffer;
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  const make = () => ({
    endpoint: keys.endpoint, options: { applicationServerKey: null },
    getKey: (name) => bytes(name === 'p256dh' ? keys.p256dh : keys.auth),
    unsubscribe: async () => { localStorage.removeItem('__fakeSub'); localStorage.setItem('__unsubscribed', String(+(localStorage.getItem('__unsubscribed') || 0) + 1)); return true; },
  });
  PushManager.prototype.subscribe = async function (opts) {
    localStorage.setItem('__subscribeKey', b64url(opts.applicationServerKey));
    localStorage.setItem('__subscribeVisible', String(opts.userVisibleOnly));
    localStorage.setItem('__fakeSub', '1');
    return make();
  };
  PushManager.prototype.getSubscription = async function () { return localStorage.getItem('__fakeSub') ? make() : null; };
  window.__permAsked = 0;
  window.__answer = 'granted';
  Object.defineProperty(Notification, 'permission', { configurable: true, get: () => localStorage.getItem('__perm') || 'default' });
  Notification.requestPermission = async () => {
    window.__permAsked++;
    localStorage.setItem('__perm', window.__answer);
    return window.__answer;
  };
})();`;

const CSP_SCRIPT = `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI));`;

async function openPage(chrome, url, { sub, ua, standalone = false } = {}) {
  const page = await chrome.newPage(null, { isolated: true });
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  if (ua) await page.cdp('Emulation.setUserAgentOverride', { userAgent: ua, platform: 'iPhone' });
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: CSP_SCRIPT });
  if (sub) await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: fakePushScript(sub) });
  if (standalone) await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'standalone', { get: () => true });` });
  await page.goto(url);
  await prepare(page);
  return page;
}
const violations = (page) => page.eval('window.__csp');
const settingsLoaded = (page) => page.waitFor(`document.querySelector('.notifications-page, #app .empty')`, { label: '通知設定頁' });

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

/** 在 A 的 Service Worker（sw.js）裡執行運算式 */
async function inServiceWorker(chrome, page, expression) {
  const { targetInfos } = await chrome.send('Target.getTargets');
  const sw = targetInfos.find((t) => t.type === 'service_worker' && t.browserContextId === page.browserContextId && t.url.endsWith('/sw.js'));
  if (!sw) throw new Error('找不到 A 的 Service Worker');
  const { sessionId } = await chrome.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
  try {
    const r = await chrome.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  } finally {
    await chrome.send('Target.detachFromTarget', { sessionId }).catch(() => {});
  }
}
const pageTargets = async (chrome, page) => (await chrome.send('Target.getTargets')).targetInfos
  .filter((t) => t.type === 'page' && t.browserContextId === page.browserContextId).length;

const push = fakePushServer();
let server;
let chrome;

try {
  await push.listen();
  setupPushVault();
  const { A, B } = await setupUsers(['A', 'B'], [['A', 'B']]);
  const post = await insertBrew(A, { withPhoto: false });
  const keysA = browserKeys();
  const subA = { endpoint: pushEndpoint('ui-a'), p256dh: keysA.p256dh, auth: keysA.auth };

  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();
  const pa = await openPage(chrome, base, { sub: subA });
  await signIn(pa, await realSession(A));
  // 重新整理（page.reload 是略過快取的強制重新整理，不會由 Service Worker 接管，所以重新開網址）
  await pa.waitFor('navigator.serviceWorker.ready.then(() => true)', { label: 'A 的 Service Worker 安裝好' });
  await pa.goto(`${base}?r=1`);
  await prepare(pa);
  await pa.waitFor('navigator.serviceWorker.controller !== null', { label: 'A 的 Service Worker 接管頁面' });

  /* ===== 1. 不會一打開就詢問權限 ===== */
  await sleep(1500);
  check('打開 App：沒有詢問通知權限', (await pa.eval('window.__permAsked')) === 0);
  await pa.eval(`location.hash = '#/settings'; true`);
  check('「設定與關於」有「通知設定」', Boolean(await pa.waitFor(`document.querySelector('.settings a[href="#/notifications"]')`, { label: '設定頁的通知設定' })));
  check('設定頁也沒有詢問通知權限', (await pa.eval('window.__permAsked')) === 0);

  await visit(pa, base, '#/notifications');
  await settingsLoaded(pa);
  check('打開通知設定頁：還沒詢問權限', (await pa.eval('window.__permAsked')) === 0);
  check('有「在這台裝置啟用通知」按鈕', Boolean(await pa.eval(`document.querySelector('[data-action="enable"]')`)));
  const defaults = await pa.eval(`[...document.querySelectorAll('.switch-row input')].map((i) => i.name + ':' + i.checked).join()`);
  check('預設：新留言、回覆、按讚開，好友新貼文關', defaults === 'comments:true,replies:true,likes:true,newPosts:false', defaults);
  check('說明通知不含留言內容', (await text(pa, '.notifications-page')).includes('不會顯示留言內容'));
  check('開關每一列 ≥ 48px', (await pa.eval(`Math.min(...[...document.querySelectorAll('.switch-row')].map((r) => r.getBoundingClientRect().height))`)) >= 48);
  check('390px 沒有橫向捲動', (await pa.eval('document.documentElement.scrollWidth <= innerWidth')) === true);

  const shotDir = await mkdtemp(path.join(tmpdir(), 'coffee-log-push-'));
  for (const theme of ['dark', 'light']) {
    await setTheme(pa, theme);
    await settingsLoaded(pa);
    await screenshot(pa, path.join(shotDir, `notifications-${theme}.png`));
  }
  console.log(`截圖：${shotDir}`);

  /* ===== 2. 開關存到雲端 ===== */
  await click(pa, '.switch-row input[name="replies"]');
  await toast(pa, '已儲存');
  let prefs = rows(await rest(`notification_prefs?user_id=eq.${A.id}`, { headers: admin }))?.[0];
  check('關掉「回覆」：存到雲端', prefs?.comments === true && prefs?.replies === false, JSON.stringify(prefs));
  await visit(pa, base, '#/notifications');
  await settingsLoaded(pa);
  check('重新打開：「回覆」還是關的', (await pa.eval(`document.querySelector('.switch-row input[name="replies"]').checked`)) === false);
  await click(pa, '.switch-row input[name="replies"]');
  await toast(pa, '已儲存');
  prefs = rows(await rest(`notification_prefs?user_id=eq.${A.id}`, { headers: admin }))?.[0];
  check('再打開「回覆」', prefs?.replies === true);
  await click(pa, '.switch-row input[name="newPosts"]');
  await toast(pa, '已儲存');
  await pa.waitFor(`!document.querySelector('.switch-row input[name="newPosts"]').disabled`, { label: '存完好友新貼文' });
  await click(pa, '.switch-row input[name="likes"]');
  await pa.waitFor(`!document.querySelector('.switch-row input[name="likes"]').disabled`, { label: '存完按讚' });
  prefs = rows(await rest(`notification_prefs?user_id=eq.${A.id}`, { headers: admin }))?.[0];
  check('打開「好友新貼文」、關掉「按讚」：存到雲端', prefs?.new_posts === true && prefs?.likes === false && prefs?.comments === true, JSON.stringify(prefs));
  await visit(pa, base, '#/notifications');
  await settingsLoaded(pa);
  const reloaded = await pa.eval(`[...document.querySelectorAll('.switch-row input')].map((i) => i.name + ':' + i.checked).join()`);
  check('重新打開：四個開關都照存的', reloaded === 'comments:true,replies:true,likes:false,newPosts:true', reloaded);
  await click(pa, '.switch-row input[name="likes"]');
  await pa.waitFor(`!document.querySelector('.switch-row input[name="likes"]').disabled`, { label: '存完按讚' });
  check('再打開「按讚」', rows(await rest(`notification_prefs?user_id=eq.${A.id}`, { headers: admin }))?.[0]?.likes === true);

  /* ===== 3. 拒絕權限 ===== */
  await pa.eval(`window.__answer = 'denied'; true`);
  await click(pa, '[data-action="enable"]');
  await pa.waitFor(`document.querySelector('#push-denied-help')`, { label: '拒絕權限的說明' });
  check('按按鈕才詢問權限（1 次）', (await pa.eval('window.__permAsked')) === 1);
  const denied = await text(pa, '#push-denied-help');
  check('拒絕：說明要到系統設定開啟（iPhone、Android）', denied.includes('系統設定') && denied.includes('iPhone') && denied.includes('Android'), denied);
  check('拒絕：沒有啟用按鈕', !(await pa.eval(`document.querySelector('[data-action="enable"]')`)));
  check('拒絕：沒有存訂閱', rows(await rest(`push_subscriptions?user_id=eq.${A.id}`, { headers: admin }))?.length === 0);

  /* ===== 4. 啟用 ===== */
  await pa.eval(`localStorage.removeItem('__perm'); window.__answer = 'granted'; true`);
  await click(pa, '[data-action="recheck"]');
  await click(pa, '[data-action="enable"]');
  await toast(pa, '已啟用通知');
  await pa.waitFor(`document.querySelector('[data-action="disable"]')`, { label: '已啟用' });
  const saved = rows(await rest(`push_subscriptions?user_id=eq.${A.id}`, { headers: admin })) ?? [];
  check('啟用：訂閱存到資料庫（A 的、endpoint、金鑰）', saved.length === 1 && saved[0].endpoint === subA.endpoint
    && saved[0].p256dh === subA.p256dh && saved[0].auth === subA.auth, JSON.stringify(saved));
  check('用 config.js 的 VAPID 公鑰訂閱、userVisibleOnly', (await pa.eval(`localStorage.getItem('__subscribeKey')`)) === LOCAL_VAPID_PUBLIC
    && (await pa.eval(`localStorage.getItem('__subscribeVisible')`)) === 'true');
  check('已啟用：顯示「已啟用」', (await text(pa, '#push-device')).includes('已啟用'));

  /* ===== 5. iPhone ===== */
  const iphone = await openPage(chrome, base, { ua: IPHONE_UA });
  await signIn(iphone, await realSession(B));
  await visit(iphone, base, '#/notifications');
  await settingsLoaded(iphone);
  const help = await text(iphone, '#push-ios-help');
  check('iPhone 不是從主畫面開啟：顯示加入主畫面的說明', help?.includes('分享') && help.includes('加入主畫面') && help.includes('從主畫面'), help);
  check('iPhone 不是從主畫面開啟：沒有啟用按鈕', !(await iphone.eval(`document.querySelector('[data-action="enable"]')`)));
  check('iPhone 的說明頁：開關照樣可以設定', (await iphone.eval(`document.querySelectorAll('.switch-row input').length`)) === 4);
  const home = await openPage(chrome, base, { ua: IPHONE_UA, standalone: true });
  await signIn(home, await realSession(B));
  await visit(home, base, '#/notifications');
  await settingsLoaded(home);
  check('iPhone 從主畫面開啟：有啟用按鈕、沒有加入主畫面的說明', Boolean(await home.eval(`document.querySelector('[data-action="enable"]')`))
    && !(await home.eval(`document.querySelector('#push-ios-help')`)));

  /* ===== 6. B 留言 → 推播 → A 的 sw.js 顯示通知 ===== */
  await chrome.send('Browser.grantPermissions', { permissions: ['notifications'], origin: new URL(base).origin, browserContextId: pa.browserContextId });
  await visit(pa, base, '#/beans'); // A 開著別的頁面
  const since = push.received.length;
  const SECRET_BODY = '只在 App 裡看得到的留言內容';
  const c = await rest('comments', { method: 'POST', token: B.token, body: { brew_owner: A.id, brew_id: post, body: SECRET_BODY } });
  check('B 留言成功', c.status === 201, c.text);
  for (let i = 0; i < 100 && push.received.length === since; i++) await sleep(100);
  const got = push.received.slice(since);
  check('假推播伺服器收到送給 A 的通知', got.length === 1 && got[0].path === new URL(subA.endpoint).pathname);
  const payload = got[0] ? decrypt(got[0].body, keysA).text : '{}';
  check('推播內容沒有留言原文', !payload.includes('只在 App'));

  // 用 DevTools 把解密後的內容送進 A 的 Service Worker（和推播服務送達時一樣觸發 push 事件）
  let registrationId = null;
  pa.on((msg) => {
    if (msg.method === 'ServiceWorker.workerRegistrationUpdated') {
      registrationId ??= msg.params.registrations.find((r) => r.scopeURL === base && !r.isDeleted)?.registrationId ?? null;
    }
  });
  await pa.cdp('ServiceWorker.enable');
  for (let i = 0; i < 50 && !registrationId; i++) await sleep(100);
  check('（找到 A 的 Service Worker 註冊）', Boolean(registrationId));
  await pa.cdp('ServiceWorker.deliverPushMessage', { origin: new URL(base).origin, registrationId, data: payload });
  const notifications = await pa.waitFor(`navigator.serviceWorker.ready.then((r) => r.getNotifications()).then((ns) => ns.length && ns.map((n) => ({
    title: n.title, body: n.body, tag: n.tag, path: n.data?.path })))`, { label: 'A 的通知' }).catch(() => []);
  const n = notifications[0];
  check('通知：「B 留言了你的貼文」', notifications.length === 1 && n.title === '手沖紀錄' && n.body === 'B 留言了你的貼文', JSON.stringify(notifications));
  check('通知沒有留言原文', !JSON.stringify(notifications).includes('只在 App'));
  check('通知的 tag 是這篇貼文（取代舊的）', n?.tag === `post:${A.id}/${post}`);
  check('通知記著點擊後要去的貼文', n?.path === `#/social/${A.id}/${post}?comments=1`, n?.path);

  // 同一篇再送一則（例如超過 5 分鐘後）：取代舊的，不會變成兩則
  await pa.cdp('ServiceWorker.deliverPushMessage', {
    origin: new URL(base).origin, registrationId, data: JSON.stringify({ v: 1, kind: 'reply', nickname: 'B', owner: A.id, brewId: post }),
  });
  await sleep(500);
  const replaced = await pa.eval(`navigator.serviceWorker.ready.then((r) => r.getNotifications()).then((ns) => ns.map((n) => n.body))`);
  check('同一篇的新通知取代舊的', replaced.length === 1 && replaced[0] === 'B 回覆了你的留言', JSON.stringify(replaced));

  // 惡意的內容：只顯示成文字，網址只到 #/social
  await pa.cdp('ServiceWorker.deliverPushMessage', {
    origin: new URL(base).origin, registrationId,
    data: JSON.stringify({ v: 1, kind: 'comment', nickname: '<img src=x onerror=pwn()>‮壞人\nX', owner: '../../evil', brewId: post }),
  });
  await sleep(500);
  const evil = await pa.eval(`navigator.serviceWorker.ready.then((r) => r.getNotifications({ tag: 'comments' })).then((ns) => ns.map((n) => ({ body: n.body, path: n.data?.path })))`);
  check('owner 不是 uuid：通用提示、只到 #/social', evil.length === 1 && evil[0].body === '有新的留言' && evil[0].path === '#/social', JSON.stringify(evil));
  await pa.cdp('ServiceWorker.deliverPushMessage', {
    origin: new URL(base).origin, registrationId,
    data: JSON.stringify({ v: 1, kind: 'reply', nickname: '<b>壞‮人</b>\n第二行', owner: A.id, brewId: B.id }),
  });
  await sleep(500);
  const odd = await pa.eval(`navigator.serviceWorker.ready.then((r) => r.getNotifications({ tag: ${q(`post:${A.id}/${B.id}`)} })).then((ns) => ns.map((n) => n.body))`);
  check('暱稱只當成文字、去掉換行與改變方向的字元', odd[0] === '<b>壞人</b>第二行 回覆了你的留言', JSON.stringify(odd));
  await pa.cdp('ServiceWorker.deliverPushMessage', { origin: new URL(base).origin, registrationId, data: 'not json' });
  await sleep(300);
  check('不是 JSON：照樣顯示通用提示', (await pa.eval(`navigator.serviceWorker.ready.then((r) => r.getNotifications({ tag: 'comments' })).then((ns) => ns[0]?.body)`)) === '有新的留言');

  /* ===== 6-1. 按讚、好友新貼文 ===== */
  const deliver = (data) => pa.cdp('ServiceWorker.deliverPushMessage', {
    origin: new URL(base).origin, registrationId, data: typeof data === 'string' ? data : JSON.stringify(data),
  }).then(() => sleep(500));
  const byTag = (tag) => pa.eval(`navigator.serviceWorker.ready.then((r) => r.getNotifications({ tag: ${q(tag)} }))
    .then((ns) => ns.map((n) => ({ body: n.body, path: n.data?.path, silent: n.silent, renotify: n.renotify })))`);

  // 真的按讚：B 按 A 的貼文 → 假推播伺服器 → 解密 → 送進 A 的 sw.js
  const likeSince = push.received.length;
  check('B 按讚 A 的貼文', (await rest('likes', { method: 'POST', token: B.token, body: { brew_owner: A.id, brew_id: post } })).status === 201);
  for (let i = 0; i < 100 && push.received.length === likeSince; i++) await sleep(100);
  const likeGot = push.received.slice(likeSince);
  check('假推播伺服器收到按讚的通知', likeGot.length === 1);
  const likePayload = likeGot[0] ? decrypt(likeGot[0].body, keysA).text : '{}';
  await deliver(likePayload);
  const likeTag = `like:${A.id}/${post}`;
  let shown = await byTag(likeTag);
  check('按讚：「B 說你的貼文讚」、會響', shown.length === 1 && shown[0].body === 'B 說你的貼文讚' && shown[0].silent === false && shown[0].renotify === true, JSON.stringify(shown));
  check('按讚：點了打開那篇貼文（不是留言區）', shown[0]?.path === `#/social/${A.id}/${post}`, shown[0]?.path);
  check('按讚的通知不會蓋掉留言的通知', (await byTag(`post:${A.id}/${post}`)).length === 1);
  await deliver({ v: 1, kind: 'like', nickname: 'C', owner: A.id, brewId: post, others: 2, quiet: true });
  shown = await byTag(likeTag);
  check('30 分鐘內的讚：取代成「C 和其他 2 人說你的貼文讚」、安靜', shown.length === 1 && shown[0].body === 'C 和其他 2 人說你的貼文讚'
    && shown[0].silent === true && shown[0].renotify === false, JSON.stringify(shown));
  for (const others of ['5', -1, 1.5, 1e9]) {
    await deliver({ v: 1, kind: 'like', nickname: 'C', owner: A.id, brewId: post, others });
    shown = await byTag(likeTag);
    check(`others 是 ${q(others)}：當成 0`, shown[0]?.body === 'C 說你的貼文讚', JSON.stringify(shown));
  }

  // 好友新貼文
  const friendTag = `friend:${B.id}`;
  await deliver({ v: 1, kind: 'post', nickname: 'B', owner: B.id, brewId: post, bean: '衣索比亞 耶加雪菲', others: 0, quiet: false });
  shown = await byTag(friendTag);
  check('新貼文：「B 分享了一杯 衣索比亞 耶加雪菲」', shown.length === 1 && shown[0].body === 'B 分享了一杯 衣索比亞 耶加雪菲' && shown[0].silent === false, JSON.stringify(shown));
  check('新貼文：點了打開那篇貼文', shown[0]?.path === `#/social/${B.id}/${post}`);
  await deliver({ v: 1, kind: 'post', nickname: 'B', owner: B.id, brewId: A.id, bean: '肯亞', others: 2, quiet: true });
  shown = await byTag(friendTag);
  check('同一位好友 30 分鐘內：取代成「B 分享了 3 杯，最新：肯亞」、安靜、打開最新那篇', shown.length === 1
    && shown[0].body === 'B 分享了 3 杯，最新：肯亞' && shown[0].silent === true && shown[0].path === `#/social/${B.id}/${A.id}`, JSON.stringify(shown));
  await deliver({ v: 1, kind: 'post', nickname: 'B', owner: B.id, brewId: post, bean: `<b>壞‮豆</b>\n${'很長'.repeat(30)}` });
  shown = await byTag(friendTag);
  check('豆子名稱只當成文字、去掉換行與改變方向的字元、最多 30 字', shown[0]?.body === `B 分享了一杯 ${[...`<b>壞豆</b>${'很長'.repeat(30)}`].slice(0, 30).join('')}`, JSON.stringify(shown));
  await deliver({ v: 1, kind: 'post', nickname: 'B', owner: B.id, brewId: post, bean: 42 });
  check('豆子名稱不是字串：顯示「咖啡」', (await byTag(friendTag))[0]?.body === 'B 分享了一杯 咖啡');
  await deliver({ v: 1, kind: 'follow', nickname: 'B', owner: B.id, brewId: post });
  check('不認得的 kind：通用提示', (await byTag('comments'))[0]?.body === '有新的留言');

  /* ===== 7. 點通知：A 開著的視窗換到那篇貼文 ===== */
  const before = await pageTargets(chrome, pa);
  const target = `#/social/${A.id}/${post}?comments=1`;
  // 和 notificationclick 做的事相同：取出通知的 path、關掉通知、打開 App
  await inServiceWorker(chrome, pa, `self.registration.getNotifications({ tag: ${q(`post:${A.id}/${post}`)} })
    .then(([n]) => { n.close(); return openApp(n.data.path); }).then(() => true)`);
  await pa.waitFor(`location.hash === ${q(target)}`, { label: '換到那篇貼文', timeout: 5000 }).catch(() => null);
  check('點通知：A 的視窗換到那篇貼文的留言', (await pa.eval('location.hash')) === target, await pa.eval('location.hash'));
  check('沒有開新視窗', (await pageTargets(chrome, pa)) === before);
  await pa.waitFor(`document.querySelector('#app').textContent.includes(${q(SECRET_BODY)})`, { label: '貼文詳細頁顯示留言' }).catch(() => null);
  check('詳細頁打開，看得到 B 的留言', (await pa.eval(`document.querySelector('#app').textContent.includes(${q(SECRET_BODY)})`)) === true);

  // 按讚的通知：換到那篇貼文（不帶 comments=1）
  await visit(pa, base, '#/beans');
  const likeTarget = `#/social/${A.id}/${post}`;
  await inServiceWorker(chrome, pa, `self.registration.getNotifications({ tag: ${q(`like:${A.id}/${post}`)} })
    .then(([n]) => { n.close(); return openApp(n.data.path); }).then(() => true)`);
  await pa.waitFor(`location.hash === ${q(likeTarget)}`, { label: '換到按讚的貼文', timeout: 5000 }).catch(() => null);
  check('點按讚的通知：A 的視窗換到那篇貼文', (await pa.eval('location.hash')) === likeTarget, await pa.eval('location.hash'));

  // 外部網址、App 其他頁面：只到 #/social
  for (const bad of ['https://evil.example/', 'javascript:pwn()', '#/admin', `#/social/${A.id}/${post}?comments=1&x=https://evil.example`, '//evil.example/#/social']) {
    await visit(pa, base, '#/beans');
    await inServiceWorker(chrome, pa, `openApp(${q(bad)}).then(() => true)`);
    await pa.waitFor(`location.hash === '#/social'`, { label: `${bad} → #/social`, timeout: 3000 }).catch(() => null);
    check(`點擊網址是 ${bad}：只到 #/social`, (await pa.eval('location.hash')) === '#/social' && (await pa.eval('location.origin')) === new URL(base).origin);
  }
  // App 頁面也會再檢查：Service Worker 傳來的換頁訊息不是社群貼文就忽略
  await visit(pa, base, '#/beans');
  await inServiceWorker(chrome, pa, `self.clients.matchAll({ type: 'window' }).then((cs) => {
    for (const c of cs) { c.postMessage({ type: 'navigate', path: '#/admin' }); c.postMessage({ type: 'navigate', path: 'https://evil.example/' }); }
    return true;
  })`);
  await sleep(800);
  check('App 收到不合格的換頁訊息：忽略', (await pa.eval('location.hash')) === '#/beans');
  check('沒有開新視窗（全部測完）', (await pageTargets(chrome, pa)) === before);

  /* ===== 8. 停用、再啟用、登出 ===== */
  await visit(pa, base, '#/notifications');
  await settingsLoaded(pa);
  await click(pa, '[data-action="disable"]');
  await toast(pa, '已停用');
  check('停用：雲端的訂閱刪除', rows(await rest(`push_subscriptions?user_id=eq.${A.id}`, { headers: admin }))?.length === 0);
  check('停用：這台裝置退訂', (await pa.eval(`localStorage.getItem('__fakeSub')`)) === null);
  await pa.waitFor(`document.querySelector('[data-action="enable"]')`, { label: '回到可以啟用' });
  await click(pa, '[data-action="enable"]');
  await toast(pa, '已啟用通知');
  check('再啟用：訂閱存回去', rows(await rest(`push_subscriptions?user_id=eq.${A.id}`, { headers: admin }))?.length === 1);

  await visit(pa, base, '#/account');
  await click(pa, '[data-action="signout"]');
  await toast(pa, '已登出');
  check('登出：這台裝置的訂閱從雲端刪除', rows(await rest(`push_subscriptions?user_id=eq.${A.id}`, { headers: admin }))?.length === 0);
  check('登出：這台裝置退訂', (await pa.eval(`localStorage.getItem('__fakeSub')`)) === null);
  await visit(pa, base, '#/notifications');
  await settingsLoaded(pa);
  check('登出後：通知設定頁請你先登入', (await text(pa, '#app')).includes('要先登入'));

  /* ===== 9. CSP、JavaScript 錯誤 ===== */
  for (const [name, page] of Object.entries({ A: pa, iPhone: iphone, 主畫面: home })) {
    const v = await violations(page);
    check(`${name}：沒有 CSP 違規`, v.length === 0, v.join(' | '));
    check(`${name}：沒有 JavaScript 錯誤`, page.errors.length === 0, page.errors.join(' | '));
  }
} catch (err) {
  console.error(err);
  check('沒有發生例外', false, err.message);
} finally {
  await chrome?.close();
  server?.close();
  await push.close();
  await cleanup();
  summary();
}
