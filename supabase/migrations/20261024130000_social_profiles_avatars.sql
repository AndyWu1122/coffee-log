-- 咖啡社群 階段 3：頭像、封鎖名單的暱稱（docs/social-spec.md）
--
-- 1. profiles.avatar_path + 私有 bucket avatars（≤ 100KB、只收 image/jpeg，路徑 <user_id>/avatar.jpg）
--    頭像不用 Google 大頭貼，只用使用者自己上傳、前端重新編碼並移除 EXIF 的圖
--    讀取權限跟著 profiles 走：讀得到那個 profile（本人、好友、有待處理邀請的對方，且沒有封鎖）
--    而且 avatar_path 指向這張圖才讀得到；移除頭像（avatar_path = null）後立刻讀不到
-- 2. blocks.blocked_nickname：封鎖後雙方互相看不到 profile，封鎖名單要顯示名字才能解除封鎖，
--    所以封鎖當下由 trigger 記下對方的暱稱（封鎖者本來就看得到；被封鎖者讀不到 blocks）

/* ===== 1. 頭像 ===== */

alter table public.profiles
  add column avatar_path text
    constraint avatar_path_own check (avatar_path = id::text || '/avatar.jpg');
create index profiles_avatar_path on public.profiles (avatar_path) where avatar_path is not null;

grant update (avatar_path) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 102400, array['image/jpeg']);

-- 子查詢以呼叫者身分執行，會套用 profiles 的 RLS
create policy "avatars: 本人，或讀得到對應 profile 的人可讀" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.profiles p where p.avatar_path = objects.name)
    )
  );

-- 只能上傳、覆蓋自己的 <user_id>/avatar.jpg（先上傳，成功後再把 avatar_path 指過去）
create policy "avatars: 只能上傳自己的頭像" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '/avatar.jpg');

create policy "avatars: 只能覆蓋自己的頭像" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '/avatar.jpg')
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '/avatar.jpg');

create policy "avatars: 只能刪自己資料夾裡的" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

/* ===== 2. 封鎖名單的暱稱 ===== */

alter table public.blocks
  add column blocked_nickname text not null default '';

-- 不管前端傳什麼都覆蓋（insert 也沒開放這個欄位）；需要讀到對方的 profile，所以用 security definer
create function private.blocks_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.blocked_nickname := coalesce((select nickname from public.profiles where id = new.blocked), '');
  new.created_at := now();
  return new;
end
$$;
create trigger blocks_before_insert before insert on public.blocks
  for each row execute function private.blocks_before_insert();

-- 新函式預設不給執行權限（trigger 函式不需要）
revoke all on function private.blocks_before_insert() from public, anon, authenticated;
