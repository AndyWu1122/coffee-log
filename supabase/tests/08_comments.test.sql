-- 留言與回覆：權限、只有兩層、內容限制、封鎖、解除好友、改回只有我、刪主留言、刪除帳號、每日上限、通知
-- A、B 好友；C 不是任何人的好友；D 原本是 A、B 的好友，之後被 A 封鎖；E 是 A 的好友
-- （每個檔案在交易中執行，結束 rollback；同一個交易裡 now() 都一樣，所以 created_at 都相同）
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
-- 依內容找留言（不受 RLS 影響，測試用）
create function tests.cid(b text) returns uuid language sql security definer set search_path = '' as $$
  select id from public.comments where body = b
$$;
create function tests.n(b text) returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.comments where body = b
$$;
-- 今天還能留幾則
create function tests.remaining(uid uuid) returns int language sql security definer set search_path = '' as $$
  select 100 - count(*)::int from private.rate_events where user_id = uid and kind = 'comment'
$$;
grant execute on function tests.cid(text), tests.n(text), tests.remaining(uuid) to authenticated;

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
  ('bbbbbbbb-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000', 'accepted'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000000', 'accepted');
-- A 的貼文 a1、a2；B 的貼文 b1
insert into public.shared_brews (owner, id, bean_name, brewed_at, coffee_g, water_g) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', 'A 的豆子', now(), 15, 240),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a2a2a2a2-0000-0000-0000-000000000000', 'A 的豆子 2', now(), 15, 240),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'b1b1b1b1-0000-0000-0000-000000000000', 'B 的豆子', now(), 15, 240);

/* ========== 結構 ========== */
select ok(not has_table_privilege('authenticated', 'public.comments', 'UPDATE'), '沒有 update 權限：留言不能修改');
select ok(not has_column_privilege('authenticated', 'public.comments', 'author_nickname', 'INSERT'), '暱稱快照不能由前端指定');

/* ========== 主留言與回覆 ========== */
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', 'B 的主留言') $$, 'B 在 A 的貼文留言');
select is((select author from public.comments where body = 'B 的主留言'), 'bbbbbbbb-0000-0000-0000-000000000000'::uuid, '作者預設是自己');
select is((select author_nickname from public.comments where body = 'B 的主留言'), 'Bob', '記下留言當下的暱稱');

select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, parent_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', tests.cid('B 的主留言'), 'A 回覆 B') $$,
  'A 回覆 B 的主留言');

select tests.login_as('dddddddd-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', 'D 的主留言') $$, 'D 在 A 的貼文留言');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, parent_id, reply_to_user, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', tests.cid('B 的主留言'),
          'aaaaaaaa-0000-0000-0000-000000000000', 'D 回覆 A') $$,
  '回覆的回覆：掛在同一則主留言下，reply_to_user 是 A（貼文作者）');
select is((select reply_to_nickname from public.comments where body = 'D 回覆 A'), 'Alice', '記下回覆對象的暱稱');

select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, parent_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', tests.cid('A 回覆 B'), 'x') $$,
  '23514', null, '只有兩層：parent_id 指向回覆被拒絕');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, parent_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a2a2a2a2-0000-0000-0000-000000000000', tests.cid('B 的主留言'), 'x') $$,
  '23503', null, '跨貼文的 parent_id 被拒絕');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, parent_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', gen_random_uuid(), 'x') $$,
  '23503', null, '不存在的 parent_id 被拒絕');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, reply_to_user, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'x') $$,
  '23514', null, '主留言不能有 reply_to_user');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, parent_id, reply_to_user, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', tests.cid('B 的主留言'),
          'cccccccc-0000-0000-0000-000000000000', 'x') $$,
  '23514', null, 'reply_to_user 是讀不到貼文的人（C）被拒絕');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, parent_id, reply_to_user, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', tests.cid('B 的主留言'),
          'eeeeeeee-0000-0000-0000-000000000000', 'x') $$,
  '23514', null, 'reply_to_user 只能是貼文作者或這串留過言的人（E 讀得到但沒留言）');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, parent_id, reply_to_user, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', tests.cid('B 的主留言'),
          'dddddddd-0000-0000-0000-000000000000', 'B 回覆 D') $$,
  'reply_to_user 是這串留過言的人（D）');

select throws_ok($$ update public.comments set body = '改過' where body = 'B 的主留言' $$, '42501', null, '不能修改留言');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, author, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', '冒用 A') $$,
  '42501', null, '跨帳號：不能以別人的名義留言');
select throws_ok($$ insert into public.comments (id, brew_owner, brew_id, body)
  values (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', 'x') $$,
  '42501', null, '不能指定 id');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, body, created_at)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', 'x', '2000-01-01') $$,
  '42501', null, '不能指定建立時間');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, body, author_nickname)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', 'x', '假暱稱') $$,
  '42501', null, '不能指定暱稱');

/* ========== 內容限制 ========== */
select throws_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', '') $$, '23514', null, '空字串被拒絕');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', '   ') $$, '23514', null, '只有空白被拒絕');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', E'\n \n') $$, '23514', null, '只有換行被拒絕');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', '　') $$, '23514', null, '只有全形空白被拒絕');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', repeat('あ', 301)) $$, '23514', null, '301 字被拒絕');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', E'a\tb') $$, '23514', null, '換行以外的控制字元被拒絕');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', repeat('あ', 300)) $$, '剛好 300 字');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', E'第一行\n第二行') $$, '可以換行');
select is(tests.remaining('bbbbbbbb-0000-0000-0000-000000000000'), 96, '被拒絕的留言不算次數（B 成功 4 則）');

/* ========== 讀取 ========== */
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from public.comments where brew_id = 'a1a1a1a1-0000-0000-0000-000000000000'), 7::bigint, 'B 讀得到 A 貼文的全部留言');
select tests.login_as('eeeeeeee-0000-0000-0000-000000000000');
select is((select count(*) from public.comments where brew_id = 'a1a1a1a1-0000-0000-0000-000000000000'), 7::bigint,
  'E（A 的好友，不是 B、D 的好友）也讀得到');

select tests.login_as('cccccccc-0000-0000-0000-000000000000');
select is((select count(*) from public.comments), 0::bigint, 'C（不是好友）讀不到任何留言');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', 'C 想留言') $$,
  '42501', null, 'C 不能在 A 的貼文留言');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, parent_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', tests.cid('A 回覆 B'), 'x') $$,
  '42501', null, 'C 探測留言（回覆的回覆）也只得到權限錯誤，不透露留言存在');

select tests.as_anon();
select throws_ok($$ select * from public.comments $$, '42501', null, '未登入：讀不到留言');
select throws_ok($$ select public.comment_activity() $$, '42501', null, '未登入：不能查通知');

/* ========== 通知：只查目前登入的人 ========== */
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select is((public.comment_activity()->>'post_comments')::int, 6, 'A：我貼文的新留言 6 則（不含自己的）');
select is((public.comment_activity()->>'replies')::int, 0, 'A：別人貼文上回覆我的 0 則');
select is((public.comment_activity()->'posts')::text, '["aaaaaaaa-0000-0000-0000-000000000000/a1a1a1a1-0000-0000-0000-000000000000"]',
  'A：有新留言的貼文');
select is((public.comment_activity(now(), now())->>'post_comments')::int, 0, 'A：從看過的時間之後沒有新的');
select ok(public.comment_activity()->>'latest_post_comment_at' is not null, '回傳最新一則的時間');
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((public.comment_activity()->>'replies')::int, 2, 'B：回覆我的主留言 2 則（A 回覆 B、D 回覆 A）');
select is((public.comment_activity()->>'post_comments')::int, 0, 'B：自己的貼文沒有留言');
select tests.login_as('dddddddd-0000-0000-0000-000000000000');
select is((public.comment_activity()->>'replies')::int, 1, 'D：@D 的回覆 1 則');
select tests.login_as('cccccccc-0000-0000-0000-000000000000');
select is(public.comment_activity()::text, '{"post_comments" : 0, "replies" : 0, "latest_post_comment_at" : null, "latest_reply_at" : null, "posts" : []}',
  'C：什麼都沒有（讀不到別人的）');

/* ========== 刪除 ========== */
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
delete from public.comments where body = 'A 回覆 B';
select is(tests.n('A 回覆 B'), 1::bigint, 'B 不能刪別人的留言（在別人的貼文上）');
select tests.login_as('dddddddd-0000-0000-0000-000000000000');
delete from public.comments where body = 'B 回覆 D';
select is(tests.n('B 回覆 D'), 1::bigint, 'D 不能刪回覆自己的留言');
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
delete from public.comments where body in ('D 的主留言', 'B 回覆 D');
select is(tests.n('D 的主留言') + tests.n('B 回覆 D'), 0::bigint, 'A 能刪自己貼文下任何人的留言');
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
delete from public.comments where body = 'B 的主留言';
select is(tests.n('B 的主留言'), 0::bigint, 'B 刪掉自己的主留言');
select is(tests.n('A 回覆 B') + tests.n('D 回覆 A'), 0::bigint, '刪主留言時回覆一起刪');

/* ========== 封鎖 ========== */
-- 封鎖前：A、D 都在 B 的貼文留言；A 在 B 的主留言下回覆；D 在 A 的貼文留言
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1b1b1b1-0000-0000-0000-000000000000', 'A 在 B 的貼文') $$, 'A 在 B 的貼文留言');
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1b1b1b1-0000-0000-0000-000000000000', 'B 自己的主留言') $$, 'B 在自己的貼文留言');
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, parent_id, body)
  values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1b1b1b1-0000-0000-0000-000000000000', tests.cid('B 自己的主留言'), 'A 在 B 串裡') $$,
  'A 回覆 B 的主留言');
select tests.login_as('dddddddd-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1b1b1b1-0000-0000-0000-000000000000', 'D 在 B 的貼文') $$, 'D 在 B 的貼文留言');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', 'D 在 A 的貼文') $$, 'D 在 A 的貼文留言');

select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
insert into public.blocks (blocked) values ('dddddddd-0000-0000-0000-000000000000');
select is(tests.n('D 在 A 的貼文'), 0::bigint, '封鎖時（好友關係刪除）D 在 A 貼文的留言一起刪');
select is((select count(*) from public.comments where body = 'D 在 B 的貼文'), 0::bigint, 'A 看不到 D 在共同好友貼文的留言');
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from public.comments where brew_id = 'b1b1b1b1-0000-0000-0000-000000000000'), 4::bigint, 'B 照樣看得到 A、D 兩人的留言');

select tests.login_as('dddddddd-0000-0000-0000-000000000000');
select is((select count(*) from public.comments where author = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint,
  'D 看不到 A 的任何留言（包括在 B 的貼文上）');
select is((select count(*) from public.comments where brew_owner = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint, 'D 看不到 A 貼文的留言');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', 'D 想留言') $$,
  '42501', null, 'D 不能在 A 的貼文留言（和 C 一樣的錯誤）');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, parent_id, body)
  values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1b1b1b1-0000-0000-0000-000000000000', tests.cid('A 在 B 的貼文'), 'x') $$,
  '23503', null, 'D 不能回覆 A 在共同好友貼文的留言（和不存在一樣）');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, parent_id, reply_to_user, body)
  values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1b1b1b1-0000-0000-0000-000000000000', tests.cid('B 自己的主留言'),
          'aaaaaaaa-0000-0000-0000-000000000000', 'x') $$,
  '23514', null, 'D 不能 @A');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, parent_id, body)
  values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1b1b1b1-0000-0000-0000-000000000000', tests.cid('B 自己的主留言'), 'D 在 B 串裡') $$,
  'D 照樣能回覆 B 的留言');

/* ========== 解除好友 ========== */
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', 'B 再留一則') $$, 'B 在 A 的貼文留言');
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
delete from public.friendships where requester = 'aaaaaaaa-0000-0000-0000-000000000000' and addressee = 'bbbbbbbb-0000-0000-0000-000000000000';
select is(tests.n('B 再留一則'), 0::bigint, '解除好友：B 在 A 貼文的留言刪除');
select is(tests.n('A 在 B 的貼文') + tests.n('A 在 B 串裡'), 0::bigint, '解除好友：A 在 B 貼文的留言刪除');
select is(tests.n('B 自己的主留言') + tests.n('D 在 B 的貼文'), 2::bigint, '其他人的留言不受影響');

/* ========== 改回只有我（雲端刪除這筆紀錄） ========== */
select tests.login_as('eeeeeeee-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a2a2a2a2-0000-0000-0000-000000000000', 'E 在 a2') $$, 'E 在 A 的 a2 留言');
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
delete from public.shared_brews where id = 'a2a2a2a2-0000-0000-0000-000000000000';
select is(tests.n('E 在 a2'), 0::bigint, '貼文刪除（改回只有我）時留言全刪');

/* ========== 刪除帳號 ========== */
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', 'A 主留言') $$, 'A 在自己的貼文留言');
select tests.login_as('eeeeeeee-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, parent_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', tests.cid('A 主留言'), 'E 回覆 A') $$, 'E 回覆');
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, parent_id, reply_to_user, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', tests.cid('A 主留言'),
          'eeeeeeee-0000-0000-0000-000000000000', 'A 回覆 E') $$, 'A @E');
select tests.as_admin();
delete from auth.users where id = 'eeeeeeee-0000-0000-0000-000000000000';
select is(tests.n('E 回覆 A'), 0::bigint, '刪除帳號：E 的留言一起刪');
select is((select row(reply_to_user, reply_to_nickname)::text from public.comments where body = 'A 回覆 E'), '(,)',
  '刪除帳號：別人 @E 的回覆不再留著 E 的 id 與暱稱');

/* ========== 每天 100 則 ========== */
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, body)
  select 'aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', '一次塞 ' || n from generate_series(1, 101) n $$,
  'P0001', null, '一次新增 101 則也被擋下');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, body)
  select 'aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', '第 ' || n || ' 則'
  from generate_series(1, tests.remaining('aaaaaaaa-0000-0000-0000-000000000000')) n $$, 'A 用完今天的 100 則');
select throws_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', '第 101 則') $$,
  'P0001', null, '第 101 則被擋下');
select tests.login_as('dddddddd-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('bbbbbbbb-0000-0000-0000-000000000000', 'b1b1b1b1-0000-0000-0000-000000000000', 'D 不受 A 的上限影響') $$, '上限各自計算');

select * from finish();
rollback;
