-- 個人檔案（#/user/<id>）：自我介紹、常用器材、喜歡的豆子（2026-10-25）
--
-- 1. profiles 新增 bio、favorite_gear、favorite_beans（都選填，空字串＝沒填），長度與格式用 check 強制
-- 2. 讀取權限不擴大：profiles 原本整張表開放讀取，讀得到的人包含「有待處理邀請的對方」和「封鎖了的好友」
--    （好友名單要顯示暱稱、頭像）。新欄位只給本人和「已接受、雙方沒有封鎖」的好友，所以：
--    - profiles 改成欄位層級的讀取權限：只開放 id、nickname、friend_code、avatar_path（前端原本就只讀這些）
--      新欄位和 created_at 都不能直接讀
--    - 完整的個人檔案只能透過 public.profile_detail(target)：本人或 private.can_view(target) 才回傳，其他一律 null
--      （只回答「目前登入的人」能不能看；不是好友、被封鎖、帳號不存在都一樣是 null）
-- 3. 只有本人能改這三個欄位（沿用 profiles 原本的 update 政策：id = auth.uid()）

/* ===== 1. 欄位 ===== */

alter table public.profiles
  add column bio text not null default ''
    -- ≤ 150 字、最多 5 行；除了換行不可有控制字元
    constraint bio_length check (char_length(bio) <= 150)
    constraint bio_lines check (cardinality(string_to_array(bio, E'\n')) <= 5)
    constraint bio_chars check (private.single_line(replace(bio, E'\n', ''))),
  add column favorite_gear text not null default ''
    constraint favorite_gear_length check (char_length(favorite_gear) <= 50 and private.single_line(favorite_gear)),
  add column favorite_beans text not null default ''
    constraint favorite_beans_length check (char_length(favorite_beans) <= 50 and private.single_line(favorite_beans));

/* ===== 2. 讀取權限：欄位層級 ===== */

revoke select on public.profiles from authenticated;
grant select (id, nickname, friend_code, avatar_path) on public.profiles to authenticated;
grant update (bio, favorite_gear, favorite_beans) on public.profiles to authenticated;

/* ===== 3. 完整的個人檔案 ===== */

-- 本人或「已接受、雙方沒有封鎖」的好友才回傳；posts 是他分享給好友的紀錄數（雲端只有 friends 紀錄）
create function public.profile_detail(target uuid)
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
    'posts', (select count(*) from public.shared_brews b where b.owner = p.id)
  )
  from public.profiles p
  where p.id = target and auth.uid() is not null and private.can_view(target)
$$;

/* ===== 4. 函式權限 ===== */
revoke all on function public.profile_detail(uuid) from public, anon, authenticated;
grant execute on function public.profile_detail(uuid) to authenticated;
