-- 意見回饋的 App 版本號（文字）：'x.y.z' 或舊版的整數；格式不對被拒絕
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create schema tests;
grant usage on schema tests to anon, authenticated;
create function tests.login_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a@test.local', 'authenticated', 'authenticated');
insert into public.profiles (id, nickname) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Alice');

select col_type_is('public', 'feedback', 'app_version', 'text', 'app_version 是文字');
select col_is_null('public', 'feedback', 'app_version', '沒有 Service Worker 時可以是 null');

select tests.login_as('aaaaaaaa-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.feedback (category, message, app_version) values ('bug', 'semver', '1.0.0') $$, '1.0.0');
select lives_ok($$ insert into public.feedback (category, message, app_version) values ('bug', 'semver2', '12.345.6789') $$, '每段最多 4 位');
select lives_ok($$ insert into public.feedback (category, message, app_version) values ('bug', 'legacy', '18') $$, '舊版的整數版本（字串）');
select lives_ok($$ insert into public.feedback (category, message, app_version) values ('idea', 'null', null) $$, '不明（null）');
select throws_ok($$ insert into public.feedback (category, message, app_version) values ('bug', 'x', '1.0') $$, '23514', null, '1.0 被拒絕');
select throws_ok($$ insert into public.feedback (category, message, app_version) values ('bug', 'x', 'abc') $$, '23514', null, 'abc 被拒絕');
select throws_ok($$ insert into public.feedback (category, message, app_version) values ('bug', 'x', '1.0.0 ') $$, '23514', null, '多餘的空白被拒絕');
select throws_ok($$ insert into public.feedback (category, message, app_version) values ('bug', 'x', '1.0.0-beta') $$, '23514', null, '1.0.0-beta 被拒絕');
select throws_ok($$ insert into public.feedback (category, message, app_version) values ('bug', 'x', '12345.0.0') $$, '23514', null, '超過 4 位被拒絕');
select throws_ok($$ insert into public.feedback (category, message, app_version) values ('bug', 'x', '01') $$, '23514', null, '0 開頭的整數被拒絕');
select throws_ok($$ insert into public.feedback (category, message, app_version) values ('bug', 'x', '10000000') $$, '23514', null, '整數超過 7 位被拒絕');

select * from finish();
rollback;
