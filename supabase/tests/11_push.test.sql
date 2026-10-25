-- 推播通知：訂閱與偏好的權限、10 台上限、endpoint 限制；comments_push 通知誰、合併、封鎖、停權、偏好、內容
-- A、B、E 互為好友（E 只和 A）；C 不是任何人的好友；D 是 A、B 的好友
-- （每個檔案在交易中執行，結束 rollback；pg_net 的佇列 net.http_request_queue 在 commit 前看得到、rollback 後不會送出）
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
-- 不受 RLS 影響的計數（測試用）
create function tests.subs(uid uuid) returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.push_subscriptions where user_id = uid
$$;
grant execute on function tests.subs(uuid) to authenticated;
-- pg_net 佇列：送出幾次、最後一次送出的內容
create function tests.pushes() returns bigint language sql security definer set search_path = '' as $$
  select count(*) from net.http_request_queue
$$;
create function tests.last_push() returns jsonb language sql security definer set search_path = '' as $$
  select convert_from(body, 'utf8')::jsonb from net.http_request_queue order by id desc limit 1
$$;
create function tests.last_push_headers() returns jsonb language sql security definer set search_path = '' as $$
  select headers from net.http_request_queue order by id desc limit 1
$$;
-- 最後一次送給誰：'<user_id>:<kind>' 排序後用逗號連起來
create function tests.last_recipients() returns text language sql security definer set search_path = '' as $$
  select string_agg((r->>'user_id') || ':' || (r->>'kind'), ',' order by r->>'user_id')
  from jsonb_array_elements(tests.last_push()->'recipients') r
$$;
-- 每個情境開始前：清掉佇列與合併狀態
create function tests.reset() returns void language sql security definer set search_path = '' as $$
  delete from net.http_request_queue; delete from private.push_throttle;
$$;
grant execute on function tests.pushes(), tests.last_push(), tests.last_recipients(), tests.reset() to authenticated;
create function tests.endpoint(n text) returns text language sql immutable as $$
  select 'https://fcm.googleapis.com/fcm/send/' || n
$$;
create function tests.p256dh() returns text language sql immutable as $$ select 'B' || repeat('A', 86) $$;
create function tests.auth() returns text language sql immutable as $$ select repeat('A', 22) $$;
grant execute on function tests.endpoint(text), tests.p256dh(), tests.auth() to authenticated;

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
-- A 的貼文 a1–a6、E 的貼文 e1
insert into public.shared_brews (owner, id, bean_name, brewed_at, coffee_g, water_g)
select 'aaaaaaaa-0000-0000-0000-000000000000', ('a' || n || 'a' || n || 'a' || n || 'a' || n || '-0000-0000-0000-000000000000')::uuid, 'A 的豆子', now(), 15, 240
from generate_series(1, 6) n;
insert into public.shared_brews (owner, id, bean_name, brewed_at, coffee_g, water_g) values
  ('eeeeeeee-0000-0000-0000-000000000000', 'e1e1e1e1-0000-0000-0000-000000000000', 'E 的豆子', now(), 15, 240);

/* ===== 1. push_subscriptions：自己的 ===== */

select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$
  insert into public.push_subscriptions (endpoint, p256dh, auth, user_agent)
  values (tests.endpoint('a-1'), tests.p256dh(), tests.auth(), 'Mozilla/5.0 (iPhone)')
$$, 'A 新增自己的訂閱');
select is((select user_id from public.push_subscriptions where endpoint = tests.endpoint('a-1')),
  'aaaaaaaa-0000-0000-0000-000000000000'::uuid, 'user_id 由資料庫用 auth.uid() 決定');
select throws_ok($$
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values ('bbbbbbbb-0000-0000-0000-000000000000', tests.endpoint('fake-b'), tests.p256dh(), tests.auth())
$$, '42501', null, '不能替別人新增（user_id 沒有 insert 權限）');
select throws_ok($$
  update public.push_subscriptions set p256dh = tests.p256dh() where endpoint = tests.endpoint('a-1')
$$, '42501', null, '不能修改訂閱');

-- endpoint 只能是已知推播服務的 https 網址
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth)
  values ('http://fcm.googleapis.com/fcm/send/x', tests.p256dh(), tests.auth()) $$, '23514', null, 'http 被拒絕');
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth)
  values ('https://evil.example.com/fcm/send/x', tests.p256dh(), tests.auth()) $$, '23514', null, '不在清單的網域被拒絕');
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth)
  values ('https://fcm.googleapis.com.evil.com/x', tests.p256dh(), tests.auth()) $$, '23514', null, '假冒的子網域被拒絕');
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth)
  values ('https://fcm.googleapis.com@kong:8000/rest/v1/', tests.p256dh(), tests.auth()) $$, '23514', null, '帳密形式（@）被拒絕');
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth)
  values ('https://fcm.googleapis.com/' || repeat('x', 1000), tests.p256dh(), tests.auth()) $$, '23514', null, '超過 1000 字被拒絕');
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth)
  values (tests.endpoint('bad-key'), 'not-a-key', tests.auth()) $$, '23514', null, 'p256dh 格式不對被拒絕');
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth)
  values (tests.endpoint('bad-auth'), tests.p256dh(), 'short') $$, '23514', null, 'auth 格式不對被拒絕');
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth, user_agent)
  values (tests.endpoint('bad-ua'), tests.p256dh(), tests.auth(), E'a\nb') $$, '23514', null, 'user_agent 有換行被拒絕');
select lives_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth) values
  ('https://web.push.apple.com/QGx-_y', tests.p256dh(), tests.auth()),
  ('https://updates.push.services.mozilla.com/wpush/v2/gAAA', tests.p256dh(), tests.auth()),
  ('https://wns2-par02p.notify.windows.com/w/?token=AAA%3d', tests.p256dh(), tests.auth())
$$, 'Apple、Mozilla、Microsoft 的推播服務都可以');

-- 每人最多 10 台
select lives_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth)
  select tests.endpoint('a-more-' || n), tests.p256dh(), tests.auth() from generate_series(1, 6) n $$, 'A 有 10 台裝置');
select is(tests.subs('aaaaaaaa-0000-0000-0000-000000000000'), 10::bigint, 'A 剛好 10 筆');
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth)
  values (tests.endpoint('a-11'), tests.p256dh(), tests.auth()) $$, 'P0001', 'too many devices', '第 11 台被拒絕');

/* ===== 2. 別人的訂閱 ===== */

select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from public.push_subscriptions), 0::bigint, 'B 讀不到 A 的訂閱');
select is((select count(*) from public.push_subscriptions where endpoint = tests.endpoint('a-1')), 0::bigint, '指定 endpoint 也讀不到');
delete from public.push_subscriptions where endpoint = tests.endpoint('a-1');
select is(tests.subs('aaaaaaaa-0000-0000-0000-000000000000'), 10::bigint, 'B 刪不掉 A 的訂閱');
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth)
  values (tests.endpoint('a-1'), tests.p256dh(), tests.auth()) $$, '23505', null, '同一個 endpoint 不能有兩筆');
select lives_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth)
  values (tests.endpoint('b-1'), tests.p256dh(), tests.auth()) $$, 'B 新增自己的訂閱（A 的 10 台不影響 B）');

select tests.as_anon();
select throws_ok($$ select count(*) from public.push_subscriptions $$, '42501', null, 'anon 讀不到訂閱');
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth)
  values (tests.endpoint('anon'), tests.p256dh(), tests.auth()) $$, '42501', null, 'anon 不能新增');

select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
delete from public.push_subscriptions where endpoint like tests.endpoint('a-more-%');
select is(tests.subs('aaaaaaaa-0000-0000-0000-000000000000'), 4::bigint, 'A 刪得掉自己的');

/* ===== 3. notification_prefs ===== */

select lives_ok($$ insert into public.notification_prefs (comments, replies) values (true, false) $$, 'A 新增自己的偏好');
select lives_ok($$ insert into public.notification_prefs (comments, replies) values (false, false)
  on conflict (user_id) do update set comments = excluded.comments, replies = excluded.replies $$, 'A 用 upsert 修改');
select is((select comments::text || replies::text from public.notification_prefs), 'falsefalse', 'A 讀得到自己的偏好');
select throws_ok($$ insert into public.notification_prefs (user_id, comments) values ('bbbbbbbb-0000-0000-0000-000000000000', false) $$,
  '42501', null, '不能替別人新增偏好');
update public.notification_prefs set comments = true, replies = true;
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select is((select count(*) from public.notification_prefs), 0::bigint, 'B 讀不到 A 的偏好');
update public.notification_prefs set comments = false where user_id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.as_admin();
select is((select comments from public.notification_prefs where user_id = 'aaaaaaaa-0000-0000-0000-000000000000'), true, 'B 改不了 A 的偏好');

/* ===== 4. 不從 API 公開的 ===== */

select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select throws_ok($$ select count(*) from private.push_throttle $$, '42501', null, '使用者讀不到合併的狀態');
select throws_ok($$ select count(*) from vault.decrypted_secrets $$, '42501', null, '使用者讀不到 vault');
select ok(not has_function_privilege('authenticated', 'private.comments_push()', 'execute'), 'authenticated 不能執行 comments_push');
select ok(not has_function_privilege('anon', 'private.comments_push()', 'execute'), 'anon 不能執行 comments_push');

/* ===== 5. 留言後通知 ===== */

select tests.as_admin();
-- C 沒有訂閱（之後才加），其他人都有
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('dddddddd-0000-0000-0000-000000000000', tests.endpoint('d-1'), tests.p256dh(), tests.auth()),
  ('eeeeeeee-0000-0000-0000-000000000000', tests.endpoint('e-1'), tests.p256dh(), tests.auth());

-- vault 還沒設定：照常留言，不送
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a6a6a6a6-0000-0000-0000-000000000000', '還沒設定推播') $$, '沒設定推播也能留言');
select is(tests.pushes(), 0::bigint, '沒設定推播：不送');

select tests.as_admin();
select vault.create_secret('http://example.invalid/functions/v1/send-push', 'send_push_url');
select vault.create_secret('test-push-secret', 'push_webhook_secret');
select tests.reset();

-- B 留言 A 的貼文 → 通知 A（新留言）
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a1a1a1a1-0000-0000-0000-000000000000', '秘密的留言內容 B1');
select is(tests.pushes(), 1::bigint, 'B 留言 A 的貼文：送出一次');
select is(tests.last_recipients(), 'aaaaaaaa-0000-0000-0000-000000000000:comment', '通知 A，類型是新留言');
select tests.as_admin();
select is(tests.last_push()->>'actor_nickname', 'Bob', '附上留言者的暱稱');
select is(tests.last_push()->>'brew_owner', 'aaaaaaaa-0000-0000-0000-000000000000', '附上貼文作者');
select is(tests.last_push()->>'brew_id', 'a1a1a1a1-0000-0000-0000-000000000000', '附上貼文 id');
select ok(abs(extract(epoch from clock_timestamp()) - (tests.last_push()->>'sent_at')::numeric) < 5, '附上送出時間（秒）');
select ok(position('秘密' in tests.last_push()::text) = 0, '送出的內容沒有留言原文');
select is((select array_agg(k order by k) from jsonb_object_keys(tests.last_push()) k),
  array['actor_nickname', 'brew_id', 'brew_owner', 'recipients', 'sent_at'], '送出的欄位只有這五個');
select is((select headers->>'x-push-signature' from net.http_request_queue order by id desc limit 1),
  (select encode(extensions.hmac(convert_from(body, 'utf8'), 'test-push-secret', 'sha256'), 'hex') from net.http_request_queue order by id desc limit 1),
  'header 是內容的 HMAC-SHA256');
select ok((select position('test-push-secret' in headers::text || convert_from(body, 'utf8')) = 0 from net.http_request_queue order by id desc limit 1),
  '佇列裡沒有密鑰本身（net.* 是 Supabase 預設的權限）');
select is((select url from net.http_request_queue order by id desc limit 1), 'http://example.invalid/functions/v1/send-push', '送到 vault 的網址');

-- A 在自己的貼文回覆 B → 通知 B（回覆），不通知 A 自己
select tests.reset();
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, parent_id, body)
  select brew_owner, brew_id, id, 'A 回覆 B' from public.comments where body = '秘密的留言內容 B1';
select is(tests.pushes(), 1::bigint, 'A 回覆 B：送出一次');
select is(tests.last_recipients(), 'bbbbbbbb-0000-0000-0000-000000000000:reply', '只通知 B（回覆），不通知 A 自己');

-- 自己留言自己的貼文：不送
select tests.reset();
insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a2a2a2a2-0000-0000-0000-000000000000', 'A 自己留言');
select is(tests.pushes(), 0::bigint, '自己留言自己的貼文：不送');

-- D 在 A 的主留言下回覆 @B（B 在這一串回覆過）：通知 A（貼文作者優先算新留言）和 B（回覆）
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, parent_id, body)
  select brew_owner, brew_id, id, 'B 回覆 A 自己的留言' from public.comments where body = 'A 自己留言';
select tests.reset();
select tests.login_as('dddddddd-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, parent_id, reply_to_user, body)
  select brew_owner, brew_id, id, 'bbbbbbbb-0000-0000-0000-000000000000', 'D 回覆 @B'
  from public.comments where body = 'A 自己留言';
select is(tests.pushes(), 1::bigint, '一則留言只呼叫一次 function');
select is(tests.last_recipients(),
  'aaaaaaaa-0000-0000-0000-000000000000:comment,bbbbbbbb-0000-0000-0000-000000000000:reply',
  '回覆：貼文作者（也是主留言作者）算新留言、@ 的人算回覆，各一次');

-- 別人貼文上的回覆：主留言作者收到回覆
select tests.reset();
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, body)
  values ('eeeeeeee-0000-0000-0000-000000000000', 'e1e1e1e1-0000-0000-0000-000000000000', 'A 在 E 的貼文');
select is(tests.last_recipients(), 'eeeeeeee-0000-0000-0000-000000000000:comment', 'A 留言 E 的貼文：通知 E');
select tests.reset();
select tests.login_as('eeeeeeee-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, parent_id, body)
  select brew_owner, brew_id, id, 'E 回覆 A' from public.comments where body = 'A 在 E 的貼文';
select is(tests.last_recipients(), 'aaaaaaaa-0000-0000-0000-000000000000:reply', '在 E 的貼文回覆 A：通知 A（回覆）');

/* ----- 5 分鐘合併 ----- */
select tests.reset();
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a3a3a3a3-0000-0000-0000-000000000000', 'a3 第一則');
select is(tests.pushes(), 1::bigint, 'a3 第一則：送出');
select tests.login_as('dddddddd-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a3a3a3a3-0000-0000-0000-000000000000', 'a3 第二則（別人）');
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a3a3a3a3-0000-0000-0000-000000000000', 'a3 第三則');
select is(tests.pushes(), 1::bigint, '5 分鐘內同一篇的其他留言（不管誰留的）：不再送（合併）');
insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a4a4a4a4-0000-0000-0000-000000000000', 'a4 第一則');
select is(tests.pushes(), 2::bigint, '別篇貼文照常送');
select tests.as_admin();
update private.push_throttle set sent_at = now() - interval '4 minutes 59 seconds'
  where brew_id = 'a3a3a3a3-0000-0000-0000-000000000000';
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a3a3a3a3-0000-0000-0000-000000000000', 'a3 4 分 59 秒後');
select is(tests.pushes(), 2::bigint, '還沒滿 5 分鐘：不送');
select tests.as_admin();
update private.push_throttle set sent_at = now() - interval '5 minutes'
  where brew_id = 'a3a3a3a3-0000-0000-0000-000000000000';
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a3a3a3a3-0000-0000-0000-000000000000', 'a3 5 分鐘後');
select is(tests.pushes(), 3::bigint, '滿 5 分鐘：再送一次');
select is(tests.last_recipients(), 'aaaaaaaa-0000-0000-0000-000000000000:comment', '還是通知 A');

/* ----- 封鎖 ----- */
-- 正常流程下封鎖的雙方本來就不能互相回覆（comments_before_insert 擋下）；
-- 這裡用管理者身分直接新增（跳過那些檢查），確認推播這一層也不會通知
select tests.as_admin();
select tests.reset();
insert into public.blocks (blocker, blocked) values ('bbbbbbbb-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, author, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a5a5a5a5-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'B 在 a5');
select tests.reset();
insert into public.comments (brew_owner, brew_id, author, parent_id, body)
  select brew_owner, brew_id, 'dddddddd-0000-0000-0000-000000000000', id, 'D 回覆 B（B 封鎖了 D）'
  from public.comments where body = 'B 在 a5';
select is(tests.last_recipients(), 'aaaaaaaa-0000-0000-0000-000000000000:comment', 'B 封鎖了 D：D 的回覆只通知 A，不通知 B');
select tests.reset();
insert into public.blocks (blocker, blocked) values ('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, author, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a5a5a5a5-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000', 'D 在 a5（A 封鎖了 D）');
select is(tests.pushes(), 0::bigint, 'A 封鎖了 D：D 的留言不通知 A');
delete from public.blocks;
insert into public.blocks (blocker, blocked) values ('dddddddd-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, author, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a5a5a5a5-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000', 'D 在 a5（D 封鎖了 A）');
select is(tests.pushes(), 0::bigint, 'D 封鎖了 A：D 的留言也不通知 A（反方向）');
delete from public.blocks;

-- 收件人讀不到貼文：C 不是 A 的好友，不會因為主留言收到 A 貼文的通知
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('cccccccc-0000-0000-0000-000000000000', tests.endpoint('c-1'), tests.p256dh(), tests.auth());
insert into public.comments (brew_owner, brew_id, author, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a6a6a6a6-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000000', 'C 的舊留言（已不是好友）');
select tests.reset();
insert into public.comments (brew_owner, brew_id, author, parent_id, body)
  select brew_owner, brew_id, 'bbbbbbbb-0000-0000-0000-000000000000', id, 'B 回覆 C'
  from public.comments where body = 'C 的舊留言（已不是好友）';
select is(tests.last_recipients(), 'aaaaaaaa-0000-0000-0000-000000000000:comment', '讀不到貼文的人（C）不通知');
-- 貼文作者封鎖了主留言作者：讀不到貼文，也不通知
select tests.reset();
insert into public.comments (brew_owner, brew_id, author, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a4a4a4a4-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000', 'D 在 a4');
select tests.reset();
insert into public.blocks (blocker, blocked) values ('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, author, parent_id, body)
  select brew_owner, brew_id, 'bbbbbbbb-0000-0000-0000-000000000000', id, 'B 回覆 D（A 封鎖了 D）'
  from public.comments where body = 'D 在 a4';
select is(tests.last_recipients(), 'aaaaaaaa-0000-0000-0000-000000000000:comment', '貼文作者封鎖了主留言作者：不通知他');
delete from public.blocks;

/* ----- 偏好 ----- */
select tests.reset();
insert into public.notification_prefs (user_id, comments, replies) values ('eeeeeeee-0000-0000-0000-000000000000', false, true);
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, body)
  values ('eeeeeeee-0000-0000-0000-000000000000', 'e1e1e1e1-0000-0000-0000-000000000000', 'A 再留言 E（E 關掉新留言）');
select is(tests.pushes(), 0::bigint, 'E 關掉「新留言」：不送');
select tests.as_admin();
update public.notification_prefs set comments = true, replies = false;
select tests.login_as('eeeeeeee-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a2a2a2a2-0000-0000-0000-000000000000', 'E 在 a2');
select tests.reset();
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
insert into public.comments (brew_owner, brew_id, parent_id, body)
  select brew_owner, brew_id, id, 'A 回覆 E（E 關掉回覆）' from public.comments where body = 'E 在 a2';
select is(tests.pushes(), 0::bigint, 'E 關掉「回覆」：回覆不送');
select tests.reset();
insert into public.comments (brew_owner, brew_id, body)
  values ('eeeeeeee-0000-0000-0000-000000000000', 'e1e1e1e1-0000-0000-0000-000000000000', 'A 又留言 E（新留言開著）');
select is(tests.last_recipients(), 'eeeeeeee-0000-0000-0000-000000000000:comment', 'E 的「新留言」開著：照常送');

/* ----- 停權、沒有訂閱 ----- */
select tests.as_admin();
select tests.reset();
update auth.users set banned_until = now() + interval '1 day' where id = 'bbbbbbbb-0000-0000-0000-000000000000';
insert into public.comments (brew_owner, brew_id, author, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a6a6a6a6-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', '被停權的 B');
select is(tests.pushes(), 0::bigint, '留言者被停權：不送');
insert into public.comments (brew_owner, brew_id, parent_id, author, body)
  select brew_owner, brew_id, id, 'dddddddd-0000-0000-0000-000000000000', 'D 回覆被停權的 B' from public.comments where body = '被停權的 B';
select is(tests.last_recipients(), 'aaaaaaaa-0000-0000-0000-000000000000:comment', '收件人被停權：不通知 B（A 照常）');
update auth.users set banned_until = now() - interval '1 second' where id = 'bbbbbbbb-0000-0000-0000-000000000000';
select tests.reset();
insert into public.comments (brew_owner, brew_id, author, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a6a6a6a6-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', '停權到期的 B');
select is(tests.pushes(), 1::bigint, '停權到期：照常送');

select tests.reset();
delete from public.push_subscriptions where user_id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.comments (brew_owner, brew_id, author, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a6a6a6a6-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'A 沒有訂閱');
select is(tests.pushes(), 0::bigint, '收件人沒有訂閱：不送（不呼叫 function）');

/* ----- 推播出錯不影響留言 ----- */
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('aaaaaaaa-0000-0000-0000-000000000000', tests.endpoint('a-again'), tests.p256dh(), tests.auth());
select tests.reset();
-- 讓 net.http_post 出錯（網址不合法）
select vault.update_secret((select id from vault.decrypted_secrets where name = 'send_push_url'), 'not a url');
select lives_ok($$ insert into public.comments (brew_owner, brew_id, author, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'a6a6a6a6-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', '網址壞掉') $$,
  '推播的網址壞掉：留言照樣成功');
select is((select count(*) from public.comments where body = '網址壞掉'), 1::bigint, '留言確實存下來了');

/* ===== 6. 刪除帳號：訂閱、偏好、合併狀態一起刪 ===== */
delete from auth.users where id = 'eeeeeeee-0000-0000-0000-000000000000';
select is(tests.subs('eeeeeeee-0000-0000-0000-000000000000'), 0::bigint, '刪除帳號：訂閱 cascade 刪除');
select is((select count(*) from public.notification_prefs where user_id = 'eeeeeeee-0000-0000-0000-000000000000'), 0::bigint, '刪除帳號：偏好 cascade 刪除');
select is((select count(*) from private.push_throttle where recipient = 'eeeeeeee-0000-0000-0000-000000000000'), 0::bigint, '刪除帳號：合併狀態 cascade 刪除');

select * from finish();
rollback;
