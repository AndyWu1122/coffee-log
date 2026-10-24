-- 咖啡社群 階段 1：資料表與檢查條件（docs/social-spec.md）
-- 權限（RLS、grant、函式、trigger）在下一個 migration：*_social_policies.sql
--
-- 原則：雲端只放使用者選擇「好友可見」的紀錄；所有限制都在資料庫強制，
-- 因為 anon key 是公開的，任何人都能繞過 App 直接呼叫 API。

-- 不透過 API 公開的內部函式與資料（API 只公開 public、graphql_public）
create schema if not exists private;

/* ===== 驗證用函式（check 約束會用到，必須是 immutable） ===== */

-- 風味輪 key 陣列：最多 30 個，每個是 1–3 層的小寫英文 key，例如 fruity.berry.blueberry
create function private.valid_flavor_notes(notes text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(notes) <= 30
     and array_position(notes, null) is null
     and coalesce(
       (select bool_and(n ~ '^[a-z]+(\.[a-z]+){0,2}$' and char_length(n) <= 60) from unnest(notes) as n),
       true
     )
$$;

-- 一般文字欄位：不可含控制字元（換行、tab 等）；筆記另外允許換行
create function private.single_line(t text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select t !~ '[[:cntrl:]]'
$$;

/* ===== profiles：暱稱與好友代碼（不收真名、學號） ===== */

create table public.profiles (
  id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  nickname text not null
    constraint nickname_length check (char_length(nickname) <= 20 and char_length(btrim(nickname)) >= 1)
    constraint nickname_single_line check (private.single_line(nickname)),
  -- 由資料庫產生（trigger），使用者不能指定；10 碼，不含易混淆的 0 O 1 I L
  friend_code text not null unique
    constraint friend_code_format check (friend_code ~ '^[A-HJKMNP-Z2-9]{10}$'),
  created_at timestamptz not null default now()
);

/* ===== friendships：雙方同意才成為好友 ===== */

create table public.friendships (
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    constraint friendship_status check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester, addressee),
  constraint friendship_not_self check (requester <> addressee)
);
-- 兩人之間不管誰發起，只能有一筆
create unique index friendships_one_per_pair
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index friendships_addressee on public.friendships (addressee);

/* ===== blocks：封鎖 ===== */

create table public.blocks (
  blocker uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint block_not_self check (blocker <> blocked)
);
create index blocks_blocked on public.blocks (blocked);

/* ===== shared_brews：好友可見的沖煮紀錄 ===== */
-- 雲端只會有 friends 紀錄（private 不上傳），所以不另外存可見度
-- 主鍵 (owner, id)：id 沿用本機紀錄的 id，別人無法先佔用你的 id 讓你上傳失敗

create table public.shared_brews (
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  id uuid not null,

  -- 豆子資訊（雲端沒有豆子表，跟著紀錄存）
  bean_name text not null
    constraint bean_name_length check (char_length(bean_name) between 1 and 100 and private.single_line(bean_name)),
  bean_origin text not null default ''
    constraint bean_origin_length check (char_length(bean_origin) <= 100 and private.single_line(bean_origin)),
  bean_process text
    constraint bean_process_value check (bean_process in ('washed', 'natural', 'honey', 'other')),
  roast_level text
    constraint roast_level_value check (roast_level in ('light', 'light-medium', 'medium-light', 'medium', 'dark')),
  roast_date date
    constraint roast_date_range check (roast_date >= date '2000-01-01'), -- 不能是未來：由 trigger 檢查

  -- 沖煮參數
  brewed_at timestamptz not null
    constraint brewed_at_range check (brewed_at >= timestamptz '2000-01-01'), -- 不能是未來：由 trigger 檢查
  dripper text not null default ''
    constraint dripper_length check (char_length(dripper) <= 100 and private.single_line(dripper)),
  grinder_name text not null default ''
    constraint grinder_name_length check (char_length(grinder_name) <= 100 and private.single_line(grinder_name)),
  grind_setting text not null default ''
    constraint grind_setting_length check (char_length(grind_setting) <= 100 and private.single_line(grind_setting)),
  coffee_g numeric(5, 1) not null
    constraint coffee_g_range check (coffee_g > 0 and coffee_g <= 100),
  water_g numeric(6, 1) not null
    constraint water_g_range check (water_g > 0 and water_g <= 2000),
  temp_c numeric(4, 1)
    constraint temp_c_range check (temp_c between 70 and 100),
  total_time_s integer
    constraint total_time_s_range check (total_time_s between 0 and 3600),

  -- 評分與風味（1–5，沒填為 null）
  rating smallint constraint rating_range check (rating between 1 and 5),
  acidity smallint constraint acidity_range check (acidity between 1 and 5),
  sweetness smallint constraint sweetness_range check (sweetness between 1 and 5),
  bitterness smallint constraint bitterness_range check (bitterness between 1 and 5),
  body smallint constraint body_range check (body between 1 and 5),
  flavor_notes text[] not null default '{}'
    constraint flavor_notes_valid check (private.valid_flavor_notes(flavor_notes)),

  notes text not null default ''
    constraint notes_length check (char_length(notes) <= 500),
  -- 照片只能放在自己的資料夾、檔名就是這筆紀錄的 id（階段 2 的 Storage 用）
  photo_path text
    constraint photo_path_own check (photo_path = owner::text || '/' || id::text || '.jpg'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner, id)
);
create index shared_brews_owner_brewed_at on public.shared_brews (owner, brewed_at desc);

/* ===== likes：讚 ===== */

create table public.likes (
  brew_owner uuid not null,
  brew_id uuid not null,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (brew_owner, brew_id, user_id), -- 同一人對同一筆只能一個讚
  foreign key (brew_owner, brew_id) references public.shared_brews (owner, id) on delete cascade
);
create index likes_user on public.likes (user_id);

/* ===== reports：檢舉（只能新增，任何人都讀不到；由站長在 Supabase 後台查看） ===== */

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  brew_owner uuid not null,
  brew_id uuid not null,
  reason text not null
    constraint report_reason check (reason in ('spam', 'inappropriate', 'harassment', 'other')),
  detail text not null default ''
    constraint report_detail_length check (char_length(detail) <= 300),
  created_at timestamptz not null default now(),
  -- 紀錄刪除時檢舉跟著刪（雲端資料刪除要徹底）
  foreign key (brew_owner, brew_id) references public.shared_brews (owner, id) on delete cascade
);

/* ===== private.rate_events：每日／每小時上限的計數 ===== */
-- 另外記一筆事件，而不是數現有的資料列：刪掉再新增，次數也不會被還回來

create table private.rate_events (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null
    constraint rate_event_kind check (kind in ('brew_insert', 'friend_request', 'code_attempt', 'report')),
  at timestamptz not null default now()
);
create index rate_events_lookup on private.rate_events (user_id, kind, at);
