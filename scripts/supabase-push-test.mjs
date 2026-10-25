// 推播通知從 API 層測：訂閱的權限與 10 台上限、send-push 只收資料庫簽章的請求、
// 實際留言後（trigger → pg_net → send-push → 假推播伺服器）通知正確的人、內容沒有留言原文、5 分鐘合併、封鎖、410 時刪除訂閱
// A、B 好友，A、D 好友，B、D 好友；C 不是任何人的好友
// 本機的 send-push 一律送到這支測試開的假推播伺服器（port 54398），不會連到真的推播服務
//
// 用法：npx supabase@2.120.0 start 之後 node scripts/supabase-push-test.mjs
//      （新增 send-push 後要 stop 再 start 一次才會載入）

import { execSync } from 'node:child_process';
import {
  check, summary, setupUsers, cleanup, rest, rows, insertBrew, serviceKey, psql, setupPushVault,
  pushEndpoint, subscribePush, signedPush, userToken, representation,
} from './supabase-local.mjs';
import { browserKeys, decrypt, verifyVapid, fakePushServer } from './push-helpers.mjs';
import { readFile } from 'node:fs/promises';

const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EDGE_CONTAINER = 'supabase_edge_runtime_coffee-log';
// 和 send-push 的 LOCAL_VAPID、js/config.js 的 LOCAL.vapidPublicKey 是同一組
const LOCAL_VAPID_PUBLIC = (await readFile(new URL('../js/config.js', import.meta.url), 'utf8')).match(/vapidPublicKey: '([\w-]+)'/)[1];

const gone = new Set(); // 假推播伺服器對這些路徑回 410
const push = fakePushServer({ status: (path) => (gone.has(path) ? 410 : 201) });
const pathOf = (name) => new URL(pushEndpoint(name)).pathname;

/** 等到假推播伺服器收到 n 則（從 since 起算）；回傳那幾則 */
async function waitPushes(since, n, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (push.received.length - since < n && Date.now() < deadline) await sleep(100);
  return push.received.slice(since);
}
/** 確認一段時間內沒有再收到（pg_net 每 ~1 秒處理一次佇列） */
async function noMorePushes(since, ms = 4000) {
  await sleep(ms);
  return push.received.length === since;
}
const comment = (user, owner, brewId, body, extra = {}) => rest('comments', {
  method: 'POST', token: user.token, headers: representation, body: { brew_owner: owner, brew_id: brewId, body, ...extra },
});

try {
  await push.listen();
  setupPushVault();
  const { A, B, C, D } = await setupUsers(['A', 'B', 'C', 'D'], [['A', 'B'], ['A', 'D'], ['B', 'D']]);
  const keys = { A: browserKeys(), B: browserKeys(), C: browserKeys(), D: browserKeys() };

  /* ===== 1. 訂閱的權限 ===== */
  const a1 = await subscribePush(A, 'a1', keys.A);
  check('A 新增自己的訂閱', a1.status === 201 && rows(a1)?.[0]?.user_id === A.id, a1.text);
  check('B 新增自己的訂閱', (await subscribePush(B, 'b1', keys.B)).status === 201);
  check('D 新增自己的訂閱', (await subscribePush(D, 'd1', keys.D)).status === 201);
  check('C 新增自己的訂閱', (await subscribePush(C, 'c1', keys.C)).status === 201);
  check('B 讀不到 A 的訂閱', rows(await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(pushEndpoint('a1'))}`, { token: B.token }))?.length === 0);
  check('B 只讀得到自己的', rows(await rest('push_subscriptions?select=endpoint', { token: B.token }))?.map((r) => r.endpoint).join() === pushEndpoint('b1'));
  await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(pushEndpoint('a1'))}`, { method: 'DELETE', token: B.token });
  check('B 刪不掉 A 的訂閱', rows(await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(pushEndpoint('a1'))}`, { headers: admin }))?.length === 1);
  const forged = await rest('push_subscriptions', {
    method: 'POST', token: B.token, body: { user_id: A.id, endpoint: pushEndpoint('forged'), p256dh: keys.B.p256dh, auth: keys.B.auth },
  });
  check('B 不能替 A 新增訂閱', forged.status === 401 || forged.status === 403, `${forged.status}`);
  const dup = await subscribePush(B, 'a1', keys.B);
  check('同一個 endpoint 不能有兩筆（23505）', dup.json?.code === '23505', dup.text);
  const ssrf = await rest('push_subscriptions', {
    method: 'POST', token: B.token, body: { endpoint: 'http://kong:8000/rest/v1/', p256dh: keys.B.p256dh, auth: keys.B.auth },
  });
  check('endpoint 不能是內部網址（23514）', ssrf.json?.code === '23514', ssrf.text);
  const anon = await rest('push_subscriptions');
  check('沒登入讀不到訂閱', anon.status === 401 || rows(anon)?.length === 0, `${anon.status}`);

  // 每人最多 10 台
  for (let i = 2; i <= 10; i++) await subscribePush(A, `a${i}`, browserKeys());
  const eleventh = await subscribePush(A, 'a11', browserKeys());
  check('第 11 台被拒絕（too_many_devices）', eleventh.json?.code === 'P0001' && eleventh.json?.hint === 'too_many_devices', eleventh.text);
  await rest(`push_subscriptions?endpoint=neq.${encodeURIComponent(pushEndpoint('a1'))}`, { method: 'DELETE', token: A.token });
  check('A 刪掉多的，剩 1 台', rows(await rest('push_subscriptions?select=id', { token: A.token }))?.length === 1);

  // 偏好
  const prefs = await rest('notification_prefs?on_conflict=user_id', {
    method: 'POST', token: A.token, headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: { comments: true, replies: false },
  });
  check('A 存自己的偏好（upsert）', prefs.status === 201 && rows(prefs)?.[0]?.replies === false, prefs.text);
  const again = await rest('notification_prefs?on_conflict=user_id', {
    method: 'POST', token: A.token, headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: { comments: true, replies: true },
  });
  check('A 再存一次（改成都開）', rows(again)?.[0]?.replies === true, again.text);
  check('B 讀不到 A 的偏好', rows(await rest('notification_prefs', { token: B.token }))?.length === 0);

  /* ===== 2. 一般使用者呼叫不了 send-push ===== */
  const fn = (opts) => fetch('http://127.0.0.1:54321/functions/v1/send-push', { method: 'POST', ...opts });
  const job = { brew_owner: A.id, brew_id: crypto.randomUUID(), actor_nickname: '假冒', recipients: [{ user_id: A.id, kind: 'comment' }] };
  const fresh = () => ({ ...job, sent_at: Math.floor(Date.now() / 1000) });
  check('沒有簽章：401', (await fn({ body: JSON.stringify(fresh()) })).status === 401);
  check('帶使用者的 JWT：401', (await fn({ body: JSON.stringify(fresh()), headers: { Authorization: `Bearer ${A.token}` } })).status === 401);
  check('帶 service_role 也一樣要簽章：401', (await fn({ body: JSON.stringify(fresh()), headers: admin })).status === 401);
  check('密鑰本身當成簽章：401', (await fn({ body: JSON.stringify(fresh()), headers: { 'x-push-signature': 'local-push-secret' } })).status === 401);
  check('用錯的密鑰簽章：401', (await signedPush(fresh(), 'wrong-secret')).status === 401);
  const tampered = await (async () => {
    const body = JSON.stringify(fresh());
    const { createHmac } = await import('node:crypto');
    const sig = createHmac('sha256', 'local-push-secret').update(body).digest('hex');
    return fn({ body: body.replace('假冒', '竄改'), headers: { 'x-push-signature': sig } });
  })();
  check('內容被改過：401', tampered.status === 401);
  check('超過 2 分鐘的舊請求（重送）：400', (await signedPush({ ...job, sent_at: Math.floor(Date.now() / 1000) - 600 })).status === 400);
  check('GET：405', (await fetch('http://127.0.0.1:54321/functions/v1/send-push')).status === 405);
  check('正確簽章、內容不合格：400', (await signedPush({ ...fresh(), recipients: [{ user_id: 'x', kind: 'comment' }] })).status === 400);
  const before = push.received.length;
  const ok = await signedPush(fresh());
  check('正確簽章：200（這個測試確認 function 本身正常）', ok.status === 200, await ok.text());
  check('…送到 A 的裝置', (await waitPushes(before, 1)).length === 1);

  /* ===== 3. 留言 → 通知貼文作者 ===== */
  const p1 = await insertBrew(A, { withPhoto: false });
  let since = push.received.length;
  const SECRET_BODY = '這是不能出現在通知裡的留言內容';
  const c1 = rows(await comment(B, A.id, p1, SECRET_BODY))[0];
  let got = await waitPushes(since, 1);
  check('B 留言 A 的貼文：A 收到一則', got.length === 1 && got[0].path === pathOf('a1'), got.map((g) => g.path).join());
  const msg = got[0] && JSON.parse(decrypt(got[0].body, keys.A).text);
  check('解密後：新留言、B 的暱稱、貼文', msg?.v === 1 && msg.kind === 'comment' && msg.nickname === 'B' && msg.owner === A.id && msg.brewId === p1, JSON.stringify(msg));
  check('通知內容沒有留言原文', got[0] && !decrypt(got[0].body, keys.A).text.includes('不能出現'));
  check('通知只有 v、kind、nickname、owner、brewId', msg && Object.keys(msg).sort().join() === 'brewId,kind,nickname,owner,v');
  const vapid = got[0] && verifyVapid(got[0].headers.authorization, LOCAL_VAPID_PUBLIC);
  check('VAPID 簽章正確、aud 是 FCM', vapid?.ok && vapid.claims.aud === 'https://fcm.googleapis.com', JSON.stringify(vapid?.claims));
  check('header：aes128gcm、TTL、Topic', got[0]?.headers['content-encoding'] === 'aes128gcm' && got[0].headers.ttl === '86400' && /^[\w-]{32}$/.test(got[0].headers.topic));
  const topicP1 = got[0]?.headers.topic;

  /* ===== 4. 回覆 → 通知被回覆的人，不通知自己 ===== */
  since = push.received.length;
  await comment(A, A.id, p1, 'A 回覆 B', { parent_id: c1.id });
  got = await waitPushes(since, 1);
  check('A 回覆 B：只有 B 收到', got.length === 1 && got[0].path === pathOf('b1'), got.map((g) => g.path).join());
  const reply = got[0] && JSON.parse(decrypt(got[0].body, keys.B).text);
  check('B 收到的是回覆、暱稱是 A', reply?.kind === 'reply' && reply.nickname === 'A', JSON.stringify(reply));
  check('A 自己沒收到', await noMorePushes(push.received.length, 2500));

  since = push.received.length;
  const b1 = await insertBrew(B, { withPhoto: false });
  await comment(B, B.id, b1, 'B 自己的貼文');
  check('自己留言自己的貼文：沒有通知', await noMorePushes(since));

  /* ===== 5. 5 分鐘合併 ===== */
  since = push.received.length;
  await comment(D, A.id, p1, 'D 也留言 p1');
  await comment(B, A.id, p1, 'B 再留言 p1');
  check('5 分鐘內同一篇的新留言：A 不再收到（合併）', await noMorePushes(since));
  psql(`update private.push_throttle set sent_at = now() - interval '6 minutes' where brew_id = '${p1}'`);
  await comment(D, A.id, p1, 'D 過了 5 分鐘再留言');
  got = await waitPushes(since, 1);
  check('超過 5 分鐘：A 再收到一則', got.length === 1 && got[0].path === pathOf('a1'));
  check('同一篇貼文的 Topic 相同（推播服務取代還沒送達的）', got[0]?.headers.topic === topicP1);
  check('通知的是 D', got[0] && JSON.parse(decrypt(got[0].body, keys.A).text).nickname === 'D');

  /* ===== 6. 封鎖 ===== */
  // D 的貼文上 B 留言；D 封鎖 B 之後，A 回覆 B 的留言：只通知 D（貼文作者），B 讀不到這篇所以不通知
  const d1 = await insertBrew(D, { withPhoto: false });
  const bOnD = rows(await comment(B, D.id, d1, 'B 在 D 的貼文'))[0];
  await waitPushes(push.received.length, 1);
  check('D 封鎖 B', (await rest('blocks', { method: 'POST', token: D.token, body: { blocked: B.id } })).status === 201);
  psql(`delete from private.push_throttle where brew_id = '${d1}'`); // D 剛收過 d1 的通知，不要被合併
  since = push.received.length;
  const aReply = await comment(A, D.id, d1, 'A 回覆 B（D 封鎖了 B）', { parent_id: bOnD.id });
  check('A 回覆成功', aReply.status === 201, aReply.text);
  got = await waitPushes(since, 1);
  await sleep(1500);
  got = push.received.slice(since);
  check('封鎖：只有 D 收到，B 沒收到', got.length === 1 && got[0].path === pathOf('d1'), got.map((g) => g.path).join());

  // 非好友收不到：C 沒辦法留言 A 的貼文，也收不到 A 貼文的任何通知
  check('C 不能留言 A 的貼文', (await comment(C, A.id, p1, 'C')).status >= 400);
  check('C 從頭到尾沒收到通知', !push.received.some((r) => r.path === pathOf('c1')));

  /* ===== 7. 關掉「新留言」 ===== */
  await rest('notification_prefs?on_conflict=user_id', {
    method: 'POST', token: A.token, headers: { Prefer: 'resolution=merge-duplicates' }, body: { comments: false, replies: true },
  });
  since = push.received.length;
  const p2 = await insertBrew(A, { withPhoto: false });
  await comment(B, A.id, p2, 'A 關掉新留言之後');
  check('A 關掉「新留言」：沒有通知', await noMorePushes(since));
  await rest('notification_prefs?on_conflict=user_id', {
    method: 'POST', token: A.token, headers: { Prefer: 'resolution=merge-duplicates' }, body: { comments: true, replies: true },
  });

  /* ===== 8. 推播服務回 410：刪除那筆訂閱 ===== */
  gone.add(pathOf('a1'));
  since = push.received.length;
  const p3 = await insertBrew(A, { withPhoto: false });
  await comment(B, A.id, p3, '這次 A 的裝置已經不存在');
  got = await waitPushes(since, 1);
  check('送到 A 的裝置（回 410）', got.length === 1 && got[0].path === pathOf('a1'));
  let removed = false;
  for (let i = 0; i < 30 && !removed; i++) {
    removed = rows(await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(pushEndpoint('a1'))}`, { headers: admin }))?.length === 0;
    if (!removed) await sleep(200);
  }
  check('410：A 的那筆訂閱被刪掉', removed);
  check('B 的訂閱還在', rows(await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(pushEndpoint('b1'))}`, { headers: admin }))?.length === 1);

  /* ===== 9. function 的 log 不含 endpoint、金鑰 ===== */
  const logs = execSync(`docker logs --since 10m ${EDGE_CONTAINER} 2>&1`, { encoding: 'utf8' });
  const pushLogs = logs.split('\n').filter((l) => l.includes('[send-push]'));
  check('log 有送出的摘要', pushLogs.some((l) => /送出 \d+、過期刪除 1/.test(l)), pushLogs.slice(-3).join(' | '));
  check('log 沒有 endpoint、使用者的金鑰、VAPID 私鑰', !logs.includes(pathOf('b1').split('/').pop()) && !logs.includes(keys.B.p256dh)
    && !logs.includes(keys.B.auth) && !logs.includes('Ka74bLPnWHTLH'));

  /* ===== 11. 好友新貼文 ===== */
  // A 的 a1 在 8. 被 410 刪掉了：換一台新的
  check('A 換一台裝置訂閱', (await subscribePush(A, 'a-more', keys.A)).status === 201);
  const upsertPrefs = (user, body) => rest('notification_prefs?on_conflict=user_id', {
    method: 'POST', token: user.token, headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body,
  });
  const share = async (user, extra = {}) => {
    const id = crypto.randomUUID();
    const r = await rest('shared_brews', {
      method: 'POST', token: user.token,
      body: { id, bean_name: '肯亞 AA', brewed_at: new Date().toISOString(), coffee_g: 15, water_g: 240, notes: '不能出現的筆記', ...extra },
    });
    return { id, r };
  };
  const msgOf = (g, k) => JSON.parse(decrypt(g.body, k).text);
  const settle = async (since, n) => { await waitPushes(since, n); await sleep(2000); return push.received.slice(since); };

  check('A 的偏好：好友新貼文預設關、按讚預設開', (() => {
    const p = rows(again)?.[0];
    return p?.new_posts === false && p?.likes === true;
  })(), JSON.stringify(rows(again)?.[0]));
  since = push.received.length;
  await share(A);
  check('好友新貼文預設關：B、D 都不會收到', await noMorePushes(since));

  for (const u of [B, C, D]) await upsertPrefs(u, { new_posts: true });
  const oldFormat = await upsertPrefs(B, { comments: true, replies: true });
  check('舊版只存 comments、replies：不會改到 new_posts、likes', rows(oldFormat)?.[0]?.new_posts === true && rows(oldFormat)?.[0]?.likes === true, oldFormat.text);

  since = push.received.length;
  const n1 = await share(A);
  got = await settle(since, 2);
  check('A 分享：好友 B、D 收到，非好友 C 沒有', got.map((g) => g.path).sort().join() === [pathOf('b1'), pathOf('d1')].sort().join(), got.map((g) => g.path).join());
  const postMsg = got.find((g) => g.path === pathOf('b1'));
  const pm = postMsg && msgOf(postMsg, keys.B);
  check('解密後：post、A 的暱稱、豆子名稱、貼文、第一則會響', pm?.kind === 'post' && pm.nickname === 'A' && pm.bean === '肯亞 AA'
    && pm.owner === A.id && pm.brewId === n1.id && pm.others === 0 && pm.quiet === false, JSON.stringify(pm));
  check('通知沒有筆記', postMsg && !decrypt(postMsg.body, keys.B).text.includes('不能出現'));
  check('通知只有 v、kind、nickname、owner、brewId、bean、others、quiet', pm && Object.keys(pm).sort().join() === 'bean,brewId,kind,nickname,others,owner,quiet,v');
  const topicFriendA = postMsg?.headers.topic;

  since = push.received.length;
  await rest(`shared_brews?owner=eq.${A.id}&id=eq.${n1.id}`, { method: 'PATCH', token: A.token, body: { notes: '改過', bean_name: '改名' } });
  check('修改舊貼文：不通知', await noMorePushes(since));
  await rest(`shared_brews?owner=eq.${A.id}&id=eq.${n1.id}`, { method: 'DELETE', token: A.token });
  const reshared = await share(A, { id: n1.id });
  check('改回只有我再分享：上傳成功', reshared.r.status === 201, reshared.r.text);
  check('…不再通知', await noMorePushes(since));

  since = push.received.length;
  const n2 = await share(A, { bean_name: '哥倫比亞' });
  got = await settle(since, 2);
  const second = got.find((g) => g.path === pathOf('b1'));
  const sm = second && msgOf(second, keys.B);
  check('30 分鐘內第二篇：照樣送、安靜、others 1、指向新那篇', got.length === 2 && sm?.quiet === true && sm.others === 1 && sm.brewId === n2.id && sm.bean === '哥倫比亞', JSON.stringify(sm));
  check('同一位好友的 Topic 相同', second?.headers.topic === topicFriendA);
  psql(`update private.push_windows set started_at = now() - interval '31 minutes' where key = 'friend:${A.id}'`);
  since = push.received.length;
  await share(A);
  got = await settle(since, 2);
  check('超過 30 分鐘：重新開始（響）', got.length === 2 && got.every((g) => msgOf(g, g.path === pathOf('b1') ? keys.B : keys.D).quiet === false));

  // 封鎖：D 封鎖了 B（6.）。B 分享：A 沒開、D 封鎖 → 沒有人；A 打開後只有 A
  since = push.received.length;
  await share(B);
  check('B 分享：D 封鎖了 B、A 沒開 → 沒有通知', await noMorePushes(since));
  await upsertPrefs(A, { new_posts: true });
  since = push.received.length;
  await share(B);
  got = await settle(since, 1);
  check('A 打開後：只有 A 收到（D 封鎖 B 照樣收不到）', got.length === 1 && got[0].path === pathOf('a-more'), got.map((g) => g.path).join());
  await upsertPrefs(A, { new_posts: false });

  // 停權
  psql(`update auth.users set banned_until = now() + interval '1 day' where id = '${A.id}'`);
  since = push.received.length;
  await share(A);
  check('發文者被停權：不通知', await noMorePushes(since));
  psql(`update auth.users set banned_until = null where id = '${A.id}'; update auth.users set banned_until = now() + interval '1 day' where id = '${B.id}'`);
  psql(`delete from private.push_windows where key = 'friend:${A.id}'`);
  since = push.received.length;
  await share(A);
  got = await settle(since, 1);
  check('收件人 B 被停權：只有 D 收到', got.length === 1 && got[0].path === pathOf('d1'), got.map((g) => g.path).join());
  psql(`update auth.users set banned_until = null where id = '${B.id}'`);

  // 每天 30 筆：第 31 筆上傳被拒，也就不會通知
  psql(`insert into private.rate_events (user_id, kind) select '${A.id}', 'brew_insert'
    from generate_series(1, 30 - private.count_today('${A.id}', 'brew_insert'))`);
  since = push.received.length;
  const capped = await share(A);
  check('第 31 筆上傳被拒（rate_limited）', capped.r.json?.hint === 'rate_limited', capped.r.text);
  check('…沒有通知', await noMorePushes(since));

  /* ===== 12. 按讚 ===== */
  const like = (user, owner, brewId) => rest('likes', { method: 'POST', token: user.token, body: { brew_owner: owner, brew_id: brewId } });
  const unlike = (user, owner, brewId) => rest(`likes?brew_owner=eq.${owner}&brew_id=eq.${brewId}&user_id=eq.${user.id}`, { method: 'DELETE', token: user.token });
  const lp = n2.id; // A 的貼文
  since = push.received.length;
  check('B 按讚 A 的貼文', (await like(B, A.id, lp)).status === 201);
  got = await settle(since, 1);
  const lm = got[0] && msgOf(got[0], keys.A);
  check('A 收到按讚：like、B、這篇、響', got.length === 1 && got[0].path === pathOf('a-more') && lm?.kind === 'like' && lm.nickname === 'B'
    && lm.owner === A.id && lm.brewId === lp && lm.others === 0 && lm.quiet === false, JSON.stringify(lm));
  check('按讚的通知只有 v、kind、nickname、owner、brewId、others、quiet', lm && Object.keys(lm).sort().join() === 'brewId,kind,nickname,others,owner,quiet,v');
  check('讚的 Topic 和留言的不同（不會取代留言通知）', got[0] && got[0].headers.topic !== topicP1);
  const topicLike = got[0]?.headers.topic;

  since = push.received.length;
  await like(A, A.id, lp);
  check('自己按自己的讚：不通知', await noMorePushes(since, 2500));
  await unlike(B, A.id, lp);
  await like(B, A.id, lp);
  check('B 收回再按：不再通知', await noMorePushes(since));

  since = push.received.length;
  await like(D, A.id, lp);
  got = await settle(since, 1);
  const dm = got[0] && msgOf(got[0], keys.A);
  check('30 分鐘內 D 也按讚：「D 和其他 1 人」、安靜、Topic 相同', got.length === 1 && dm?.nickname === 'D' && dm.others === 1 && dm.quiet === true
    && got[0].headers.topic === topicLike, JSON.stringify(dm));

  // 封鎖：D 封鎖了 B，RLS 讓雙方按不到讚；直接新增（繞過 RLS）確認 trigger 也不送（兩個方向）
  const bPost = (await share(B)).id;
  const dPost = (await share(D)).id;
  check('D 按不到 B 的讚（RLS）', (await like(D, B.id, bPost)).status >= 400);
  since = push.received.length;
  psql(`insert into public.likes (brew_owner, brew_id, user_id) values ('${B.id}', '${bPost}', '${D.id}'), ('${D.id}', '${dPost}', '${B.id}')`);
  check('封鎖的雙方互相按讚：都不通知', await noMorePushes(since));

  // 關掉「按讚」
  await upsertPrefs(A, { likes: false });
  since = push.received.length;
  await like(B, A.id, n1.id);
  check('A 關掉「按讚」：不通知', await noMorePushes(since));
  await upsertPrefs(A, { likes: true });

  /* ===== 13. send-push 檢查新的格式 ===== */
  const recipient = (kind, extra = {}) => ({ user_id: A.id, kind, ...extra });
  const postJob = (recipients, extra = {}) => ({ ...fresh(), bean_name: '豆', recipients, ...extra });
  const many = Array.from({ length: 201 }, () => recipient('post', { count: 1, quiet: false }));
  for (const [name, body] of [
    ['新貼文 201 人', postJob(many)],
    ['讚 2 人', { ...fresh(), recipients: [recipient('like', { count: 1, quiet: false }), recipient('like', { count: 1, quiet: false })] }],
    ['不認得的 kind', { ...fresh(), recipients: [recipient('follow')] }],
    ['count 是字串', postJob([recipient('post', { count: '1', quiet: false })])],
    ['count 是 0', postJob([recipient('post', { count: 0, quiet: false })])],
    ['quiet 不是 boolean', postJob([recipient('post', { count: 1, quiet: 'yes' })])],
    ['新貼文和留言混在一起', postJob([recipient('post', { count: 1, quiet: false }), recipient('comment')])],
    ['新貼文沒有豆子名稱', postJob([recipient('post', { count: 1, quiet: false })], { bean_name: undefined })],
    ['留言帶 count', { ...fresh(), recipients: [recipient('comment', { count: 1 })] }],
    ['讚帶豆子名稱', postJob([recipient('like', { count: 1, quiet: false })])],
  ]) {
    const r = await signedPush(body);
    check(`send-push：${name} → 400`, r.status === 400, `${r.status}`);
  }
  since = push.received.length;
  check('send-push：正確的新貼文 → 200', (await signedPush(postJob(Array.from({ length: 200 }, () => recipient('post', { count: 1, quiet: false }))))).status === 200);
  check('…送到 A', (await waitPushes(since, 1)).length >= 1);

  /* ===== 14. 刪除帳號：訂閱一起刪除 ===== */
  const del = await fetch('http://127.0.0.1:54321/functions/v1/delete-account', { method: 'POST', headers: { Authorization: `Bearer ${userToken(D.id)}` } });
  check('D 刪除帳號', del.status === 200, `${del.status}`);
  check('D 的訂閱 cascade 刪除', rows(await rest(`push_subscriptions?user_id=eq.${D.id}`, { headers: admin }))?.length === 0);
} catch (err) {
  console.error(err);
  check('沒有發生例外', false, err.message);
} finally {
  await cleanup();
  await push.close();
  summary();
}
