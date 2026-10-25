-- 推播通知擴充：好友新貼文（shared_brews_push）、按讚（likes_push）、偏好的新欄位、30 分鐘合併
-- A 的好友：B、D、E、F；C 不是任何人的好友；E 封鎖了 A、A 封鎖了 F（封鎖不解除好友）
-- （每個檔案在交易中執行，結束 rollback；整個檔案的 now() 是同一個時間，合併視窗用改 started_at 模擬過了 30 分鐘）
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
create function tests.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function tests.pushes() returns bigint language sql security definer set search_path = '' as $$
  select count(*) from net.http_request_queue
$$;
create function tests.last_push() returns jsonb language sql security definer set search_path = '' as $$
  select convert_from(body, 'utf8')::jsonb from net.http_request_queue order by id desc limit 1
$$;
-- 最後一次送給誰：'<名字首字>:<kind>:<count>:<quiet>' 排序後用逗號連起來
create function tests.last_recipients() returns text language sql security definer set search_path = '' as $$
  select string_agg(left(r->>'user_id', 1) || ':' || (r->>'kind') || ':' || (r->>'count') || ':' || (r->>'quiet'), ',' order by r->>'user_id')
  from jsonb_array_elements(tests.last_push()->'recipients') r
$$;
create function tests.reset() returns void language sql security definer set search_path = '' as $$
  delete from net.http_request_queue;
$$;
grant execute on function tests.pushes(), tests.last_push(), tests.last_recipients(), tests.reset() to authenticated;
create function tests.brew(n text) returns uuid language sql immutable as $$
  select (repeat(n, 8) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function tests.brew(text) to authenticated;

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a@test.local', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'b@test.local', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000000', 'c@test.local', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000000', 'd@test.local', 'authenticated', 'authenticated'),
  ('eeeeeeee-0000-0000-0000-000000000000', 'e@test.local', 'authenticated', 'authenticated'),
  ('ffffffff-0000-0000-0000-000000000000', 'f@test.local', 'authenticated', 'authenticated');
insert into public.profiles (id, nickname) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Alice'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Bob'),
  ('cccccccc-0000-0000-0000-000000000000', 'Carol'),
  ('dddddddd-0000-0000-0000-000000000000', 'Dave'),
  ('eeeeeeee-0000-0000-0000-000000000000', 'Eve'),
  ('ffffffff-0000-0000-0000-000000000000', 'Frank');
insert into public.friendships (requester, addressee, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'accepted'),
  ('dddddddd-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'accepted'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000000', 'accepted'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000000', 'accepted'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000', 'accepted');
insert into public.blocks (blocker, blocked) values
  ('eeeeeeee-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000000');
-- 每個人都有訂閱
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
select id, 'https://fcm.googleapis.com/fcm/send/' || id, 'B' || repeat('A', 86), repeat('A', 22) from public.profiles;

/* ===== 1. 偏好的新欄位 ===== */

select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
insert into public.notification_prefs (comments) values (true);
select is((select array[new_posts, likes] from public.notification_prefs), array[false, true], '預設：好友新貼文關、按讚開');
select lives_ok($$ update public.notification_prefs set new_posts = true, likes = false $$, '改自己的兩個新開關');
select is((select array[new_posts, likes] from public.notification_prefs), array[true, false], '存下來了');
select lives_ok($$ update public.notification_prefs set comments = false, replies = true $$, '舊版只改 comments、replies');
select is((select array[new_posts, likes] from public.notification_prefs), array[true, false], '舊版的更新不會改到新開關');
select tests.login_as('cccccccc-0000-0000-0000-000000000000');
update public.notification_prefs set new_posts = false, likes = true where user_id = 'bbbbbbbb-0000-0000-0000-000000000000';
select tests.as_admin();
select is((select array[new_posts, likes] from public.notification_prefs where user_id = 'bbbbbbbb-0000-0000-0000-000000000000'),
  array[true, false], 'C 改不了 B 的新開關');
-- B、C、E、F 打開好友新貼文；D 沒有偏好（預設關）；B 的按讚先開回來
update public.notification_prefs set comments = true, likes = true where user_id = 'bbbbbbbb-0000-0000-0000-000000000000';
insert into public.notification_prefs (user_id, new_posts) values
  ('cccccccc-0000-0000-0000-000000000000', true),
  ('eeeeeeee-0000-0000-0000-000000000000', true),
  ('ffffffff-0000-0000-0000-000000000000', true);

/* ===== 2. 不從 API 公開的 ===== */

select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select throws_ok($$ select count(*) from private.push_notified_posts $$, '42501', null, '使用者讀不到通知過的貼文');
select throws_ok($$ select count(*) from private.push_notified_likes $$, '42501', null, '使用者讀不到通知過的讚');
select throws_ok($$ select count(*) from private.push_windows $$, '42501', null, '使用者讀不到合併的狀態');
select throws_ok($$ select private.push_send('{}'::jsonb) $$, '42501', null, '使用者不能自己送推播');
select throws_ok($$ select private.push_window('aaaaaaaa-0000-0000-0000-000000000000', 'x') $$, '42501', null, '使用者不能改合併狀態');
select ok(not has_function_privilege('authenticated', 'private.shared_brews_push()', 'execute'), 'authenticated 不能執行 shared_brews_push');
select ok(not has_function_privilege('authenticated', 'private.likes_push()', 'execute'), 'authenticated 不能執行 likes_push');
select ok(not has_function_privilege('anon', 'private.push_ready()', 'execute'), 'anon 不能執行 push_ready');

/* ===== 3. 好友新貼文 ===== */

-- vault 還沒設定：照常上傳、不送，但記下「通知過了」（之後設定好也不會補通知這一篇）
insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g) values (tests.brew('1'), '沒設定推播', now(), 15, 240);
select is(tests.pushes(), 0::bigint, '沒設定推播：不送');

select tests.as_admin();
select vault.create_secret('http://example.invalid/functions/v1/send-push', 'send_push_url');
select vault.create_secret('test-push-secret', 'push_webhook_secret');
select tests.reset();

select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g, notes)
  values (tests.brew('2'), '衣索比亞 耶加雪菲 科契爾 日曬 G1 這是一個超過三十個字的豆子名稱喔', now(), 15, 240, '秘密的筆記');
select is(tests.pushes(), 1::bigint, 'A 分享新紀錄：送出一次');
select is(tests.last_recipients(), 'b:post:1:false', '只通知 B（好友、開著）：不通知 C（非好友）、D（預設關）、E（E 封鎖 A）、F（A 封鎖 F）');
select tests.as_admin();
select is(tests.last_push()->>'actor_nickname', 'Alice', '附上發文者暱稱');
select is(tests.last_push()->>'bean_name', '衣索比亞 耶加雪菲 科契爾 日曬 G1 這是一個超過三十個字', '附上豆子名稱（最多 30 字）');
select is(char_length(tests.last_push()->>'bean_name'), 30, '…剛好 30 字');
select is(tests.last_push()->>'brew_id', tests.brew('2')::text, '附上貼文 id');
select ok(position('秘密' in tests.last_push()::text) = 0, '送出的內容沒有筆記');
select is((select array_agg(k order by k) from jsonb_object_keys(tests.last_push()) k),
  array['actor_nickname', 'bean_name', 'brew_id', 'brew_owner', 'recipients', 'sent_at'], '送出的欄位只有這六個');
select is((select headers->>'x-push-signature' from net.http_request_queue order by id desc limit 1),
  (select encode(extensions.hmac(convert_from(body, 'utf8'), 'test-push-secret', 'sha256'), 'hex') from net.http_request_queue order by id desc limit 1),
  'header 是內容的 HMAC-SHA256');
select ok((select position('test-push-secret' in headers::text || convert_from(body, 'utf8')) = 0 from net.http_request_queue order by id desc limit 1),
  '佇列裡沒有密鑰本身');

-- 修改不算
select tests.reset();
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
update public.shared_brews set notes = '改筆記', bean_name = '改名' where id = tests.brew('2');
select is(tests.pushes(), 0::bigint, '修改舊貼文：不送');
-- 改回只有我（刪掉）再分享：不算
delete from public.shared_brews where id = tests.brew('2');
insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g) values (tests.brew('2'), '再分享', now(), 15, 240);
select is(tests.pushes(), 0::bigint, '改回只有我再分享：不再通知');
delete from public.shared_brews where id = tests.brew('1');
insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g) values (tests.brew('1'), '設定前分享過', now(), 15, 240);
select is(tests.pushes(), 0::bigint, '推播設定前分享過的：再分享也不通知');

-- 30 分鐘內第二篇：同一個視窗，安靜取代
insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g) values (tests.brew('3'), '第二篇', now(), 15, 240);
select is(tests.last_recipients(), 'b:post:2:true', '30 分鐘內第二篇：照樣送，count 2、quiet');
select tests.as_admin();
update private.push_windows set started_at = now() - interval '31 minutes'
  where recipient = 'bbbbbbbb-0000-0000-0000-000000000000' and key = 'friend:aaaaaaaa-0000-0000-0000-000000000000';
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g) values (tests.brew('4'), '第三篇', now(), 15, 240);
select is(tests.last_recipients(), 'b:post:1:false', '超過 30 分鐘：重新開始（響）');

-- B 發文：A、D 是 B 的好友；A 沒開、D 打開後才收到
select tests.reset();
select tests.as_admin();
insert into public.notification_prefs (user_id, new_posts) values ('dddddddd-0000-0000-0000-000000000000', true);
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g) values (tests.brew('5'), 'B 的豆子', now(), 15, 240);
select is(tests.last_recipients(), 'd:post:1:false', 'B 發文：只通知打開的 D（A 沒有偏好＝預設關）');

-- 停權
select tests.as_admin();
select tests.reset();
update auth.users set banned_until = now() + interval '1 day' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.shared_brews (owner, id, bean_name, brewed_at, coffee_g, water_g)
  values ('aaaaaaaa-0000-0000-0000-000000000000', tests.brew('6'), '停權的 A', now(), 15, 240);
select is(tests.pushes(), 0::bigint, '發文者被停權：不送');
update auth.users set banned_until = null where id = 'aaaaaaaa-0000-0000-0000-000000000000';
update auth.users set banned_until = now() + interval '1 day' where id = 'dddddddd-0000-0000-0000-000000000000';
insert into public.shared_brews (owner, id, bean_name, brewed_at, coffee_g, water_g)
  values ('bbbbbbbb-0000-0000-0000-000000000000', tests.brew('7'), 'B 第二篇', now(), 15, 240);
select is(tests.pushes(), 0::bigint, '收件人被停權：不送');
update auth.users set banned_until = null where id = 'dddddddd-0000-0000-0000-000000000000';

-- 每天 30 筆：第 31 筆上傳被拒，所以也不會通知
select tests.reset();
insert into private.rate_events (user_id, kind)
select 'aaaaaaaa-0000-0000-0000-000000000000', 'brew_insert' from generate_series(1, 30 - private.count_today('aaaaaaaa-0000-0000-0000-000000000000', 'brew_insert'));
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select throws_ok($$ insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g) values (tests.brew('8'), '第 31 筆', now(), 15, 240) $$,
  'P0001', null, '第 31 筆上傳被拒');
select is(tests.pushes(), 0::bigint, '第 31 筆：不通知');

-- 好友很多：每 200 人一次
select tests.as_admin();
insert into auth.users (id, email, aud, role)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'many' || n || '@test.local', 'authenticated', 'authenticated' from generate_series(1, 201) n;
insert into public.profiles (id, nickname)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'M' || n from generate_series(1, 201) n;
insert into public.friendships (requester, addressee, status)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'cccccccc-0000-0000-0000-000000000000', 'accepted' from generate_series(1, 201) n;
insert into public.notification_prefs (user_id, new_posts)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, true from generate_series(1, 201) n;
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'https://fcm.googleapis.com/fcm/send/many-' || n, 'B' || repeat('A', 86), repeat('A', 22) from generate_series(1, 201) n;
select tests.reset();
select tests.login_as('cccccccc-0000-0000-0000-000000000000');
insert into public.shared_brews (id, bean_name, brewed_at, coffee_g, water_g) values (tests.brew('9'), 'C 的豆子', now(), 15, 240);
select is(tests.pushes(), 2::bigint, '201 位好友：分兩次送');
select tests.as_admin();
select is((select array_agg(jsonb_array_length(convert_from(body, 'utf8')::jsonb->'recipients') order by id) from net.http_request_queue),
  array[200, 1], '每次最多 200 人');

/* ===== 4. 按讚 ===== */

select tests.reset();
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
insert into public.likes (brew_owner, brew_id) values ('aaaaaaaa-0000-0000-0000-000000000000', tests.brew('3'));
select is(tests.pushes(), 1::bigint, 'B 按讚 A 的貼文：送出一次');
select is(tests.last_recipients(), 'a:like:1:false', '通知 A（第一個讚，響）');
select tests.as_admin();
select is(tests.last_push()->>'actor_nickname', 'Bob', '附上按讚者暱稱');
select is(tests.last_push()->>'brew_id', tests.brew('3')::text, '附上貼文 id');
select is((select array_agg(k order by k) from jsonb_object_keys(tests.last_push()) k),
  array['actor_nickname', 'brew_id', 'brew_owner', 'recipients', 'sent_at'], '送出的欄位只有這五個');

-- 收回再按：不重複
select tests.reset();
select tests.login_as('bbbbbbbb-0000-0000-0000-000000000000');
delete from public.likes where brew_owner = 'aaaaaaaa-0000-0000-0000-000000000000' and brew_id = tests.brew('3');
insert into public.likes (brew_owner, brew_id) values ('aaaaaaaa-0000-0000-0000-000000000000', tests.brew('3'));
select is(tests.pushes(), 0::bigint, '收回再按：不再通知');

-- 30 分鐘內第二個人：安靜取代（和其他 1 人）
select tests.login_as('dddddddd-0000-0000-0000-000000000000');
insert into public.likes (brew_owner, brew_id) values ('aaaaaaaa-0000-0000-0000-000000000000', tests.brew('3'));
select is(tests.last_recipients(), 'a:like:2:true', '30 分鐘內第二個讚：count 2、quiet');
select tests.as_admin();
select is(tests.last_push()->>'actor_nickname', 'Dave', '暱稱是最新按讚的人');
-- 別篇貼文是另一個視窗
select tests.reset();
select tests.login_as('dddddddd-0000-0000-0000-000000000000');
insert into public.likes (brew_owner, brew_id) values ('aaaaaaaa-0000-0000-0000-000000000000', tests.brew('4'));
select is(tests.last_recipients(), 'a:like:1:false', '別篇貼文：另外計算（響）');

-- 自己按自己的：不送
select tests.reset();
select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
insert into public.likes (brew_owner, brew_id) values ('aaaaaaaa-0000-0000-0000-000000000000', tests.brew('3'));
select is(tests.pushes(), 0::bigint, '自己按自己的讚：不送');

-- 封鎖：RLS 本來就讓雙方按不到，這裡直接新增確認 trigger 自己也擋（兩個方向）
select tests.as_admin();
select tests.reset();
insert into public.likes (brew_owner, brew_id, user_id) values ('aaaaaaaa-0000-0000-0000-000000000000', tests.brew('3'), 'eeeeeeee-0000-0000-0000-000000000000');
select is(tests.pushes(), 0::bigint, '按讚的人封鎖了作者：不送');
insert into public.likes (brew_owner, brew_id, user_id) values ('aaaaaaaa-0000-0000-0000-000000000000', tests.brew('3'), 'ffffffff-0000-0000-0000-000000000000');
select is(tests.pushes(), 0::bigint, '作者封鎖了按讚的人：不送');

-- 停權
update auth.users set banned_until = now() + interval '1 day' where id = 'bbbbbbbb-0000-0000-0000-000000000000';
insert into public.likes (brew_owner, brew_id, user_id) values ('aaaaaaaa-0000-0000-0000-000000000000', tests.brew('4'), 'bbbbbbbb-0000-0000-0000-000000000000');
select is(tests.pushes(), 0::bigint, '按讚的人被停權：不送');
update auth.users set banned_until = null where id = 'bbbbbbbb-0000-0000-0000-000000000000';
update auth.users set banned_until = now() + interval '1 day' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.likes (brew_owner, brew_id, user_id) values ('bbbbbbbb-0000-0000-0000-000000000000', tests.brew('5'), 'aaaaaaaa-0000-0000-0000-000000000000');
select is(tests.pushes(), 0::bigint, '…（被停權的人按讚也不送）');
update auth.users set banned_until = null where id = 'aaaaaaaa-0000-0000-0000-000000000000';
update auth.users set banned_until = now() + interval '1 day' where id = 'bbbbbbbb-0000-0000-0000-000000000000';
insert into public.likes (brew_owner, brew_id, user_id) values ('bbbbbbbb-0000-0000-0000-000000000000', tests.brew('5'), 'dddddddd-0000-0000-0000-000000000000');
select is(tests.pushes(), 0::bigint, '作者被停權：不送');
update auth.users set banned_until = null where id = 'bbbbbbbb-0000-0000-0000-000000000000';

-- 關掉「按讚」
update public.notification_prefs set likes = false where user_id = 'bbbbbbbb-0000-0000-0000-000000000000';
insert into public.likes (brew_owner, brew_id, user_id) values ('bbbbbbbb-0000-0000-0000-000000000000', tests.brew('7'), 'dddddddd-0000-0000-0000-000000000000');
select is(tests.pushes(), 0::bigint, '作者關掉「按讚」：不送');
update public.notification_prefs set likes = true where user_id = 'bbbbbbbb-0000-0000-0000-000000000000';
insert into public.likes (brew_owner, brew_id, user_id) values ('bbbbbbbb-0000-0000-0000-000000000000', tests.brew('7'), 'aaaaaaaa-0000-0000-0000-000000000000');
select is(tests.last_recipients(), 'b:like:1:false', '打開「按讚」後：照常送');

/* ===== 5. 推播出錯不影響上傳與按讚 ===== */
select tests.reset();
select vault.update_secret((select id from vault.decrypted_secrets where name = 'send_push_url'), 'not a url');
select lives_ok($$ insert into public.shared_brews (owner, id, bean_name, brewed_at, coffee_g, water_g)
  values ('bbbbbbbb-0000-0000-0000-000000000000', tests.brew('b'), '網址壞掉', now(), 15, 240) $$, '推播的網址壞掉：上傳照樣成功');
select lives_ok($$ insert into public.likes (brew_owner, brew_id, user_id)
  values ('bbbbbbbb-0000-0000-0000-000000000000', tests.brew('b'), 'aaaaaaaa-0000-0000-0000-000000000000') $$, '推播的網址壞掉：按讚照樣成功');

/* ===== 6. 刪除帳號：通知紀錄、合併狀態一起刪 ===== */
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select is((select count(*) from private.push_notified_posts where owner = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint, '刪除帳號：通知過的貼文 cascade 刪除');
select is((select count(*) from private.push_notified_likes where 'aaaaaaaa-0000-0000-0000-000000000000' in (brew_owner, user_id)), 0::bigint, '刪除帳號：通知過的讚 cascade 刪除');
select is((select count(*) from private.push_windows where recipient = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint, '刪除帳號：合併狀態 cascade 刪除');

select * from finish();
rollback;
