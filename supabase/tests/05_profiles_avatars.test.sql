-- 頭像與封鎖名單（docs/social-spec.md 階段 3）
-- 帳號：A 和 B 是好友；D 對 A 送了邀請（待處理）；C 和 A 沒有關係。在交易裡跑，最後 rollback
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
create function tests.avatar_count(object_name text) returns bigint language sql security definer as $$
  select count(*) from storage.objects where bucket_id = 'avatars' and name = object_name
$$;
select set_config('storage.allow_delete_query', 'true', true);

/* ---------- bucket 設定 ---------- */
select is((select public from storage.buckets where id = 'avatars'), false, 'avatars bucket 是私有的');
select is((select file_size_limit from storage.buckets where id = 'avatars'), 102400::bigint, '頭像上限 100KB');
select is((select allowed_mime_types from storage.buckets where id = 'avatars'), array['image/jpeg'], '頭像只允許 image/jpeg');
select is((select count(*) from pg_policy where polrelid = 'storage.objects'::regclass
  and polname like 'avatars:%'), 4::bigint, 'avatars 有 4 條政策');
select is((select count(*) from pg_policy where polrelid = 'storage.objects'::regclass
  and polname like 'avatars:%' and polroles <> array['authenticated'::regrole]::oid[]), 0::bigint,
  'avatars 政策只給 authenticated');

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
  ('dddddddd-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'pending');

/* ========== avatar_path 只能指向自己的 <id>/avatar.jpg ========== */
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select throws_ok($$ update public.profiles set avatar_path = 'bbbbbbbb-0000-0000-0000-000000000000/avatar.jpg'
  where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$, '23514', null, 'avatar_path 不能指向別人的頭像');
select throws_ok($$ update public.profiles set avatar_path = 'aaaaaaaa-0000-0000-0000-000000000000/x.jpg'
  where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$, '23514', null, 'avatar_path 檔名只能是 avatar.jpg');
select lives_ok($$ update public.profiles set avatar_path = 'aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg'
  where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$, 'A 設定自己的 avatar_path');
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
update public.profiles set avatar_path = null where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.as_admin();
select is((select avatar_path from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000000'),
  'aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg', 'B 改不到 A 的 avatar_path');

/* ========== 上傳 ========== */
select tests.logout();
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('avatars', 'aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg') $$, '42501', null, '未登入：不能上傳頭像');

select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ insert into storage.objects (bucket_id, name)
  values ('avatars', 'aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg') $$, 'A 上傳自己的頭像');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('avatars', 'bbbbbbbb-0000-0000-0000-000000000000/avatar.jpg') $$, '42501', null, 'A 不能上傳 B 的頭像');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('avatars', 'aaaaaaaa-0000-0000-0000-000000000000/other.jpg') $$, '42501', null, '頭像檔名只能是 avatar.jpg（不能把 bucket 當硬碟）');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('avatars', 'aaaaaaaa-0000-0000-0000-000000000000/x/avatar.jpg') $$, '42501', null, '頭像不能放在子資料夾');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('avatars', 'aaaaaaaa-0000-0000-0000-000000000000/../bbbbbbbb-0000-0000-0000-000000000000/avatar.jpg') $$,
  '42501', null, '頭像路徑不能用 .. 跳到別人的資料夾');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('brew-photos', 'aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg') $$, '42501', null,
  '頭像政策不會開放 brew-photos bucket');
select throws_ok($$ update storage.objects set name = 'bbbbbbbb-0000-0000-0000-000000000000/avatar.jpg'
  where bucket_id = 'avatars' and name = 'aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg' $$,
  '42501', null, 'A 不能把頭像搬到 B 的路徑');

select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select lives_ok($$ insert into storage.objects (bucket_id, name)
  values ('avatars', 'bbbbbbbb-0000-0000-0000-000000000000/avatar.jpg') $$, 'B 上傳自己的頭像');
update public.profiles set avatar_path = 'bbbbbbbb-0000-0000-0000-000000000000/avatar.jpg'
  where id = 'bbbbbbbb-0000-0000-0000-000000000000';

/* ========== 誰讀得到 A 的頭像 ========== */
select tests.logout();
select is((select count(*) from storage.objects where bucket_id = 'avatars'), 0::bigint, '未登入：讀不到任何頭像');

select tests.login_as('cccccccc-0000-0000-0000-000000000000');
select is((select count(*) from storage.objects where bucket_id = 'avatars'), 0::bigint, 'C（沒有關係）讀不到任何頭像');

select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is(tests.avatar_count('aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg'), 1::bigint, '（A 的頭像確實存在）');
select is((select count(*) from storage.objects where bucket_id = 'avatars'
  and name = 'aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg'), 1::bigint, 'B（好友）讀得到 A 的頭像');

select tests.login_as('dddddddd-0000-0000-0000-000000000000');
select is((select count(*) from storage.objects where bucket_id = 'avatars'
  and name = 'aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg'), 1::bigint, 'D（待處理邀請的對方）讀得到 A 的頭像');
select is((select count(*) from storage.objects where bucket_id = 'avatars'
  and name like 'bbbbbbbb-0000-0000-0000-000000000000/%'), 0::bigint, 'D 讀不到 B 的頭像（D 和 B 沒有關係）');

/* ========== B 不能改、刪 A 的頭像 ========== */
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select lives_ok($$ update storage.objects set metadata = '{"hacked": true}'
  where bucket_id = 'avatars' and name = 'aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg' $$,
  'B 嘗試覆蓋 A 的頭像（改不到任何一列）');
select lives_ok($$ delete from storage.objects
  where bucket_id = 'avatars' and name = 'aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg' $$,
  'B 嘗試刪除 A 的頭像（刪不到任何一列）');
select tests.as_admin();
select is((select metadata from storage.objects where bucket_id = 'avatars'
  and name = 'aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg'), null, 'A 的頭像沒被 B 改到');
select is(tests.avatar_count('aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg'), 1::bigint, 'A 的頭像沒被 B 刪掉');

/* ========== 移除頭像、封鎖 ========== */
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
update public.profiles set avatar_path = null where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from storage.objects where bucket_id = 'avatars'
  and name like 'aaaaaaaa-0000-0000-0000-000000000000/%'), 0::bigint, 'A 移除頭像後，B 立刻讀不到（檔案還沒刪也一樣）');
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
update public.profiles set avatar_path = 'aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg'
  where id = 'aaaaaaaa-0000-0000-0000-000000000000';

-- A 封鎖 B：前端傳的暱稱會被覆蓋成 B 當下的暱稱
select throws_ok($$ insert into public.blocks (blocker, blocked, blocked_nickname)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', '亂寫的') $$,
  '42501', null, '不能自己指定封鎖名單的暱稱（沒開放這個欄位）');
insert into public.blocks (blocker, blocked)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000');
select is((select blocked_nickname from public.blocks where blocked = 'bbbbbbbb-0000-0000-0000-000000000000'), 'Bob',
  '封鎖名單記下 B 的暱稱');
select is((select count(*) from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000000'), 0::bigint,
  '封鎖後 A 讀不到 B 的 profile（所以才需要記下暱稱）');
select is((select count(*) from storage.objects where bucket_id = 'avatars'
  and name like 'bbbbbbbb-0000-0000-0000-000000000000/%'), 0::bigint, '封鎖後 A 讀不到 B 的頭像');
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from storage.objects where bucket_id = 'avatars'
  and name like 'aaaaaaaa-0000-0000-0000-000000000000/%'), 0::bigint, '封鎖後 B 讀不到 A 的頭像');
select is((select count(*) from public.blocks), 0::bigint, 'B 讀不到封鎖紀錄（也就看不到 A 記下的暱稱）');
-- 之後 B 改暱稱，封鎖名單不會跟著變（只是當下的快照）
update public.profiles set nickname = 'Bobby' where id = 'bbbbbbbb-0000-0000-0000-000000000000';
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select is((select blocked_nickname from public.blocks where blocked = 'bbbbbbbb-0000-0000-0000-000000000000'), 'Bob',
  'B 之後改暱稱，封鎖名單不受影響');

/* ========== 本人可以刪自己的頭像 ========== */
select lives_ok($$ delete from storage.objects
  where bucket_id = 'avatars' and name = 'aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg' $$, 'A 刪除自己的頭像');
select is(tests.avatar_count('aaaaaaaa-0000-0000-0000-000000000000/avatar.jpg'), 0::bigint, 'A 的頭像已刪除');

select * from finish();
rollback;
