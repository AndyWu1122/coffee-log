-- 拉花分享到社群（1.25.0）
--
-- 1. private.posts：手沖（shared_brews）和拉花（shared_latte_arts）共同的上層，(owner, id) 在兩種貼文之間唯一
--    讚、留言、檢舉、留言推播的合併狀態原本用外鍵指向 shared_brews，改成指向 posts → 兩種貼文都能按讚、留言、檢舉
--    posts 由 trigger 維護：貼文新增前先寫 posts（同一個 id 不能同時是兩種，23505），貼文刪除後刪 posts（讚、留言、檢舉跟著 cascade）
-- 2. 停權：private.can_view 加上「對方沒有被停權」（auth.users.banned_until），手沖、拉花、留言、個人檔案、熱度圖一起生效
-- 3. shared_latte_arts：權限和 shared_brews 同一套（本人，或已接受、沒有封鎖、沒有停權的好友）；
--    每天 30 筆和手沖共用（rate_events 的 brew_insert）：好友新貼文的推播「每天最多 30 則」就是靠這個上限
-- 4. 照片：沿用私有 bucket brew-photos，路徑一樣是 <user_id>/<id>.jpg（id 在 posts 裡唯一，不會撞到）；
--    Storage 政策改成兩種貼文都認（刪除帳號、開發者刪照片的流程不用改）
-- 5. public.feed_posts：動態牆排序、分頁用的 view（security_invoker，RLS 照常生效）
-- 6. 好友新貼文推播：和手沖同一套（push_notified_posts、30 分鐘合併 'friend:<owner>'），
--    送出的格式也一樣（kind 'post'，豆子名稱的位置放「拉花・圖案」），send-push 不用改
-- 7. 開發者後台：貼文列表、詳細、刪除、用戶詳細都包含拉花

/* ===== 1. posts ===== */

create table private.posts (
  owner uuid not null references public.profiles (id) on delete cascade,
  id uuid not null,
  kind text not null constraint post_kind check (kind in ('brew', 'latte')),
  primary key (owner, id)
);
alter table private.posts enable row level security; -- 不公開、沒有政策：只有 trigger 和 security definer 函式碰得到

insert into private.posts (owner, id, kind) select owner, id, 'brew' from public.shared_brews;

-- 貼文新增前先佔用 (owner, id)；tg_argv[0] 是種類
-- 先擋「不是自己的」（和 RLS 同樣的 42501）：否則別人用你的 owner 新增時會得到 23505，等於能探測你有哪些貼文
-- 同一種貼文已經佔用（重送、upsert）照常往下，交給主鍵處理；另一種貼文用了同一個 id 才是 23505
create function private.posts_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing text;
begin
  if auth.uid() is not null and new.owner is distinct from auth.uid() then
    raise exception 'new row violates row-level security policy' using errcode = '42501';
  end if;
  insert into private.posts (owner, id, kind) values (new.owner, new.id, tg_argv[0])
  on conflict (owner, id) do nothing;
  if not found then
    select x.kind into existing from private.posts x where x.owner = new.owner and x.id = new.id;
    if existing is distinct from tg_argv[0] then
      raise exception 'post id already used' using errcode = '23505', hint = 'taken';
    end if;
  end if;
  return new;
end
$$;

create function private.posts_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.posts where owner = old.owner and id = old.id and kind = tg_argv[0];
  return null;
end
$$;

-- 名稱以 zz_ 開頭：before trigger 依名稱排序，排在每日上限、開發者移除的檢查之後
create trigger zz_posts_claim before insert on public.shared_brews
  for each row execute function private.posts_claim('brew');
create trigger posts_release after delete on public.shared_brews
  for each row execute function private.posts_release('brew');

-- 讚、留言、檢舉、留言推播的合併狀態：外鍵改指向 posts
alter table public.likes drop constraint likes_brew_owner_brew_id_fkey;
alter table public.likes add constraint likes_post_fkey
  foreign key (brew_owner, brew_id) references private.posts (owner, id) on delete cascade;
alter table public.comments drop constraint comments_brew_owner_brew_id_fkey;
alter table public.comments add constraint comments_post_fkey
  foreign key (brew_owner, brew_id) references private.posts (owner, id) on delete cascade;
alter table public.reports drop constraint reports_brew_owner_brew_id_fkey;
alter table public.reports add constraint reports_post_fkey
  foreign key (brew_owner, brew_id) references private.posts (owner, id) on delete cascade;
alter table private.push_throttle drop constraint push_throttle_brew_owner_brew_id_fkey;
alter table private.push_throttle add constraint push_throttle_post_fkey
  foreign key (brew_owner, brew_id) references private.posts (owner, id) on delete cascade;

/* ===== 2. 停權的人：好友也看不到 ===== */

create or replace function private.can_view(target uuid)
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
    and not exists (select 1 from auth.users u where u.id = target and u.banned_until > now())
  )
$$;

/* ===== 3. shared_latte_arts ===== */

create table public.shared_latte_arts (
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  id uuid not null,
  made_at timestamptz not null
    constraint made_at_range check (made_at >= timestamptz '2000-01-01'), -- 不能是未來：由 trigger 檢查
  pattern text not null
    constraint pattern_value check (pattern in ('heart', 'tulip', 'rosetta', 'swan', 'other')),
  pattern_note text not null default ''
    constraint pattern_note_length check (char_length(pattern_note) <= 50 and private.single_line(pattern_note)),
  milk text not null default ''
    constraint milk_length check (char_length(milk) <= 50 and private.single_line(milk)),
  cup text not null default ''
    constraint cup_length check (char_length(cup) <= 50 and private.single_line(cup)),
  -- 自評四項（參考世界拉花大賽的視覺評分），各 1–5；總分是平均，由 App 算
  score_contrast smallint not null constraint score_contrast_range check (score_contrast between 1 and 5),
  score_foam smallint not null constraint score_foam_range check (score_foam between 1 and 5),
  score_symmetry smallint not null constraint score_symmetry_range check (score_symmetry between 1 and 5),
  score_completion smallint not null constraint score_completion_range check (score_completion between 1 and 5),
  notes text not null default ''
    constraint notes_length check (char_length(notes) <= 500),
  photo_path text
    constraint photo_path_own check (photo_path = owner::text || '/' || id::text || '.jpg'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner, id)
);
create index shared_latte_arts_owner_made_at on public.shared_latte_arts (owner, made_at desc);
create index shared_latte_arts_photo_path on public.shared_latte_arts (photo_path) where photo_path is not null;

revoke all on table public.shared_latte_arts from anon, authenticated;
alter table public.shared_latte_arts enable row level security;

-- 新增：每天 30 筆（和手沖共用）；新增、修改：時間不能是未來；修改時不能改 owner、id、created_at
create function private.shared_latte_arts_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.made_at > now() + interval '1 day' then
    raise exception 'made_at is in the future' using errcode = '23514';
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
create trigger shared_latte_arts_before_write before insert or update on public.shared_latte_arts
  for each row execute function private.shared_latte_arts_before_write();
-- 開發者移除過的不能再上傳（和手沖共用 removed_brews；函式只看 new.owner、new.id）
create trigger shared_latte_arts_not_removed before insert on public.shared_latte_arts
  for each row execute function private.shared_brews_not_removed();
create trigger zz_posts_claim before insert on public.shared_latte_arts
  for each row execute function private.posts_claim('latte');
create trigger posts_release after delete on public.shared_latte_arts
  for each row execute function private.posts_release('latte');

grant select, delete on public.shared_latte_arts to authenticated;
grant insert (
  owner, id, made_at, pattern, pattern_note, milk, cup,
  score_contrast, score_foam, score_symmetry, score_completion, notes, photo_path
) on public.shared_latte_arts to authenticated;
grant update (
  made_at, pattern, pattern_note, milk, cup,
  score_contrast, score_foam, score_symmetry, score_completion, notes, photo_path
) on public.shared_latte_arts to authenticated;

create policy "shared_latte_arts: 本人或已接受且沒封鎖的好友可讀" on public.shared_latte_arts
  for select to authenticated
  using (owner = (select auth.uid()) or private.can_view(owner));
create policy "shared_latte_arts: 只能新增自己的" on public.shared_latte_arts
  for insert to authenticated
  with check (owner = (select auth.uid()));
create policy "shared_latte_arts: 只能改自己的" on public.shared_latte_arts
  for update to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));
create policy "shared_latte_arts: 只能刪自己的" on public.shared_latte_arts
  for delete to authenticated
  using (owner = (select auth.uid()));

/* ===== 讚、檢舉：看得到貼文（任一種）才行 ===== */

-- security invoker：子查詢套用兩張表的 RLS
create function private.post_visible(p_owner uuid, p_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.shared_brews b where b.owner = p_owner and b.id = p_id)
      or exists (select 1 from public.shared_latte_arts a where a.owner = p_owner and a.id = p_id)
$$;

drop policy "likes: 看得到紀錄、且和按讚的人沒有封鎖才看得到" on public.likes;
create policy "likes: 看得到貼文、且和按讚的人沒有封鎖才看得到" on public.likes
  for select to authenticated
  using (private.post_visible(brew_owner, brew_id) and not private.blocked_with(user_id));
drop policy "likes: 只能以自己的名義、對看得到的紀錄按讚" on public.likes;
create policy "likes: 只能以自己的名義、對看得到的貼文按讚" on public.likes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.post_visible(brew_owner, brew_id));

drop policy "reports: 只能以自己的名義、檢舉看得到的紀錄" on public.reports;
create policy "reports: 只能以自己的名義、檢舉看得到的貼文" on public.reports
  for insert to authenticated
  with check (
    reporter = (select auth.uid())
    and brew_owner <> (select auth.uid())
    and private.post_visible(brew_owner, brew_id)
  );

/* ===== 4. 照片：brew-photos 的政策認兩種貼文 ===== */

drop policy "brew-photos: 本人，或讀得到對應紀錄的人可讀" on storage.objects;
create policy "brew-photos: 本人，或讀得到對應貼文的人可讀" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'brew-photos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.shared_brews b where b.photo_path = objects.name)
      or exists (select 1 from public.shared_latte_arts a where a.photo_path = objects.name)
    )
  );

drop policy "brew-photos: 只能上傳自己紀錄指定的路徑" on storage.objects;
create policy "brew-photos: 只能上傳自己貼文指定的路徑" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'brew-photos'
    and (
      exists (select 1 from public.shared_brews b where b.owner = (select auth.uid()) and b.photo_path = objects.name)
      or exists (select 1 from public.shared_latte_arts a where a.owner = (select auth.uid()) and a.photo_path = objects.name)
    )
  );

drop policy "brew-photos: 只能覆蓋自己紀錄指定的路徑" on storage.objects;
create policy "brew-photos: 只能覆蓋自己貼文指定的路徑" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'brew-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'brew-photos'
    and (
      exists (select 1 from public.shared_brews b where b.owner = (select auth.uid()) and b.photo_path = objects.name)
      or exists (select 1 from public.shared_latte_arts a where a.owner = (select auth.uid()) and a.photo_path = objects.name)
    )
  );

/* ===== 5. 動態牆的排序與分頁 ===== */

create view public.feed_posts with (security_invoker = true) as
  select b.owner, b.id, 'brew'::text as kind, b.brewed_at as at, b.created_at from public.shared_brews b
  union all
  select a.owner, a.id, 'latte'::text, a.made_at, a.created_at from public.shared_latte_arts a;
revoke all on public.feed_posts from anon, authenticated;
grant select on public.feed_posts to authenticated;

-- 個人檔案的貼文數：兩種都算
create or replace function public.profile_detail(target uuid)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'id', p.id,
    'nickname', p.nickname,
    'avatar_path', p.avatar_path,
    'bio', p.bio,
    'favorite_gear', p.favorite_gear,
    'favorite_beans', p.favorite_beans,
    'created_at', p.created_at,
    'posts', (select count(*) from private.posts x where x.owner = p.id)
  )
  from public.profiles p
  where p.id = target and auth.uid() is not null and private.can_view(target)
$$;

/* ===== 6. 好友新貼文的推播 ===== */

-- 拉花的「名稱」（推播裡放在豆子名稱的位置）：拉花・愛心；「其他」有說明時用說明
create function private.latte_title(pattern text, note text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '拉花・' || case pattern
    when 'heart' then '愛心' when 'tulip' then '鬱金香' when 'rosetta' then '葉子' when 'swan' then '天鵝'
    else coalesce(nullif(btrim(note), ''), '其他') end
$$;

-- 和 shared_brews_push 同一套規則（第一次上傳才通知、停權、封鎖、偏好 new_posts、訂閱、30 分鐘合併、每批 200 人）
create function private.shared_latte_arts_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base jsonb;
  batch jsonb := '[]'::jsonb;
  r record;
  w record;
begin
  begin
    insert into private.push_notified_posts (owner, id) values (new.owner, new.id) on conflict do nothing;
    if not found or not private.push_ready() then
      return null;
    end if;
    if exists (select 1 from auth.users u where u.id = new.owner and u.banned_until > now()) then
      return null;
    end if;

    base := jsonb_build_object(
      'brew_owner', new.owner,
      'brew_id', new.id,
      'actor_nickname', (select p.nickname from public.profiles p where p.id = new.owner),
      'bean_name', left(private.latte_title(new.pattern, new.pattern_note), 30)
    );

    for r in
      with friends (user_id) as (
        select case when f.requester = new.owner then f.addressee else f.requester end
        from public.friendships f
        where f.status = 'accepted' and (f.requester = new.owner or f.addressee = new.owner)
      )
      select fr.user_id from friends fr
      where not exists (
          select 1 from public.blocks b
          where (b.blocker = fr.user_id and b.blocked = new.owner)
             or (b.blocker = new.owner and b.blocked = fr.user_id)
        )
        and not exists (select 1 from auth.users u where u.id = fr.user_id and u.banned_until > now())
        and coalesce((select np.new_posts from public.notification_prefs np where np.user_id = fr.user_id), false)
        and exists (select 1 from public.push_subscriptions s where s.user_id = fr.user_id)
    loop
      select * into w from private.push_window(r.user_id, 'friend:' || new.owner::text);
      batch := batch || jsonb_build_object('user_id', r.user_id, 'kind', 'post', 'count', w.events, 'quiet', w.quiet);
      if jsonb_array_length(batch) >= 200 then
        perform private.push_send(base || jsonb_build_object('recipients', batch));
        batch := '[]'::jsonb;
      end if;
    end loop;

    if jsonb_array_length(batch) > 0 then
      perform private.push_send(base || jsonb_build_object('recipients', batch));
    end if;
  exception when others then
    raise warning 'shared_latte_arts_push failed: %', sqlstate;
  end;
  return null;
end
$$;
create trigger shared_latte_arts_push after insert on public.shared_latte_arts
  for each row execute function private.shared_latte_arts_push();

/* ===== 7. 開發者後台 ===== */

-- 一篇拉花＋作者暱稱、讚數、留言數、檢舉數（欄位和 admin_post_json 對齊：kind、時間）
create function private.admin_latte_json(a public.shared_latte_arts)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(a) || jsonb_build_object(
    'kind', 'latte',
    'owner_nickname', (select p.nickname from public.profiles p where p.id = a.owner),
    'likes', (select count(*) from public.likes l where l.brew_owner = a.owner and l.brew_id = a.id),
    'comments', (select count(*) from public.comments c where c.brew_owner = a.owner and c.brew_id = a.id),
    'reports', (select count(*) from public.reports r where r.brew_owner = a.owner and r.brew_id = a.id)
  )
$$;

-- 兩種貼文一起（kind、排序用的時間）；owner 為 null 時是全部
create function private.admin_posts(p_owner uuid)
returns table (j jsonb, at timestamptz, id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select private.admin_post_json(b) || jsonb_build_object('kind', 'brew'), b.brewed_at, b.id
  from public.shared_brews b where p_owner is null or b.owner = p_owner
  union all
  select private.admin_latte_json(a), a.made_at, a.id
  from public.shared_latte_arts a where p_owner is null or a.owner = p_owner
$$;

create or replace function public.admin_list_users(search text default '', lim integer default 50, off integer default 0)
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
        (select count(*) from private.posts x where x.owner = p.id) as posts,
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

create or replace function public.admin_user_detail(uid uuid)
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
      'posts', coalesce((select jsonb_agg(x.j order by x.at desc) from private.admin_posts(p.id) x), '[]'::jsonb),
      'comments', coalesce((select jsonb_agg(private.admin_comment_json(c) order by c.created_at desc)
        from public.comments c where c.author = p.id), '[]'::jsonb)
    )
    from public.profiles p where p.id = uid
  );
end
$$;

create or replace function public.admin_list_posts(lim integer default 50, off integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(x.j order by x.at desc, x.id) from (
      select * from private.admin_posts(null)
      order by at desc, id
      limit private.page_size(lim) offset greatest(coalesce(off, 0), 0)
    ) x
  ), '[]'::jsonb);
end
$$;

create or replace function public.admin_post_detail(p_owner uuid, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  post jsonb;
begin
  perform private.require_admin();
  select private.admin_post_json(b) || jsonb_build_object('kind', 'brew') into post
  from public.shared_brews b where b.owner = p_owner and b.id = p_id;
  if post is null then
    select private.admin_latte_json(a) into post from public.shared_latte_arts a where a.owner = p_owner and a.id = p_id;
  end if;
  if post is null then
    return null;
  end if;
  return jsonb_build_object(
    'post', post,
    'comments', coalesce((select jsonb_agg(private.admin_comment_json(c) order by c.created_at)
      from public.comments c where c.brew_owner = p_owner and c.brew_id = p_id), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'detail', r.detail,
        'created_at', r.created_at, 'reporter', r.reporter,
        'reporter_nickname', (select p.nickname from public.profiles p where p.id = r.reporter)) order by r.created_at desc)
      from public.reports r where r.brew_owner = p_owner and r.brew_id = p_id), '[]'::jsonb)
  );
end
$$;

create or replace function public.admin_list_reports(lim integer default 50, off integer default 0)
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
        coalesce(
          (select b.bean_name from public.shared_brews b where b.owner = r.brew_owner and b.id = r.brew_id),
          (select private.latte_title(a.pattern, a.pattern_note) from public.shared_latte_arts a where a.owner = r.brew_owner and a.id = r.brew_id)
        ) as bean_name
      from public.reports r
      order by r.created_at desc
      limit private.page_size(lim) offset greatest(coalesce(off, 0), 0)
    ) x
  ), '[]'::jsonb);
end
$$;

-- 刪除貼文（任一種；留言、讚、檢舉 cascade）；記進 removed_brews，作者不能再上傳同一筆；回傳照片路徑
create or replace function public.admin_delete_post(p_owner uuid, p_id uuid, reason text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  post_kind text;
  photo text;
  why text;
begin
  perform private.require_admin();
  why := private.check_reason(reason);
  select x.kind into post_kind from private.posts x where x.owner = p_owner and x.id = p_id;
  if post_kind = 'brew' then
    select b.photo_path into photo from public.shared_brews b where b.owner = p_owner and b.id = p_id;
  elsif post_kind = 'latte' then
    select a.photo_path into photo from public.shared_latte_arts a where a.owner = p_owner and a.id = p_id;
  else
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  insert into public.admin_audit_log (actor, action, target_user, target_brew, target_nickname, detail, reason)
  values (auth.uid(), 'delete_post', p_owner, p_id,
    coalesce((select p.nickname from public.profiles p where p.id = p_owner), ''),
    jsonb_build_object('kind', post_kind,
      'comments', (select count(*) from public.comments c where c.brew_owner = p_owner and c.brew_id = p_id),
      'had_photo', photo is not null),
    why);
  insert into private.removed_brews (owner, id) values (p_owner, p_id) on conflict do nothing;
  if post_kind = 'brew' then
    delete from public.shared_brews where owner = p_owner and id = p_id;
  else
    delete from public.shared_latte_arts where owner = p_owner and id = p_id;
  end if;
  return photo;
end
$$;

create or replace function public.admin_begin_delete_user(target uuid, reason text)
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
      'posts', (select count(*) from private.posts x where x.owner = target),
      'comments', (select count(*) from public.comments c where c.author = target)),
    why);
end
$$;

/* ===== 8. 函式權限：最後統一設定 ===== */
-- 新函式預設不給執行權限；create or replace 保留原本的權限，這裡再明確設定一次
revoke all on function
  private.posts_claim(),
  private.posts_release(),
  private.can_view(uuid),
  private.shared_latte_arts_before_write(),
  private.post_visible(uuid, uuid),
  private.latte_title(text, text),
  private.shared_latte_arts_push(),
  private.admin_latte_json(public.shared_latte_arts),
  private.admin_posts(uuid)
  from public, anon, authenticated;
-- RLS 政策以呼叫者身分執行，需要 execute（can_view 只回答目前使用者自己的關係；post_visible 是 security invoker，照常套用 RLS）
grant execute on function private.can_view(uuid) to authenticated;
grant execute on function private.post_visible(uuid, uuid) to authenticated;

revoke all on function
  public.profile_detail(uuid),
  public.admin_list_users(text, integer, integer),
  public.admin_user_detail(uuid),
  public.admin_list_posts(integer, integer),
  public.admin_post_detail(uuid, uuid),
  public.admin_list_reports(integer, integer),
  public.admin_delete_post(uuid, uuid, text),
  public.admin_begin_delete_user(uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.profile_detail(uuid),
  public.admin_list_users(text, integer, integer),
  public.admin_user_detail(uuid),
  public.admin_list_posts(integer, integer),
  public.admin_post_detail(uuid, uuid),
  public.admin_list_reports(integer, integer),
  public.admin_delete_post(uuid, uuid, text),
  public.admin_begin_delete_user(uuid, text)
  to authenticated;
