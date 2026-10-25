// 留言與回覆：從 API 層（PostgREST、Edge Function）測權限，用真的 JWT
// pgTAP（supabase/tests/08_comments.test.sql）測資料庫本身；這裡確認從外部打 API 時同樣擋得住
// A、B 好友；C 不是好友；D 原本是 A、B 的好友，之後被 A 封鎖；E 是 A 的好友；F 只用來測每日上限
//
// 用法：先 npx supabase@2.120.0 start，再 node scripts/supabase-comments-test.mjs

import {
  call, rest, rpc, representation, rows, check, failures, summary, setupUsers, cleanup, insertBrew, serviceKey,
} from './supabase-local.mjs';

const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const adminRows = async (pathAndQuery) => rows(await rest(pathAndQuery, { headers: admin })) ?? [];
const exists = async (id) => (await adminRows(`comments?select=id&id=eq.${id}`)).length === 1;

/** 新增留言；回傳 { status, code, id, row } */
async function comment(user, owner, brewId, body, extra = {}) {
  const r = await rest('comments', {
    method: 'POST', token: user.token, headers: representation,
    body: { brew_owner: owner.id, brew_id: brewId, body, ...extra },
  });
  const row = rows(r)?.[0];
  return { status: r.status, code: r.json?.code, id: row?.id, row, text: r.text };
}
const ok = (r) => r.status === 201 && Boolean(r.id);
const visible = async (user, query) => rows(await rest(`comments?select=id,body,author&${query}`, { token: user.token })) ?? [];
const remove = (user, id) => rest(`comments?id=eq.${id}`, { method: 'DELETE', token: user.token, headers: representation });

try {
  const { A, B, C, D, E, F } = await setupUsers(['A', 'B', 'C', 'D', 'E', 'F'],
    [['A', 'B'], ['A', 'D'], ['B', 'D'], ['A', 'E'], ['A', 'F']]);
  const a1 = await insertBrew(A, { withPhoto: false });
  const a2 = await insertBrew(A, { withPhoto: false });
  const b1 = await insertBrew(B, { withPhoto: false });

  /* ===== 主留言與回覆 ===== */
  const bMain = await comment(B, A, a1, 'B 的主留言');
  check('B 在 A 的貼文留言', ok(bMain), bMain.text);
  check('作者是 B、記下暱稱', bMain.row?.author === B.id && bMain.row?.author_nickname === 'B');
  const aReply = await comment(A, A, a1, 'A 回覆 B', { parent_id: bMain.id });
  check('A 回覆 B', ok(aReply), aReply.text);
  const dReply = await comment(D, A, a1, 'D 回覆 A', { parent_id: bMain.id, reply_to_user: A.id });
  check('回覆的回覆：掛在主留言下、reply_to_user 是 A', ok(dReply) && dReply.row?.reply_to_nickname === 'A', dReply.text);

  const nested = await comment(B, A, a1, 'x', { parent_id: aReply.id });
  check('只有兩層：parent_id 指向回覆被拒絕（23514）', nested.code === '23514', nested.text);
  const crossPost = await comment(B, A, a2, 'x', { parent_id: bMain.id });
  check('跨貼文的 parent_id 被拒絕（23503）', crossPost.code === '23503', crossPost.text);
  const mainWithTarget = await comment(B, A, a1, 'x', { reply_to_user: A.id });
  check('主留言不能有 reply_to_user', mainWithTarget.code === '23514', mainWithTarget.text);
  const targetC = await comment(B, A, a1, 'x', { parent_id: bMain.id, reply_to_user: C.id });
  check('reply_to_user 是讀不到貼文的 C 被拒絕', targetC.code === '23514', targetC.text);
  const targetE = await comment(B, A, a1, 'x', { parent_id: bMain.id, reply_to_user: E.id });
  check('reply_to_user 是沒在這串留言的 E 被拒絕', targetE.code === '23514', targetE.text);

  /* ===== 不能修改、不能冒用、不能指定 ===== */
  const patch = await rest(`comments?id=eq.${bMain.id}`, { method: 'PATCH', token: B.token, body: { body: '改過' }, headers: representation });
  check('不能修改留言', patch.status >= 400, `HTTP ${patch.status}`);
  check('（內容沒變）', (await adminRows(`comments?select=body&id=eq.${bMain.id}`))[0]?.body === 'B 的主留言');
  const impersonate = await comment(B, A, a1, '冒用 A', { author: A.id });
  check('跨帳號：不能以 A 的名義留言', impersonate.status === 403 || impersonate.code === '42501', impersonate.text);
  for (const [field, value] of [['id', crypto.randomUUID()], ['created_at', '2000-01-01'], ['author_nickname', '假暱稱'], ['reply_to_nickname', '假']]) {
    const r = await comment(B, A, a1, 'x', { [field]: value });
    check(`不能指定 ${field}`, r.status >= 400, `HTTP ${r.status}`);
  }

  /* ===== 內容 ===== */
  for (const [label, body] of [['空字串', ''], ['只有空白', '   '], ['只有換行', '\n \n'], ['全形空白', '　'], ['301 字', 'あ'.repeat(301)], ['tab', 'a\tb']]) {
    const r = await comment(B, A, a1, body);
    check(`內容：${label}被拒絕`, r.code === '23514', r.text.slice(0, 100));
  }
  check('內容：剛好 300 字', ok(await comment(B, A, a1, 'あ'.repeat(300))));
  check('內容：XSS 字串原樣保存（顯示時由前端跳脫）',
    (await comment(B, A, a1, '"><svg onload=pwn()>')).row?.body === '"><svg onload=pwn()>');

  /* ===== 讀取 ===== */
  check('E（A 的好友）讀得到 A 貼文的留言', (await visible(E, `brew_id=eq.${a1}`)).length === 5);
  check('C（不是好友）讀不到任何留言', (await visible(C, 'id=not.is.null')).length === 0);
  const cInsert = await comment(C, A, a1, 'C 想留言');
  check('C 不能在 A 的貼文留言（403）', cInsert.status === 403, cInsert.text);
  const cProbe = await comment(C, A, a1, 'x', { parent_id: aReply.id });
  check('C 探測留言也只得到 403，不透露留言存在', cProbe.status === 403, cProbe.text);
  const anon = await rest('comments');
  check('未登入讀不到留言', anon.status >= 400 || rows(anon)?.length === 0, `HTTP ${anon.status}`);
  check('private.blocked_with 沒有從 API 公開', (await rpc('blocked_with', { target: A.id }, B.token)).status >= 400);

  /* ===== 通知 ===== */
  const activity = async (user, args = {}) => (await rpc('comment_activity', args, user.token)).json;
  const aAct = await activity(A);
  check('A：我貼文的新留言（不含自己的）', aAct?.post_comments === 4 && aAct?.replies === 0, JSON.stringify(aAct));
  check('A：有新留言的貼文', JSON.stringify(aAct?.posts) === JSON.stringify([`${A.id}/${a1}`]));
  check('A：看過之後沒有新的', (await activity(A, { post_since: aAct.latest_post_comment_at }))?.post_comments === 0);
  check('B：回覆我的主留言 2 則', (await activity(B))?.replies === 2);
  check('C：什麼都沒有', (await activity(C))?.post_comments === 0 && (await activity(C))?.replies === 0);
  check('未登入不能查通知', (await rpc('comment_activity', {})).status >= 400);

  /* ===== 刪除 ===== */
  check('B 不能刪別人的留言', rows(await remove(B, aReply.id))?.length === 0 && await exists(aReply.id));
  const dMain = await comment(D, A, a1, 'D 的主留言');
  check('A 能刪自己貼文下任何人的留言', rows(await remove(A, dMain.id))?.length === 1 && !(await exists(dMain.id)));
  check('B 刪掉自己的主留言', rows(await remove(B, bMain.id))?.length === 1);
  check('刪主留言時回覆一起刪', !(await exists(aReply.id)) && !(await exists(dReply.id)));

  /* ===== 封鎖 ===== */
  const aOnB = await comment(A, B, b1, 'A 在 B 的貼文');
  const bOnB = await comment(B, B, b1, 'B 自己的主留言');
  const dOnB = await comment(D, B, b1, 'D 在 B 的貼文');
  const dOnA = await comment(D, A, a1, 'D 在 A 的貼文');
  check('（封鎖前的留言都成功）', [aOnB, bOnB, dOnB, dOnA].every(ok));
  const block = await rest('blocks', { method: 'POST', token: A.token, body: { blocked: D.id } });
  check('A 封鎖 D', block.status === 201, block.text);
  check('封鎖不解除好友：D 在 A 貼文的留言沒有刪除', await exists(dOnA.id));
  check('A 看不到 D 在自己貼文的留言', (await visible(A, `id=eq.${dOnA.id}`)).length === 0);
  check('A 看不到 D 在共同好友貼文的留言', (await visible(A, `id=eq.${dOnB.id}`)).length === 0);
  check('D 看不到 A 在共同好友貼文的留言', (await visible(D, `id=eq.${aOnB.id}`)).length === 0);
  check('B 照樣看得到兩人的留言', (await visible(B, `brew_id=eq.${b1}`)).length === 3);
  const dInsert = await comment(D, A, a1, 'D 想留言');
  check('D 不能在 A 的貼文留言：和 C 一樣是 403', dInsert.status === 403 && dInsert.code === cInsert.code, dInsert.text);
  const dReplyA = await comment(D, B, b1, 'x', { parent_id: aOnB.id });
  check('D 不能回覆 A 的留言：和不存在一樣（23503）', dReplyA.code === '23503', dReplyA.text);
  const ghost = await comment(D, B, b1, 'x', { parent_id: crypto.randomUUID() });
  check('（不存在的留言也是 23503）', ghost.code === dReplyA.code);
  const dAtA = await comment(D, B, b1, 'x', { parent_id: bOnB.id, reply_to_user: A.id });
  check('D 不能 @A', dAtA.code === '23514', dAtA.text);
  // 解除封鎖：留言全部恢復；再封鎖回去，後面維持 D 被 A 封鎖
  await rest(`blocks?blocked=eq.${D.id}`, { method: 'DELETE', token: A.token });
  check('解除封鎖後 A 又看得到 D 的留言', (await visible(A, `id=in.(${dOnA.id},${dOnB.id})`)).length === 2);
  check('解除封鎖後 D 又看得到 A 的留言', (await visible(D, `id=eq.${aOnB.id}`)).length === 1);
  await rest('blocks', { method: 'POST', token: A.token, body: { blocked: D.id } });

  /* ===== 解除好友 ===== */
  const bOnA = await comment(B, A, a1, 'B 再留一則');
  check('（B 在 A 的貼文留言）', ok(bOnA));
  const unfriend = await rest(`friendships?requester=eq.${B.id}&addressee=eq.${A.id}`, { method: 'DELETE', token: A.token, headers: representation });
  check('A 和 B 解除好友', rows(unfriend)?.length === 1, unfriend.text);
  check('解除好友：B 在 A 貼文的留言刪除', !(await exists(bOnA.id)));
  check('解除好友：A 在 B 貼文的留言刪除', !(await exists(aOnB.id)));
  check('其他人的留言不受影響', await exists(bOnB.id) && await exists(dOnB.id));

  /* ===== 改回只有我（雲端刪除這筆紀錄） ===== */
  const eOnA2 = await comment(E, A, a2, 'E 在 a2');
  check('（E 在 a2 留言）', ok(eOnA2));
  await rest(`shared_brews?id=eq.${a2}`, { method: 'DELETE', token: A.token });
  check('改回只有我：留言全刪', !(await exists(eOnA2.id)));

  /* ===== 刪除帳號（Edge Function delete-account） ===== */
  const aMain = await comment(A, A, a1, 'A 主留言');
  const eReply = await comment(E, A, a1, 'E 回覆 A', { parent_id: aMain.id });
  const aAtE = await comment(A, A, a1, 'A 回覆 E', { parent_id: aMain.id, reply_to_user: E.id });
  check('（刪除帳號前的留言都成功）', [aMain, eReply, aAtE].every(ok));
  const del = await call('/functions/v1/delete-account', { method: 'POST', headers: { Authorization: `Bearer ${E.token}` } });
  check('E 刪除帳號', del.status === 200 && del.json?.deleted === true, del.text);
  check('刪除帳號：E 的留言刪除', !(await exists(eReply.id)));
  const [atE] = await adminRows(`comments?select=reply_to_user,reply_to_nickname&id=eq.${aAtE.id}`);
  check('刪除帳號：@E 的回覆不再留著 E 的 id 與暱稱', atE && atE.reply_to_user === null && atE.reply_to_nickname === null, JSON.stringify(atE));

  /* ===== 每天 100 則 ===== */
  const bulk = (n, prefix) => rest('comments', {
    method: 'POST', token: F.token,
    body: Array.from({ length: n }, (_, i) => ({ brew_owner: A.id, brew_id: a1, body: `${prefix} ${i + 1}` })),
  });
  const over = await bulk(101, '一次塞');
  check('一次新增 101 則被擋下（P0001），一則都沒存', over.json?.code === 'P0001'
    && (await adminRows(`comments?select=id&author=eq.${F.id}`)).length === 0, over.text.slice(0, 100));
  check('F 用完今天的 100 則', (await bulk(100, '第')).status === 201);
  const limit = await comment(F, A, a1, '第 101 則');
  check('第 101 則被擋下（P0001）', limit.code === 'P0001', limit.text);
  check('上限各自計算：A 照樣能留言', ok(await comment(A, A, a1, 'A 不受 F 的上限影響')));
} catch (err) {
  failures.push(`執行錯誤：${err.message}`);
  console.error(err);
} finally {
  await cleanup();
}

summary();
