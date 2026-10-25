-- 同時送出的請求不能超過每日上限、互加好友不會撞到唯一索引（2026-10-25 安全檢查）
--
-- 原本「先數今天幾次、再記一筆」在兩個交易同時執行時，兩邊都數到同樣的次數，可以多塞幾筆。
-- 改成數之前先拿交易層級的 advisory lock（同一人＋同一種事件），同時的請求會排隊，交易結束自動釋放：
--   1. private.count_today：所有每日上限（brew_insert、friend_request、report、feedback、comment）都經過這裡
--      改成 volatile：每個查詢重新取快照，拿到鎖之後才看得到前一個交易剛 commit 的那筆
--   2. send_friend_request：每小時打錯代碼的計數也先鎖；找到對方後再鎖住「這兩個人」，
--      A→B、B→A 同時送出時，後面的會看到前面的邀請而直接成為好友（不會撞到 friendships_one_per_pair）
-- 回傳值、權限都和 20261025150000_block_keeps_friends.sql 相同

/* ===== 1. 鎖 ===== */

-- 同一個 key 同時只有一個交易能往下走；交易結束（commit 或 rollback）自動釋放
create function private.lock_key(key text)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(key, 0))
$$;

/* ===== 2. 每日上限的計數 ===== */

create or replace function private.count_today(uid uuid, event_kind text)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.lock_key('rate:' || uid::text || ':' || event_kind);
  return (
    select count(*) from private.rate_events
    where user_id = uid and kind = event_kind
      and at >= (date_trunc('day', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei')
  );
end
$$;

/* ===== 3. send_friend_request ===== */

create or replace function public.send_friend_request(code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  target uuid;
  existing public.friendships%rowtype;
  normalized text := upper(regexp_replace(coalesce(code, ''), '[\s-]', '', 'g'));
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = me) then
    return 'no_profile';
  end if;

  -- 每小時最多打錯 10 次代碼，防止猜代碼（只算「找不到」；正常送邀請受每日 20 個限制）
  perform private.lock_key('rate:' || me::text || ':code_attempt');
  if (select count(*) from private.rate_events
      where user_id = me and kind = 'code_attempt' and at > now() - interval '1 hour') >= 10 then
    return 'rate_limited';
  end if;

  select id into target from public.profiles where friend_code = normalized;
  if target is null or target = me then
    insert into private.rate_events (user_id, kind) values (me, 'code_attempt');
    return 'not_found';
  end if;

  -- 兩人之間同時只處理一個邀請（不管誰送的）
  perform private.lock_key('pair:' || least(me, target)::text || ':' || greatest(me, target)::text);

  select * into existing from public.friendships
  where (requester = me and addressee = target) or (requester = target and addressee = me);
  -- 已經是好友：不管有沒有封鎖都這樣回答（被封鎖者本來就知道你們是好友，不透露封鎖）
  if existing.status = 'accepted' then
    return 'already_friends';
  end if;

  -- 對方封鎖了你：和代碼不存在一樣，並記一次失敗（不透露封鎖）
  if exists (select 1 from public.blocks where blocker = target and blocked = me) then
    insert into private.rate_events (user_id, kind) values (me, 'code_attempt');
    return 'not_found';
  end if;
  if exists (select 1 from public.blocks where blocker = me and blocked = target) then
    return 'you_blocked';
  end if;

  if existing.requester is not null then
    if existing.requester = me then
      return 'already_sent';
    end if;
    update public.friendships set status = 'accepted'
    where requester = target and addressee = me;
    return 'accepted';
  end if;

  -- 每天最多送 20 個邀請（台灣時間）
  if private.count_today(me, 'friend_request') >= 20 then
    return 'rate_limited';
  end if;
  insert into private.rate_events (user_id, kind) values (me, 'friend_request');
  insert into public.friendships (requester, addressee) values (me, target);
  return 'sent';
end
$$;

/* ===== 4. 函式權限 ===== */
-- 新函式預設不給執行權限；create or replace 保留原本的權限，這裡再明確設定一次
revoke all on function private.lock_key(text) from public, anon, authenticated;
revoke all on function private.count_today(uuid, text) from public, anon, authenticated;
revoke all on function public.send_friend_request(text) from public, anon, authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
