-- 推播通知（Web Push、VAPID）：有人留言我的貼文、回覆我的留言時，手機跳出通知
--
-- 流程：comments 新增 → trigger（這裡判斷通知誰、合併）→ pg_net 呼叫 Edge Function send-push
--       → function 用 service_role 讀訂閱、加密後送到推播服務（Apple／Google／Mozilla／Microsoft）
--
-- 規則（全部在資料庫強制，anon key 是公開的）：
-- - push_subscriptions：只能新增、讀取、刪除自己的；endpoint 唯一；每人最多 10 台裝置
--   endpoint 只能是已知推播服務的 https 網址（防 SSRF：function 會對它送出請求，不能讓使用者指定任意網址）
-- - notification_prefs：「新留言」「回覆」開關（沒有這一列＝都開），只能讀寫自己的
-- - 通知對象：貼文作者（新留言）、被回覆的人與主留言作者（回覆；和 comment_activity 同一套定義）
--   不通知：留言者自己、和留言者有封鎖（任一方向）、讀不到這則留言的人、被停權（auth.users.banned_until）、關掉通知、沒有訂閱
-- - 合併：同一個人、同一篇貼文，上一則通知送出後 5 分鐘內不再送（push_throttle）
-- - trigger 和 function 之間用共享密鑰驗證：vault 的 push_webhook_secret ＝ function 的 PUSH_WEBHOOK_SECRET
--   密鑰本身不送出：header 是內容的 HMAC-SHA256（x-push-signature），內容附上送出時間，function 只收 2 分鐘內的
--   （pg_net 的佇列 net.* 是 Supabase 預設的權限，資料庫裡的角色都讀得到；雖然沒有從 API 公開，也不放密鑰）
--   function 的網址也在 vault（send_push_url）；兩個都沒設定就不送（本機由測試腳本設定，正式步驟見 docs/supabase-setup.md 5-6）
-- - 推播出錯絕不影響留言寫入；推播內容不含留言原文

create extension if not exists pg_net with schema extensions;

/* ===== 1. 檢查函式 ===== */

-- 已知推播服務的 https 網址：host 後面只能接路徑（不能有 port、帳密、@），只允許可見的 ASCII
create function private.push_endpoint_ok(e text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select char_length(e) <= 1000 and e ~ ('^https://('
    || 'fcm\.googleapis\.com'
    || '|[a-z0-9-]+\.push\.apple\.com'
    || '|([a-z0-9-]+\.)*push\.services\.mozilla\.com'
    || '|[a-z0-9-]+\.notify\.windows\.com'
    || ')/[!-~]*$')
$$;

/* ===== 2. push_subscriptions ===== */

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint text not null unique
    constraint push_endpoint_allowed check (private.push_endpoint_ok(endpoint)),
  -- 瀏覽器的公鑰（P-256 未壓縮，65 bytes，0x04 開頭）與 auth secret（16 bytes），base64url 不補 =
  p256dh text not null constraint push_p256dh_format check (p256dh ~ '^B[A-Za-z0-9_-]{86}$'),
  auth text not null constraint push_auth_format check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  user_agent text not null default ''
    constraint push_user_agent_length check (char_length(user_agent) <= 300)
    constraint push_user_agent_chars check (private.single_line(user_agent)),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);

revoke all on table public.push_subscriptions from anon, authenticated;
alter table public.push_subscriptions enable row level security;

-- 每人最多 10 台裝置：先鎖住這個人（同時新增不能超過），身分檢查和 RLS 相同、錯誤碼也相同
create function private.push_subscriptions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is not null and new.user_id is distinct from me then
    raise exception 'new row violates row-level security policy for table "push_subscriptions"' using errcode = '42501';
  end if;
  new.created_at := now();
  perform private.lock_key('push:' || new.user_id::text);
  if (select count(*) from public.push_subscriptions s where s.user_id = new.user_id) >= 10 then
    raise exception 'too many devices' using errcode = 'P0001', hint = 'too_many_devices';
  end if;
  return new;
end
$$;
create trigger push_subscriptions_before_insert before insert on public.push_subscriptions
  for each row execute function private.push_subscriptions_before_insert();

grant select, delete on public.push_subscriptions to authenticated;
grant insert (endpoint, p256dh, auth, user_agent) on public.push_subscriptions to authenticated;
-- 不開放 update：換金鑰就是新的訂閱

create policy "push_subscriptions: 只能讀自己的" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "push_subscriptions: 只能以自己的名義新增" on public.push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "push_subscriptions: 只能刪自己的" on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

/* ===== 3. notification_prefs ===== */

create table public.notification_prefs (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  comments boolean not null default true,
  replies boolean not null default true,
  updated_at timestamptz not null default now()
);

revoke all on table public.notification_prefs from anon, authenticated;
alter table public.notification_prefs enable row level security;

grant select on public.notification_prefs to authenticated;
grant insert (comments, replies), update (comments, replies) on public.notification_prefs to authenticated;

create policy "notification_prefs: 只能讀自己的" on public.notification_prefs
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notification_prefs: 只能新增自己的" on public.notification_prefs
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "notification_prefs: 只能改自己的" on public.notification_prefs
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

/* ===== 4. 5 分鐘合併的狀態（不從 API 公開） ===== */

create table private.push_throttle (
  recipient uuid not null references public.profiles (id) on delete cascade,
  brew_owner uuid not null,
  brew_id uuid not null,
  sent_at timestamptz not null,
  primary key (recipient, brew_owner, brew_id),
  foreign key (brew_owner, brew_id) references public.shared_brews (owner, id) on delete cascade
);
alter table private.push_throttle enable row level security;

/* ===== 5. 留言後通知 ===== */

create function private.comments_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  push_url text;
  push_secret text;
  recipients jsonb := '[]'::jsonb;
  payload jsonb;
  r record;
begin
  begin
    select s.decrypted_secret into push_url from vault.decrypted_secrets s where s.name = 'send_push_url';
    select s.decrypted_secret into push_secret from vault.decrypted_secrets s where s.name = 'push_webhook_secret';
    if push_url is null or push_secret is null then
      return null; -- 還沒設定推播：不送
    end if;

    -- 留言者被停權：不通知任何人
    if exists (select 1 from auth.users u where u.id = new.author and u.banned_until > now()) then
      return null;
    end if;

    for r in
      with candidates (user_id, kind, rank) as (
        select new.brew_owner, 'comment', 1
        union all
        select new.reply_to_user, 'reply', 2 where new.parent_id is not null and new.reply_to_user is not null
        union all
        select p.author, 'reply', 2 from public.comments p where p.id = new.parent_id
      ),
      -- 同一人只通知一次：貼文作者優先（在自己的貼文上收到的回覆，也算「留言了你的貼文」）
      picked as (
        select distinct on (c.user_id) c.user_id, c.kind
        from candidates c
        where c.user_id is not null and c.user_id <> new.author
        order by c.user_id, c.rank
      )
      select p.user_id, p.kind from picked p
      where
        -- 讀得到這篇貼文：貼文作者本人，或貼文作者已接受、雙方沒有封鎖的好友（和 private.can_view 相同）
        (p.user_id = new.brew_owner or (
          exists (
            select 1 from public.friendships f
            where f.status = 'accepted'
              and ((f.requester = p.user_id and f.addressee = new.brew_owner)
                or (f.requester = new.brew_owner and f.addressee = p.user_id))
          )
          and not exists (
            select 1 from public.blocks b
            where (b.blocker = p.user_id and b.blocked = new.brew_owner)
               or (b.blocker = new.brew_owner and b.blocked = p.user_id)
          )
        ))
        -- 和留言者之間沒有封鎖（讀不到這則留言）
        and not exists (
          select 1 from public.blocks b
          where (b.blocker = p.user_id and b.blocked = new.author)
             or (b.blocker = new.author and b.blocked = p.user_id)
        )
        and not exists (select 1 from auth.users u where u.id = p.user_id and u.banned_until > now())
        and coalesce((
          select case when p.kind = 'comment' then np.comments else np.replies end
          from public.notification_prefs np where np.user_id = p.user_id
        ), true)
        and exists (select 1 from public.push_subscriptions s where s.user_id = p.user_id)
    loop
      -- 5 分鐘合併：沒有紀錄、或上一則已經超過 5 分鐘才記下並通知（同時的留言由這一列的鎖排隊）
      insert into private.push_throttle as t (recipient, brew_owner, brew_id, sent_at)
      values (r.user_id, new.brew_owner, new.brew_id, now())
      on conflict (recipient, brew_owner, brew_id) do update set sent_at = excluded.sent_at
        where t.sent_at <= excluded.sent_at - interval '5 minutes';
      if found then
        recipients := recipients || jsonb_build_object('user_id', r.user_id, 'kind', r.kind);
      end if;
    end loop;

    if jsonb_array_length(recipients) > 0 then
      -- pg_net：交易 commit 後才由背景程序送出；留言 rollback 時不會送
      payload := jsonb_build_object(
        'brew_owner', new.brew_owner,
        'brew_id', new.brew_id,
        'actor_nickname', new.author_nickname,
        'recipients', recipients,
        'sent_at', floor(extract(epoch from clock_timestamp()))::bigint
      );
      -- pg_net 送出的內容就是 convert_to(body::text, 'UTF8')，所以對 payload::text 簽章
      perform net.http_post(
        url := push_url,
        body := payload,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-push-signature', encode(extensions.hmac(payload::text, push_secret, 'sha256'), 'hex')
        ),
        timeout_milliseconds := 10000
      );
    end if;
  exception when others then
    -- 推播出錯不影響留言（記在資料庫 log，不含內容）
    raise warning 'comments_push failed: %', sqlstate;
  end;
  return null;
end
$$;
create trigger comments_push after insert on public.comments
  for each row execute function private.comments_push();

/* ===== 6. 函式權限：最後統一設定 ===== */
revoke all on function
  private.push_endpoint_ok(text),
  private.push_subscriptions_before_insert(),
  private.comments_push()
  from public, anon, authenticated;
-- check constraint 以新增者的身分執行，需要 execute（和 private.single_line 一樣只檢查字串）
grant execute on function private.push_endpoint_ok(text) to authenticated;
