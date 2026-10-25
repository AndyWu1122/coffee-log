-- 照片 Storage 的權限（docs/social-spec.md 階段 2）
-- 直接對 storage.objects 測 RLS：Storage API 也是以使用者身分（authenticated + JWT claims）查這張表
-- 帳號：A 和 B 是好友，C 不是。在交易裡跑，最後 rollback
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
-- 以管理者身分查照片是否還在、名稱是什麼（不受 RLS 影響）
create function tests.object_count(object_name text) returns bigint language sql security definer as $$
  select count(*) from storage.objects where bucket_id = 'brew-photos' and name = object_name
$$;
-- Supabase 的 protect_delete trigger 擋住 SQL 直接刪除；測試刪除政策時打開（RLS 照樣套用）
select set_config('storage.allow_delete_query', 'true', true);

/* ---------- bucket 設定 ---------- */
select is((select public from storage.buckets where id = 'brew-photos'), false, 'bucket 是私有的');
select is((select file_size_limit from storage.buckets where id = 'brew-photos'), 1048576::bigint, '單檔上限 1MB');
select is((select allowed_mime_types from storage.buckets where id = 'brew-photos'), array['image/jpeg'],
  '只允許 image/jpeg');
select ok((select relrowsecurity from pg_class where oid = 'storage.objects'::regclass), 'storage.objects 開了 RLS');
select is((select count(*) from pg_policy where polrelid = 'storage.objects'::regclass
  and polname like 'brew-photos:%'), 6::bigint, 'brew-photos 有 6 條政策（讀、傳、覆蓋、刪，開發者讀、刪）');
select is((select count(*) from pg_policy where polrelid = 'storage.objects'::regclass
  and polname like 'brew-photos:%' and polroles <> array['authenticated'::regrole]::oid[]), 0::bigint,
  '政策只給 authenticated（anon 什麼都不能做）');

/* ---------- 測試資料 ---------- */
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'b@test.local', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000000', 'c@test.local', 'authenticated', 'authenticated');
insert into public.profiles (id, nickname) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Alice'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Bob'),
  ('cccccccc-0000-0000-0000-000000000000', 'Carol');
insert into public.friendships (requester, addressee, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'accepted');
-- A1：有照片；A2：沒有照片；B1：B 自己的、有照片
insert into public.shared_brews (owner, id, bean_name, brewed_at, coffee_g, water_g, photo_path) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', '耶加雪菲',
   now() - interval '1 day', 15, 240,
   'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', '肯亞',
   now() - interval '1 day', 15, 240, null),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000001', '哥倫比亞',
   now() - interval '1 day', 15, 240,
   'bbbbbbbb-0000-0000-0000-000000000000/b0000000-0000-0000-0000-000000000001.jpg');

/* ========== 未登入 ========== */
select tests.logout();
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('brew-photos', 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg') $$,
  '42501', null, '未登入：不能上傳');

/* ========== A 上傳自己的照片 ========== */
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ insert into storage.objects (bucket_id, name)
  values ('brew-photos', 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg') $$,
  'A 能上傳自己紀錄的照片');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('brew-photos', 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000002.jpg') $$,
  '42501', null, '紀錄沒有指定照片（photo_path 是 null）時不能上傳');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('brew-photos', 'aaaaaaaa-0000-0000-0000-000000000000/' || gen_random_uuid() || '.jpg') $$,
  '42501', null, '沒有對應紀錄時不能上傳（不能把 bucket 當硬碟）');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('brew-photos', 'bbbbbbbb-0000-0000-0000-000000000000/b0000000-0000-0000-0000-000000000001.jpg') $$,
  '42501', null, 'A 不能上傳到 B 的資料夾');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('brew-photos', 'bbbbbbbb-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg') $$,
  '42501', null, 'A 不能用自己的紀錄 id 上傳到 B 的資料夾');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('brew-photos', 'aaaaaaaa-0000-0000-0000-000000000000/../bbbbbbbb-0000-0000-0000-000000000000/b0000000-0000-0000-0000-000000000001.jpg') $$,
  '42501', null, '路徑不能用 .. 跳到別人的資料夾');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('brew-photos', 'aaaaaaaa-0000-0000-0000-000000000000/x/a0000000-0000-0000-0000-000000000001.jpg') $$,
  '42501', null, '不能放在子資料夾');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('brew-photos', 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.png') $$,
  '42501', null, '副檔名只能是 .jpg');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('brew-photos', 'AAAAAAAA-0000-0000-0000-000000000000/A0000000-0000-0000-0000-000000000001.jpg') $$,
  '42501', null, '大寫的同一個 id 也不行（路徑必須完全一致）');

select lives_ok($$ update storage.objects set metadata = '{"size": 1}'
  where name = 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg' $$,
  'A 能覆蓋自己的照片');
select throws_ok($$ update storage.objects
  set name = 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000002.jpg'
  where name = 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg' $$,
  '42501', null, 'A 不能把照片改名到紀錄沒指定的路徑');
select throws_ok($$ update storage.objects
  set name = 'bbbbbbbb-0000-0000-0000-000000000000/b0000000-0000-0000-0000-000000000001.jpg'
  where name = 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg' $$,
  '42501', null, 'A 不能把照片搬到 B 的資料夾');

-- B 也上傳自己的照片（之後確認 A 動不了）
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select lives_ok($$ insert into storage.objects (bucket_id, name)
  values ('brew-photos', 'bbbbbbbb-0000-0000-0000-000000000000/b0000000-0000-0000-0000-000000000001.jpg') $$,
  'B 能上傳自己紀錄的照片');

/* ========== 誰讀得到 A 的照片 ========== */
select tests.logout();
select is((select count(*) from storage.objects where bucket_id = 'brew-photos'), 0::bigint, '未登入：讀不到任何照片');

select tests.login_as('cccccccc-0000-0000-0000-000000000000');
select is((select count(*) from storage.objects where bucket_id = 'brew-photos'), 0::bigint,
  'C（不是好友）讀不到 A、B 的照片');

select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from storage.objects
  where name = 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg'), 1::bigint,
  'B（好友）讀得到 A 的照片');

/* ========== B 不能修改、刪除 A 的照片 ========== */
select lives_ok($$ update storage.objects set metadata = '{"hacked": true}'
  where name = 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg' $$,
  'B 嘗試覆蓋 A 的照片（RLS 讓它改不到任何一列）');
select tests.as_admin();
select is((select metadata from storage.objects
  where name = 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg'), '{"size": 1}'::jsonb,
  'A 的照片沒被 B 改到');
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select lives_ok($$ delete from storage.objects
  where name = 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg' $$,
  'B 嘗試刪除 A 的照片（RLS 讓它刪不到任何一列）');
select is(tests.object_count('aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg'),
  1::bigint, 'A 的照片沒被 B 刪掉');

select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ delete from storage.objects
  where name = 'bbbbbbbb-0000-0000-0000-000000000000/b0000000-0000-0000-0000-000000000001.jpg' $$,
  'A 嘗試刪除 B 的照片');
select is(tests.object_count('bbbbbbbb-0000-0000-0000-000000000000/b0000000-0000-0000-0000-000000000001.jpg'),
  1::bigint, 'B 的照片沒被 A 刪掉');

/* ========== 照片跟著紀錄走 ========== */
-- A 移除這筆紀錄的照片（photo_path = null）：檔案還在，B 已經讀不到
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
update public.shared_brews set photo_path = null where id = 'a0000000-0000-0000-0000-000000000001';
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from storage.objects where bucket_id = 'brew-photos'
  and name like 'aaaaaaaa-0000-0000-0000-000000000000/%'), 0::bigint, '紀錄移除照片後，好友立刻讀不到（檔案還沒刪也一樣）');
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select is((select count(*) from storage.objects
  where name = 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg'), 1::bigint,
  '本人還讀得到自己資料夾裡的照片（才能清掉）');
update public.shared_brews
  set photo_path = 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg'
  where id = 'a0000000-0000-0000-0000-000000000001';

-- 解除好友：B 讀不到
select tests.as_admin();
delete from public.friendships where requester = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from storage.objects where bucket_id = 'brew-photos'
  and name like 'aaaaaaaa-0000-0000-0000-000000000000/%'), 0::bigint, '解除好友後 B 讀不到 A 的照片');
select tests.as_admin();
insert into public.friendships (requester, addressee, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'accepted');

-- A 封鎖 B：B 讀不到；A 也讀不到 B 的照片
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
insert into public.blocks (blocker, blocked) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from storage.objects where bucket_id = 'brew-photos'
  and name like 'bbbbbbbb-0000-0000-0000-000000000000/%'), 0::bigint, 'A 封鎖 B 之後，A 也讀不到 B 的照片');
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from storage.objects where bucket_id = 'brew-photos'
  and name like 'aaaaaaaa-0000-0000-0000-000000000000/%'), 0::bigint, 'A 封鎖 B 之後，B 讀不到 A 的照片');

-- A 刪除紀錄（改回 private 或刪除）：留下的照片本人還能刪
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
delete from public.shared_brews where id = 'a0000000-0000-0000-0000-000000000001';
select throws_ok($$ update storage.objects set metadata = '{}'
  where name = 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg' $$,
  '42501', null, '紀錄刪除後不能再覆蓋那張照片');
select lives_ok($$ delete from storage.objects
  where name = 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg' $$,
  '紀錄刪除後，本人刪除留下的照片');
select is(tests.object_count('aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg'),
  0::bigint, '留下的照片已刪除');

select * from finish();
rollback;
