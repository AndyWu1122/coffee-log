-- 好友邀請流程、每日上限、讚與檢舉
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated;
create function tests.login_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function tests.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function tests.code_of(uid uuid) returns text language sql security definer as $$
  select friend_code from public.profiles where id = uid
$$;

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'b@test.local', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000000', 'c@test.local', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000000', 'd@test.local', 'authenticated', 'authenticated');
insert into public.profiles (id, nickname) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Alice'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Bob'),
  ('cccccccc-0000-0000-0000-000000000000', 'Carol');
-- D 還沒建立 profile

/* ========== 好友邀請流程 ========== */
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select is(public.send_friend_request('ZZZZZZZZZZ'), 'not_found', '不存在的代碼：not_found');
select is(public.send_friend_request(tests.code_of('aaaaaaaa-0000-0000-0000-000000000000')), 'not_found', '自己的代碼：not_found');
select is(public.send_friend_request(lower(tests.code_of('bbbbbbbb-0000-0000-0000-000000000000'))), 'sent',
  '代碼大小寫不拘：送出邀請');
select is(public.send_friend_request(tests.code_of('bbbbbbbb-0000-0000-0000-000000000000')), 'already_sent', '重複邀請：already_sent');
select is((select count(*) from public.friendships), 1::bigint, '重複邀請不會多一筆');
select is((select status from public.friendships), 'pending', '邀請是 pending');

select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select nickname from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000000'), 'Alice',
  'B 看得到邀請他的人的暱稱（才知道要不要接受）');
select is_empty($$ select * from public.shared_brews where owner = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  '還沒接受前，B 讀不到 A 的紀錄');
select lives_ok($$ update public.friendships set status = 'accepted'
  where requester = 'aaaaaaaa-0000-0000-0000-000000000000' $$, 'B（接收者）接受邀請');
select is((select status from public.friendships), 'accepted', '接受後是 accepted');
select isnt((select accepted_at from public.friendships), null, '接受時記下時間');
select is(public.send_friend_request(tests.code_of('aaaaaaaa-0000-0000-0000-000000000000')), 'already_friends', '已經是好友：already_friends');
select is_empty($$ update public.friendships set status = 'pending' returning 1 $$, '接受後不能改回 pending');

-- 反向邀請：C 邀請 A 之前，A 先邀請了 C → C 輸入 A 的代碼就直接成為好友
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select is(public.send_friend_request(tests.code_of('cccccccc-0000-0000-0000-000000000000')), 'sent', 'A 邀請 C');
select tests.login_as('cccccccc-0000-0000-0000-000000000000');
select is(public.send_friend_request(tests.code_of('aaaaaaaa-0000-0000-0000-000000000000')), 'accepted',
  'C 也輸入 A 的代碼：直接成為好友');
-- 拒絕／解除好友：任一方可刪除
select lives_ok($$ delete from public.friendships where 'aaaaaaaa-0000-0000-0000-000000000000' in (requester, addressee) $$,
  'C 可以解除和 A 的好友關係');
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select is((select count(*) from public.friendships where 'cccccccc-0000-0000-0000-000000000000' in (requester, addressee)),
  0::bigint, '解除後 A 這邊也沒有了');

-- 沒有 profile 的人不能送邀請
select tests.login_as('dddddddd-0000-0000-0000-000000000000');
select is(public.send_friend_request(tests.code_of('aaaaaaaa-0000-0000-0000-000000000000')), 'no_profile', '沒有 profile：no_profile');

-- 重新產生好友代碼：舊代碼立即失效
select tests.as_admin();
create temp table old_code as select tests.code_of('cccccccc-0000-0000-0000-000000000000') as code;
grant select on old_code to authenticated;
select tests.login_as('cccccccc-0000-0000-0000-000000000000');
select isnt(public.regenerate_friend_code(), (select code from old_code), 'C 重新產生好友代碼');
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is(public.send_friend_request((select code from old_code)), 'not_found', '舊代碼失效');

/* ========== 猜代碼：每小時打錯 10 次就鎖住 ========== */
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
-- 上面 B 已經打錯 1 次，再錯 9 次 = 10 次
select is(
  (select array_agg(distinct public.send_friend_request('WRONGCODE' || i)) from generate_series(1, 9) as i),
  array['not_found'], '再打錯 9 次（共 10 次）都是 not_found');
select is(public.send_friend_request(tests.code_of('cccccccc-0000-0000-0000-000000000000')), 'rate_limited',
  '這小時打錯 10 次後，連正確代碼都暫時不能用');

/* ========== 每天最多 20 個好友邀請 ========== */
-- A 今天已經送了 2 個（給 B、給 C）；用管理者身分再補 17 筆＝19 個（建立 17 個帳號太慢）
select tests.as_admin();
select is(private.count_today('aaaaaaaa-0000-0000-0000-000000000000', 'friend_request'), 2::bigint, 'A 今天已送 2 個邀請');
insert into private.rate_events (user_id, kind)
  select 'aaaaaaaa-0000-0000-0000-000000000000', 'friend_request' from generate_series(1, 17);
-- 再送 1 個 = 第 20 個，可以
insert into auth.users (id, email, aud, role) values
  ('eeeeeeee-0000-0000-0000-000000000000', 'e@test.local', 'authenticated', 'authenticated'),
  ('ffffffff-0000-0000-0000-000000000000', 'f@test.local', 'authenticated', 'authenticated');
insert into public.profiles (id, nickname) values
  ('eeeeeeee-0000-0000-0000-000000000000', 'Eve'),
  ('ffffffff-0000-0000-0000-000000000000', 'Frank');
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select is(public.send_friend_request(tests.code_of('eeeeeeee-0000-0000-0000-000000000000')), 'sent', '今天第 20 個邀請：可以');
select is(public.send_friend_request(tests.code_of('ffffffff-0000-0000-0000-000000000000')), 'rate_limited', '今天第 21 個邀請：rate_limited');
-- 取消邀請不會把次數還回來
select lives_ok($$ delete from public.friendships where addressee = 'eeeeeeee-0000-0000-0000-000000000000' $$, '取消一個邀請');
select is(public.send_friend_request(tests.code_of('ffffffff-0000-0000-0000-000000000000')), 'rate_limited', '取消邀請後仍是 rate_limited');
-- 昨天（台灣時間）的不算
select tests.as_admin();
update private.rate_events set at = now() - interval '2 days'
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000000' and kind = 'friend_request';
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select is(public.send_friend_request(tests.code_of('ffffffff-0000-0000-0000-000000000000')), 'sent', '前幾天的邀請不算在今天');

/* ========== 每天最多上傳 30 筆紀錄 ========== */
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  select gen_random_uuid(), '豆' || i, now() - interval '1 hour', 15, 240 from generate_series(1, 29) as i $$,
  '新增 29 筆');
select lives_ok($$ update public.shared_brews set notes = '改過' $$, '修改不算次數');
select lives_ok($$ update public.shared_brews set rating = 4 $$, '再修改一次也不算');
select lives_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values ('b0000000-0000-0000-0000-000000000030', '第 30 筆', now(), 15, 240) $$, '第 30 筆可以');
select throws_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values (gen_random_uuid(), '第 31 筆', now(), 15, 240) $$, 'P0001', null, '第 31 筆被拒絕');
select lives_ok($$ delete from public.shared_brews where id = 'b0000000-0000-0000-0000-000000000030' $$, '刪掉一筆');
select throws_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values (gen_random_uuid(), '刪了再加', now(), 15, 240) $$, 'P0001', null, '刪掉再新增，次數不會還回來');

/* ========== 讚與檢舉 ========== */
-- A 和 B 是好友；B 有紀錄
select tests.as_admin();
create temp table b_brew as select id from public.shared_brews where owner = 'bbbbbbbb-0000-0000-0000-000000000000' limit 1;
grant select on b_brew to authenticated;

select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.likes (brew_owner, brew_id)
  values ('bbbbbbbb-0000-0000-0000-000000000000', (select id from b_brew)) $$, 'A 對 B 的紀錄按讚');
select lives_ok($$ insert into public.reports (brew_owner, brew_id, reason, detail)
  values ('bbbbbbbb-0000-0000-0000-000000000000', (select id from b_brew), 'spam', '測試') $$, 'A 檢舉 B 的紀錄');
select throws_ok($$ select * from public.reports $$, '42501', null, '檢舉者自己也讀不到檢舉');
select throws_ok($$ update public.reports set reason = 'other' $$, '42501', null, '不能修改檢舉');
select throws_ok($$ delete from public.reports $$, '42501', null, '不能刪除檢舉');

select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select throws_ok($$ select * from public.reports $$, '42501', null, '被檢舉的人讀不到檢舉');
select is((select count(*) from public.likes), 1::bigint, 'B 看得到自己紀錄上的讚');
select is_empty($$ delete from public.likes returning 1 $$, 'B 不能刪掉 A 按的讚');
select throws_ok($$ insert into public.reports (brew_owner, brew_id, reason)
  values ('bbbbbbbb-0000-0000-0000-000000000000', (select id from b_brew), 'spam') $$,
  '42501', null, '不能檢舉自己的紀錄');

select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ delete from public.likes where user_id = 'aaaaaaaa-0000-0000-0000-000000000000' $$, 'A 可以收回自己的讚');

-- 每天最多檢舉 10 次（已檢舉 1 次，再 9 次可以，第 11 次不行）
select lives_ok($$ insert into public.reports (brew_owner, brew_id, reason)
  select 'bbbbbbbb-0000-0000-0000-000000000000', (select id from b_brew), 'other' from generate_series(1, 9) $$,
  '今天第 2–10 次檢舉可以');
select throws_ok($$ insert into public.reports (brew_owner, brew_id, reason)
  values ('bbbbbbbb-0000-0000-0000-000000000000', (select id from b_brew), 'other') $$,
  'P0001', null, '今天第 11 次檢舉被拒絕');

-- 紀錄刪除時，讚和檢舉跟著刪（雲端資料刪除要徹底）
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select lives_ok($$ delete from public.shared_brews where id = (select id from b_brew) $$, 'B 刪除那筆紀錄');
select tests.as_admin();
select is((select count(*) from public.reports), 0::bigint, '紀錄刪除後檢舉跟著刪');
select is((select count(*) from public.likes where brew_id = (select id from b_brew)), 0::bigint, '紀錄刪除後讚跟著刪');

/* ========== 帳號刪除時，所有資料跟著刪 ========== */
delete from auth.users where id = 'bbbbbbbb-0000-0000-0000-000000000000';
select is((select count(*) from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000000'), 0::bigint, '帳號刪除：profile 刪除');
select is((select count(*) from public.shared_brews where owner = 'bbbbbbbb-0000-0000-0000-000000000000'), 0::bigint, '帳號刪除：紀錄刪除');
select is((select count(*) from public.friendships where 'bbbbbbbb-0000-0000-0000-000000000000' in (requester, addressee)),
  0::bigint, '帳號刪除：好友關係刪除');
select is((select count(*) from private.rate_events where user_id = 'bbbbbbbb-0000-0000-0000-000000000000'), 0::bigint,
  '帳號刪除：計數紀錄刪除');

select * from finish();
rollback;
