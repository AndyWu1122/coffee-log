-- 留言與回覆（社群頁的詳細頁）
--
-- 規則（全部在資料庫強制，anon key 是公開的）：
-- - 只有兩層：主留言（parent_id null）與回覆；回覆只能掛在「同一篇貼文」的主留言下
--   回覆別人的回覆時，也掛在同一則主留言下，reply_to_user 記下回覆的對象（畫面顯示「@暱稱」）
-- - 內容 1–300 字（除了換行，不可有控制字元）；每人每天 100 則（台灣時間，只算成功新增的）；不能修改
-- - 讀得到貼文才讀得到留言；只能以自己的名義、在讀得到的貼文留言
-- - 留言作者或貼文作者可以刪除；刪主留言時回覆一起刪（外鍵 cascade）
-- - 貼文刪除或改回只有我（shared_brews 刪除）時留言全刪；刪除帳號時 cascade
-- - 解除好友（含封鎖）時，刪掉雙方在對方貼文的留言
-- - 封鎖的雙方互相看不到對方的留言（包括在共同好友的貼文上），不能回覆對方；
--   對被封鎖者來說和「不是好友」一樣（錯誤碼相同）
-- - 暱稱：留言者常常不是讀者的好友（profiles 讀不到），留言當下由 trigger 記下暱稱（前端不能指定），
--   不擴大 profiles 的讀取範圍（裡面有好友代碼）；比照 blocks.blocked_nickname

/* ===== 1. 每日上限的計數加上 comment ===== */
alter table private.rate_events drop constraint rate_event_kind;
alter table private.rate_events add constraint rate_event_kind
  check (kind in ('brew_insert', 'friend_request', 'code_attempt', 'report', 'feedback', 'comment'));

/* ===== 2. comments ===== */

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  brew_owner uuid not null,
  brew_id uuid not null,
  author uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- 主留言是 null；回覆指向同一篇貼文的主留言（下面的複合外鍵強制同一篇；只能是主留言由 trigger 強制）
  parent_id uuid,
  -- 回覆的對象（顯示「@暱稱」）：只有回覆才能有；對方刪除帳號時變成 null
  reply_to_user uuid references public.profiles (id) on delete set null,
  -- 由 trigger 在新增當下記下（前端不能指定）
  author_nickname text not null default '',
  reply_to_nickname text,
  body text not null
    constraint comment_body_length
      check (char_length(body) <= 300 and char_length(btrim(body, E' \n　')) >= 1)
    constraint comment_body_chars check (private.single_line(replace(body, E'\n', ''))),
  created_at timestamptz not null default now(),
  constraint comment_reply_to_only_in_replies check (parent_id is not null or reply_to_user is null),
  constraint comments_in_brew unique (brew_owner, brew_id, id),
  -- 貼文刪除（或改回只有我）時留言全刪
  foreign key (brew_owner, brew_id) references public.shared_brews (owner, id) on delete cascade,
  -- 回覆只能在同一篇貼文；刪主留言時回覆一起刪
  foreign key (brew_owner, brew_id, parent_id) references public.comments (brew_owner, brew_id, id) on delete cascade
);
create index comments_brew on public.comments (brew_owner, brew_id, created_at);
create index comments_parent on public.comments (parent_id);
create index comments_author on public.comments (author);
create index comments_reply_to on public.comments (reply_to_user);

-- Supabase 預設會把 public 的新表開給 anon、authenticated，先全部收回
revoke all on table public.comments from anon, authenticated;
alter table public.comments enable row level security;

/* ===== 3. 判斷函式 ===== */

-- 目前使用者和 target 之間有沒有封鎖（任一方向）；只回答「目前登入的人」與某人的關係
-- 需要讀到「對方封鎖了我」（blocks 對被封鎖者不可見），所以用 security definer
create function private.blocked_with(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker = auth.uid() and b.blocked = target)
       or (b.blocker = target and b.blocked = auth.uid())
  )
$$;

/* ===== 4. 新增：檢查、暱稱、每日上限 ===== */

create function private.comments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  parent public.comments%rowtype;
begin
  -- 先確認身分與讀取權限（和 RLS 的 with check 相同、錯誤碼也相同），
  -- 讀不到貼文的人不會因為下面的檢查得知留言是否存在
  if me is not null and (new.author is distinct from me or not private.can_view(new.brew_owner)) then
    raise exception 'new row violates row-level security policy for table "comments"' using errcode = '42501';
  end if;

  new.created_at := now();
  new.author_nickname := coalesce((select p.nickname from public.profiles p where p.id = new.author), '');
  new.reply_to_nickname := null;

  if new.parent_id is not null then
    select * into parent from public.comments c
    where c.id = new.parent_id and c.brew_owner = new.brew_owner and c.brew_id = new.brew_id;
    if found then
      if parent.parent_id is not null then
        raise exception 'replies can only be added to top-level comments' using errcode = '23514';
      end if;
      -- 看不到的父留言（和作者之間有封鎖）：和不存在一樣
      if me is not null and private.blocked_with(parent.author) then
        raise exception 'parent comment not found' using errcode = '23503';
      end if;
    end if;
    -- 不存在或在別篇貼文：由外鍵拒絕（23503）
  end if;

  -- 回覆的對象：貼文作者，或在這一串（主留言與它的回覆）留過言的人，而且和我之間沒有封鎖
  -- （因此一定讀得到這篇貼文；也不能拿來探測任意帳號是不是貼文作者的好友）
  if new.reply_to_user is not null and new.parent_id is not null then
    if (new.reply_to_user <> new.brew_owner and not exists (
          select 1 from public.comments c
          where c.brew_owner = new.brew_owner and c.brew_id = new.brew_id
            and (c.id = new.parent_id or c.parent_id = new.parent_id)
            and c.author = new.reply_to_user
        ))
        or (me is not null and private.blocked_with(new.reply_to_user)) then
      raise exception 'reply_to_user must be the post owner or someone in this thread' using errcode = '23514';
    end if;
    new.reply_to_nickname := (select p.nickname from public.profiles p where p.id = new.reply_to_user);
  end if;

  -- 每天 100 則（台灣時間）；這一列沒有成功新增時，整個陳述式回復，次數也不會記下
  if me is not null then
    if private.count_today(me, 'comment') >= 100 then
      raise exception 'daily comment limit reached' using errcode = 'P0001', hint = 'rate_limited';
    end if;
    insert into private.rate_events (user_id, kind) values (me, 'comment');
  end if;
  return new;
end
$$;
create trigger comments_before_insert before insert on public.comments
  for each row execute function private.comments_before_insert();

-- 使用者不能修改（沒有 update 權限）；唯一的修改是回覆對象刪除帳號時外鍵把 reply_to_user 設成 null，
-- 這時一起清掉記下的暱稱（雲端不留已刪除帳號的暱稱）
create function private.comments_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reply_to_user is null then
    new.reply_to_nickname := null;
  end if;
  return new;
end
$$;
create trigger comments_before_update before update on public.comments
  for each row execute function private.comments_before_update();

/* ===== 5. 解除好友（含封鎖）：刪掉雙方在對方貼文的留言 ===== */
-- 封鎖時 blocks_after_insert 會刪掉 friendships，也會經過這裡

create function private.friendships_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.comments
  where (author = old.requester and brew_owner = old.addressee)
     or (author = old.addressee and brew_owner = old.requester);
  return null;
end
$$;
create trigger friendships_after_delete after delete on public.friendships
  for each row execute function private.friendships_after_delete();

/* ===== 6. 權限 ===== */

grant select, delete on public.comments to authenticated;
grant insert (brew_owner, brew_id, author, parent_id, reply_to_user, body) on public.comments to authenticated;
-- 不開放 update：留言不能修改

create policy "comments: 讀得到貼文、且和留言者之間沒有封鎖" on public.comments
  for select to authenticated
  using (private.can_view(brew_owner) and not private.blocked_with(author));
create policy "comments: 只能以自己的名義、在讀得到的貼文留言" on public.comments
  for insert to authenticated
  with check (author = (select auth.uid()) and private.can_view(brew_owner));
create policy "comments: 留言作者或貼文作者可以刪除" on public.comments
  for delete to authenticated
  using (author = (select auth.uid()) or brew_owner = (select auth.uid()));

/* ===== 7. 通知：只查目前登入的人 ===== */
/*
 * 我貼文的新留言、回覆我的留言（社群分頁的數字），各自從上次看過的時間算起（null＝全部），最多各算 100
 *   post_comments：別人在我的貼文留的言（包含回覆）
 *   replies：別人在「別人的貼文」回覆我（回覆我的主留言，或 @我）；在我的貼文上的已經算在 post_comments
 *   latest_*_at：這次算到的最新一則的時間（雲端時間；前端記下當作「看過了」）
 *   posts：有新留言的貼文 ['<owner>/<id>', ...]
 * security invoker：RLS 照常生效（被封鎖、讀不到的不算）
 */
create function public.comment_activity(post_since timestamptz default null, reply_since timestamptz default null)
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  with post_comments as (
    select c.brew_owner, c.brew_id, c.created_at from public.comments c
    where c.brew_owner = auth.uid() and c.author <> auth.uid()
      and (post_since is null or c.created_at > post_since)
    order by c.created_at desc
    limit 100
  ),
  replies as (
    select c.brew_owner, c.brew_id, c.created_at from public.comments c
    where c.brew_owner <> auth.uid() and c.author <> auth.uid()
      and (c.reply_to_user = auth.uid()
        or exists (select 1 from public.comments p where p.id = c.parent_id and p.author = auth.uid()))
      and (reply_since is null or c.created_at > reply_since)
    order by c.created_at desc
    limit 100
  )
  select json_build_object(
    'post_comments', (select count(*) from post_comments),
    'replies', (select count(*) from replies),
    'latest_post_comment_at', (select max(created_at) from post_comments),
    'latest_reply_at', (select max(created_at) from replies),
    'posts', coalesce((
      select json_agg(distinct k.key) from (
        select brew_owner::text || '/' || brew_id::text as key from post_comments
        union select brew_owner::text || '/' || brew_id::text from replies
      ) k
    ), '[]'::json)
  )
$$;

/* ===== 8. 函式權限：最後統一設定 ===== */
revoke all on function
  private.blocked_with(uuid),
  private.comments_before_insert(),
  private.comments_before_update(),
  private.friendships_after_delete()
  from public, anon, authenticated;
-- RLS 政策以呼叫者身分執行，需要 execute（只回答目前使用者自己的關係）
grant execute on function private.blocked_with(uuid) to authenticated;

revoke all on function public.comment_activity(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.comment_activity(timestamptz, timestamptz) to authenticated;
