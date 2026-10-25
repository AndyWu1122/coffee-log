-- 開發者後台（2026-10-26）
--
-- 1. private.admins：開發者名單。沒有任何 grant，App 和 API 都改不到；第一個開發者由站長在 SQL Editor 新增
--    （docs/supabase-setup.md）。不放在 profiles 或 user_metadata 這些使用者改得到的地方
-- 2. private.is_admin()：只回答「目前登入的人」是不是開發者；public.am_i_admin() 給前端決定要不要顯示入口
-- 3. 後台讀資料一律走這裡的 security definer 函式（public.admin_*），不在 shared_brews、comments、profiles 加
--    「開發者可讀」的 RLS：permissive 政策是 OR，開發者自己的動態牆和通知數字會混進所有人的貼文
-- 4. public.admin_audit_log：開發者的每個操作（誰、做了什麼、對象、原因、時間）；只有開發者讀得到，
--    任何人（含 service_role）都不能修改、刪除。沒有外鍵：刪帳號 cascade 時紀錄才不會跟著被刪；不存被刪的內容本身
-- 5. private.removed_brews：開發者刪掉的貼文，作者的手機不能再同步上傳同一筆
-- 6. Storage：開發者可以讀 brew-photos、avatars（後台顯示照片、頭像），可以刪 brew-photos（刪貼文時一起刪照片）
-- 刪除帳號由 Edge Function admin-delete-user 執行：它用呼叫者的 JWT 呼叫 admin_begin_delete_user 檢查權限並寫紀錄

/* ===== 1. 開發者名單與判斷 ===== */

create table private.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.admins enable row level security; -- 沒有政策、沒有 grant：只有 security definer 函式讀得到

-- 只檢查目前登入的人（auth.uid()），不接受任何 id
create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.admins where user_id = auth.uid())
$$;

-- 後台函式開頭呼叫：不是開發者一律 42501（和其他權限錯誤一樣）
create function private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
end
$$;

-- 前端用：要不要顯示「開發者後台」的入口（真正的權限在各個函式裡檢查）
create function public.am_i_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
$$;

/* ===== 2. 操作紀錄 ===== */

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor uuid not null,
  action text not null
    constraint audit_action check (action in ('delete_comment', 'delete_post', 'delete_user')),
  target_user uuid,
  target_brew uuid,
  target_comment uuid,
  target_nickname text not null default '',
  -- 補充（例如一起刪掉的回覆數）；不放被刪的內容
  detail jsonb not null default '{}',
  reason text not null
    constraint audit_reason check (char_length(reason) <= 200 and char_length(btrim(reason)) >= 1),
  created_at timestamptz not null default now()
);
create index admin_audit_log_created_at on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;

-- Supabase 預設會把 public 的新表全部開給 anon、authenticated：先全部收回，只給 select（RLS 再限開發者）
revoke all on table public.admin_audit_log from anon, authenticated;
grant select on public.admin_audit_log to authenticated;
create policy "admin_audit_log: 只有開發者可讀" on public.admin_audit_log
  for select to authenticated
  using (private.is_admin());

-- 任何人（含 service_role、資料庫擁有者）都不能修改或刪除
create function private.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin_audit_log is append-only' using errcode = '42501';
end
$$;
create trigger admin_audit_log_no_update before update or delete on public.admin_audit_log
  for each row execute function private.audit_log_immutable();
create trigger admin_audit_log_no_truncate before truncate on public.admin_audit_log
  for each statement execute function private.audit_log_immutable();

-- 原因：1–200 字，除了換行不可有控制字元
create function private.check_reason(reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if reason is null or char_length(reason) > 200 or char_length(btrim(reason)) < 1
     or not private.single_line(replace(reason, E'\n', '')) then
    raise exception 'invalid reason' using errcode = '22023', hint = 'reason';
  end if;
  return btrim(reason);
end
$$;

/* ===== 3. 被開發者刪掉的貼文不能再上傳 ===== */

create table private.removed_brews (
  owner uuid not null,
  id uuid not null,
  removed_at timestamptz not null default now(),
  primary key (owner, id)
);
alter table private.removed_brews enable row level security;

create function private.shared_brews_not_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from private.removed_brews r where r.owner = new.owner and r.id = new.id) then
    raise exception 'brew removed by admin' using errcode = '23514', hint = 'removed';
  end if;
  return new;
end
$$;
create trigger shared_brews_not_removed before insert on public.shared_brews
  for each row execute function private.shared_brews_not_removed();

/* ===== 4. 後台讀取（每頁最多 100） ===== */

create function private.page_size(lim integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select least(greatest(coalesce(lim, 50), 1), 100)
$$;

-- 一筆貼文＋作者暱稱、讚數、留言數、檢舉數
create function private.admin_post_json(b public.shared_brews)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(b) || jsonb_build_object(
    'owner_nickname', (select p.nickname from public.profiles p where p.id = b.owner),
    'likes', (select count(*) from public.likes l where l.brew_owner = b.owner and l.brew_id = b.id),
    'comments', (select count(*) from public.comments c where c.brew_owner = b.owner and c.brew_id = b.id),
    'reports', (select count(*) from public.reports r where r.brew_owner = b.owner and r.brew_id = b.id)
  )
$$;

-- 一則留言＋留言者目前的暱稱（帳號還在時）
create function private.admin_comment_json(c public.comments)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(c) || jsonb_build_object(
    'author_current_nickname', (select p.nickname from public.profiles p where p.id = c.author),
    'author_avatar_path', (select p.avatar_path from public.profiles p where p.id = c.author),
    'replies', (select count(*) from public.comments r where r.parent_id = c.id)
  )
$$;

-- 用戶列表：依註冊時間新→舊；search 比對暱稱（不分大小寫，當成一般文字）
create function public.admin_list_users(search text default '', lim integer default 50, off integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(u order by u.created_at desc) from (
      select p.id, p.nickname, p.avatar_path, p.created_at,
        (select count(*) from public.shared_brews b where b.owner = p.id) as posts,
        (select count(*) from public.comments c where c.author = p.id) as comments,
        (select count(*) from public.reports r where r.brew_owner = p.id) as reports,
        exists (select 1 from private.admins a where a.user_id = p.id) as is_admin
      from public.profiles p
      where coalesce(search, '') = '' or strpos(lower(p.nickname), lower(search)) > 0
      order by p.created_at desc
      limit private.page_size(lim) offset greatest(coalesce(off, 0), 0)
    ) u
  ), '[]'::jsonb);
end
$$;

-- 用戶詳細：profile、所有雲端貼文（新→舊）、所有留言（新→舊）；用戶不存在回傳 null
create function public.admin_user_detail(uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return (
    select jsonb_build_object(
      'profile', jsonb_build_object('id', p.id, 'nickname', p.nickname, 'avatar_path', p.avatar_path, 'created_at', p.created_at,
        'is_admin', exists (select 1 from private.admins a where a.user_id = p.id),
        'reports', (select count(*) from public.reports r where r.brew_owner = p.id)),
      'posts', coalesce((select jsonb_agg(private.admin_post_json(b) order by b.brewed_at desc)
        from public.shared_brews b where b.owner = p.id), '[]'::jsonb),
      'comments', coalesce((select jsonb_agg(private.admin_comment_json(c) order by c.created_at desc)
        from public.comments c where c.author = p.id), '[]'::jsonb)
    )
    from public.profiles p where p.id = uid
  );
end
$$;

-- 全部貼文：依沖煮時間新→舊
create function public.admin_list_posts(lim integer default 50, off integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(private.admin_post_json(b) order by b.brewed_at desc, b.id) from (
      select * from public.shared_brews
      order by brewed_at desc, id
      limit private.page_size(lim) offset greatest(coalesce(off, 0), 0)
    ) b
  ), '[]'::jsonb);
end
$$;

-- 一篇貼文：內容、全部留言（舊→新，不受封鎖影響）、檢舉；已刪除回傳 null
create function public.admin_post_detail(p_owner uuid, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return (
    select jsonb_build_object(
      'post', private.admin_post_json(b),
      'comments', coalesce((select jsonb_agg(private.admin_comment_json(c) order by c.created_at)
        from public.comments c where c.brew_owner = b.owner and c.brew_id = b.id), '[]'::jsonb),
      'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'detail', r.detail,
          'created_at', r.created_at, 'reporter', r.reporter,
          'reporter_nickname', (select p.nickname from public.profiles p where p.id = r.reporter)) order by r.created_at desc)
        from public.reports r where r.brew_owner = b.owner and r.brew_id = b.id), '[]'::jsonb)
    )
    from public.shared_brews b where b.owner = p_owner and b.id = p_id
  );
end
$$;

-- 檢舉：新→舊（貼文刪除時檢舉跟著刪，所以列出來的貼文都還在）
create function public.admin_list_reports(lim integer default 50, off integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select r.id, r.reason, r.detail, r.created_at, r.reporter, r.brew_owner, r.brew_id,
        (select p.nickname from public.profiles p where p.id = r.reporter) as reporter_nickname,
        (select p.nickname from public.profiles p where p.id = r.brew_owner) as owner_nickname,
        (select b.bean_name from public.shared_brews b where b.owner = r.brew_owner and b.id = r.brew_id) as bean_name
      from public.reports r
      order by r.created_at desc
      limit private.page_size(lim) offset greatest(coalesce(off, 0), 0)
    ) x
  ), '[]'::jsonb);
end
$$;

-- 意見回饋：新→舊
create function public.admin_list_feedback(lim integer default 50, off integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select f.id, f.category, f.message, f.app_version, f.created_at, f.author,
        (select p.nickname from public.profiles p where p.id = f.author) as nickname
      from public.feedback f
      order by f.created_at desc
      limit private.page_size(lim) offset greatest(coalesce(off, 0), 0)
    ) x
  ), '[]'::jsonb);
end
$$;

-- 操作紀錄：新→舊，附操作者目前的暱稱
create function public.admin_list_audit(lim integer default 50, off integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select l.*, (select p.nickname from public.profiles p where p.id = l.actor) as actor_nickname
      from public.admin_audit_log l
      order by l.created_at desc
      limit private.page_size(lim) offset greatest(coalesce(off, 0), 0)
    ) x
  ), '[]'::jsonb);
end
$$;

/* ===== 5. 後台刪除：先寫紀錄再刪 ===== */

-- 刪除留言（主留言的回覆 cascade）；留言不存在 → P0002
create function public.admin_delete_comment(comment_id uuid, reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c public.comments%rowtype;
  why text;
begin
  perform private.require_admin();
  why := private.check_reason(reason);
  select * into c from public.comments where id = comment_id;
  if not found then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;
  insert into public.admin_audit_log (actor, action, target_user, target_brew, target_comment, target_nickname, detail, reason)
  values (auth.uid(), 'delete_comment', c.author, c.brew_id, c.id,
    coalesce((select p.nickname from public.profiles p where p.id = c.author), c.author_nickname),
    jsonb_build_object('brew_owner', c.brew_owner,
      'replies', (select count(*) from public.comments r where r.parent_id = c.id)),
    why);
  delete from public.comments where id = c.id;
end
$$;

-- 刪除貼文（留言、讚、檢舉 cascade）；記進 removed_brews，作者不能再上傳同一筆
-- 回傳照片路徑（沒有照片是 null），由前端用 Storage API 刪除（SQL 不能刪 storage.objects）；貼文不存在 → P0002
create function public.admin_delete_post(p_owner uuid, p_id uuid, reason text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.shared_brews%rowtype;
  why text;
begin
  perform private.require_admin();
  why := private.check_reason(reason);
  select * into b from public.shared_brews where owner = p_owner and id = p_id;
  if not found then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  insert into public.admin_audit_log (actor, action, target_user, target_brew, target_nickname, detail, reason)
  values (auth.uid(), 'delete_post', b.owner, b.id,
    coalesce((select p.nickname from public.profiles p where p.id = b.owner), ''),
    jsonb_build_object('comments', (select count(*) from public.comments c where c.brew_owner = b.owner and c.brew_id = b.id),
      'had_photo', b.photo_path is not null),
    why);
  insert into private.removed_brews (owner, id) values (b.owner, b.id) on conflict do nothing;
  delete from public.shared_brews where owner = b.owner and id = b.id;
  return b.photo_path;
end
$$;

-- 刪除帳號的第一步：Edge Function admin-delete-user 用「呼叫者的 JWT」呼叫
-- 檢查呼叫者是開發者、對象不是自己也不是開發者、對象存在，然後寫紀錄；照片和 auth 使用者由 function 刪除
create function public.admin_begin_delete_user(target uuid, reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  why text;
begin
  perform private.require_admin();
  why := private.check_reason(reason);
  if target is null or target = auth.uid() then
    raise exception 'cannot delete yourself' using errcode = '42501', hint = 'self';
  end if;
  if exists (select 1 from private.admins where user_id = target) then
    raise exception 'cannot delete an admin' using errcode = '42501', hint = 'admin';
  end if;
  if not exists (select 1 from auth.users where id = target) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  insert into public.admin_audit_log (actor, action, target_user, target_nickname, detail, reason)
  values (auth.uid(), 'delete_user', target,
    coalesce((select p.nickname from public.profiles p where p.id = target), ''),
    jsonb_build_object(
      'posts', (select count(*) from public.shared_brews b where b.owner = target),
      'comments', (select count(*) from public.comments c where c.author = target)),
    why);
end
$$;

/* ===== 6. Storage：開發者可以讀照片、頭像，刪貼文的照片 ===== */

create policy "brew-photos: 開發者可讀" on storage.objects
  for select to authenticated
  using (bucket_id = 'brew-photos' and private.is_admin());
create policy "avatars: 開發者可讀" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and private.is_admin());
create policy "brew-photos: 開發者可刪" on storage.objects
  for delete to authenticated
  using (bucket_id = 'brew-photos' and private.is_admin());

/* ===== 7. 函式權限：最後統一設定 ===== */

revoke all on function
  private.is_admin(),
  private.require_admin(),
  private.audit_log_immutable(),
  private.check_reason(text),
  private.shared_brews_not_removed(),
  private.page_size(integer),
  private.admin_post_json(public.shared_brews),
  private.admin_comment_json(public.comments)
  from public, anon, authenticated;
-- RLS 政策（audit log、storage）以呼叫者身分執行，需要 execute；它只回答目前使用者自己的身分
grant execute on function private.is_admin() to authenticated;

revoke all on function
  public.am_i_admin(),
  public.admin_list_users(text, integer, integer),
  public.admin_user_detail(uuid),
  public.admin_list_posts(integer, integer),
  public.admin_post_detail(uuid, uuid),
  public.admin_list_reports(integer, integer),
  public.admin_list_feedback(integer, integer),
  public.admin_list_audit(integer, integer),
  public.admin_delete_comment(uuid, text),
  public.admin_delete_post(uuid, uuid, text),
  public.admin_begin_delete_user(uuid, text)
  from public, anon, authenticated;
-- 每個函式裡都會先檢查是不是開發者
grant execute on function
  public.am_i_admin(),
  public.admin_list_users(text, integer, integer),
  public.admin_user_detail(uuid),
  public.admin_list_posts(integer, integer),
  public.admin_post_detail(uuid, uuid),
  public.admin_list_reports(integer, integer),
  public.admin_list_feedback(integer, integer),
  public.admin_list_audit(integer, integer),
  public.admin_delete_comment(uuid, text),
  public.admin_delete_post(uuid, uuid, text),
  public.admin_begin_delete_user(uuid, text)
  to authenticated;
