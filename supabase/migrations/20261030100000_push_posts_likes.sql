-- 推播通知擴充（1.11.0）：好友發新貼文、有人按讚我的貼文
-- 沿用 20261029100000_push.sql 的架構：trigger 判斷通知誰、合併 → pg_net（HMAC 簽章）→ Edge Function send-push
-- （comments_push 已部署，這裡不改它；新的兩個 trigger 共用下面的 helper）
--
-- 規則（全部在資料庫強制）：
-- - 好友新貼文：一筆紀錄第一次 insert 到 shared_brews 時通知發文者的好友；之後修改（update）不算；
--   改回只有我（delete）再分享（insert）也不算：通知過的貼文記在 push_notified_posts（不接 shared_brews 的外鍵，刪掉後還記得）
--   每人每天最多觸發 30 則：insert 本身已被 brew_insert 每天 30 筆擋住，同一筆又只通知一次，所以不另外計數
-- - 按讚：通知貼文作者；自己按自己的不通知；同一人對同一篇只通知一次（push_notified_likes，收回再按不重複）
-- - 不通知：封鎖（任一方向）、發文者／按讚者或收件人被停權（auth.users.banned_until）、偏好關掉、沒有訂閱
--   好友新貼文只送給已接受的好友（和 private.can_view 相同：好友、沒有封鎖）
-- - 偏好：notification_prefs 新增 new_posts（預設關）、likes（預設開）；沒有這一列＝comments、replies、likes 開，new_posts 關
-- - 合併（push_windows）：同一位好友的新貼文、同一篇貼文的讚，30 分鐘內第一則正常通知（響），
--   之後的仍然送出，但標記 quiet，sw.js 用同一個 tag 安靜地取代內容（「分享了 N 杯」「和其他 N 人」）
-- - 推播出錯絕不影響上傳與按讚；推播內容不含筆記

/* ===== 1. 偏好的新欄位 ===== */

alter table public.notification_prefs
  add column new_posts boolean not null default false,
  add column likes boolean not null default true;
-- 舊版 App 的 upsert 只帶 comments、replies：PostgREST 只更新帶來的欄位，不會蓋掉新的兩個
grant insert (new_posts, likes), update (new_posts, likes) on public.notification_prefs to authenticated;

/* ===== 2. 通知過的貼文、讚（不從 API 公開） ===== */

create table private.push_notified_posts (
  owner uuid not null references public.profiles (id) on delete cascade,
  id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner, id)
);
alter table private.push_notified_posts enable row level security;

create table private.push_notified_likes (
  brew_owner uuid not null references public.profiles (id) on delete cascade,
  brew_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (brew_owner, brew_id, user_id)
);
alter table private.push_notified_likes enable row level security;

/* ===== 3. 30 分鐘合併的狀態 ===== */
-- key：'friend:<發文者>'（好友新貼文）或 'like:<owner>/<brew_id>'（讚）
create table private.push_windows (
  recipient uuid not null references public.profiles (id) on delete cascade,
  key text not null,
  started_at timestamptz not null,
  events integer not null,
  primary key (recipient, key)
);
alter table private.push_windows enable row level security;

/* ===== 4. 共用的 helper ===== */

-- vault 有沒有設定推播（沒設定就不送；本機由測試腳本設定，正式步驟見 docs/supabase-setup.md 5-6）
create function private.push_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from vault.decrypted_secrets s where s.name = 'send_push_url')
     and exists (select 1 from vault.decrypted_secrets s where s.name = 'push_webhook_secret')
$$;

-- 簽章後交給 pg_net（交易 commit 後才送出；rollback 不送）；和 comments_push 的寫法相同
create function private.push_send(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  push_url text;
  push_secret text;
  body jsonb := payload || jsonb_build_object('sent_at', floor(extract(epoch from clock_timestamp()))::bigint);
begin
  select s.decrypted_secret into push_url from vault.decrypted_secrets s where s.name = 'send_push_url';
  select s.decrypted_secret into push_secret from vault.decrypted_secrets s where s.name = 'push_webhook_secret';
  if push_url is null or push_secret is null then
    return;
  end if;
  -- pg_net 送出的內容就是 convert_to(body::text, 'UTF8')，所以對 body::text 簽章
  perform net.http_post(
    url := push_url,
    body := body,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-signature', encode(extensions.hmac(body::text, push_secret, 'sha256'), 'hex')
    ),
    timeout_milliseconds := 10000
  );
end
$$;

-- 30 分鐘合併：視窗不存在或已超過 30 分鐘 → 重新開始（events = 1，響）；否則 events + 1（安靜取代）
-- 同時的事件由這一列的鎖排隊
create function private.push_window(target uuid, window_key text, out events integer, out quiet boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  insert into private.push_windows as w (recipient, key, started_at, events)
  values (target, window_key, now(), 1)
  on conflict (recipient, key) do update set
    started_at = case when w.started_at <= now() - interval '30 minutes' then now() else w.started_at end,
    events = case when w.started_at <= now() - interval '30 minutes' then 1 else w.events + 1 end
  returning w.events, w.events > 1 into events, quiet;
end
$$;

/* ===== 5. 好友新貼文 ===== */

create function private.shared_brews_push()
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
    -- 第一次上傳才通知（改回只有我再分享不算）；沒設定推播也照樣記下
    insert into private.push_notified_posts (owner, id) values (new.owner, new.id) on conflict do nothing;
    if not found or not private.push_ready() then
      return null;
    end if;
    -- 發文者被停權：不通知任何人
    if exists (select 1 from auth.users u where u.id = new.owner and u.banned_until > now()) then
      return null;
    end if;

    base := jsonb_build_object(
      'brew_owner', new.owner,
      'brew_id', new.id,
      'actor_nickname', (select p.nickname from public.profiles p where p.id = new.owner),
      'bean_name', left(new.bean_name, 30)
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
      -- send-push 一次最多收 200 人
      if jsonb_array_length(batch) >= 200 then
        perform private.push_send(base || jsonb_build_object('recipients', batch));
        batch := '[]'::jsonb;
      end if;
    end loop;

    if jsonb_array_length(batch) > 0 then
      perform private.push_send(base || jsonb_build_object('recipients', batch));
    end if;
  exception when others then
    -- 推播出錯不影響上傳（記在資料庫 log，不含內容）
    raise warning 'shared_brews_push failed: %', sqlstate;
  end;
  return null;
end
$$;
-- 只掛 insert：修改舊貼文不通知
create trigger shared_brews_push after insert on public.shared_brews
  for each row execute function private.shared_brews_push();

/* ===== 6. 按讚 ===== */

create function private.likes_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  w record;
begin
  begin
    if new.user_id = new.brew_owner then
      return null; -- 自己按自己的讚
    end if;
    -- 同一人對同一篇只通知一次（收回再按不重複）；沒設定推播也照樣記下
    insert into private.push_notified_likes (brew_owner, brew_id, user_id)
    values (new.brew_owner, new.brew_id, new.user_id) on conflict do nothing;
    if not found or not private.push_ready() then
      return null;
    end if;

    if exists (select 1 from auth.users u where u.id in (new.user_id, new.brew_owner) and u.banned_until > now())
      or exists (
        select 1 from public.blocks b
        where (b.blocker = new.user_id and b.blocked = new.brew_owner)
           or (b.blocker = new.brew_owner and b.blocked = new.user_id)
      )
      or not coalesce((select np.likes from public.notification_prefs np where np.user_id = new.brew_owner), true)
      or not exists (select 1 from public.push_subscriptions s where s.user_id = new.brew_owner)
    then
      return null;
    end if;

    select * into w from private.push_window(new.brew_owner, 'like:' || new.brew_owner::text || '/' || new.brew_id::text);
    perform private.push_send(jsonb_build_object(
      'brew_owner', new.brew_owner,
      'brew_id', new.brew_id,
      'actor_nickname', (select p.nickname from public.profiles p where p.id = new.user_id),
      'recipients', jsonb_build_array(jsonb_build_object(
        'user_id', new.brew_owner, 'kind', 'like', 'count', w.events, 'quiet', w.quiet
      ))
    ));
  exception when others then
    raise warning 'likes_push failed: %', sqlstate;
  end;
  return null;
end
$$;
create trigger likes_push after insert on public.likes
  for each row execute function private.likes_push();

/* ===== 7. 函式權限：最後統一設定（都不開放） ===== */
revoke all on function
  private.push_ready(),
  private.push_send(jsonb),
  private.push_window(uuid, text),
  private.shared_brews_push(),
  private.likes_push()
  from public, anon, authenticated;
