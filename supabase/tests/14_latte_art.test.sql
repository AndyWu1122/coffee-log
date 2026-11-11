-- 拉花分享（20261111100000_latte_art.sql）
-- 帳號：A 和 B 是好友；D 和 A 是好友但 A 封鎖了 D；C 和 A 沒有關係；E 和 A 是好友但 E 被停權。在交易裡跑，最後 rollback
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
create function tests.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- 以 postgres 身分數（不受 RLS 影響）
create function tests.count_posts(uid uuid) returns bigint language sql security definer as $$
  select count(*) from private.posts where owner = uid
$$;
create function tests.count_likes(uid uuid) returns bigint language sql security definer as $$
  select count(*) from public.likes where brew_owner = uid
$$;
create function tests.count_comments(uid uuid) returns bigint language sql security definer as $$
  select count(*) from public.comments where brew_owner = uid
$$;
grant execute on all functions in schema tests to anon, authenticated;

/* ---------- 測試資料 ---------- */
insert into auth.users (id, email, aud, role, banned_until) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a@test.local', 'authenticated', 'authenticated', null),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'b@test.local', 'authenticated', 'authenticated', null),
  ('cccccccc-0000-0000-0000-000000000000', 'c@test.local', 'authenticated', 'authenticated', null),
  ('dddddddd-0000-0000-0000-000000000000', 'd@test.local', 'authenticated', 'authenticated', null),
  ('eeeeeeee-0000-0000-0000-000000000000', 'e@test.local', 'authenticated', 'authenticated', now() + interval '1 day');
insert into public.profiles (id, nickname) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Alice'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Bob'),
  ('cccccccc-0000-0000-0000-000000000000', 'Carol'),
  ('dddddddd-0000-0000-0000-000000000000', 'Dave'),
  ('eeeeeeee-0000-0000-0000-000000000000', 'Eve');
insert into public.friendships (requester, addressee, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'accepted'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000', 'accepted'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000000', 'accepted');
insert into public.blocks (blocker, blocked) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000');
-- 停權的 E 已經分享過一篇（停權前上傳的）
insert into public.shared_latte_arts (owner, id, made_at, pattern, score_contrast, score_foam, score_symmetry, score_completion) values
  ('eeeeeeee-0000-0000-0000-000000000000', 'eeee0000-0000-0000-0000-000000000001', now(), 'heart', 3, 3, 3, 3);

/* ========== 結構 ========== */
select has_table('public', 'shared_latte_arts', '有 shared_latte_arts');
select col_is_pk('public', 'shared_latte_arts', array['owner', 'id'], '主鍵是 (owner, id)');
select ok((select relrowsecurity from pg_class where oid = 'public.shared_latte_arts'::regclass), 'shared_latte_arts 開了 RLS');
select ok((select relrowsecurity from pg_class where oid = 'private.posts'::regclass), 'private.posts 開了 RLS');
select ok(not has_table_privilege('authenticated', 'private.posts', 'SELECT'), '登入的人讀不到 private.posts');
select has_view('public', 'feed_posts', '有 feed_posts');
select ok(not has_table_privilege('anon', 'public.feed_posts', 'SELECT'), 'anon 讀不到 feed_posts');
select ok(not has_column_privilege('authenticated', 'public.shared_latte_arts', 'owner', 'UPDATE'), '不能改 owner');
select ok(not has_column_privilege('authenticated', 'public.shared_latte_arts', 'id', 'UPDATE'), '不能改 id');
select is((select count(*) from private.posts p join public.shared_brews b on b.owner = p.owner and b.id = p.id where p.kind = 'brew'),
  (select count(*) from public.shared_brews), '既有的手沖貼文都回填到 posts');

/* ========== A 分享 ========== */
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.shared_latte_arts (id, made_at, pattern, pattern_note, milk, cup,
    score_contrast, score_foam, score_symmetry, score_completion, notes, photo_path)
  values ('aaaa0000-0000-0000-0000-000000000001', now(), 'other', '多層愛心', '燕麥奶', '拿鐵杯', 4, 3, 4, 5, '融合太早',
    'aaaaaaaa-0000-0000-0000-000000000000/aaaa0000-0000-0000-0000-000000000001.jpg') $$, 'A 分享一杯拉花');
select is(tests.count_posts('aaaaaaaa-0000-0000-0000-000000000000'), 1::bigint, 'posts 多了一筆');
select is((select kind from public.feed_posts where id = 'aaaa0000-0000-0000-0000-000000000001'), 'latte', 'feed_posts 看得到、kind 是 latte');

select throws_ok($$ insert into public.shared_latte_arts (id, made_at, pattern, score_contrast, score_foam, score_symmetry, score_completion)
  values ('aaaa0000-0000-0000-0000-000000000002', now(), 'heart', 0, 3, 3, 3) $$, '23514', null, '分項 0 被拒絕');
select throws_ok($$ insert into public.shared_latte_arts (id, made_at, pattern, score_contrast, score_foam, score_symmetry, score_completion)
  values ('aaaa0000-0000-0000-0000-000000000002', now(), 'heart', 3, 6, 3, 3) $$, '23514', null, '分項 6 被拒絕');
select throws_ok($$ insert into public.shared_latte_arts (id, made_at, pattern, score_contrast, score_foam, score_symmetry)
  values ('aaaa0000-0000-0000-0000-000000000002', now(), 'heart', 3, 3, 3) $$, '23502', null, '少一項被拒絕');
select throws_ok($$ insert into public.shared_latte_arts (id, made_at, pattern, score_contrast, score_foam, score_symmetry, score_completion)
  values ('aaaa0000-0000-0000-0000-000000000002', now(), 'dragon', 3, 3, 3, 3) $$, '23514', null, '不認得的圖案被拒絕');
select throws_ok($$ insert into public.shared_latte_arts (id, made_at, pattern, milk, score_contrast, score_foam, score_symmetry, score_completion)
  values ('aaaa0000-0000-0000-0000-000000000002', now(), 'heart', repeat('x', 51), 3, 3, 3, 3) $$, '23514', null, '牛奶超過 50 字被拒絕');
select throws_ok($$ insert into public.shared_latte_arts (id, made_at, pattern, cup, score_contrast, score_foam, score_symmetry, score_completion)
  values ('aaaa0000-0000-0000-0000-000000000002', now(), 'heart', E'a\nb', 3, 3, 3, 3) $$, '23514', null, '杯子不能換行');
select throws_ok($$ insert into public.shared_latte_arts (id, made_at, pattern, score_contrast, score_foam, score_symmetry, score_completion)
  values ('aaaa0000-0000-0000-0000-000000000002', now() + interval '2 days', 'heart', 3, 3, 3, 3) $$, '23514', null, '未來的時間被拒絕');
select throws_ok($$ insert into public.shared_latte_arts (id, made_at, pattern, score_contrast, score_foam, score_symmetry, score_completion, photo_path)
  values ('aaaa0000-0000-0000-0000-000000000002', now(), 'heart', 3, 3, 3, 3, 'bbbbbbbb-0000-0000-0000-000000000000/x.jpg') $$,
  '23514', null, '照片路徑只能是自己的 <owner>/<id>.jpg');
select throws_ok($$ insert into public.shared_latte_arts (owner, id, made_at, pattern, score_contrast, score_foam, score_symmetry, score_completion)
  values ('bbbbbbbb-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000003', now(), 'heart', 3, 3, 3, 3) $$,
  '42501', null, '不能以別人的名義新增');
-- 手沖和拉花不能用同一個 id
select throws_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g)
  values ('aaaa0000-0000-0000-0000-000000000001', '豆', now(), 15, 240) $$, '23505', null, '同一個 id 不能同時是手沖和拉花');

/* ========== 讀取 ========== */
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from public.shared_latte_arts where owner = 'aaaaaaaa-0000-0000-0000-000000000000'), 1::bigint, '好友 B 讀得到');
select is((select score_completion from public.shared_latte_arts where id = 'aaaa0000-0000-0000-0000-000000000001'), 5::smallint, 'B 讀得到自評');
select lives_ok($$ insert into public.likes (brew_owner, brew_id) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000001') $$, 'B 可以按讚');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, body) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000001', '好看') $$, 'B 可以留言');
select lives_ok($$ insert into public.reports (brew_owner, brew_id, reason) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000001', 'other') $$, 'B 可以檢舉');
select is((select count(*) from public.likes where brew_id = 'aaaa0000-0000-0000-0000-000000000001'), 1::bigint, 'B 看得到讚');
select is((select count(*) from public.feed_posts where owner = 'eeeeeeee-0000-0000-0000-000000000000'), 0::bigint, 'B 不是 E 的好友：看不到');
select is_empty($$ update public.shared_latte_arts set notes = 'x' where id = 'aaaa0000-0000-0000-0000-000000000001' returning 1 $$, 'B 不能改 A 的');
select is_empty($$ delete from public.shared_latte_arts where id = 'aaaa0000-0000-0000-0000-000000000001' returning 1 $$, 'B 不能刪 A 的');

select tests.login_as('cccccccc-0000-0000-0000-000000000000');
select is((select count(*) from public.shared_latte_arts where owner = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint, '非好友 C 讀不到');
select is((select count(*) from public.feed_posts where owner = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint, 'C 在 feed_posts 也看不到');
select throws_ok($$ insert into public.likes (brew_owner, brew_id) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000001') $$,
  '42501', null, 'C 不能按讚');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, body) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000001', 'x') $$,
  '42501', null, 'C 不能留言');

select tests.login_as('dddddddd-0000-0000-0000-000000000000');
select is((select count(*) from public.shared_latte_arts where owner = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint, '被封鎖的 D 讀不到');
select throws_ok($$ insert into public.likes (brew_owner, brew_id) values ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000001') $$,
  '42501', null, 'D 不能按讚');

/* ========== 停權 ========== */
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select is((select count(*) from public.shared_latte_arts where owner = 'eeeeeeee-0000-0000-0000-000000000000'), 0::bigint, '好友被停權：A 看不到他的拉花');
select ok(public.profile_detail('eeeeeeee-0000-0000-0000-000000000000') is null, '好友被停權：A 拿不到他的個人檔案');
select is((public.profile_detail('aaaaaaaa-0000-0000-0000-000000000000') ->> 'posts')::int, 1, '自己的個人檔案：貼文數包含拉花');

/* ========== 改回只有我：讚、留言、檢舉一起刪 ========== */
select is(tests.count_likes('aaaaaaaa-0000-0000-0000-000000000000'), 1::bigint, '刪除前有 1 個讚');
select lives_ok($$ delete from public.shared_latte_arts where id = 'aaaa0000-0000-0000-0000-000000000001' $$, 'A 刪除（改回只有我）');
select is(tests.count_posts('aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint, 'posts 也刪了');
select is(tests.count_likes('aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint, '讚一起刪');
select is(tests.count_comments('aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint, '留言一起刪');

/* ========== 每天 30 筆和手沖共用 ========== */
select tests.as_admin();
insert into private.rate_events (user_id, kind)
  select 'bbbbbbbb-0000-0000-0000-000000000000', 'brew_insert' from generate_series(1, 30);
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select throws_ok($$ insert into public.shared_latte_arts (id, made_at, pattern, score_contrast, score_foam, score_symmetry, score_completion)
  values ('bbbb0000-0000-0000-0000-000000000001', now(), 'heart', 3, 3, 3, 3) $$, 'P0001', null, '手沖已經 30 筆：拉花也不能再上傳');

/* ========== 刪除帳號：cascade ========== */
select tests.as_admin();
select is(tests.count_posts('eeeeeeee-0000-0000-0000-000000000000'), 1::bigint, 'E 有一篇');
delete from auth.users where id = 'eeeeeeee-0000-0000-0000-000000000000';
select is((select count(*) from public.shared_latte_arts where owner = 'eeeeeeee-0000-0000-0000-000000000000'), 0::bigint, '刪除帳號：拉花刪掉');
select is(tests.count_posts('eeeeeeee-0000-0000-0000-000000000000'), 0::bigint, '刪除帳號：posts 刪掉');

/* ========== 開發者刪除拉花 ========== */
insert into private.admins (user_id) values ('cccccccc-0000-0000-0000-000000000000');
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.shared_latte_arts (id, made_at, pattern, score_contrast, score_foam, score_symmetry, score_completion, photo_path)
  values ('aaaa0000-0000-0000-0000-000000000009', now(), 'swan', 2, 2, 2, 2,
    'aaaaaaaa-0000-0000-0000-000000000000/aaaa0000-0000-0000-0000-000000000009.jpg') $$, 'A 再分享一杯');
select tests.login_as('cccccccc-0000-0000-0000-000000000000');
select is((public.admin_list_posts() -> 0 ->> 'kind'), 'latte', '後台貼文列表有拉花');
select is((public.admin_post_detail('aaaaaaaa-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000009') -> 'post' ->> 'pattern'), 'swan', '後台看得到拉花詳細');
select is(public.admin_delete_post('aaaaaaaa-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000009', '測試'),
  'aaaaaaaa-0000-0000-0000-000000000000/aaaa0000-0000-0000-0000-000000000009.jpg', '開發者刪除拉花：回傳照片路徑');
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select throws_ok($$ insert into public.shared_latte_arts (id, made_at, pattern, score_contrast, score_foam, score_symmetry, score_completion)
  values ('aaaa0000-0000-0000-0000-000000000009', now(), 'swan', 2, 2, 2, 2) $$, '23514', null, '被開發者移除的不能再上傳');

select * from finish();
rollback;
