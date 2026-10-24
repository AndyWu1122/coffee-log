// 從 API 層測試權限（docs/social-spec.md 階段 1）：用真的 JWT 走 Auth → PostgREST → GraphQL
// pgTAP（supabase/tests）測資料庫本身；這裡確認從外部打 API 時同樣擋得住，且 private schema 不會被公開
//
// 用法：先 npx supabase@2.120.0 start，再 node scripts/supabase-api-test.mjs
// 金鑰在執行時從 `supabase status` 讀取，不寫進檔案；只允許連本機，絕不連正式專案

import {
  call, rest, rpc, representation, rows, check, failures, summary, run, users, createUser, cleanup,
} from './supabase-local.mjs';

try {
  for (const name of ['A', 'B', 'C']) await createUser(name);
  const { A, B, C } = users;

  // email 註冊與登入都關閉（只用 Google 登入）
  const login = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: `a-${run}@test.local`, password: 'x' } });
  check('不能用 email 密碼登入', login.status >= 400, `HTTP ${login.status} ${login.json?.error_code ?? ''}`);
  const signup = await call('/auth/v1/signup', { method: 'POST', body: { email: `x-${run}@test.local`, password: 'password123' } });
  check('不能用 email 自行註冊', signup.status >= 400, `HTTP ${signup.status}`);

  /* ----- 建立 profile、成為好友、A 上傳一筆紀錄 ----- */
  for (const [name, u] of Object.entries(users)) {
    const r = await rest('profiles', { method: 'POST', token: u.token, body: { nickname: name }, headers: representation });
    check(`${name} 建立自己的 profile`, r.status === 201, `HTTP ${r.status}`);
  }
  const aCode = rows(await rest('profiles?select=friend_code', { token: A.token }))[0].friend_code;
  check('B 用代碼邀請 A', (await rpc('send_friend_request', { code: aCode }, B.token)).json === 'sent');
  const accept = await rest(`friendships?requester=eq.${B.id}`, {
    method: 'PATCH', token: A.token, body: { status: 'accepted' }, headers: representation,
  });
  check('A 接受邀請', rows(accept)?.[0]?.status === 'accepted', accept.text);

  const brewId = crypto.randomUUID();
  const insert = await rest('shared_brews', {
    method: 'POST', token: A.token, headers: representation,
    body: { id: brewId, bean_name: '耶加雪菲', brewed_at: new Date().toISOString(), coffee_g: 15, water_g: 240, notes: 'A 的筆記' },
  });
  check('A 上傳一筆紀錄', insert.status === 201, `HTTP ${insert.status} ${insert.text.slice(0, 120)}`);
  check('owner 由 auth.uid() 決定', rows(insert)?.[0]?.owner === A.id);

  /* ----- 未登入 ----- */
  for (const table of ['profiles', 'friendships', 'blocks', 'shared_brews', 'likes', 'reports']) {
    const r = await rest(`${table}?select=*`);
    check(`未登入：讀不到 ${table}`, r.status >= 400 || (rows(r) && rows(r).length === 0), `HTTP ${r.status}`);
  }
  const anonRpc = await rpc('send_friend_request', { code: aCode });
  check('未登入：不能送好友邀請', anonRpc.status >= 400, `HTTP ${anonRpc.status}`);

  /* ----- C（不是好友） ----- */
  check('C 讀不到 A 的紀錄', rows(await rest('shared_brews?select=*', { token: C.token }))?.length === 0);
  check('C 讀不到 A 的 profile', rows(await rest(`profiles?id=eq.${A.id}`, { token: C.token }))?.length === 0);
  check('C 只看得到自己的 profile（不能列出所有使用者）', rows(await rest('profiles?select=id', { token: C.token }))?.length === 1);
  const cAccept = await rest(`friendships?requester=eq.${B.id}`, {
    method: 'PATCH', token: C.token, body: { status: 'pending' }, headers: representation,
  });
  check('C 不能改 A 和 B 的好友關係', rows(cAccept)?.length === 0, cAccept.text);

  /* ----- B（好友） ----- */
  check('B 讀得到 A 的紀錄', rows(await rest('shared_brews?select=id', { token: B.token }))?.length === 1);
  const bPatch = await rest(`shared_brews?owner=eq.${A.id}`, {
    method: 'PATCH', token: B.token, body: { notes: 'B 改的' }, headers: representation,
  });
  check('B 不能修改 A 的紀錄', rows(bPatch)?.length === 0, bPatch.text);
  const bDelete = await rest(`shared_brews?owner=eq.${A.id}`, { method: 'DELETE', token: B.token, headers: representation });
  check('B 不能刪除 A 的紀錄', rows(bDelete)?.length === 0, bDelete.text);
  const bForge = await rest('shared_brews', {
    method: 'POST', token: B.token,
    body: { owner: A.id, id: crypto.randomUUID(), bean_name: '冒名', brewed_at: new Date().toISOString(), coffee_g: 15, water_g: 240 },
  });
  check('B 不能用 A 的名義新增紀錄', bForge.status >= 400, `HTTP ${bForge.status}`);
  const aNotes = rows(await rest(`shared_brews?id=eq.${brewId}&select=notes`, { token: A.token }))?.[0]?.notes;
  check('A 的紀錄沒被改', aNotes === 'A 的筆記');

  /* ----- 資料檢查（繞過 App 直接送） ----- */
  const bad = await rest('shared_brews', {
    method: 'POST', token: B.token,
    body: { id: crypto.randomUUID(), bean_name: 'x', brewed_at: new Date().toISOString(), coffee_g: 15, water_g: 240, rating: 99 },
  });
  check('評分 99 被拒絕', bad.status >= 400 && bad.json?.code === '23514', `${bad.status} ${bad.json?.code}`);
  const longNotes = await rest('shared_brews', {
    method: 'POST', token: B.token,
    body: { id: crypto.randomUUID(), bean_name: 'x', brewed_at: new Date().toISOString(), coffee_g: 15, water_g: 240, notes: '字'.repeat(501) },
  });
  check('筆記 501 字被拒絕', longNotes.json?.code === '23514', `${longNotes.status} ${longNotes.json?.code}`);

  /* ----- private schema 不會從 API 公開 ----- */
  const priv = await rest('rate_events?select=*', { token: C.token, headers: { 'Accept-Profile': 'private' } });
  check('API 讀不到 private schema 的表', priv.status >= 400, `HTTP ${priv.status} ${priv.json?.message ?? ''}`);
  const privRpc = await call('/rest/v1/rpc/count_today', {
    method: 'POST', token: C.token, body: { uid: A.id, event_kind: 'brew_insert' }, headers: { 'Content-Profile': 'private' },
  });
  check('API 呼叫不到 private 函式', privRpc.status >= 400, `HTTP ${privRpc.status}`);
  const pubCount = await rpc('count_today', { uid: A.id, event_kind: 'brew_insert' }, C.token);
  check('public 下也沒有內部函式', pubCount.status >= 400, `HTTP ${pubCount.status}`);
  const gql = await call('/graphql/v1', {
    method: 'POST', token: C.token,
    body: { query: '{ __schema { queryType { fields { name } } mutationType { fields { name } } } }' },
  });
  const gqlText = gql.text.toLowerCase();
  check('GraphQL 沒有公開 private 的表或函式',
    !['rate_events', 'can_view', 'count_today', 'profile_visible', 'new_friend_code'].some((n) => gqlText.includes(n)),
    `HTTP ${gql.status}`);

  /* ----- 偽造的 token ----- */
  const [h, p] = C.token.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  const forged = `${h}.${Buffer.from(JSON.stringify({ ...payload, sub: A.id })).toString('base64url')}.invalidsignature`;
  const forgedRead = await rest('shared_brews?select=*', { token: forged });
  check('改過內容的 token（冒充 A）被拒絕', forgedRead.status === 401, `HTTP ${forgedRead.status}`);

  /* ----- A 封鎖 B ----- */
  const block = await rest('blocks', { method: 'POST', token: A.token, body: { blocked: B.id } });
  check('A 封鎖 B', block.status === 201, `HTTP ${block.status} ${block.text}`);
  check('封鎖後 B 讀不到 A 的紀錄', rows(await rest('shared_brews?select=*', { token: B.token }))?.length === 0);
  check('封鎖後 B 讀不到 A 的 profile', rows(await rest(`profiles?id=eq.${A.id}`, { token: B.token }))?.length === 0);
  check('B 看不到自己被封鎖', rows(await rest('blocks?select=*', { token: B.token }))?.length === 0);
  check('被封鎖的 B 再邀請只會得到 not_found', (await rpc('send_friend_request', { code: aCode }, B.token)).json === 'not_found');
} catch (err) {
  failures.push(`執行錯誤：${err.message}`);
  console.error(err);
} finally {
  await cleanup();
}

summary();
