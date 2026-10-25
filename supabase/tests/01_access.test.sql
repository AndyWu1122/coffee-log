-- 跨帳號存取（docs/social-spec.md 階段 1 的測試清單）
-- 帳號：A 和 B 是好友，C 不是。每個測試檔都在一個交易裡跑，最後 rollback，不留資料
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

/* ---------- 測試工具：切換身分 ---------- */
create schema tests;
grant usage on schema tests to anon, authenticated;
-- 模擬登入：PostgREST 收到 JWT 時也是這樣設定角色與 claims，auth.uid() 讀的就是 claims.sub
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
create function tests.code_of(uid uuid) returns text language sql security definer as $$
  select friend_code from public.profiles where id = uid
$$;

/* ---------- 測試資料（以管理者身分建立） ---------- */
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
-- A 上傳了一筆 friends 紀錄；A 的 private 紀錄不會上傳，所以雲端只有這一筆
insert into public.shared_brews (owner, id, bean_name, brewed_at, coffee_g, water_g, notes, photo_path) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', '耶加雪菲',
   now() - interval '1 day', 15, 240, 'A 的筆記',
   'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg');

/* ========== 未登入者什麼都讀不到、寫不進去 ========== */
select tests.logout();
select throws_ok('select * from public.profiles', '42501', null, '未登入：讀不到 profiles');
select throws_ok('select * from public.friendships', '42501', null, '未登入：讀不到 friendships');
select throws_ok('select * from public.blocks', '42501', null, '未登入：讀不到 blocks');
select throws_ok('select * from public.shared_brews', '42501', null, '未登入：讀不到 shared_brews');
select throws_ok('select * from public.likes', '42501', null, '未登入：讀不到 likes');
select throws_ok('select * from public.reports', '42501', null, '未登入：讀不到 reports');
select throws_ok($$ insert into public.shared_brews (owner, id, bean_name, brewed_at, coffee_g, water_g)
  values ('aaaaaaaa-0000-0000-0000-000000000000', gen_random_uuid(), 'x', now(), 15, 240) $$,
  '42501', null, '未登入：不能新增紀錄');
select throws_ok($$ select public.send_friend_request('ABCDEFGHJK') $$, '42501', null, '未登入：不能送好友邀請');
select throws_ok($$ select public.regenerate_friend_code() $$, '42501', null, '未登入：不能重設好友代碼');
select throws_ok($$ select private.can_view('aaaaaaaa-0000-0000-0000-000000000000') $$, '42501', null,
  '未登入：不能呼叫內部函式');
select throws_ok($$ select * from private.rate_events $$, '42501', null, '未登入：讀不到內部計數表');

/* ========== C（不是好友）讀不到 A 的任何東西 ========== */
select tests.login_as('cccccccc-0000-0000-0000-000000000000');
select is((select count(*) from public.shared_brews where owner = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint,
  'C 讀不到 A 的紀錄');
select is((select count(*) from public.shared_brews where photo_path is not null), 0::bigint,
  'C 讀不到 A 的照片路徑');
select is((select count(*) from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint,
  'C 讀不到 A 的 profile');
select is((select count(*) from public.profiles), 1::bigint, 'C 只讀得到自己的 profile（不能列出所有使用者）');
select is((select count(*) from public.friendships), 0::bigint, 'C 看不到 A 和 B 的好友關係');
select throws_ok($$ insert into public.likes (brew_owner, brew_id)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'C 不能對 A 的紀錄按讚');
select throws_ok($$ insert into public.reports (brew_owner, brew_id, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'spam') $$,
  '42501', null, 'C 不能檢舉看不到的紀錄');
-- can_view 有 execute 權限（RLS 政策需要），但只回答「目前使用者」能否看 target，不能查別人之間的關係
select is(private.can_view('aaaaaaaa-0000-0000-0000-000000000000'), false, 'C 用 can_view 查 A：false');
select throws_ok($$ select private.count_today('aaaaaaaa-0000-0000-0000-000000000000', 'brew_insert') $$,
  '42501', null, 'C 不能查別人的計數');

/* ========== C 不能自己把好友申請改成 accepted ========== */
select is(public.send_friend_request(tests.code_of('aaaaaaaa-0000-0000-0000-000000000000')), 'sent', 'C 送邀請給 A');
select is_empty($$ update public.friendships set status = 'accepted'
  where requester = 'cccccccc-0000-0000-0000-000000000000' returning 1 $$,
  'C（申請者）不能自己把申請改成 accepted');
select throws_ok($$ insert into public.friendships (requester, addressee, status)
  values ('cccccccc-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'accepted') $$,
  '42501', null, 'C 不能直接新增 accepted 的好友關係');
select throws_ok($$ update public.friendships set addressee = 'cccccccc-0000-0000-0000-000000000000'
  where requester = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  '42501', null, 'C 不能修改別人的好友關係的當事人');
select is_empty($$ update public.friendships set status = 'pending'
  where requester = 'aaaaaaaa-0000-0000-0000-000000000000' returning 1 $$,
  'C 不能改 A 和 B 的好友狀態');
select is_empty($$ delete from public.friendships
  where requester = 'aaaaaaaa-0000-0000-0000-000000000000' returning 1 $$,
  'C 不能刪 A 和 B 的好友關係');
select tests.as_admin();
select is((select status from public.friendships
  where requester = 'cccccccc-0000-0000-0000-000000000000' and addressee = 'aaaaaaaa-0000-0000-0000-000000000000'),
  'pending', 'C 的申請仍是 pending');
select is((select status from public.friendships
  where requester = 'aaaaaaaa-0000-0000-0000-000000000000' and addressee = 'bbbbbbbb-0000-0000-0000-000000000000'),
  'accepted', 'A 和 B 仍是好友');

/* ========== B（好友）讀得到 A 的紀錄，但不能改、不能刪 ========== */
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from public.shared_brews where owner = 'aaaaaaaa-0000-0000-0000-000000000000'), 1::bigint,
  'B 讀得到 A 的 friends 紀錄（A 的 private 紀錄不在雲端，所以只有這一筆）');
select is((select nickname from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000000'), 'Alice',
  'B 讀得到 A 的暱稱');
select is_empty($$ update public.shared_brews set notes = 'B 改的'
  where owner = 'aaaaaaaa-0000-0000-0000-000000000000' returning 1 $$, 'B 不能修改 A 的紀錄');
select is_empty($$ delete from public.shared_brews
  where owner = 'aaaaaaaa-0000-0000-0000-000000000000' returning 1 $$, 'B 不能刪除 A 的紀錄');
select throws_ok($$ insert into public.shared_brews (owner, id, bean_name, brewed_at, coffee_g, water_g)
  values ('aaaaaaaa-0000-0000-0000-000000000000', gen_random_uuid(), '冒名', now(), 15, 240) $$,
  '42501', null, 'B 不能用 A 的名義新增紀錄');
select throws_ok($$ insert into public.shared_brews (owner, id, bean_name, brewed_at, coffee_g, water_g)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', '覆蓋', now(), 15, 240)
  on conflict (owner, id) do update set notes = 'B 覆蓋' $$,
  '42501', null, 'B 不能用 upsert 覆蓋 A 的紀錄');
select is_empty($$ update public.profiles set nickname = 'hacked'
  where id = 'aaaaaaaa-0000-0000-0000-000000000000' returning 1 $$, 'B 不能改 A 的暱稱');
select lives_ok($$ insert into public.likes (brew_owner, brew_id)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001') $$,
  'B 可以對 A 的紀錄按讚');
select throws_ok($$ insert into public.likes (brew_owner, brew_id, user_id)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001',
          'cccccccc-0000-0000-0000-000000000000') $$,
  '42501', null, 'B 不能用 C 的名義按讚');
select throws_ok($$ insert into public.likes (brew_owner, brew_id)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001') $$,
  '23505', null, '同一人對同一筆只能按一個讚');
-- B 自己的紀錄：不能把 owner 改成別人
select lives_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values ('b0000000-0000-0000-0000-000000000001', 'B 的豆子', now(), 16, 250) $$, 'B 可以新增自己的紀錄（owner 自動是自己）');
select is((select owner from public.shared_brews where id = 'b0000000-0000-0000-0000-000000000001'),
  'bbbbbbbb-0000-0000-0000-000000000000'::uuid, 'owner 由 auth.uid() 決定');
select throws_ok($$ update public.shared_brews set owner = 'aaaaaaaa-0000-0000-0000-000000000000'
  where id = 'b0000000-0000-0000-0000-000000000001' $$, '42501', null, 'B 不能把自己紀錄的 owner 改成 A');
select throws_ok($$ update public.shared_brews set photo_path = 'aaaaaaaa-0000-0000-0000-000000000000/a0000000-0000-0000-0000-000000000001.jpg'
  where id = 'b0000000-0000-0000-0000-000000000001' $$, '23514', null, 'B 的紀錄不能指向 A 的照片');

select tests.as_admin();
select is((select notes from public.shared_brews where id = 'a0000000-0000-0000-0000-000000000001'), 'A 的筆記',
  'A 的紀錄沒有被 B 改到');

/* ========== A 封鎖 B：仍是好友，但雙方互相看不到對方的東西 ========== */
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select is((select count(*) from public.likes), 1::bigint, '封鎖前：A 看得到 B 的讚');
select lives_ok($$ insert into public.blocks (blocked) values ('bbbbbbbb-0000-0000-0000-000000000000') $$, 'A 封鎖 B');
select is((select count(*) from public.friendships
  where 'bbbbbbbb-0000-0000-0000-000000000000' in (requester, addressee) and status = 'accepted'), 1::bigint,
  '封鎖不會解除好友');
select is((select count(*) from public.likes), 0::bigint, '封鎖後 A 看不到 B 的讚（也不算在讚數裡）');
select is((select count(*) from public.shared_brews where owner = 'bbbbbbbb-0000-0000-0000-000000000000'), 0::bigint,
  '封鎖後 A 也讀不到 B 的紀錄（雙向）');
select is((select nickname from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000000'), 'Bob',
  '封鎖後 A 仍看得到好友 B 的 profile');
select tests.as_admin();
select is((select count(*) from public.likes where user_id = 'bbbbbbbb-0000-0000-0000-000000000000'), 1::bigint,
  'B 的讚只是隱藏，沒有刪除');

select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from public.shared_brews where owner = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint,
  '封鎖後 B 讀不到 A 的紀錄');
select is((select count(*) from public.likes where brew_owner = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint,
  '封鎖後 B 讀不到 A 紀錄的讚');
select is((select count(*) from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000000'), 1::bigint,
  '封鎖後 B 仍看得到好友 A 的 profile（好友名單不會少一個人，不透露封鎖）');
select is((select count(*) from public.friendships where status = 'accepted'
  and 'aaaaaaaa-0000-0000-0000-000000000000' in (requester, addressee)), 1::bigint, 'B 看到的好友關係還在');
select is((select count(*) from public.blocks), 0::bigint, 'B 看不到自己被封鎖');
select throws_ok($$ insert into public.likes (brew_owner, brew_id)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001') $$,
  '42501', null, '封鎖後 B 不能對 A 的紀錄按讚');
select is(public.send_friend_request(tests.code_of('aaaaaaaa-0000-0000-0000-000000000000')), 'already_friends',
  '被封鎖的好友 B 用 A 的代碼送邀請：already_friends（和沒封鎖時一樣）');
select is_empty($$ delete from public.blocks returning 1 $$, 'B 不能解除 A 對他的封鎖');

select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select is(public.send_friend_request(tests.code_of('bbbbbbbb-0000-0000-0000-000000000000')), 'already_friends',
  'A 用好友 B 的代碼：already_friends');
select lives_ok($$ delete from public.blocks where blocked = 'bbbbbbbb-0000-0000-0000-000000000000' $$, 'A 解除封鎖');
select is((select count(*) from public.likes), 1::bigint, '解除封鎖後 A 又看得到 B 的讚');
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from public.shared_brews where owner = 'aaaaaaaa-0000-0000-0000-000000000000'), 1::bigint,
  '解除封鎖後 B 又讀得到 A 的紀錄');

/* ========== 封鎖待處理的邀請：邀請刪除，之後送不了邀請 ========== */
-- 前面 C 送了邀請給 A
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select is((select count(*) from public.friendships where status = 'pending'
  and 'cccccccc-0000-0000-0000-000000000000' in (requester, addressee)), 1::bigint, '封鎖前：C 的邀請還在');
select lives_ok($$ insert into public.blocks (blocked) values ('cccccccc-0000-0000-0000-000000000000') $$, 'A 封鎖 C');
select is((select count(*) from public.friendships
  where 'cccccccc-0000-0000-0000-000000000000' in (requester, addressee)), 0::bigint, '封鎖時待處理的邀請刪除');
select is((select count(*) from public.profiles where id = 'cccccccc-0000-0000-0000-000000000000'), 0::bigint,
  '邀請刪除後 A 讀不到 C 的 profile');
select is(public.send_friend_request(tests.code_of('cccccccc-0000-0000-0000-000000000000')), 'you_blocked',
  'A 要先解除封鎖才能邀請 C');
select tests.login_as('cccccccc-0000-0000-0000-000000000000');
select is(public.send_friend_request(tests.code_of('aaaaaaaa-0000-0000-0000-000000000000')), 'not_found',
  '被封鎖的 C 用正確代碼送邀請，只會得到 not_found');
select is((select count(*) from public.friendships), 0::bigint, '被封鎖的 C 沒有送出邀請');

/* ========== 反方向：B 封鎖 A，A 也讀不到 B ========== */
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.blocks (blocked) values ('aaaaaaaa-0000-0000-0000-000000000000') $$, 'B 封鎖 A');
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select is((select count(*) from public.shared_brews where owner = 'bbbbbbbb-0000-0000-0000-000000000000'), 0::bigint,
  'B 封鎖 A 後，A 讀不到 B 的紀錄');
select is((select count(*) from public.blocks where blocked = 'bbbbbbbb-0000-0000-0000-000000000000'), 0::bigint,
  'A 看不到 B 封鎖了他');

select * from finish();
rollback;
