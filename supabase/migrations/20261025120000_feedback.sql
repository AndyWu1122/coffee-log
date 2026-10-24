-- 意見回饋（☰ →「意見回饋」）：使用者 → 開發者（站長）
-- 和檢舉一樣：只能新增，任何人都讀不到（連送出的人自己也是），站長在 Supabase 後台的 Table Editor 看
-- App 經由 Edge Function feedback 用呼叫者的 JWT 寫入（RLS、每日上限照常生效），寫入後寄 Email 通知站長；
-- 直接打 API 新增也會存下來，只是不會寄信

/* ===== 1. 每日上限的計數加上 feedback ===== */
alter table private.rate_events drop constraint rate_event_kind;
alter table private.rate_events add constraint rate_event_kind
  check (kind in ('brew_insert', 'friend_request', 'code_attempt', 'report', 'feedback'));

/* ===== 2. feedback ===== */

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  -- 刪除帳號時一起刪除（雲端資料刪除要徹底）
  author uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  category text not null
    constraint feedback_category check (category in ('bug', 'idea', 'other')),
  message text not null
    constraint feedback_message_length check (char_length(message) <= 1000 and char_length(btrim(message)) >= 1),
  -- 送出時的 App 版本（sw.js 的 CACHE_VERSION），沒有 Service Worker 時為 null
  app_version integer
    constraint feedback_app_version_range check (app_version between 1 and 1000000),
  created_at timestamptz not null default now()
);
create index feedback_created_at on public.feedback (created_at desc);

-- Supabase 預設會把 public 的新表開給 anon、authenticated，先全部收回
revoke all on table public.feedback from anon, authenticated;
alter table public.feedback enable row level security;

-- 每天最多 5 則（台灣時間；只算新增）；建立時間由資料庫決定
create function private.feedback_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := now();
  if auth.uid() is not null then
    if private.count_today(auth.uid(), 'feedback') >= 5 then
      raise exception 'daily feedback limit reached' using errcode = 'P0001', hint = 'rate_limited';
    end if;
    insert into private.rate_events (user_id, kind) values (auth.uid(), 'feedback');
  end if;
  return new;
end
$$;
create trigger feedback_before_insert before insert on public.feedback
  for each row execute function private.feedback_before_insert();

-- 只開放新增；沒有任何讀取、修改、刪除的權限與政策
grant insert (author, category, message, app_version) on public.feedback to authenticated;
create policy "feedback: 只能以自己的名義新增" on public.feedback
  for insert to authenticated
  with check (author = (select auth.uid()));

/* ===== 3. 函式權限 ===== */
revoke all on function private.feedback_before_insert() from public, anon, authenticated;
