-- 意見回饋的 App 版本號改成文字：sw.js 的版本號從整數 CACHE_VERSION（18）改成 semver 的 APP_VERSION（'1.0.0'）
-- 舊資料的整數轉成字串保留（17 → '17'）；舊版 App 仍可能送整數，Edge Function 會轉成字串

alter table public.feedback drop constraint feedback_app_version_range;

alter table public.feedback alter column app_version type text using app_version::text;

-- 'x.y.z'（每段最多 4 位），或舊版的整數版本（1–1000000，不以 0 開頭）；沒有 Service Worker 時為 null
alter table public.feedback add constraint feedback_app_version_format
  check (app_version ~ '^([0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}|[1-9][0-9]{0,6})$');

comment on column public.feedback.app_version is
  '送出時的 App 版本（sw.js 的 APP_VERSION，例如 1.0.0；1.0.0 以前是整數，例如 18）';
