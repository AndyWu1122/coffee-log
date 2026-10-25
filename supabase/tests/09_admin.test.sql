-- 開發者後台：名單只在 private.admins、一般使用者什麼都拿不到、開發者看得到所有貼文與留言、
-- 刪除留言／貼文都寫進操作紀錄、紀錄不能改也不能刪、被刪的貼文不能再上傳、不能刪自己或其他開發者
-- M、N 是開發者（和誰都不是好友）；A、B 好友，各有貼文和留言；U 是一般使用者
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create schema tests;
grant usage on schema tests to anon, authenticated;
create function tests.login_as(uid uuid, metadata jsonb default '{}') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated',
    'user_metadata', metadata, 'app_metadata', metadata)::text, true);
end $$;
create function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;
create function tests.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- 不受 RLS 影響的計數（測試用）
create function tests.count_of(q text) returns bigint language plpgsql security definer set search_path = '' as $$
declare n bigint;
begin
  execute q into n;
  return n;
end $$;
grant execute on function tests.count_of(text) to authenticated;

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a@test.local', 'authenticated', 'authenticated', '{}'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'b@test.local', 'authenticated', 'authenticated', '{}'),
  ('99999999-0000-0000-0000-000000000000', 'u@test.local', 'authenticated', 'authenticated', '{"is_admin": true}'),
  ('11111111-0000-0000-0000-000000000000', 'm@test.local', 'authenticated', 'authenticated', '{}'),
  ('22222222-0000-0000-0000-000000000000', 'n@test.local', 'authenticated', 'authenticated', '{}');
insert into public.profiles (id, nickname) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Alice'),
  ('bbbbbbbb-0000-0000-0000-000000000000', '"><svg onload=pwn()>'),
  ('99999999-0000-0000-0000-000000000000', 'User'),
  ('11111111-0000-0000-0000-000000000000', 'Mod'),
  ('22222222-0000-0000-0000-000000000000', 'Mod2');
insert into public.friendships (requester, addressee, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'accepted');
insert into public.shared_brews (owner, id, bean_name, brewed_at, coffee_g, water_g, photo_path) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', 'A 的豆子', now() - interval '1 day', 15, 240,
   'aaaaaaaa-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000000.jpg'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'b1b1b1b1-0000-0000-0000-000000000000', 'B 的豆子', now(), 15, 240, null);
insert into public.comments (id, brew_owner, brew_id, author, body) values
  ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000',
   'bbbbbbbb-0000-0000-0000-000000000000', 'B 的主留言');
insert into public.comments (id, brew_owner, brew_id, author, parent_id, body) values
  ('c0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000001', 'A 回覆 B');
insert into public.comments (id, brew_owner, brew_id, author, body) values
  ('c0000000-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000000', 'b1b1b1b1-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-000000000000', 'A 在 B 的貼文');
insert into public.reports (reporter, brew_owner, brew_id, reason) values
  ('bbbbbbbb-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', 'spam');
insert into public.feedback (author, category, message) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'idea', '想要統計頁');
-- 開發者只能在資料庫直接新增（站長在 SQL Editor 做）
insert into private.admins (user_id) values
  ('11111111-0000-0000-0000-000000000000'), ('22222222-0000-0000-0000-000000000000');

/* ========== 結構 ========== */
select has_table('private', 'admins', 'private.admins 存在');
select has_table('public', 'admin_audit_log', 'admin_audit_log 存在');
select ok((select relrowsecurity from pg_class where oid = 'public.admin_audit_log'::regclass), 'audit log 開了 RLS');
select ok((select relrowsecurity from pg_class where oid = 'private.admins'::regclass), 'admins 開了 RLS');
select ok(not has_function_privilege('anon', 'public.am_i_admin()', 'execute'), 'anon 不能呼叫 am_i_admin');
select ok(not has_function_privilege('anon', 'public.admin_list_users(text, integer, integer)', 'execute'), 'anon 不能呼叫 admin_list_users');
select ok(not has_function_privilege('authenticated', 'private.require_admin()', 'execute'), '一般角色不能直接呼叫 require_admin');
select ok(not has_table_privilege('authenticated', 'private.admins', 'select'), 'authenticated 沒有 admins 的 select 權限');
select ok(not has_table_privilege('authenticated', 'private.admins', 'insert'), 'authenticated 沒有 admins 的 insert 權限');
select ok(not has_table_privilege('authenticated', 'public.admin_audit_log', 'insert'), '沒有 audit log 的 insert 權限');
select ok(not has_table_privilege('authenticated', 'public.admin_audit_log', 'update'), '沒有 audit log 的 update 權限');
select ok(not has_table_privilege('authenticated', 'public.admin_audit_log', 'delete'), '沒有 audit log 的 delete 權限');
select is((select prosecdef from pg_proc where oid = 'private.is_admin()'::regprocedure), true, 'is_admin 是 security definer');
select ok((select proconfig from pg_proc where oid = 'private.is_admin()'::regprocedure) @> array['search_path=""'],
  'is_admin 設了 search_path');
select is((select pronargs::int from pg_proc where oid = 'private.is_admin()'::regprocedure), 0, 'is_admin 不接受任何參數');

/* ========== 沒登入 ========== */
select tests.as_anon();
select throws_ok($$ select public.am_i_admin() $$, '42501', null, '沒登入：不能呼叫 am_i_admin');
select throws_ok($$ select * from public.admin_audit_log $$, '42501', null, '沒登入：讀不到 audit log');
select throws_ok($$ select public.admin_list_posts() $$, '42501', null, '沒登入：不能呼叫後台函式');

/* ========== 一般使用者：什麼都拿不到 ========== */
-- U 的 user_metadata、app_metadata 都寫了 is_admin: true，照樣不是開發者
select tests.login_as('99999999-0000-0000-0000-000000000000', '{"is_admin": true, "role": "admin"}');
select is(public.am_i_admin(), false, 'user_metadata 寫了 is_admin 也不是開發者');
select throws_ok($$ select * from private.admins $$, '42501', null, '一般使用者讀不到 admins');
select throws_ok($$ insert into private.admins (user_id) values ('99999999-0000-0000-0000-000000000000') $$, '42501', null,
  '一般使用者不能把自己加進 admins');
select is(public.am_i_admin(), false, '仍然不是開發者');
select is((select count(*) from public.admin_audit_log), 0::bigint, '一般使用者讀不到 audit log（沒有資料列）');
select throws_ok($$ insert into public.admin_audit_log (actor, action, reason) values
  ('99999999-0000-0000-0000-000000000000', 'delete_post', '假的') $$, '42501', null, '一般使用者不能寫 audit log');
select throws_ok($$ select * from private.removed_brews $$, '42501', null, '一般使用者讀不到 removed_brews');
select throws_ok($$ select public.admin_list_users() $$, '42501', null, '一般使用者：admin_list_users 被拒');
select throws_ok($$ select public.admin_user_detail('aaaaaaaa-0000-0000-0000-000000000000') $$, '42501', null, '一般使用者：admin_user_detail 被拒');
select throws_ok($$ select public.admin_list_posts() $$, '42501', null, '一般使用者：admin_list_posts 被拒');
select throws_ok($$ select public.admin_post_detail('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000') $$,
  '42501', null, '一般使用者：admin_post_detail 被拒');
select throws_ok($$ select public.admin_list_reports() $$, '42501', null, '一般使用者：admin_list_reports 被拒');
select throws_ok($$ select public.admin_list_feedback() $$, '42501', null, '一般使用者：admin_list_feedback 被拒');
select throws_ok($$ select public.admin_list_audit() $$, '42501', null, '一般使用者：admin_list_audit 被拒');
select throws_ok($$ select public.admin_delete_comment('c0000000-0000-0000-0000-000000000003', '測試') $$, '42501', null,
  '一般使用者：admin_delete_comment 被拒');
select throws_ok($$ select public.admin_delete_post('bbbbbbbb-0000-0000-0000-000000000000', 'b1b1b1b1-0000-0000-0000-000000000000', '測試') $$,
  '42501', null, '一般使用者：admin_delete_post 被拒');
select throws_ok($$ select public.admin_begin_delete_user('aaaaaaaa-0000-0000-0000-000000000000', '測試') $$, '42501', null,
  '一般使用者：admin_begin_delete_user 被拒');
select is(tests.count_of('select count(*) from public.comments'), 3::bigint, '一般使用者的嘗試沒有刪掉任何留言');
select is(tests.count_of('select count(*) from public.admin_audit_log'), 0::bigint, '也沒有留下任何紀錄');

/* ========== 開發者：看得到非好友的內容 ========== */
select tests.login_as('11111111-0000-0000-0000-000000000000');
select is(public.am_i_admin(), true, 'M 是開發者');
select is((select count(*) from public.shared_brews), 0::bigint, '一般 API 讀取照常只看好友（M 的動態牆不會混進所有人的貼文）');
select is((select count(*) from public.comments), 0::bigint, '一般 API 讀不到非好友的留言');
select is(jsonb_array_length(public.admin_list_posts()), 2, '後台看得到所有貼文');
select is(public.admin_list_posts()->0->>'bean_name', 'B 的豆子', '貼文依沖煮時間新→舊');
select is((public.admin_list_posts()->1->>'comments')::int, 2, '貼文附留言數');
select is((public.admin_list_posts()->1->>'reports')::int, 1, '貼文附檢舉數');
select is(jsonb_array_length(public.admin_list_users()), 5, '用戶列表有全部 5 人');
select is((select u->>'nickname' from jsonb_array_elements(public.admin_list_users('SVG')) u), '"><svg onload=pwn()>',
  '搜尋暱稱（不分大小寫，特殊字元當一般文字）');
select is(jsonb_array_length(public.admin_list_users('%')), 0, '搜尋 % 不會變成萬用字元');
select is((select (u->>'reports')::int from jsonb_array_elements(public.admin_list_users('Alice')) u), 1, '用戶附被檢舉次數');
select is((select (u->>'comments')::int from jsonb_array_elements(public.admin_list_users('Alice')) u), 2, '用戶附留言數');
select ok(public.admin_list_users('Mod2')->0 ? 'friend_code' = false, '用戶列表不含好友代碼');
select is(jsonb_array_length(public.admin_user_detail('aaaaaaaa-0000-0000-0000-000000000000')->'posts'), 1, '用戶詳細：他的貼文');
select is(jsonb_array_length(public.admin_user_detail('aaaaaaaa-0000-0000-0000-000000000000')->'comments'), 2, '用戶詳細：他的留言');
select is(public.admin_user_detail('33333333-0000-0000-0000-000000000000'), null, '不存在的用戶：null');
select is(jsonb_array_length(public.admin_post_detail('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000')->'comments'), 2,
  '貼文詳細：全部留言');
select is(jsonb_array_length(public.admin_post_detail('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000')->'reports'), 1,
  '貼文詳細：檢舉');
select is(public.admin_list_reports()->0->>'bean_name', 'A 的豆子', '檢舉列表附被檢舉的貼文');
select is(public.admin_list_feedback()->0->>'nickname', 'Alice', '意見回饋列表附暱稱');
select is(jsonb_array_length(public.admin_list_posts(1000)), 2, '每頁上限不會出錯');

/* ========== 開發者刪除：原因必填 ========== */
select throws_ok($$ select public.admin_delete_comment('c0000000-0000-0000-0000-000000000001', '   ') $$, '22023', null, '沒有填原因');
select throws_ok($$ select public.admin_delete_comment('c0000000-0000-0000-0000-000000000001', repeat('長', 201)) $$, '22023', null,
  '原因超過 200 字');
select throws_ok($$ select public.admin_delete_comment('c0000000-0000-0000-0000-000000000099', '測試') $$, 'P0002', null, '留言不存在');

select lives_ok($$ select public.admin_delete_comment('c0000000-0000-0000-0000-000000000001', '騷擾') $$, '開發者刪除主留言');
select is(tests.count_of($q$select count(*) from public.comments where id in
  ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')$q$), 0::bigint, '主留言和回覆一起刪除');
select is((select row(action, target_user, target_comment, target_nickname, reason, (detail->>'replies')::int)::text
  from public.admin_audit_log where action = 'delete_comment'),
  '(delete_comment,bbbbbbbb-0000-0000-0000-000000000000,c0000000-0000-0000-0000-000000000001,"""><svg onload=pwn()>",騷擾,1)',
  '紀錄：誰的哪則留言、原因、一起刪的回覆數');
select is((select actor from public.admin_audit_log where action = 'delete_comment'), '11111111-0000-0000-0000-000000000000'::uuid,
  '紀錄：操作者是 M（由資料庫決定）');
select ok((select detail::text from public.admin_audit_log where action = 'delete_comment') not like '%主留言%', '紀錄不存被刪的內容');

select is(public.admin_delete_post('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', '廣告'),
  'aaaaaaaa-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000000.jpg', '刪貼文：回傳照片路徑（給前端用 Storage API 刪）');
select is(tests.count_of($q$select count(*) from public.shared_brews where id = 'a1a1a1a1-0000-0000-0000-000000000000'$q$), 0::bigint,
  '貼文已刪除');
select is(tests.count_of($q$select count(*) from public.reports$q$), 0::bigint, '貼文的檢舉 cascade');
select is((select row(action, target_user, target_brew, target_nickname, reason)::text from public.admin_audit_log where action = 'delete_post'),
  '(delete_post,aaaaaaaa-0000-0000-0000-000000000000,a1a1a1a1-0000-0000-0000-000000000000,Alice,廣告)', '紀錄：刪貼文');
select throws_ok($$ select public.admin_delete_post('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', '再刪') $$,
  'P0002', null, '已刪除的貼文：P0002');

/* ========== 刪帳號的檢查 ========== */
select throws_ok($$ select public.admin_begin_delete_user('11111111-0000-0000-0000-000000000000', '測試') $$, '42501', null, '不能刪自己');
select throws_ok($$ select public.admin_begin_delete_user('22222222-0000-0000-0000-000000000000', '測試') $$, '42501', null, '不能刪其他開發者');
select throws_ok($$ select public.admin_begin_delete_user('33333333-0000-0000-0000-000000000000', '測試') $$, 'P0002', null, '不存在的用戶');
select lives_ok($$ select public.admin_begin_delete_user('99999999-0000-0000-0000-000000000000', '冒充開發者') $$, '可以刪一般使用者');
select is((select row(action, target_user, target_nickname)::text from public.admin_audit_log where action = 'delete_user'),
  '(delete_user,99999999-0000-0000-0000-000000000000,User)', '紀錄：刪帳號');
select is(jsonb_array_length(public.admin_list_audit()), 3, '後台看得到 3 筆紀錄');
select is(public.admin_list_audit()->0->>'actor_nickname', 'Mod', '紀錄附操作者暱稱');

/* ========== 紀錄不能改、不能刪（連開發者、資料庫擁有者都不行） ========== */
select is((select count(*) from public.admin_audit_log), 3::bigint, '開發者用一般 API 讀得到紀錄');
select throws_ok($$ update public.admin_audit_log set reason = '改掉' $$, '42501', null, '開發者不能修改紀錄');
select throws_ok($$ delete from public.admin_audit_log $$, '42501', null, '開發者不能刪除紀錄');
select tests.as_admin();
select throws_ok($$ update public.admin_audit_log set reason = '改掉' $$, '42501', null, '資料庫擁有者也不能修改紀錄');
select throws_ok($$ delete from public.admin_audit_log $$, '42501', null, '資料庫擁有者也不能刪除紀錄');
select throws_ok($$ truncate public.admin_audit_log $$, '42501', null, '也不能 truncate');
select is((select count(*) from public.admin_audit_log), 3::bigint, '紀錄都還在');

/* ========== 刪除帳號後紀錄還在（沒有外鍵） ========== */
select lives_ok($$ delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$, '刪除 A 的帳號');
select is((select count(*) from public.admin_audit_log where target_user = 'aaaaaaaa-0000-0000-0000-000000000000'), 1::bigint,
  '對象的帳號刪除後，紀錄還在');

/* ========== 被開發者刪掉的貼文不能再上傳 ========== */
-- A 已刪除，用 B 測：開發者刪 B 的貼文，B 再 insert 同一筆被擋
select tests.login_as('11111111-0000-0000-0000-000000000000');
select lives_ok($$ select public.admin_delete_post('bbbbbbbb-0000-0000-0000-000000000000', 'b1b1b1b1-0000-0000-0000-000000000000', '違規') $$,
  '開發者刪 B 的貼文');
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select throws_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values ('b1b1b1b1-0000-0000-0000-000000000000', 'B 的豆子', now(), 15, 240) $$, '23514', null, 'B 不能再上傳被刪的那一筆');
select lives_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values ('b2b2b2b2-0000-0000-0000-000000000000', 'B 的新紀錄', now(), 15, 240) $$, '其他紀錄照常上傳');

select * from finish();
rollback;
