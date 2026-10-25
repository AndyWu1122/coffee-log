// 開發者後台：從 API 層（PostgREST、Storage、Edge Function admin-delete-user）測權限，用真的 JWT
// pgTAP（supabase/tests/09_admin.test.sql）測資料庫本身；這裡確認從外部打 API 時同樣擋得住
// M、N 是開發者（直接在資料庫加進 private.admins，和站長在 SQL Editor 做的一樣）；A、B 好友；C 是要被刪的帳號；U 是一般使用者
//
// 用法：先 npx supabase@2.120.0 start，再 node scripts/admin-api-test.mjs

import { execFileSync } from 'node:child_process';
import {
  call, rest, rpc, rows, check, summary, setupUsers, cleanup, insertBrew, serviceKey, realSession,
  uploadPhoto, photoExists, signPhoto, photoPath, avatarPath, AVATARS,
} from './supabase-local.mjs';

const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const adminRows = async (pathAndQuery) => rows(await rest(pathAndQuery, { headers: admin })) ?? [];
const TINY_JPEG = Uint8Array.from(Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
));
const denied = (r) => r.status === 401 || r.status === 403;
const deleteUser = (token, body) => call('/functions/v1/admin-delete-user', {
  method: 'POST', body, headers: token ? { Authorization: `Bearer ${token}` } : {},
});

/** 在資料庫直接加開發者（只連本機的 Docker 容器） */
function makeAdmin(user) {
  execFileSync('docker', ['exec', 'supabase_db_coffee-log', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
    `insert into private.admins (user_id) values ('${user.id}')`], { stdio: 'ignore' });
}

const ADMIN_RPCS = [
  ['admin_list_users', {}], ['admin_user_detail', { uid: crypto.randomUUID() }], ['admin_list_posts', {}],
  ['admin_post_detail', { p_owner: crypto.randomUUID(), p_id: crypto.randomUUID() }], ['admin_list_reports', {}],
  ['admin_list_feedback', {}], ['admin_list_audit', {}],
  ['admin_delete_comment', { comment_id: crypto.randomUUID(), reason: 'x' }],
  ['admin_delete_post', { p_owner: crypto.randomUUID(), p_id: crypto.randomUUID(), reason: 'x' }],
  ['admin_begin_delete_user', { target: crypto.randomUUID(), reason: 'x' }],
];

try {
  const { M, N, A, B, C, U } = await setupUsers(['M', 'N', 'A', 'B', 'C', 'U'], [['A', 'B'], ['A', 'C']]);
  makeAdmin(M);
  makeAdmin(N);

  // A 有一篇有照片的貼文，B 留言；C 有貼文、照片、頭像、留言、讚
  const a1 = await insertBrew(A);
  check('（A 上傳照片）', (await uploadPhoto(A.token, photoPath(A.id, a1), TINY_JPEG)).status === 200);
  const bComment = rows(await rest('comments', {
    method: 'POST', token: B.token, headers: { Prefer: 'return=representation' },
    body: { brew_owner: A.id, brew_id: a1, body: 'B 的留言' },
  }))?.[0];
  const c1 = await insertBrew(C);
  await uploadPhoto(C.token, photoPath(C.id, c1), TINY_JPEG);
  await rest(`profiles?id=eq.${C.id}`, { method: 'PATCH', token: C.token, body: { avatar_path: avatarPath(C.id) } });
  await uploadPhoto(C.token, avatarPath(C.id), TINY_JPEG, { bucket: AVATARS });
  await rest('comments', { method: 'POST', token: C.token, body: { brew_owner: A.id, brew_id: a1, body: 'C 的留言' } });
  await rest('likes', { method: 'POST', token: C.token, body: { brew_owner: A.id, brew_id: a1 } });
  check('（測試資料都建好了）', Boolean(bComment) && await photoExists(photoPath(C.id, c1)) && await photoExists(avatarPath(C.id), AVATARS));

  /* ===== 沒登入 ===== */
  check('沒登入：am_i_admin 被拒', denied(await rpc('am_i_admin', {})));
  check('沒登入：admin-delete-user 回 401', (await deleteUser(null, { userId: C.id, reason: 'x' })).status === 401);

  /* ===== 一般使用者 U ===== */
  check('一般使用者：am_i_admin 是 false', (await rpc('am_i_admin', {}, U.token)).json === false);
  check('admins 沒有從 API 公開', (await rest('admins', { token: U.token })).status === 404);
  const privateProfile = await rest('admins', { token: U.token, headers: { 'Accept-Profile': 'private', 'Content-Profile': 'private' } });
  check('private schema 不能從 API 指定', privateProfile.status >= 400, `HTTP ${privateProfile.status}`);
  const selfAdd = await rest('admins', {
    method: 'POST', token: U.token, body: { user_id: U.id }, headers: { 'Content-Profile': 'private' },
  });
  check('一般使用者用 API 把自己加進 admins：失敗', selfAdd.status >= 400, `HTTP ${selfAdd.status}`);
  check('（加完仍然不是開發者）', (await rpc('am_i_admin', {}, U.token)).json === false);

  // 用真的 session 把 user_metadata 改成 is_admin，再重新取得 token（新 token 的 claims 會帶這些值）
  const session = await realSession(U);
  const meta = await call('/auth/v1/user', {
    method: 'PUT', token: session.access_token, body: { data: { is_admin: true, role: 'admin', admin: true } },
  });
  check('（一般使用者改得了自己的 user_metadata）', meta.status === 200 && meta.json?.user_metadata?.is_admin === true, meta.text);
  const refreshed = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
  const metaToken = refreshed.json?.access_token;
  check('改了 user_metadata 後：am_i_admin 仍是 false', metaToken && (await rpc('am_i_admin', {}, metaToken)).json === false);
  check('改了 user_metadata 後：後台函式仍被拒', denied(await rpc('admin_list_posts', {}, metaToken)));

  for (const [fn, args] of ADMIN_RPCS) {
    const r = await rpc(fn, args, U.token);
    check(`一般使用者：${fn} 被拒（42501）`, denied(r) && r.json?.code === '42501', `HTTP ${r.status} ${r.json?.code}`);
  }
  check('一般使用者讀不到 audit log', (rows(await rest('admin_audit_log?select=*', { token: U.token })) ?? []).length === 0);
  const forgeLog = await rest('admin_audit_log', { method: 'POST', token: U.token, body: { actor: U.id, action: 'delete_post', reason: '假的' } });
  check('一般使用者不能寫 audit log', denied(forgeLog), `HTTP ${forgeLog.status}`);
  const uDelete = await deleteUser(U.token, { userId: C.id, reason: '我想刪' });
  check('一般使用者呼叫 admin-delete-user：403', uDelete.status === 403, uDelete.text);
  check('（C 還在）', (await call(`/auth/v1/admin/users/${C.id}`, { headers: admin })).status === 200);
  await call('/storage/v1/object/brew-photos', { method: 'DELETE', token: U.token, body: { prefixes: [photoPath(A.id, a1)] } });
  check('一般使用者刪不了別人的照片', await photoExists(photoPath(A.id, a1)));
  check('一般使用者拿不到非好友照片的 signed URL', !(await signPhoto(U.token, photoPath(A.id, a1))).url);

  /* ===== 開發者 M：看得到非好友的內容 ===== */
  check('M：am_i_admin 是 true', (await rpc('am_i_admin', {}, M.token)).json === true);
  check('M 的一般動態牆照常只看好友（讀不到 A 的貼文）', (rows(await rest('shared_brews?select=id', { token: M.token })) ?? []).length === 0);
  const posts = (await rpc('admin_list_posts', { lim: 100 }, M.token)).json ?? [];
  check('後台看得到非好友 A、C 的貼文', [a1, c1].every((id) => posts.some((p) => p.id === id)));
  const detail = (await rpc('admin_post_detail', { p_owner: A.id, p_id: a1 }, M.token)).json;
  check('後台看得到 A 貼文的所有留言', detail?.comments?.length === 2 && detail.comments.some((c) => c.body === 'B 的留言'));
  check('開發者拿得到非好友照片的 signed URL', Boolean((await signPhoto(M.token, photoPath(A.id, a1))).url));
  const users = (await rpc('admin_list_users', { search: 'C' }, M.token)).json ?? [];
  check('用戶列表：C 的貼文數、留言數', users.some((u) => u.id === C.id && u.posts === 1 && u.comments === 1));

  /* ===== 刪留言 ===== */
  const noReason = await rpc('admin_delete_comment', { comment_id: bComment.id, reason: ' ' }, M.token);
  check('沒填原因：被拒', noReason.status >= 400 && noReason.json?.code === '22023');
  const delComment = await rpc('admin_delete_comment', { comment_id: bComment.id, reason: '不友善' }, M.token);
  check('開發者刪除 B 的留言', delComment.status < 300, delComment.text);
  check('（留言已刪除）', (await adminRows(`comments?id=eq.${bComment.id}`)).length === 0);

  /* ===== 刪貼文：照片用 Storage API 一起刪，作者不能再上傳同一筆 ===== */
  const delPost = await rpc('admin_delete_post', { p_owner: A.id, p_id: a1, reason: '廣告' }, M.token);
  check('開發者刪除 A 的貼文，回傳照片路徑', delPost.json === photoPath(A.id, a1), delPost.text);
  const rmPhoto = await call('/storage/v1/object/brew-photos', { method: 'DELETE', token: M.token, body: { prefixes: [delPost.json] } });
  check('開發者用 Storage API 刪掉照片', rmPhoto.status === 200 && !(await photoExists(photoPath(A.id, a1))), rmPhoto.text);
  check('貼文的留言、讚一起刪除', (await adminRows(`comments?brew_id=eq.${a1}`)).length === 0
    && (await adminRows(`likes?brew_id=eq.${a1}`)).length === 0);
  const reinsert = await rest('shared_brews', {
    method: 'POST', token: A.token,
    body: { id: a1, bean_name: '測試豆', brewed_at: new Date().toISOString(), coffee_g: 15, water_g: 240 },
  });
  check('作者不能再上傳被刪的那一筆（23514、hint removed）', reinsert.json?.code === '23514' && reinsert.json?.hint === 'removed', reinsert.text);

  /* ===== 刪帳號（Edge Function admin-delete-user） ===== */
  check('不能刪自己', (await deleteUser(M.token, { userId: M.id, reason: '測試' })).json?.error === 'self');
  check('不能刪其他開發者', (await deleteUser(M.token, { userId: N.id, reason: '測試' })).json?.error === 'admin');
  check('（N 還在、仍是開發者）', (await rpc('am_i_admin', {}, N.token)).json === true);
  check('userId 格式不對：400', (await deleteUser(M.token, { userId: 'not-a-uuid', reason: '測試' })).status === 400);
  check('沒填原因：400', (await deleteUser(M.token, { userId: C.id, reason: '' })).status === 400);
  check('不存在的用戶：404', (await deleteUser(M.token, { userId: crypto.randomUUID(), reason: '測試' })).status === 404);

  const del = await deleteUser(M.token, { userId: C.id, reason: '多次違規' });
  check('開發者刪除 C 的帳號', del.status === 200 && del.json?.deleted === true, del.text);
  check('C 的 auth 使用者已刪除', (await call(`/auth/v1/admin/users/${C.id}`, { headers: admin })).status === 404);
  check('C 的 profile、貼文、留言、讚全部刪除',
    (await adminRows(`profiles?id=eq.${C.id}`)).length === 0 && (await adminRows(`shared_brews?owner=eq.${C.id}`)).length === 0
    && (await adminRows(`comments?author=eq.${C.id}`)).length === 0 && (await adminRows(`likes?user_id=eq.${C.id}`)).length === 0);
  check('C 的照片、頭像全部刪除', !(await photoExists(photoPath(C.id, c1))) && !(await photoExists(avatarPath(C.id), AVATARS)));

  /* ===== 操作紀錄：每個操作都有，無法修改或刪除 ===== */
  const log = rows(await rest(`admin_audit_log?select=*&actor=eq.${M.id}&order=created_at`, { token: M.token })) ?? [];
  const entry = (action, target) => log.find((l) => l.action === action && l.target_user === target);
  check('紀錄：刪留言（對象 B、原因）', entry('delete_comment', B.id)?.reason === '不友善');
  check('紀錄：刪貼文（對象 A、原因）', entry('delete_post', A.id)?.reason === '廣告' && entry('delete_post', A.id)?.target_brew === a1);
  check('紀錄：刪帳號（對象 C、暱稱快照、原因）', entry('delete_user', C.id)?.reason === '多次違規' && entry('delete_user', C.id)?.target_nickname === 'C');
  check('被拒的操作沒有留下紀錄', log.length === 3, `${log.length} 筆`);
  check('其他開發者 N 也讀得到紀錄', (rows(await rest(`admin_audit_log?select=id&actor=eq.${M.id}`, { token: N.token })) ?? []).length === 3);
  check('後台的紀錄列表附操作者暱稱', ((await rpc('admin_list_audit', {}, N.token)).json ?? []).some((l) => l.actor_nickname === 'M'));
  const id = log[0]?.id;
  const patch = await rest(`admin_audit_log?id=eq.${id}`, { method: 'PATCH', token: M.token, body: { reason: '改掉' } });
  check('開發者不能修改紀錄', denied(patch), `HTTP ${patch.status}`);
  const remove = await rest(`admin_audit_log?id=eq.${id}`, { method: 'DELETE', token: M.token });
  check('開發者不能刪除紀錄', denied(remove), `HTTP ${remove.status}`);
  const svcPatch = await rest(`admin_audit_log?id=eq.${id}`, { method: 'PATCH', headers: admin, body: { reason: '改掉' } });
  const svcDelete = await rest(`admin_audit_log?id=eq.${id}`, { method: 'DELETE', headers: admin });
  check('連 service_role 也不能修改、刪除紀錄', svcPatch.status >= 400 && svcDelete.status >= 400, `HTTP ${svcPatch.status} / ${svcDelete.status}`);
  check('（紀錄沒有被改）', (await adminRows(`admin_audit_log?id=eq.${id}`))[0]?.reason === log[0]?.reason);
  check('U 還是讀不到紀錄', (rows(await rest('admin_audit_log?select=*', { token: U.token })) ?? []).length === 0);
} catch (err) {
  check(`執行錯誤：${err.message}`, false);
  console.error(err);
} finally {
  await cleanup();
}

summary();
