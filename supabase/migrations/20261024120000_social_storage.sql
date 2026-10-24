-- 咖啡社群 階段 2：照片（Storage）（docs/social-spec.md）
--
-- 規則：
-- - 私有 bucket，路徑 <user_id>/<brew_id>.jpg；顯示時用 signed URL，不用公開網址
-- - 單檔上限 1MB、只允許 image/jpeg（Storage 只看上傳時的 Content-Type，不檢查內容；
--   移除 EXIF 由前端重新編碼保證，繞過 App 上傳的人只能放進自己的資料夾）
-- - 照片的權限跟著 shared_brews 走：
--   - 上傳、覆蓋：自己的紀錄裡 photo_path 已經指向這個路徑（先寫紀錄、再傳照片）
--     photo_path 有 check 約束 = owner/id.jpg，所以路徑格式不會被偽造，照片數量也受每天 30 筆紀錄限制
--   - 讀取：讀得到那筆紀錄（套用 shared_brews 的 RLS：本人或已接受且沒封鎖的好友），且 photo_path 指向這張照片
--     紀錄刪除、改回 private、移除照片（photo_path = null）時，就算檔案還沒刪掉，好友也立刻讀不到
--   - 刪除：自己資料夾裡的都能刪（紀錄已經不在時也能清掉殘留的照片）
-- - SQL 不能直接刪 storage.objects（Supabase 的 protect_delete trigger），照片一律透過 Storage API 刪除
-- - anon 沒有任何政策：什麼都不能做

/* ===== 1. bucket ===== */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brew-photos', 'brew-photos', false, 1048576, array['image/jpeg']);

-- 讀取政策用 photo_path 找紀錄
create index shared_brews_photo_path on public.shared_brews (photo_path) where photo_path is not null;

/* ===== 2. storage.objects 的政策（storage.objects 本身已開 RLS） ===== */
-- 子查詢以呼叫者身分執行，會套用 shared_brews 的 RLS

create policy "brew-photos: 本人，或讀得到對應紀錄的人可讀" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'brew-photos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.shared_brews b where b.photo_path = objects.name)
    )
  );

create policy "brew-photos: 只能上傳自己紀錄指定的路徑" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'brew-photos'
    and exists (
      select 1 from public.shared_brews b
      where b.owner = (select auth.uid()) and b.photo_path = objects.name
    )
  );

-- 覆蓋（upsert）用；改名（move）後的路徑一樣要是自己紀錄指定的
create policy "brew-photos: 只能覆蓋自己紀錄指定的路徑" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'brew-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'brew-photos'
    and exists (
      select 1 from public.shared_brews b
      where b.owner = (select auth.uid()) and b.photo_path = objects.name
    )
  );

create policy "brew-photos: 只能刪自己資料夾裡的" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'brew-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
