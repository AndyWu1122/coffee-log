-- 咖啡社群 階段 1：權限（docs/social-spec.md）
--
-- 規則：
-- - 每張表都開 RLS；沒有政策的操作一律拒絕
-- - anon（未登入）對所有表沒有任何權限
-- - 判斷身分一律用 auth.uid()，不信任前端傳來的 user_id
-- - 修改只開放允許的欄位（column 層級 grant）
-- - security definer 函式一律 set search_path = ''，所有名稱都寫完整 schema

/* ===== 1. 先把預設權限全部收回，再逐一開放 ===== */
-- Supabase 預設會把 public 的表、函式開給 anon、authenticated，這裡全部收回

revoke all on table
  public.profiles, public.friendships, public.blocks, public.shared_brews, public.likes, public.reports
  from anon, authenticated;

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
-- PostgreSQL 預設會把「之後建立的函式」的 execute 開給 PUBLIC，先把 private 的預設權限關掉
-- （只 revoke 現有函式不夠：在這行之後建立的函式仍會開放。檔案最後還會再 revoke 一次）
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema private revoke all on tables from public;

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.shared_brews enable row level security;
alter table public.likes enable row level security;
alter table public.reports enable row level security;
alter table private.rate_events enable row level security; -- 不公開、沒有政策：只有 security definer 函式能寫

/* ===== 2. 判斷函式（RLS 政策用） ===== */
-- 放在 private schema（API 不公開）。只回答「目前登入的人」和某人的關係，
-- 不接受任意兩個 id，避免被拿來查別人的好友關係。
-- 需要讀到「對方封鎖了我」（blocks 對被封鎖者不可見），所以用 security definer

-- 目前使用者能不能看 target 的紀錄：本人，或已接受的好友且雙方沒有封鎖
-- 「不是好友」和「被封鎖」都只回傳 false，不會透露被封鎖
create function private.can_view(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target = auth.uid() or (
    exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester = auth.uid() and f.addressee = target)
          or (f.requester = target and f.addressee = auth.uid()))
    )
    and not exists (
      select 1 from public.blocks b
      where (b.blocker = auth.uid() and b.blocked = target)
         or (b.blocker = target and b.blocked = auth.uid())
    )
  )
$$;

-- 目前使用者能不能看 target 的 profile：本人，或有好友關係／待處理邀請，且雙方沒有封鎖
create function private.profile_visible(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target = auth.uid() or (
    exists (
      select 1 from public.friendships f
      where (f.requester = auth.uid() and f.addressee = target)
         or (f.requester = target and f.addressee = auth.uid())
    )
    and not exists (
      select 1 from public.blocks b
      where (b.blocker = auth.uid() and b.blocked = target)
         or (b.blocker = target and b.blocked = auth.uid())
    )
  )
$$;

-- 今天（台灣時間）某類事件的次數
create function private.count_today(uid uuid, event_kind text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from private.rate_events
  where user_id = uid and kind = event_kind
    and at >= (date_trunc('day', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei')
$$;


/* ===== 3. profiles ===== */

-- 好友代碼由資料庫產生
create function private.new_friend_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- 31 個字，不含 0 O 1 I L
  bytes bytea;
  code text;
begin
  loop
    bytes := extensions.gen_random_bytes(10);
    code := '';
    for i in 0..9 loop
      code := code || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where friend_code = code);
  end loop;
  return code;
end
$$;

create function private.profiles_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.friend_code := private.new_friend_code(); -- 不管前端傳什麼都覆蓋
  new.created_at := now();
  return new;
end
$$;
create trigger profiles_before_insert before insert on public.profiles
  for each row execute function private.profiles_before_insert();

grant select on public.profiles to authenticated;
grant insert (id, nickname) on public.profiles to authenticated;
grant update (nickname) on public.profiles to authenticated;

create policy "profiles: 本人或有關係的人可讀" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.profile_visible(id));
create policy "profiles: 只能建立自己的" on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));
create policy "profiles: 只能改自己的" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- 重新產生好友代碼（舊代碼立即失效）
create function public.regenerate_friend_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  code := private.new_friend_code();
  update public.profiles set friend_code = code where id = auth.uid();
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  return code;
end
$$;

/* ===== 4. friendships ===== */

-- 只有接收者能接受：只開放改 status，接受時記下時間
create function private.friendships_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'accepted' and old.status <> 'accepted' then
    new.accepted_at := now();
  end if;
  return new;
end
$$;
create trigger friendships_before_update before update on public.friendships
  for each row execute function private.friendships_before_update();

grant select, delete on public.friendships to authenticated;
grant update (status) on public.friendships to authenticated;
-- 不開放 insert：只能透過 send_friend_request(code)

create policy "friendships: 只有當事雙方可讀" on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (requester, addressee));
create policy "friendships: 只有接收者能接受" on public.friendships
  for update to authenticated
  using (addressee = (select auth.uid()) and status = 'pending')
  with check (addressee = (select auth.uid()) and status = 'accepted');
create policy "friendships: 任一方可刪除（拒絕、取消、解除好友）" on public.friendships
  for delete to authenticated
  using ((select auth.uid()) in (requester, addressee));

/*
 * 用好友代碼送出邀請。回傳：
 *   sent            已送出邀請
 *   accepted        對方之前邀請過你，直接成為好友
 *   already_sent    已經邀請過，等對方接受
 *   already_friends 已經是好友
 *   not_found       代碼不存在（對方封鎖了你也回傳這個，不透露封鎖）
 *   you_blocked     你封鎖了對方，要先解除封鎖
 *   rate_limited    這小時打錯代碼已達 10 次，或今天已送出 20 個邀請
 *   no_profile      還沒建立 profile
 * 不回傳對方的任何資料
 */
create function public.send_friend_request(code text)
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
  -- 代碼不存在、自己的代碼、對方封鎖了你：都回傳 not_found 並記一次失敗（不透露封鎖）
  if target is null or target = me
     or exists (select 1 from public.blocks where blocker = target and blocked = me) then
    insert into private.rate_events (user_id, kind) values (me, 'code_attempt');
    return 'not_found';
  end if;
  if exists (select 1 from public.blocks where blocker = me and blocked = target) then
    return 'you_blocked';
  end if;

  select * into existing from public.friendships
  where (requester = me and addressee = target) or (requester = target and addressee = me);
  if found then
    if existing.status = 'accepted' then
      return 'already_friends';
    elsif existing.requester = me then
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

/* ===== 5. blocks ===== */

-- 封鎖時：解除好友、刪掉雙方之間的邀請與讚
create function private.blocks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friendships
  where (requester = new.blocker and addressee = new.blocked)
     or (requester = new.blocked and addressee = new.blocker);
  delete from public.likes
  where (user_id = new.blocked and brew_owner = new.blocker)
     or (user_id = new.blocker and brew_owner = new.blocked);
  return null;
end
$$;
create trigger blocks_after_insert after insert on public.blocks
  for each row execute function private.blocks_after_insert();

grant select, delete on public.blocks to authenticated;
grant insert (blocker, blocked) on public.blocks to authenticated;

-- 被封鎖的人看不到封鎖紀錄
create policy "blocks: 只有封鎖者可讀" on public.blocks
  for select to authenticated
  using (blocker = (select auth.uid()));
create policy "blocks: 只能以自己的名義封鎖" on public.blocks
  for insert to authenticated
  with check (blocker = (select auth.uid()));
create policy "blocks: 只有封鎖者能解除" on public.blocks
  for delete to authenticated
  using (blocker = (select auth.uid()));

/* ===== 6. shared_brews ===== */

-- 新增：每天最多 30 筆（台灣時間；只算新增，修改不算；刪掉再新增不會還次數）
-- 新增、修改：日期不能是未來；修改時不能改 owner、id、created_at
create function private.shared_brews_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.brewed_at > now() + interval '1 day' then
    raise exception 'brewed_at is in the future' using errcode = '23514';
  end if;
  if new.roast_date > (now() at time zone 'Asia/Taipei')::date + 1 then
    raise exception 'roast_date is in the future' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    if auth.uid() is not null then
      if private.count_today(auth.uid(), 'brew_insert') >= 30 then
        raise exception 'daily upload limit reached' using errcode = 'P0001', hint = 'rate_limited';
      end if;
      insert into private.rate_events (user_id, kind) values (auth.uid(), 'brew_insert');
    end if;
  else
    if new.owner <> old.owner or new.id <> old.id or new.created_at <> old.created_at then
      raise exception 'owner, id, created_at cannot be changed' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$$;
create trigger shared_brews_before_write before insert or update on public.shared_brews
  for each row execute function private.shared_brews_before_write();

grant select, delete on public.shared_brews to authenticated;
grant insert (
  owner, id, bean_name, bean_origin, bean_process, roast_level, roast_date, brewed_at,
  dripper, grinder_name, grind_setting, coffee_g, water_g, temp_c, total_time_s,
  rating, acidity, sweetness, bitterness, body, flavor_notes, notes, photo_path
) on public.shared_brews to authenticated;
grant update (
  bean_name, bean_origin, bean_process, roast_level, roast_date, brewed_at,
  dripper, grinder_name, grind_setting, coffee_g, water_g, temp_c, total_time_s,
  rating, acidity, sweetness, bitterness, body, flavor_notes, notes, photo_path
) on public.shared_brews to authenticated;

create policy "shared_brews: 本人或已接受且沒封鎖的好友可讀" on public.shared_brews
  for select to authenticated
  using (owner = (select auth.uid()) or private.can_view(owner));
create policy "shared_brews: 只能新增自己的" on public.shared_brews
  for insert to authenticated
  with check (owner = (select auth.uid()));
create policy "shared_brews: 只能改自己的" on public.shared_brews
  for update to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));
create policy "shared_brews: 只能刪自己的" on public.shared_brews
  for delete to authenticated
  using (owner = (select auth.uid()));

/* ===== 7. likes ===== */
-- 看得到那筆紀錄才能按讚、看讚（子查詢會套用 shared_brews 的 RLS）

grant select, delete on public.likes to authenticated;
grant insert (brew_owner, brew_id, user_id) on public.likes to authenticated;

create policy "likes: 看得到紀錄才看得到讚" on public.likes
  for select to authenticated
  using (exists (
    select 1 from public.shared_brews b where b.owner = brew_owner and b.id = brew_id
  ));
create policy "likes: 只能以自己的名義、對看得到的紀錄按讚" on public.likes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.shared_brews b where b.owner = brew_owner and b.id = brew_id)
  );
create policy "likes: 只能收回自己的讚" on public.likes
  for delete to authenticated
  using (user_id = (select auth.uid()));

/* ===== 8. reports ===== */
-- 只能新增，沒有任何讀取政策：連檢舉者自己都讀不到；站長用 Supabase 後台查看

create function private.reports_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := now();
  if auth.uid() is not null then
    if private.count_today(auth.uid(), 'report') >= 10 then
      raise exception 'daily report limit reached' using errcode = 'P0001', hint = 'rate_limited';
    end if;
    insert into private.rate_events (user_id, kind) values (auth.uid(), 'report');
  end if;
  return new;
end
$$;
create trigger reports_before_insert before insert on public.reports
  for each row execute function private.reports_before_insert();

grant insert (reporter, brew_owner, brew_id, reason, detail) on public.reports to authenticated;

create policy "reports: 只能以自己的名義、檢舉看得到的紀錄" on public.reports
  for insert to authenticated
  with check (
    reporter = (select auth.uid())
    and brew_owner <> (select auth.uid())
    and exists (select 1 from public.shared_brews b where b.owner = brew_owner and b.id = brew_id)
  );

/* ===== 9. 函式權限：最後統一設定 ===== */

-- private：全部收回，只開放 check 約束與 RLS 政策執行時必須呼叫的
-- （以呼叫者身分執行，所以一般使用者要有 execute；它們只做純驗證，或只回答「目前使用者」自己的關係）
-- 不開放的：count_today（可查任何人的次數）、new_friend_code、各 trigger 函式
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function
  private.valid_flavor_notes(text[]),
  private.single_line(text),
  private.can_view(uuid),
  private.profile_visible(uuid)
  to authenticated;

-- public：對外公開的 RPC 只給登入的使用者（Supabase 預設會開給 anon）
revoke all on function public.send_friend_request(text) from public, anon, authenticated;
revoke all on function public.regenerate_friend_code() from public, anon, authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.regenerate_friend_code() to authenticated;
