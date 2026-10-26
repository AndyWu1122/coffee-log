-- 資料檢查：超長字串、不合理的數值都會被資料庫拒絕（就算繞過 App 直接打 API）
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
-- 用一個合法的紀錄當基準，只改一個欄位測試
create function tests.brew_with(col text, val text) returns text language sql as $$
  select format(
    'insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g, %I) values (gen_random_uuid(), %L, now(), 15, 240, %s)',
    col, '測試豆', val)
$$;

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'b@test.local', 'authenticated', 'authenticated');
insert into public.profiles (id, nickname) values ('bbbbbbbb-0000-0000-0000-000000000000', 'Bob');

/* ========== profiles ========== */
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select throws_ok($$ insert into public.profiles (id, nickname) values ('bbbbbbbb-0000-0000-0000-000000000000', 'x') $$,
  '42501', null, '不能用別人的 id 建立 profile');
select throws_ok($$ insert into public.profiles (nickname, friend_code) values ('Alice', 'AAAAAAAAAA') $$,
  '42501', null, '不能自己指定好友代碼');
select throws_ok($$ insert into public.profiles (nickname) values (repeat('長', 21)) $$, '23514', null, '暱稱 21 字被拒絕');
select throws_ok($$ insert into public.profiles (nickname) values ('   ') $$, '23514', null, '暱稱全是空白被拒絕');
select throws_ok($$ insert into public.profiles (nickname) values (E'Al\nice') $$, '23514', null, '暱稱含換行被拒絕');
select lives_ok($$ insert into public.profiles (nickname) values (repeat('長', 20)) $$, '暱稱剛好 20 字可以');
select matches((select friend_code from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000000'),
  '^[A-HJKMNP-Z2-9]{10}$', '好友代碼由資料庫產生：10 碼、不含 0 O 1 I L');
select throws_ok($$ update public.profiles set friend_code = 'AAAAAAAAAA' $$, '42501', null, '不能自己改好友代碼');
select throws_ok($$ update public.profiles set nickname = repeat('x', 21) $$, '23514', null, '改暱稱也有長度限制');

/* ========== shared_brews：文字長度 ========== */
select throws_ok(tests.brew_with('notes', quote_literal(repeat('字', 501))), '23514', null, '筆記 501 字被拒絕');
select lives_ok(tests.brew_with('notes', quote_literal(repeat('字', 500))), '筆記剛好 500 字可以');
select lives_ok(tests.brew_with('notes', quote_literal(E'第一行\n第二行')), '筆記可以換行');
select throws_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values (gen_random_uuid(), repeat('豆', 101), now(), 15, 240) $$, '23514', null, '豆名 101 字被拒絕');
select throws_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values (gen_random_uuid(), '', now(), 15, 240) $$, '23514', null, '豆名空白被拒絕');
select throws_ok(tests.brew_with('bean_origin', quote_literal(repeat('x', 101))), '23514', null, '產地 101 字被拒絕');
select throws_ok(tests.brew_with('dripper', quote_literal(repeat('x', 101))), '23514', null, '濾杯 101 字被拒絕');
select throws_ok(tests.brew_with('grinder_name', quote_literal(E'C40\r\nevil')), '23514', null, '磨豆機名稱含換行被拒絕');
select throws_ok(tests.brew_with('grind_setting', quote_literal(repeat('x', 101))), '23514', null, '研磨度 101 字被拒絕');

/* ========== shared_brews：沖煮方式（1.21.0） ========== */
select throws_ok(tests.brew_with('method', quote_literal('french')), '23514', null, '不認得的沖煮方式被拒絕');
select throws_ok(tests.brew_with('method', quote_literal('')), '23514', null, '沖煮方式空字串被拒絕');
select lives_ok(tests.brew_with('method', quote_literal('siphon')), '賽風可以');
select lives_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values ('cccccccc-1111-0000-0000-000000000000', '舊版 App', now(), 15, 240) $$, '舊版 App 不帶 method 照常可以上傳');
select is((select method from public.shared_brews where id = 'cccccccc-1111-0000-0000-000000000000'), 'pourover', '不帶 method＝手沖');
select lives_ok($$ update public.shared_brews set method = 'siphon' where id = 'cccccccc-1111-0000-0000-000000000000' $$, '可以改沖煮方式');
select is((select method from public.shared_brews where id = 'cccccccc-1111-0000-0000-000000000000'), 'siphon', '改成賽風');

/* ========== shared_brews：評分與風味 ========== */
select throws_ok(tests.brew_with('rating', '99'), '23514', null, '評分 99 被拒絕');
select throws_ok(tests.brew_with('rating', '0'), '23514', null, '評分 0 被拒絕');
select lives_ok(tests.brew_with('rating', '5'), '評分 5 可以');
select throws_ok(tests.brew_with('acidity', '0'), '23514', null, '酸度 0 被拒絕');
select throws_ok(tests.brew_with('sweetness', '6'), '23514', null, '甜度 6 被拒絕');
select throws_ok(tests.brew_with('bitterness', '-1'), '23514', null, '苦度 -1 被拒絕');
select throws_ok(tests.brew_with('body', '99'), '23514', null, '醇厚度 99 被拒絕');

/* ========== shared_brews：數值範圍 ========== */
select throws_ok(tests.brew_with('temp_c', '150'), '23514', null, '水溫 150 被拒絕');
select throws_ok(tests.brew_with('temp_c', '20'), '23514', null, '水溫 20 被拒絕');
select throws_ok(tests.brew_with('total_time_s', '99999'), '23514', null, '總時間 99999 秒被拒絕');
select throws_ok(tests.brew_with('total_time_s', '-1'), '23514', null, '總時間負數被拒絕');
select throws_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values (gen_random_uuid(), 'x', now(), -1, 240) $$, '23514', null, '粉量負數被拒絕');
select throws_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values (gen_random_uuid(), 'x', now(), 15, 99999) $$, null, '水量 99999 被拒絕'); -- 超出 numeric(6,1) 或範圍
select throws_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values (gen_random_uuid(), 'x', now(), 15, 2001) $$, '23514', null, '水量 2001 被拒絕');

/* ========== shared_brews：選項與格式 ========== */
select throws_ok(tests.brew_with('bean_process', quote_literal('foo')), '23514', null, '不存在的處理法被拒絕');
select throws_ok(tests.brew_with('roast_level', quote_literal('burnt')), '23514', null, '不存在的烘焙度被拒絕');
select lives_ok(tests.brew_with('roast_level', quote_literal('light-medium')), '合法的烘焙度可以');
select throws_ok(tests.brew_with('flavor_notes', $$array['Fruity!!']$$), '23514', null, '格式錯誤的風味 key 被拒絕');
select throws_ok(tests.brew_with('flavor_notes', $$array['a.b.c.d']$$), '23514', null, '超過三層的風味 key 被拒絕');
select throws_ok(tests.brew_with('flavor_notes', $$array[null]::text[]$$), '23514', null, '風味 key 不能是 null');
select throws_ok(tests.brew_with('flavor_notes', $$array(select 'fruity' from generate_series(1, 31))$$), '23514', null,
  '風味 key 31 個被拒絕');
select lives_ok(tests.brew_with('flavor_notes', $$array['fruity.berry.blueberry', 'floral']$$), '合法的風味 key 可以');
select throws_ok(tests.brew_with('photo_path', quote_literal('../../etc/passwd')), '23514', null, '照片路徑只能是自己的 <owner>/<id>.jpg');

/* ========== shared_brews：日期 ========== */
select throws_ok(tests.brew_with('roast_date', quote_literal('1999-12-31')), '23514', null, '烘焙日 1999 年被拒絕');
select throws_ok(tests.brew_with('roast_date', $$(current_date + 30)$$), '23514', null, '烘焙日是未來被拒絕');
select throws_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values (gen_random_uuid(), 'x', now() + interval '7 days', 15, 240) $$, '23514', null, '沖煮時間是未來被拒絕');
select throws_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values (gen_random_uuid(), 'x', '1990-01-01', 15, 240) $$, '23514', null, '沖煮時間 1990 年被拒絕');

/* ========== 修改時同樣檢查，且不能改 created_at ========== */
select lives_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values ('a0000000-0000-0000-0000-000000000001', '基準', now(), 15, 240) $$, '建立一筆基準紀錄');
select throws_ok($$ update public.shared_brews set rating = 99 where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '23514', null, '修改成評分 99 被拒絕');
select throws_ok($$ update public.shared_brews set created_at = '2000-01-01' where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null, '不能改 created_at');
select throws_ok($$ update public.shared_brews set id = gen_random_uuid() where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null, '不能改 id');

/* ========== reports ========== */
-- B 是 A 的好友（看得到紀錄），確認擋下來的是檢查條件而不是權限
select set_config('role', 'postgres', true);
insert into public.friendships (requester, addressee, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'accepted');
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select throws_ok($$ insert into public.reports (brew_owner, brew_id, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'because') $$,
  '23514', null, '不存在的檢舉原因被拒絕');
select throws_ok($$ insert into public.reports (brew_owner, brew_id, reason, detail)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'other', repeat('x', 301)) $$,
  '23514', null, '檢舉說明 301 字被拒絕');

select * from finish();
rollback;
