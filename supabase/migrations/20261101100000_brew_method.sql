-- 沖煮方式（1.21.0）：shared_brews 加 method（手沖／賽風）
-- 舊資料、舊版 App 上傳的（不帶這個欄位）都是 'pourover'
-- 好友本來就讀得到整列（表層級的 select），不用另外 grant select

alter table public.shared_brews
  add column method text not null default 'pourover'
    constraint method_valid check (method in ('pourover', 'siphon'));

grant insert (method), update (method) on public.shared_brews to authenticated;
