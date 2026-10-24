-- 意見回饋：只能以自己的名義新增、誰都讀不到、每天 5 則、刪除帳號時一起刪除
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create schema tests;
grant usage on schema tests to anon, authenticated;
create function tests.login_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
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

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'b@test.local', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000000', 'd@test.local', 'authenticated', 'authenticated');
insert into public.profiles (id, nickname) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Alice'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Bob');
-- D 還沒建立 profile

/* ========== 權限 ========== */
select tests.as_anon();
select throws_ok($$ insert into public.feedback (category, message) values ('bug', 'x') $$, '42501', null, '未登入：不能送出回饋');
select throws_ok($$ select * from public.feedback $$, '42501', null, '未登入：讀不到回饋');

select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.feedback (category, message, app_version) values ('bug', '按讚收不回來 <script>', 17) $$,
  'A 送出回饋（author 預設是自己）');
select throws_ok($$ select * from public.feedback $$, '42501', null, '送出的人自己也讀不到回饋');
select throws_ok($$ update public.feedback set message = 'x' $$, '42501', null, '不能修改回饋');
select throws_ok($$ delete from public.feedback $$, '42501', null, '不能刪除回饋');
select throws_ok($$ insert into public.feedback (author, category, message)
  values ('bbbbbbbb-0000-0000-0000-000000000000', 'bug', '冒用 B') $$, '42501', null, '跨帳號：不能以別人的名義送出');
select throws_ok($$ insert into public.feedback (id, category, message)
  values ('eeeeeeee-0000-0000-0000-000000000000', 'bug', 'x') $$, '42501', null, '不能指定 id');
select throws_ok($$ insert into public.feedback (category, message, created_at) values ('bug', 'x', '2000-01-01') $$,
  '42501', null, '不能指定建立時間');

select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select throws_ok($$ select * from public.feedback $$, '42501', null, '跨帳號：B 讀不到 A 的回饋');

select tests.login_as('dddddddd-0000-0000-0000-000000000000');
select throws_ok($$ insert into public.feedback (category, message) values ('bug', 'x') $$, '23503', null,
  '還沒建立 profile：不能送出');

/* ========== 內容限制 ========== */
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select throws_ok($$ insert into public.feedback (category, message) values ('spam', 'x') $$, '23514', null, '類型只能是 bug、idea、other');
select throws_ok($$ insert into public.feedback (category, message) values ('bug', '   ') $$, '23514', null, '內容不能只有空白');
select throws_ok($$ insert into public.feedback (category, message) values ('bug', repeat('あ', 1001)) $$, '23514', null,
  '內容最多 1000 字');
select throws_ok($$ insert into public.feedback (category, message, app_version) values ('bug', 'x', 0) $$, '23514', null,
  '版本號要在合理範圍');
select tests.as_admin();
select is((select count(*) from private.rate_events where user_id = 'bbbbbbbb-0000-0000-0000-000000000000'), 0::bigint,
  '被拒絕的回饋不算次數');

/* ========== 每天 5 則 ========== */
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.feedback (category, message) select 'idea', '第 ' || n || ' 則' from generate_series(1, 4) n $$,
  'B 再送 4 則（含 A 在內共 5 則，各自計算）');
select lives_ok($$ insert into public.feedback (category, message) values ('other', '第 5 則') $$, 'B 的第 5 則');
select throws_ok($$ insert into public.feedback (category, message) values ('other', '第 6 則') $$, 'P0001', null, 'B 的第 6 則被擋下');
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.feedback (category, message) values ('other', 'A 的第 2 則') $$, 'B 的上限不影響 A');

select tests.as_admin();
select is((select count(*) from public.feedback where author = 'bbbbbbbb-0000-0000-0000-000000000000'), 5::bigint, 'B 存下 5 則');
select is((select message from public.feedback where app_version = 17), '按讚收不回來 <script>', '內容原樣保存');
select ok((select created_at > now() - interval '1 minute' from public.feedback where app_version = 17), '建立時間由資料庫決定');

/* ========== 刪除帳號時一起刪除 ========== */
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select is((select count(*) from public.feedback where author = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint,
  '刪除帳號後回饋一起刪除');

select * from finish();
rollback;
