-- 沖煮熱度圖（20261031100000_brew_activity.sql）
-- 帳號：A 和 B 是好友；D 和 A 是好友但 A 封鎖了 D；C 和 A 沒有關係。在交易裡跑，最後 rollback
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

/* ---------- 測試工具 ---------- */
create schema tests;
grant usage on schema tests to anon, authenticated;
create function tests.login_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function tests.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;
create function tests.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- 台灣時間的今天、以 postgres 身分數某人的資料（不受 RLS 影響）
create function tests.today() returns date language sql as $$ select (now() at time zone 'Asia/Taipei')::date $$;
create function tests.rows_of(uid uuid) returns bigint language sql security definer as $$
  select count(*) from public.brew_activity where user_id = uid
$$;
create function tests.cups_of(uid uuid, d date) returns integer language sql security definer as $$
  select cups from public.brew_activity where user_id = uid and day = d
$$;
grant execute on all functions in schema tests to anon, authenticated;

/* ---------- 測試資料 ---------- */
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'b@test.local', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000000', 'c@test.local', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000000', 'd@test.local', 'authenticated', 'authenticated');
insert into public.profiles (id, nickname) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Alice'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Bob'),
  ('cccccccc-0000-0000-0000-000000000000', 'Carol'),
  ('dddddddd-0000-0000-0000-000000000000', 'Dave');
insert into public.friendships (requester, addressee, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'accepted'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000', 'accepted');
insert into public.blocks (blocker, blocked) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000');

/* ========== 結構 ========== */
select has_table('public', 'brew_activity', '有 brew_activity');
select has_table('public', 'activity_shares', '有 activity_shares');
select col_is_pk('public', 'brew_activity', array['user_id', 'day'], '主鍵是 (user_id, day)');
select ok((select relrowsecurity from pg_class where oid = 'public.brew_activity'::regclass), 'brew_activity 開了 RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.activity_shares'::regclass), 'activity_shares 開了 RLS');

/* ========== 沒開啟：不能上傳 ========== */
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select throws_ok($$ insert into public.brew_activity (day, cups) values (tests.today(), 2) $$,
  '42501', null, '還沒開啟：不能新增');

/* ========== 開啟後：範圍檢查 ========== */
select lives_ok($$ insert into public.activity_shares (device_id) values ('11111111-0000-0000-0000-000000000000') $$, 'A 開啟');
select lives_ok($$ insert into public.brew_activity (day, cups) values (tests.today(), 2) $$, '今天 2 杯可以');
select lives_ok($$ insert into public.brew_activity (day, cups) values (tests.today() - 364, 50) $$, '364 天前（近一年的第一天）、50 杯可以');
select throws_ok($$ insert into public.brew_activity (day, cups) values (tests.today() - 365, 1) $$,
  '23514', null, '365 天前（超過一年）被拒絕');
select throws_ok($$ insert into public.brew_activity (day, cups) values (tests.today() + 1, 1) $$,
  '23514', null, '明天（未來）被拒絕');
select throws_ok($$ insert into public.brew_activity (day, cups) values (tests.today() - 1, 0) $$,
  '23514', null, 'cups 0 被拒絕（沒沖的日子不存）');
select throws_ok($$ insert into public.brew_activity (day, cups) values (tests.today() - 1, 51) $$,
  '23514', null, 'cups 51 被拒絕');
select throws_ok($$ insert into public.brew_activity (user_id, day, cups) values ('bbbbbbbb-0000-0000-0000-000000000000', tests.today() - 2, 1) $$,
  '42501', null, '不能指定 user_id（不能寫成別人的）');
select lives_ok($$ insert into public.brew_activity (day, cups) values (tests.today() - 1, 3)
  on conflict (user_id, day) do update set day = excluded.day, cups = excluded.cups $$, 'upsert 新的一天可以');
select lives_ok($$ insert into public.brew_activity (day, cups) values (tests.today(), 4)
  on conflict (user_id, day) do update set day = excluded.day, cups = excluded.cups $$, 'upsert 已有的一天：改杯數');
select is(tests.cups_of('aaaaaaaa-0000-0000-0000-000000000000', tests.today()), 4, 'upsert 後今天是 4 杯');
select throws_ok($$ update public.brew_activity set day = tests.today() - 10 where day = tests.today() $$,
  '23514', null, '不能改日期');
select throws_ok($$ update public.brew_activity set cups = 0 where day = tests.today() $$,
  '23514', null, '不能改成 0 杯');
select is(tests.rows_of('aaaaaaaa-0000-0000-0000-000000000000'), 3::bigint, 'A 有 3 天的資料');

/* ========== 讀取：本人、好友讀得到；非好友、封鎖讀不到 ========== */
select is((select count(*) from public.brew_activity where user_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 3::bigint, 'A 讀得到自己的');

select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from public.brew_activity where user_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 3::bigint, '好友 B 讀得到 A 的');
select is((select count(*) from public.activity_shares), 0::bigint, '好友 B 讀不到 A 的開關（也看不到 device_id）');
select is_empty($$ update public.brew_activity set cups = 9 where user_id = 'aaaaaaaa-0000-0000-0000-000000000000' returning 1 $$,
  'B 改不了 A 的杯數');
select is_empty($$ delete from public.brew_activity where user_id = 'aaaaaaaa-0000-0000-0000-000000000000' returning 1 $$,
  'B 刪不了 A 的資料');
select is_empty($$ delete from public.activity_shares where user_id = 'aaaaaaaa-0000-0000-0000-000000000000' returning 1 $$,
  'B 關不了 A 的開關');
select throws_ok($$ insert into public.brew_activity (day, cups) values (tests.today(), 1) $$,
  '42501', null, 'B 自己沒開啟：不能新增');
select is(tests.rows_of('aaaaaaaa-0000-0000-0000-000000000000'), 3::bigint, 'A 的資料沒被 B 動到');
select is(tests.cups_of('aaaaaaaa-0000-0000-0000-000000000000', tests.today()), 4, 'A 的杯數沒被 B 改');

select tests.login_as('cccccccc-0000-0000-0000-000000000000');
select is((select count(*) from public.brew_activity), 0::bigint, '非好友 C 讀不到');

select tests.login_as('dddddddd-0000-0000-0000-000000000000');
select is((select count(*) from public.brew_activity), 0::bigint, '被 A 封鎖的好友 D 讀不到');

select tests.logout();
select throws_ok($$ select count(*) from public.brew_activity $$, '42501', null, '沒登入：不能讀');
select throws_ok($$ select count(*) from public.activity_shares $$, '42501', null, '沒登入：不能讀開關');

/* ========== 換裝置、關閉 ========== */
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ update public.activity_shares set device_id = '22222222-0000-0000-0000-000000000000' $$, '改由另一台裝置上傳');
select is((select device_id from public.activity_shares), '22222222-0000-0000-0000-000000000000'::uuid, '本人讀得到負責的裝置');
select is(tests.rows_of('aaaaaaaa-0000-0000-0000-000000000000'), 3::bigint, '換裝置不會清掉資料');
select lives_ok($$ delete from public.activity_shares $$, 'A 關閉');
select is(tests.rows_of('aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint, '關閉後雲端清空');
select throws_ok($$ insert into public.brew_activity (day, cups) values (tests.today(), 1) $$,
  '42501', null, '關閉後不能再新增');

/* ========== 刪除帳號：cascade ========== */
select lives_ok($$ insert into public.activity_shares (device_id) values ('11111111-0000-0000-0000-000000000000') $$, 'A 再開啟');
select lives_ok($$ insert into public.brew_activity (day, cups) values (tests.today(), 1) $$, 'A 再上傳');
select tests.as_admin();
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select is(tests.rows_of('aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint, '刪除帳號：熱度圖資料一起刪除');
select is((select count(*) from public.activity_shares where user_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint, '刪除帳號：開關一起刪除');

select * from finish();
rollback;
