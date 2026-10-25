// 個人檔案（#/user/<id>）的端對端測試：互相隔離的 headless Chrome（A、B、C、D）操作真的畫面
// A、B 好友；B、C 好友（C 不是 A 的好友）；A、D 好友但 A 封鎖了 D
// 確認：B 看到 A 的完整檔案；C、D 看不到任何欄位；A 從留言點 C 看到「你們還不是好友」和留言當下的暱稱；
// 從動態卡片、詳細頁、留言、@暱稱、好友名單點頭像或暱稱都跳到正確的檔案，點擊範圍至少 44px；
// 編輯自己的檔案（字數提示、驗證）；暱稱與自我介紹的 XSS 只顯示成文字；沒有 CSP 違規、沒有 JavaScript 錯誤
//
// 用法：先 npx supabase@2.120.0 start，再 node scripts/social-profile-test.mjs

import { check, failures, summary, setupUsers, realSession, cleanup, rest, rows, rpc, insertBrew } from './supabase-local.mjs';
import { startServer, launchChrome, prepare, visit, click, fill, submit, text, toast, noInjection, signIn } from './chrome.mjs';

const XSS = '"><svg onload=pwn()>'; // 暱稱上限 20 字
const BIO = `${XSS}\n第二行 <b>粗體</b>`;
const q = JSON.stringify;

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
const appText = (page) => page.eval(`document.querySelector('#app').textContent`);
const profileLoaded = (page) => page.waitFor(`document.querySelector('#profile-page, #app .empty')`, { label: '個人檔案頁' });
/** 點 sel，確認跳到 hash，回到原本的頁面 */
async function jumps(page, base, from, sel, hash, name) {
  await visit(page, base, from);
  await click(page, sel);
  await page.waitFor(`location.hash === ${q(hash)}`, { label: `${name} 跳到 ${hash}`, timeout: 5000 }).catch(() => null);
  check(`${name}：跳到 ${hash}`, (await page.eval('location.hash')) === hash, await page.eval('location.hash'));
}
const height = (page, sel) => page.eval(`Math.round(document.querySelector(${q(sel)})?.getBoundingClientRect().height ?? 0)`);

let server;
let chrome;

try {
  const { A, B, C, D } = await setupUsers(['A', 'B', 'C', 'D'], [['A', 'B'], ['B', 'C'], ['A', 'D']]);
  await rest('blocks', { method: 'POST', token: A.token, body: { blocked: D.id } });
  await rest(`profiles?id=eq.${A.id}`, {
    method: 'PATCH', token: A.token, body: { nickname: XSS, bio: BIO, favorite_gear: 'V60 / <i>C40</i>', favorite_beans: '衣索比亞水洗' },
  });
  await rest(`profiles?id=eq.${C.id}`, { method: 'PATCH', token: C.token, body: { nickname: 'C 的暱稱' } });
  const aPost = await insertBrew(A, { withPhoto: false });
  const bPost = await insertBrew(B, { withPhoto: false });
  // B 的貼文：C 留言、B 回覆 C、A 回覆 B 的回覆（@B）
  const comment = async (user, body, extra = {}) => rows(await rest('comments', {
    method: 'POST', token: user.token, headers: { Prefer: 'return=representation' },
    body: { brew_owner: B.id, brew_id: bPost, body, ...extra },
  }))?.[0];
  const cTop = await comment(C, 'C 的留言');
  const bReply = await comment(B, 'B 回覆 C', { parent_id: cTop.id });
  const aReply = await comment(A, 'A 回覆 B', { parent_id: cTop.id, reply_to_user: B.id });
  check('（測試資料都建好了）', Boolean(cTop && bReply && aReply) && aReply.reply_to_user === B.id);

  server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  chrome = await launchChrome();
  const pages = {};
  for (const [name, user] of Object.entries({ A, B, C, D })) {
    pages[name] = await openPage(chrome, base);
    await signIn(pages[name], await realSession(user));
  }
  const { A: pa, B: pb, C: pc, D: pd } = pages;

  /* ===== 好友 B 看 A 的檔案：全部顯示，XSS 只是文字 ===== */
  await visit(pb, base, `#/user/${A.id}`);
  await pb.waitFor(`document.querySelector('.profile-bio')`, { label: 'B 看到 A 的自我介紹' });
  check('B 看到 A 的暱稱（照原樣顯示成文字）', (await text(pb, '.profile-name')) === XSS);
  check('B 看到 A 的自我介紹（含換行、<b> 照原樣）', (await text(pb, '.profile-bio')) === BIO);
  check('自我介紹的換行用 CSS 呈現（white-space: pre-line，沒有 <br>）',
    (await pb.eval(`getComputedStyle(document.querySelector('.profile-bio')).whiteSpace`)) === 'pre-line'
      && !(await pb.eval(`document.querySelector('.profile-bio br')`)));
  const bView = await appText(pb);
  check('B 看到常用器材、喜歡的豆子', bView.includes('V60 / <i>C40</i>') && bView.includes('衣索比亞水洗'));
  check('B 看到貼文數、加入日期', bView.includes('貼文 1') && bView.includes('加入'));
  check('別人的檔案沒有「編輯個人檔案」', !(await pb.eval(`document.querySelector('[data-action="edit"], #profile-form')`)));
  check('A 的檔案頁：XSS 沒有變成 HTML', await noInjection(pb) && !(await pb.eval(`document.querySelector('#app i')`)));

  /* ===== C（非好友）、D（被封鎖的好友）：讀不到任何欄位 ===== */
  // C 在共同好友 B 的貼文上讀得到 A 的留言：只顯示留言當下的暱稱和「你們還不是好友」；D 有封鎖：找不到
  const noFields = (t) => !t.includes('第二行') && !t.includes('V60') && !t.includes('衣索比亞') && !t.includes('貼文') && !t.includes('加入');
  await visit(pc, base, `#/user/${A.id}`);
  await profileLoaded(pc);
  const cView = await appText(pc);
  check('非好友 C 看 A：只有留言當下的暱稱（照原樣顯示成文字）和「你們還不是好友」',
    (await text(pc, '.profile-name')) === XSS && cView.includes('你們還不是好友'), cView.slice(0, 80));
  check('非好友 C 看 A：沒有任何欄位、預設頭像', noFields(cView) && Boolean(await pc.eval(`document.querySelector('.profile-card .avatar-initial')`)));
  check('非好友 C 看 A：XSS 沒有變成 HTML', await noInjection(pc));
  await visit(pd, base, `#/user/${A.id}`);
  await profileLoaded(pd);
  const dView = await appText(pd);
  check('被封鎖的好友 D 看 A：「找不到這個用戶」', dView.includes('找不到這個用戶'), dView.slice(0, 60));
  check('被封鎖的好友 D 看 A：沒有任何欄位', noFields(dView) && !dView.includes(XSS));
  await visit(pa, base, `#/user/${D.id}`);
  await profileLoaded(pa);
  check('封鎖者 A 看 D：「找不到這個用戶」', (await appText(pa)).includes('找不到這個用戶'));
  await visit(pa, base, '#/user/00000000-0000-4000-8000-000000000000');
  await profileLoaded(pa);
  check('不存在的帳號：「找不到這個用戶」', (await appText(pa)).includes('找不到這個用戶'));

  /* ===== 跳轉：動態卡片、詳細頁、留言、@暱稱、好友名單 ===== */
  const card = `.feed-card[data-key="${B.id}/${bPost}"]`;
  await jumps(pa, base, '#/social', `${card} .person-link`, `#/user/${B.id}`, '動態卡片的頭像、暱稱');
  check('B 的檔案從動態卡片打開', (await pa.waitFor(`document.querySelector('.profile-name')?.textContent`)) === 'B');
  const detail = `#/social/${B.id}/${bPost}`;
  await jumps(pa, base, detail, `${card} .person-link`, `#/user/${B.id}`, '詳細頁的頭像、暱稱');
  await jumps(pa, base, detail, `.comment[data-id="${cTop.id}"] .comment-avatar`, `#/user/${C.id}`, '留言的頭像');
  await profileLoaded(pa);
  const notFriend = await appText(pa);
  check('非好友 C 的檔案：留言當下的暱稱＋「你們還不是好友」',
    (await text(pa, '.profile-name')) === 'C 的暱稱' && notFriend.includes('你們還不是好友'));
  check('非好友 C 的檔案：預設頭像（首字）、沒有其他資料',
    Boolean(await pa.eval(`document.querySelector('.profile-card .avatar-initial')`)) && !notFriend.includes('貼文') && !notFriend.includes('加入'));
  await jumps(pa, base, detail, `.comment[data-id="${bReply.id}"] .comment-meta .person-name`, `#/user/${B.id}`, '回覆的暱稱');
  await jumps(pa, base, detail, `.comment[data-id="${aReply.id}"] .mention`, `#/user/${B.id}`, '@暱稱');
  await jumps(pa, base, '#/friends', `.person[data-id="${B.id}"] .person-link`, `#/user/${B.id}`, '好友名單');
  await visit(pa, base, '#/friends');
  await pa.waitFor(`document.querySelector('#blocked .person')`, { label: '封鎖名單' });
  check('封鎖名單的人不連到個人檔案', !(await pa.eval(`document.querySelector('#blocked .person-link')`)));

  /* ===== 點擊範圍至少 44px、不和按讚、回覆搶 ===== */
  await visit(pa, base, detail);
  await pa.waitFor(`document.querySelector('.comment .comment-avatar')`, { label: '留言區' });
  check('卡片的頭像列高度 ≥ 44px', (await height(pa, `${card} .person-link`)) >= 44, `${await height(pa, `${card} .person-link`)}px`);
  check('留言頭像的點擊範圍 ≥ 44px', (await height(pa, '.comment .comment-avatar')) >= 44, `${await height(pa, '.comment .comment-avatar')}px`);
  check('留言暱稱的點擊範圍 ≥ 44px', (await height(pa, '.comment-meta .person-name')) >= 44, `${await height(pa, '.comment-meta .person-name')}px`);
  check('@暱稱的點擊範圍 ≥ 44px', (await height(pa, '.comment-body .mention')) >= 44, `${await height(pa, '.comment-body .mention')}px`);
  const overlap = await pa.eval(`(() => {
    const r = (el) => el.getBoundingClientRect();
    const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const els = [...document.querySelectorAll('.person-link, .comment-avatar, .comment-meta .person-name, .comment-body .mention')];
    const btns = [...document.querySelectorAll('[data-action="like"], [data-action="reply"], [data-action="delete"]')];
    return els.flatMap((l) => btns.filter((b) => hit(r(l), r(b))).map((b) => l.className + ' × ' + b.dataset.action)).join(' / ');
  })()`);
  check('頭像、暱稱的點擊範圍和按讚、回覆、刪除按鈕不重疊', !overlap, overlap);
  await click(pa, `.comment[data-id="${cTop.id}"] [data-action="reply"]`);
  check('按「回覆」不會跳到個人檔案', (await pa.eval('location.hash')) === detail && !(await pa.eval(`document.querySelector('#comment-target').hidden`)));

  /* ===== 個人檔案的貼文：好友看得到、和社群動態一樣的卡片、每次 20 筆 ===== */
  for (let i = 0; i < 21; i++) await insertBrew(A, { withPhoto: false }); // A 共 22 筆
  const cards = (page) => page.eval(`[...document.querySelectorAll('#profile-feed .feed-card')].map((c) => c.dataset.key)`);
  await visit(pb, base, `#/user/${A.id}`);
  await pb.waitFor(`document.querySelectorAll('#profile-feed .feed-card').length === 20`, { label: 'B 看到 A 的前 20 筆貼文' });
  const newest = rows(await rest(`shared_brews?select=id&owner=eq.${A.id}&order=brewed_at.desc,id.desc&limit=1`, { token: B.token }))[0].id;
  const firstPage = await cards(pb);
  check('好友 B 在 A 的檔案看到 A 的貼文（只有 A 的、新的在前）',
    firstPage.every((k) => k.startsWith(`${A.id}/`)) && firstPage[0] === `${A.id}/${newest}`, firstPage[0]);
  check('和社群動態一樣的卡片（豆子、參數、讚、留言數）',
    await pb.eval(`(() => { const c = document.querySelector('#profile-feed .feed-card'); return Boolean(c.querySelector('.card-title') && c.querySelector('[data-action="like"]') && c.querySelector('.comment-link')); })()`));
  check('卡片的頭像、暱稱不再連到同一個檔案', !(await pb.eval(`document.querySelector('#profile-feed .feed-head').matches('a')`)));
  check('超過 20 筆：有「載入更多」', !(await pb.eval(`document.querySelector('.profile-posts [data-action="more"]').hidden`)));
  await click(pb, '.profile-posts [data-action="more"]');
  await pb.waitFor(`document.querySelectorAll('#profile-feed .feed-card').length === 22`, { label: '載入更多' });
  check('按「載入更多」：載入剩下的 2 筆、沒有重複、按鈕隱藏',
    new Set(await cards(pb)).size === 22 && await pb.eval(`document.querySelector('.profile-posts [data-action="more"]').hidden`));
  check('檔案頁的貼文：XSS 沒有變成 HTML', await noInjection(pb));

  const firstKey = firstPage[0];
  await click(pb, `#profile-feed .feed-card[data-key="${firstKey}"] [data-action="like"]`);
  await pb.waitFor(`document.querySelector('#profile-feed .feed-card[data-key="${firstKey}"] [data-action="like"]').getAttribute('aria-pressed') === 'true'`, { label: '按讚' });
  const liked = async () => rows(await rest(`likes?select=user_id&brew_id=eq.${newest}`, { token: A.token }))?.length;
  for (let i = 0; i < 25 && (await liked()) !== 1; i++) await new Promise((r) => setTimeout(r, 200));
  check('在檔案頁按讚：雲端有這個讚', (await liked()) === 1);
  await click(pb, `#profile-feed .feed-card[data-key="${firstKey}"] a.feed-body`);
  await pb.waitFor(`location.hash === ${q(`#/social/${A.id}/${newest}`)}`, { label: '點卡片進詳細頁' });
  check('點卡片：進到原本的詳細頁', true);

  for (const [name, page] of [['非好友 C', pc], ['被封鎖的好友 D', pd]]) {
    await visit(page, base, `#/user/${A.id}`);
    await profileLoaded(page);
    await new Promise((r) => setTimeout(r, 800)); // 確認不會晚一點才冒出貼文
    check(`${name}：看不到 A 的任何貼文`, !(await page.eval(`document.querySelector('#profile-feed, .feed-card')`)));
  }
  await visit(pa, base, `#/user/${A.id}`);
  await pa.waitFor(`document.querySelectorAll('#profile-feed .feed-card').length === 20`, { label: 'A 看到自己的貼文' });
  check('自己的檔案：看得到自己分享的紀錄（標題「我分享的紀錄」）', (await text(pa, '#profile-posts-title')) === '我分享的紀錄');
  await visit(pc, base, `#/user/${C.id}`);
  await pc.waitFor(`document.querySelector('#posts-status:not([hidden])')`, { label: 'C 自己沒有貼文' });
  check('沒有貼文：顯示提示', (await text(pc, '#posts-status')).includes('還沒有分享給好友的紀錄'));

  /* ===== 自己的檔案：帳號頁的入口、編輯 ===== */
  await visit(pa, base, '#/account');
  await click(pa, `a[href="#/user/${A.id}"]`);
  await pa.waitFor(`location.hash === ${q(`#/user/${A.id}`)} && document.querySelector('[data-action="edit"]')`, { label: '帳號頁 → 我的個人檔案' });
  check('帳號頁有「我的個人檔案」，打開有「編輯個人檔案」', true);
  await click(pa, '[data-action="edit"]');
  check('輸入框提示字數上限', (await text(pa, '[data-count="bio"]')) === `${[...BIO].length}／150`
    && (await text(pa, '[data-count="favoriteGear"]')).endsWith('／50') && (await text(pa, '[data-count="favoriteBeans"]')).endsWith('／50')
    && (await text(pa, '[data-count="nickname"]')).endsWith('／20'));
  check('輸入框有 maxlength', q(await pa.eval(`['nickname', 'bio', 'favoriteGear', 'favoriteBeans'].map((n) => document.querySelector('#profile-form')[n].maxLength)`)) === q([20, 150, 50, 50]));
  await fill(pa, '#profile-bio', '1\n2\n3\n4\n5\n6');
  await submit(pa, '#profile-form');
  await pa.waitFor(`document.querySelector('[data-field="bio"] .error').textContent`, { label: '6 行的錯誤' });
  check('自我介紹 6 行：表單擋下', (await text(pa, '[data-field="bio"] .error')) === '最多 5 行');
  await fill(pa, '#profile-nickname', 'A 改名');
  await fill(pa, '#profile-bio', '新的自我介紹\n第二行');
  await fill(pa, '#profile-favoriteGear', 'Kalita');
  await fill(pa, '#profile-favoriteBeans', '巴拿馬藝伎');
  await submit(pa, '#profile-form');
  await toast(pa, '已儲存個人檔案');
  await pa.waitFor(`document.querySelector('.profile-bio')?.textContent === '新的自我介紹\\n第二行'`, { label: '儲存後重畫' });
  const saved = (await rpc('profile_detail', { target: A.id }, B.token)).json;
  check('儲存後雲端更新（好友 B 讀到新的內容）', saved?.nickname === 'A 改名' && saved?.bio === '新的自我介紹\n第二行'
    && saved?.favorite_gear === 'Kalita' && saved?.favorite_beans === '巴拿馬藝伎', q(saved));

  /* ===== 開發者後台不受影響：一般使用者的入口照樣隱藏 ===== */
  await visit(pa, base, '#/settings');
  await pa.waitFor(`document.querySelector('.settings')?.dataset.adminChecked === 'true'`, { label: '設定頁問完是不是開發者' });
  check('一般使用者看不到開發者後台', await pa.eval(`document.querySelector('.settings [data-admin]').hidden`));

  /* ===== 頁面錯誤、XSS、CSP ===== */
  for (const [name, page] of Object.entries(pages)) {
    check(`${name}：pwn() 從未被呼叫`, !(await page.eval('window.__pwned')));
    check(`${name}：沒有 CSP 違規`, (await violations(page)).length === 0, (await violations(page)).join(' / '));
    check(`${name}：沒有 JavaScript 錯誤`, page.errors.length === 0, page.errors.join(' / '));
  }
  check('（A 的貼文還在）', Boolean(aPost));
} catch (err) {
  failures.push(`執行錯誤：${err.message}`);
  console.error(err);
} finally {
  await chrome?.close();
  server?.close();
  await cleanup();
}

summary();
