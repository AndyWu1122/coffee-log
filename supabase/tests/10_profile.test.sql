-- 個人檔案：自我介紹、常用器材、喜歡的豆子（20261028100000_profile_fields.sql）
-- 帳號：A 和 B 是好友；D 和 A 是好友但 A 封鎖了 D；E 對 A 送了邀請（待處理）；C 和 A 沒有關係。在交易裡跑，最後 rollback
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
-- 以 postgres 身分讀（不受欄位權限影響），確認值有沒有被改
create function tests.bio_of(uid uuid) returns text language sql security definer as $$
  select bio from public.profiles where id = uid
$$;
grant execute on function tests.bio_of(uuid) to authenticated;

/* ---------- 測試資料 ---------- */
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'b@test.local', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000000', 'c@test.local', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000000', 'd@test.local', 'authenticated', 'authenticated'),
  ('eeeeeeee-0000-0000-0000-000000000000', 'e@test.local', 'authenticated', 'authenticated');
insert into public.profiles (id, nickname) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Alice'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Bob'),
  ('cccccccc-0000-0000-0000-000000000000', 'Carol'),
  ('dddddddd-0000-0000-0000-000000000000', 'Dave'),
  ('eeeeeeee-0000-0000-0000-000000000000', 'Eve');
insert into public.friendships (requester, addressee, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'accepted'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000', 'accepted'),
  ('eeeeeeee-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'pending');
insert into public.blocks (blocker, blocked) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000');
insert into public.shared_brews (owner, id, bean_name, brewed_at, coffee_g, water_g) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', '耶加雪菲', now(), 15, 240),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a2a2a2a2-0000-0000-0000-000000000000', '肯亞', now(), 15, 240);

/* ========== 欄位與預設值 ========== */
select has_column('public', 'profiles', 'bio', 'profiles 有 bio');
select has_column('public', 'profiles', 'favorite_gear', 'profiles 有 favorite_gear');
select has_column('public', 'profiles', 'favorite_beans', 'profiles 有 favorite_beans');
select is((select bio || favorite_gear || favorite_beans from public.profiles where id = 'cccccccc-0000-0000-0000-000000000000'), '',
  '沒填時是空字串');

/* ========== 本人修改：長度、行數、控制字元由資料庫擋下 ========== */
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ update public.profiles set bio = repeat('咖', 150) where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  '自我介紹 150 字可以');
select throws_ok($$ update public.profiles set bio = repeat('咖', 151) where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  '23514', null, '自我介紹 151 字被拒絕');
select lives_ok($$ update public.profiles set bio = E'一\n二\n三\n四\n五' where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  '自我介紹 5 行可以');
select throws_ok($$ update public.profiles set bio = E'一\n二\n三\n四\n五\n六' where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  '23514', null, '自我介紹 6 行被拒絕');
select throws_ok($$ update public.profiles set bio = E'有\ttab' where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  '23514', null, '自我介紹有 tab 被拒絕');
select throws_ok($$ update public.profiles set bio = E'有\r\n換行' where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  '23514', null, '自我介紹有 \r 被拒絕（只允許 \n）');
select lives_ok($$ update public.profiles set favorite_gear = 'V60 / C40', favorite_beans = '衣索比亞水洗、肯亞'
  where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$, '常用器材、喜歡的豆子可以填');
select throws_ok($$ update public.profiles set favorite_gear = repeat('V', 51) where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  '23514', null, '常用器材 51 字被拒絕');
select throws_ok($$ update public.profiles set favorite_gear = E'V60\nC40' where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  '23514', null, '常用器材不能換行');
select throws_ok($$ update public.profiles set favorite_beans = repeat('豆', 51) where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  '23514', null, '喜歡的豆子 51 字被拒絕');
select throws_ok($$ update public.profiles set favorite_beans = E'豆\u0007' where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  '23514', null, '喜歡的豆子有控制字元被拒絕');
update public.profiles set bio = E'手沖愛好者\n住台南' where id = 'aaaaaaaa-0000-0000-0000-000000000000';

/* ========== 不能改別人的 ========== */
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
update public.profiles set bio = 'B 改的' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select is(tests.bio_of('aaaaaaaa-0000-0000-0000-000000000000'), E'手沖愛好者\n住台南', '好友 B 改不到 A 的自我介紹');
select tests.login_as('cccccccc-0000-0000-0000-000000000000');
update public.profiles set bio = 'C 改的', favorite_gear = 'C', favorite_beans = 'C' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select is(tests.bio_of('aaaaaaaa-0000-0000-0000-000000000000'), E'手沖愛好者\n住台南', '非好友 C 改不到 A 的自我介紹');
select throws_ok($$ update public.profiles set created_at = now() where id = 'cccccccc-0000-0000-0000-000000000000' $$,
  '42501', null, '不能改加入日期');

/* ========== 新欄位不能直接讀（連本人、好友都不行），只能透過 profile_detail ========== */
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select throws_ok($$ select bio from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$, '42501', null,
  '好友 B 不能直接讀 bio');
select throws_ok($$ select favorite_gear, favorite_beans from public.profiles $$, '42501', null, '好友 B 不能直接讀器材、豆子');
select throws_ok($$ select created_at from public.profiles $$, '42501', null, '不能直接讀加入日期');
select throws_ok($$ select * from public.profiles $$, '42501', null, 'select * 也不行');
select is((select nickname from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000000'), 'Alice',
  '暱稱照常讀得到（原本的權限不變）');
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select throws_ok($$ select bio from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$, '42501', null,
  '本人也不能直接讀 bio（一律走 profile_detail）');
select tests.login_as('eeeeeeee-0000-0000-0000-000000000000');
select is((select count(*) from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000000'), 1::bigint,
  '有待處理邀請的 E 照常讀得到 A 的暱稱列（原本的規則）');
select throws_ok($$ select bio from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$, '42501', null,
  '但 E 讀不到 bio');

/* ========== profile_detail：本人、已接受且沒有封鎖的好友 ========== */
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select is((public.profile_detail('aaaaaaaa-0000-0000-0000-000000000000')->>'bio'), E'手沖愛好者\n住台南', 'A 讀得到自己的完整檔案');
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((public.profile_detail('aaaaaaaa-0000-0000-0000-000000000000')->>'favorite_gear'), 'V60 / C40', '好友 B 讀得到 A 的器材');
select is((public.profile_detail('aaaaaaaa-0000-0000-0000-000000000000')->>'favorite_beans'), '衣索比亞水洗、肯亞', '好友 B 讀得到 A 的豆子');
select is((public.profile_detail('aaaaaaaa-0000-0000-0000-000000000000')->>'posts')::int, 2, '貼文數：A 分享的 2 筆');
select ok((public.profile_detail('aaaaaaaa-0000-0000-0000-000000000000')->>'created_at') is not null, '有加入日期');
select is(public.profile_detail('aaaaaaaa-0000-0000-0000-000000000000')::jsonb ? 'friend_code', false, '不含好友代碼');

select tests.login_as('cccccccc-0000-0000-0000-000000000000');
select ok(public.profile_detail('aaaaaaaa-0000-0000-0000-000000000000') is null, '非好友 C：null');
select tests.login_as('dddddddd-0000-0000-0000-000000000000');
select ok(public.profile_detail('aaaaaaaa-0000-0000-0000-000000000000') is null, '被 A 封鎖的好友 D：null');
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select ok(public.profile_detail('dddddddd-0000-0000-0000-000000000000') is null, '封鎖者 A 也讀不到 D 的完整檔案');
select tests.login_as('eeeeeeee-0000-0000-0000-000000000000');
select ok(public.profile_detail('aaaaaaaa-0000-0000-0000-000000000000') is null, '有待處理邀請的 E：null');
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select ok(public.profile_detail('ffffffff-0000-0000-0000-000000000000') is null, '不存在的帳號：null（和讀不到一樣）');

select tests.logout();
select throws_ok($$ select public.profile_detail('aaaaaaaa-0000-0000-0000-000000000000') $$, '42501', null,
  '未登入：不能呼叫 profile_detail');

-- 解除封鎖後恢復
select tests.as_admin();
delete from public.blocks where blocker = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.login_as('dddddddd-0000-0000-0000-000000000000');
select ok(public.profile_detail('aaaaaaaa-0000-0000-0000-000000000000') is not null, '解除封鎖後 D 又讀得到');

select * from finish();
rollback;
