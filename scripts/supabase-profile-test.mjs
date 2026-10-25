// 個人檔案的權限從 API 層測（20261028100000_profile_fields.sql）：用真的 JWT 走 PostgREST
// A、B 好友；C 非好友；D 是 A 的好友但被 A 封鎖；E 對 A 送了邀請（待處理）
// 確認：完整檔案只有本人和沒有封鎖的好友拿得到；新欄位誰都不能直接讀；不能改別人的；長度、行數、控制字元被資料庫拒絕
//
// 用法：先 npx supabase@2.120.0 start，再 node scripts/supabase-profile-test.mjs

import { rest, rpc, rows, check, failures, summary, setupUsers, cleanup, insertBrew } from './supabase-local.mjs';

const detail = async (viewer, target) => (await rpc('profile_detail', { target: target.id }, viewer.token)).json;
const patch = (user, target, body) => rest(`profiles?id=eq.${target.id}`, {
  method: 'PATCH', token: user.token, body, headers: { Prefer: 'return=representation' },
});

try {
  const { A, B, C, D, E } = await setupUsers(['A', 'B', 'C', 'D', 'E'], [['A', 'B'], ['A', 'D']]);
  await rest('blocks', { method: 'POST', token: A.token, body: { blocked: D.id } });
  const aCode = rows(await rest(`profiles?select=friend_code&id=eq.${A.id}`, { token: A.token }))[0].friend_code;
  check('（E 對 A 送出邀請）', (await rpc('send_friend_request', { code: aCode }, E.token)).json === 'sent');
  await insertBrew(A, { withPhoto: false });

  /* ===== 本人修改 ===== */
  const fields = { bio: '手沖愛好者\n住台南', favorite_gear: 'V60 / C40', favorite_beans: '衣索比亞水洗' };
  const own = await rest(`profiles?id=eq.${A.id}&select=id`, { method: 'PATCH', token: A.token, body: fields, headers: { Prefer: 'return=representation' } });
  check('A 改自己的自我介紹、器材、豆子', own.status === 200 && rows(own)?.length === 1, `HTTP ${own.status} ${own.text}`);

  const rejected = [
    ['自我介紹 151 字', { bio: '咖'.repeat(151) }],
    ['自我介紹 6 行', { bio: '1\n2\n3\n4\n5\n6' }],
    ['自我介紹有 tab', { bio: '有\ttab' }],
    ['常用器材 51 字', { favorite_gear: 'V'.repeat(51) }],
    ['常用器材換行', { favorite_gear: 'V60\nC40' }],
    ['喜歡的豆子 51 字', { favorite_beans: '豆'.repeat(51) }],
  ];
  for (const [name, body] of rejected) {
    const r = await rest(`profiles?id=eq.${A.id}`, { method: 'PATCH', token: A.token, body });
    check(`${name}：被資料庫拒絕（23514）`, r.status === 400 && r.json?.code === '23514', `HTTP ${r.status} ${r.json?.code}`);
  }

  /* ===== 不能改別人的 ===== */
  for (const [name, user] of [['好友 B', B], ['非好友 C', C]]) {
    const r = await patch(user, A, { bio: `${name} 改的` });
    check(`${name} 改不到 A 的自我介紹`, r.status >= 400 || rows(r)?.length === 0, `HTTP ${r.status}`);
  }
  check('A 的自我介紹沒被改', (await detail(A, A))?.bio === fields.bio);

  /* ===== 新欄位誰都不能直接讀 ===== */
  for (const [name, user] of [['本人 A', A], ['好友 B', B], ['邀請中的 E', E]]) {
    const r = await rest(`profiles?select=bio,favorite_gear,favorite_beans&id=eq.${A.id}`, { token: user.token });
    check(`${name} 直接讀新欄位：被拒絕`, r.status >= 400, `HTTP ${r.status}`);
  }
  const star = await rest(`profiles?id=eq.${A.id}`, { token: B.token });
  check('select=* 也被拒絕（不會帶出新欄位）', star.status >= 400, `HTTP ${star.status}`);
  check('好友 B 照常讀得到暱稱', rows(await rest(`profiles?select=nickname&id=eq.${A.id}`, { token: B.token }))?.[0]?.nickname === 'A');

  /* ===== profile_detail ===== */
  const b = await detail(B, A);
  check('好友 B 拿得到 A 的完整檔案', b?.bio === fields.bio && b?.favorite_gear === fields.favorite_gear && b?.favorite_beans === fields.favorite_beans);
  check('完整檔案有貼文數、加入日期', b?.posts === 1 && Boolean(b?.created_at), JSON.stringify(b));
  check('完整檔案沒有好友代碼', b && !('friend_code' in b));
  check('非好友 C：null', (await detail(C, A)) === null);
  check('被封鎖的好友 D：null', (await detail(D, A)) === null);
  check('封鎖者 A 也拿不到 D 的', (await detail(A, D)) === null);
  check('邀請中的 E：null', (await detail(E, A)) === null);
  const anon = await rpc('profile_detail', { target: A.id });
  check('未登入：不能呼叫', anon.status >= 400, `HTTP ${anon.status}`);
} catch (err) {
  failures.push(`執行錯誤：${err.message}`);
  console.error(err);
} finally {
  await cleanup();
}

summary();
