-- 沖煮熱度圖：讓好友看到「近一年每天沖了幾杯」（1.14.0）
--
-- - activity_shares：「讓好友看到我的熱度圖」的開關（有這一列＝開啟，預設沒有）；device_id 是負責上傳的那台裝置
--   只有本人讀得到、改得到（好友讀不到開關本身：沒開＝沒有資料，和開了但一年都沒沖看起來一樣）
--   刪掉這一列（關閉）時 trigger 清空這個人所有的 brew_activity
-- - brew_activity：每天的杯數，只存有沖的日子；不含任何其他資料（評分、豆子、時間都不上傳）
--   cups 1–50；day 在台灣時間今天往前 365 天內、不能是未來（check 約束不能用 now()，用 trigger 檢查，錯誤碼同 check）
--   新增、修改要先開啟；update 不能改日期（PostgREST 的 upsert 會連 day 一起寫，所以欄位權限開 day、cups，由 trigger 擋下改日期）
--   讀取：本人，或 private.can_view（已接受的好友、雙方沒有封鎖；和 profile_detail 同一套）
-- - 刪除帳號：profiles cascade（delete-account、admin-delete-user 不用改）

/* ===== 1. activity_shares ===== */

create table public.activity_shares (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  device_id uuid not null,
  updated_at timestamptz not null default now()
);

revoke all on table public.activity_shares from anon, authenticated;
alter table public.activity_shares enable row level security;

create function private.activity_shares_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
create trigger activity_shares_touch before insert or update on public.activity_shares
  for each row execute function private.activity_shares_touch();

-- 關閉：雲端的熱度圖資料全部刪除（本人的資料，security definer 只是讓 cascade 刪帳號時也一定刪得掉）
create function private.activity_shares_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.brew_activity a where a.user_id = old.user_id;
  return old;
end
$$;

create policy "activity_shares: 只能讀自己的" on public.activity_shares
  for select to authenticated using (user_id = (select auth.uid()));
create policy "activity_shares: 只能新增自己的" on public.activity_shares
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "activity_shares: 只能改自己的" on public.activity_shares
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "activity_shares: 只能刪自己的" on public.activity_shares
  for delete to authenticated using (user_id = (select auth.uid()));

/* ===== 2. brew_activity ===== */

create table public.brew_activity (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  day date not null,
  cups integer not null constraint brew_activity_cups check (cups between 1 and 50),
  primary key (user_id, day)
);

revoke all on table public.brew_activity from anon, authenticated;
alter table public.brew_activity enable row level security;

create trigger activity_shares_after_delete after delete on public.activity_shares
  for each row execute function private.activity_shares_after_delete();

-- 日期範圍（台灣時間）：今天往前 365 天內（含今天）、不能是未來；update 不能改日期
create function private.brew_activity_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Taipei')::date;
begin
  if tg_op = 'UPDATE' and new.day is distinct from old.day then
    raise exception 'day cannot be changed' using errcode = '23514', constraint = 'brew_activity_day_fixed';
  end if;
  if new.day > today or new.day <= today - 365 then
    raise exception 'day out of range' using errcode = '23514', constraint = 'brew_activity_day_range';
  end if;
  return new;
end
$$;
create trigger brew_activity_check before insert or update on public.brew_activity
  for each row execute function private.brew_activity_check();

create policy "brew_activity: 本人和沒有封鎖的好友讀得到" on public.brew_activity
  for select to authenticated using (user_id = (select auth.uid()) or private.can_view(user_id));
create policy "brew_activity: 開啟後才能新增自己的" on public.brew_activity
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.activity_shares s where s.user_id = (select auth.uid()))
  );
create policy "brew_activity: 開啟後才能改自己的" on public.brew_activity
  for update to authenticated using (user_id = (select auth.uid())) with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.activity_shares s where s.user_id = (select auth.uid()))
  );
create policy "brew_activity: 只能刪自己的" on public.brew_activity
  for delete to authenticated using (user_id = (select auth.uid()));

/* ===== 3. 權限（統一寫在最後） ===== */

-- trigger 用的函式不給任何人直接執行
revoke all on function
  private.activity_shares_touch(), private.activity_shares_after_delete(), private.brew_activity_check()
  from public, anon, authenticated;

grant select, delete on public.activity_shares to authenticated;
grant insert (device_id), update (device_id) on public.activity_shares to authenticated;

grant select, delete on public.brew_activity to authenticated;
grant insert (day, cups), update (day, cups) on public.brew_activity to authenticated;
