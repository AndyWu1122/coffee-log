// 沖煮熱度圖的權限從 API 層測（20261031100000_brew_activity.sql）：用真的 JWT 走 PostgREST
// A、B 好友；C 非好友；D 是 A 的好友但被 A 封鎖
// 確認：沒開啟不能上傳；開啟後 B 讀得到、C／D 讀不到；不能寫別人的；cups 0、51、未來、超過一年被拒絕；
// 好友讀不到開關（device_id）；upsert 只能改杯數、不能改日期；關閉後雲端清空；刪除帳號（delete-account）一起刪除
//
// 用法：先 npx supabase@2.120.0 start，再 node scripts/supabase-activity-test.mjs

import { call, rest, rows, check, summary, setupUsers, cleanup, psql } from './supabase-local.mjs';

/** 台灣時間的日期 YYYY-MM-DD（加減天數） */
const taipei = (offset = 0) => new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const UPSERT = { Prefer: 'resolution=merge-duplicates,return=representation' };
const share = (user, deviceId = crypto.randomUUID()) => rest('activity_shares?on_conflict=user_id', {
  method: 'POST', token: user.token, body: { device_id: deviceId }, headers: { Prefer: 'resolution=merge-duplicates' },
});
const upsert = (user, body) => rest('brew_activity?on_conflict=user_id,day', { method: 'POST', token: user.token, body, headers: UPSERT });
const read = async (viewer, owner) => rows(await rest(`brew_activity?select=day,cups&user_id=eq.${owner.id}&order=day`, { token: viewer.token }));
// 以資料庫擁有者的身分數（不受 RLS 影響）
const countOf = (user) => Number(psql(`select count(*) from public.brew_activity where user_id = '${user.id}'`));

try {
  const { A, B, C, D } = await setupUsers(['A', 'B', 'C', 'D'], [['A', 'B'], ['A', 'D']]);
  await rest('blocks', { method: 'POST', token: A.token, body: { blocked: D.id } });

  /* ===== 沒開啟 ===== */
  const before = await upsert(A, [{ day: taipei(), cups: 1 }]);
  check('還沒開啟：上傳被拒絕（42501）', before.status === 403 && before.json?.code === '42501', `HTTP ${before.status} ${before.text}`);

  /* ===== 開啟、上傳 ===== */
  const on = await share(A);
  check('A 開啟（activity_shares 新增）', on.status === 201, `HTTP ${on.status} ${on.text}`);
  const up = await upsert(A, [{ day: taipei(), cups: 2 }, { day: taipei(-1), cups: 1 }, { day: taipei(-364), cups: 50 }]);
  check('A 上傳 3 天（今天、昨天、364 天前 50 杯）', up.status === 201 && rows(up)?.length === 3, `HTTP ${up.status} ${up.text}`);
  const again = await upsert(A, [{ day: taipei(), cups: 4 }]);
  check('upsert 已有的一天：改杯數', [200, 201].includes(again.status) && rows(again)?.[0]?.cups === 4, `HTTP ${again.status} ${again.text}`);
  check('雲端 A 有 3 天', countOf(A) === 3);

  for (const [name, body] of [
    ['cups 0', { day: taipei(-2), cups: 0 }],
    ['cups 51', { day: taipei(-2), cups: 51 }],
    ['明天（未來）', { day: taipei(1), cups: 1 }],
    ['365 天前（超過一年）', { day: taipei(-365), cups: 1 }],
  ]) {
    const r = await upsert(A, [body]);
    check(`${name}：被資料庫拒絕（23514）`, r.status === 400 && r.json?.code === '23514', `HTTP ${r.status} ${r.text}`);
  }
  const moveDay = await rest(`brew_activity?user_id=eq.${A.id}&day=eq.${taipei()}`, {
    method: 'PATCH', token: A.token, body: { day: taipei(-10) },
  });
  check('不能改日期（23514）', moveDay.status === 400 && moveDay.json?.code === '23514', `HTTP ${moveDay.status} ${moveDay.text}`);
  const asOther = await rest('brew_activity', { method: 'POST', token: A.token, body: { user_id: B.id, day: taipei(-3), cups: 1 } });
  check('不能指定 user_id 寫成別人的（42501）', asOther.status === 401 || asOther.status === 403, `HTTP ${asOther.status} ${asOther.text}`);
  check('雲端 A 還是 3 天、今天 4 杯', countOf(A) === 3 && psql(`select cups from public.brew_activity where user_id = '${A.id}' and day = '${taipei()}'`) === '4');

  /* ===== 讀取 ===== */
  check('A 讀得到自己的 3 天', (await read(A, A))?.length === 3);
  const bSees = await read(B, A);
  check('好友 B 讀得到 A 的 3 天（只有 day、cups）', bSees?.length === 3 && bSees.every((r) => Object.keys(r).join() === 'day,cups'), JSON.stringify(bSees));
  check('非好友 C 讀不到', (await read(C, A))?.length === 0);
  check('被 A 封鎖的好友 D 讀不到', (await read(D, A))?.length === 0);
  const anon = await rest(`brew_activity?select=day&user_id=eq.${A.id}`, {});
  check('沒登入讀不到', anon.status === 401 || rows(anon)?.length === 0, `HTTP ${anon.status}`);
  check('好友 B 讀不到 A 的開關（device_id）', rows(await rest(`activity_shares?select=device_id&user_id=eq.${A.id}`, { token: B.token }))?.length === 0);

  /* ===== 不能動別人的 ===== */
  for (const [name, user] of [['好友 B', B], ['非好友 C', C]]) {
    await rest(`brew_activity?user_id=eq.${A.id}`, { method: 'PATCH', token: user.token, body: { cups: 9 } });
    await rest(`brew_activity?user_id=eq.${A.id}`, { method: 'DELETE', token: user.token });
    await rest(`activity_shares?user_id=eq.${A.id}`, { method: 'DELETE', token: user.token });
    check(`${name}改不了、刪不了 A 的資料，也關不了 A 的開關`,
      countOf(A) === 3 && psql(`select max(cups) from public.brew_activity where user_id = '${A.id}'`) === '50'
        && psql(`select count(*) from public.activity_shares where user_id = '${A.id}'`) === '1');
  }
  const bUpload = await upsert(B, [{ day: taipei(), cups: 1 }]);
  check('B 自己沒開啟：不能上傳', bUpload.status === 403, `HTTP ${bUpload.status}`);

  /* ===== 換裝置、關閉 ===== */
  const device2 = crypto.randomUUID();
  const moved = await share(A, device2);
  check('改由另一台裝置上傳（upsert 開關）', moved.status === 201 || moved.status === 200, `HTTP ${moved.status} ${moved.text}`);
  check('本人讀得到負責的裝置', rows(await rest('activity_shares?select=device_id', { token: A.token }))?.[0]?.device_id === device2);
  check('換裝置不會清掉資料', countOf(A) === 3);
  const off = await rest(`activity_shares?user_id=eq.${A.id}`, { method: 'DELETE', token: A.token });
  check('A 關閉', off.status === 204, `HTTP ${off.status}`);
  check('關閉後雲端清空', countOf(A) === 0);
  check('關閉後 B 讀不到', (await read(B, A))?.length === 0);
  check('關閉後不能再上傳', (await upsert(A, [{ day: taipei(), cups: 1 }])).status === 403);

  /* ===== 刪除帳號（Edge Function delete-account） ===== */
  await share(B);
  await upsert(B, [{ day: taipei(), cups: 3 }]);
  check('（B 開啟並上傳）', countOf(B) === 1);
  const del = await call('/functions/v1/delete-account', { method: 'POST', headers: { Authorization: `Bearer ${B.token}` } });
  check('B 刪除帳號', del.status === 200 && del.json?.deleted === true, del.text);
  check('刪除帳號：熱度圖資料、開關一起刪除',
    countOf(B) === 0 && psql(`select count(*) from public.activity_shares where user_id = '${B.id}'`) === '0');
} catch (err) {
  check(`執行錯誤：${err.message}`, false);
  console.error(err);
} finally {
  await cleanup();
}
summary();
