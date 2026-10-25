-- 封鎖不再解除好友（2026-10-25 決定）
--
-- 封鎖後雙方仍是好友，但互相看不到對方的貼文、照片、留言（包括在共同好友的貼文上）、讚；
-- 讚和留言只隱藏、不刪除，解除封鎖後全部恢復。
--   1. blocks_after_insert：只刪雙方之間待處理的邀請（從「收到的邀請」封鎖＝拒絕），不刪好友與讚
--   2. profile_visible：好友之間不管封鎖都看得到暱稱、頭像（否則被封鎖者的好友名單會出現沒有名字的人，等於透露封鎖）
--   3. likes 讀取：和按讚的人有封鎖就看不到（自己貼文的讚數也不算被封鎖者的讚）
--   4. send_friend_request：先判斷「已經是好友」再判斷封鎖（被封鎖的好友輸入代碼不會得到 not_found）
-- 貼文（can_view）、留言（blocked_with）本來就是雙向隱藏，不用改。
-- 依賴 20261025140000_comments.sql 的 private.blocked_with，兩個 migration 要一起部署。

/* ===== 1. 封鎖時：只刪待處理的邀請 ===== */

create or replace function private.blocks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friendships
  where status = 'pending'
    and ((requester = new.blocker and addressee = new.blocked)
      or (requester = new.blocked and addressee = new.blocker));
  return null;
end
$$;

/* ===== 2. profile：有好友關係／待處理邀請就看得到（不看封鎖） ===== */

create or replace function private.profile_visible(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target = auth.uid() or exists (
    select 1 from public.friendships f
    where (f.requester = auth.uid() and f.addressee = target)
       or (f.requester = target and f.addressee = auth.uid())
  )
$$;

/* ===== 3. likes：和按讚的人有封鎖就看不到 ===== */

drop policy "likes: 看得到紀錄才看得到讚" on public.likes;
create policy "likes: 看得到紀錄、且和按讚的人沒有封鎖才看得到" on public.likes
  for select to authenticated
  using (
    exists (select 1 from public.shared_brews b where b.owner = brew_owner and b.id = brew_id)
    and not private.blocked_with(user_id)
  );

/* ===== 4. send_friend_request：已經是好友優先回答 ===== */
-- 回傳值同 20261024110100_social_policies.sql

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
  if (select count(*) from private.rate_events
      where user_id = me and kind = 'code_attempt' and at > now() - interval '1 hour') >= 10 then
    return 'rate_limited';
  end if;

  select id into target from public.profiles where friend_code = normalized;
  if target is null or target = me then
    insert into private.rate_events (user_id, kind) values (me, 'code_attempt');
    return 'not_found';
  end if;

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

/* ===== 5. 函式權限 ===== */
-- create or replace 保留原本的權限；這裡再明確設定一次
revoke all on function private.blocks_after_insert() from public, anon, authenticated;
revoke all on function private.profile_visible(uuid) from public, anon, authenticated;
grant execute on function private.profile_visible(uuid) to authenticated;
revoke all on function public.send_friend_request(text) from public, anon, authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
