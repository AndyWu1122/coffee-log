-- 結構性檢查：之後新增表或函式時，忘了開 RLS、忘了收權限都會在這裡失敗
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 每張表都開 RLS（public 與 private）
select is(
  (select array_agg(c.relname::text order by c.relname::text) from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity),
  null,
  '每張表都開了 RLS'
);

-- 未登入（anon）對任何表都沒有權限
select is(
  (select array_agg(format('%s.%s:%s', n.nspname, c.relname, p.priv) order by format('%s.%s:%s', n.nspname, c.relname, p.priv)) from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p(priv)
   where n.nspname in ('public', 'private') and c.relkind = 'r'
     and has_table_privilege('anon', c.oid, p.priv)),
  null,
  'anon 對任何表都沒有權限'
);

-- 登入使用者不能 TRUNCATE、不能讀寫 private 的表
select is(
  (select array_agg(format('%s.%s:%s', n.nspname, c.relname, p.priv) order by format('%s.%s:%s', n.nspname, c.relname, p.priv)) from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(priv)
   where c.relkind = 'r'
     and ((n.nspname = 'private' and has_table_privilege('authenticated', c.oid, p.priv))
       or (n.nspname = 'public' and p.priv = 'TRUNCATE' and has_table_privilege('authenticated', c.oid, p.priv)))),
  null,
  'authenticated 不能 TRUNCATE、不能直接存取 private 的表'
);

-- private 函式：authenticated 只能執行允許清單內的
select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  array[
    'private.blocked_with(uuid)',
    'private.can_view(uuid)',
    'private.is_admin()',
    'private.profile_visible(uuid)',
    'private.push_endpoint_ok(text)',
    'private.single_line(text)',
    'private.valid_flavor_notes(text[])'
  ],
  'authenticated 只能執行允許清單內的 private 函式'
);
select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  null,
  'anon 不能執行任何 private 函式'
);

-- public 的 RPC：只有登入使用者能呼叫，anon 不行
select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  null,
  'anon 不能執行任何 public 函式'
);

-- security definer 函式都設定了 search_path（避免被替換函式攻擊）
select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')),
  null,
  'security definer 函式都設定了 search_path'
);

-- API 只公開 public schema（private 不能從 PostgREST 存取：由 API 測試確認；這裡確認政策都只給 authenticated）
select is(
  (select array_agg(format('%s.%s', tablename, policyname) order by format('%s.%s', tablename, policyname)) from pg_policies
   where schemaname = 'public' and not (roles = array['authenticated']::name[])),
  null,
  '所有 RLS 政策都只給 authenticated'
);

select * from finish();
rollback;
