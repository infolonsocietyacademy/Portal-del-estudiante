-- Run only on an isolated database with the OLON schema and security migration loaded.
-- All synthetic writes are rolled back. No real users are queried.
begin;
do $$
begin
  if current_setting('olon.isolated_security_test', true) is distinct from 'yes' then
    raise exception 'Set olon.isolated_security_test=yes only on an isolated test database.';
  end if;
end $$;

create function pg_temp.assert_true(ok boolean, label text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Failed: %', label; end if;
end $$;

create function pg_temp.assert_denied(statement text, label text) returns void
language plpgsql as $$
begin
  begin execute statement; exception when insufficient_privilege then return; end;
  raise exception 'Expected access denial: %', label;
end $$;

insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','admin@example.invalid'),
 ('10000000-0000-4000-8000-000000000002','student-a@example.invalid'),
 ('10000000-0000-4000-8000-000000000003','student-b@example.invalid');
insert into public.profiles(id,email,full_name,role,status)
values ('10000000-0000-4000-8000-000000000001','admin@example.invalid','Test Admin','admin','active'),
 ('10000000-0000-4000-8000-000000000002','student-a@example.invalid','Test A','student','active'),
 ('10000000-0000-4000-8000-000000000003','student-b@example.invalid','Test B','student','active')
on conflict(id) do update set role=excluded.role,status=excluded.status,full_name=excluded.full_name;

insert into auth.sessions(id,user_id,aal,created_at,user_agent) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','aal1',now(),'Admin fixture'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','aal1',now(),'Student fixture'),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','aal1',now(),'Other account fixture'),
 ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','aal1',now(),'Other session fixture');

insert into public.student_records(id,student_id,record_date,deposit,gain,loss,record_kind) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',(now() at time zone 'America/Puerto_Rico')::date,100,0,0,'deposit'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',(now() at time zone 'America/Puerto_Rico')::date,100,0,0,'deposit'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003',(now() at time zone 'America/Puerto_Rico')::date,0,10,0,'trading');
insert into public.olon_profile_media(student_id, avatar_path, cover_path, display_name)
values ('10000000-0000-4000-8000-000000000003',
 '10000000-0000-4000-8000-000000000003/avatar/40000000-0000-4000-8000-000000000001.jpg',
 '10000000-0000-4000-8000-000000000003/cover/40000000-0000-4000-8000-000000000002.jpg','Private nickname');
insert into storage.objects(bucket_id,name) values
 ('olon-profile-media','10000000-0000-4000-8000-000000000003/avatar/40000000-0000-4000-8000-000000000001.jpg'),
 ('olon-profile-media','10000000-0000-4000-8000-000000000003/cover/40000000-0000-4000-8000-000000000002.jpg');

set local role anon;
select pg_temp.assert_denied('select public.olon_security_admin_overview()', 'anonymous dashboard');
select pg_temp.assert_denied('select public.olon_security_me()', 'anonymous account security');
select pg_temp.assert_denied('truncate public.olon_portal_reminders', 'anonymous truncate');
select pg_temp.assert_true((select active_students = 2 from public.olon_public_portal_metrics()), 'public aggregate works');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","session_id":"20000000-0000-4000-8000-000000000002","aal":"aal1"}',true);
select pg_temp.assert_true((select count(*) = 1 from public.profiles), 'student reads only own profile');
select pg_temp.assert_true((select count(*) = 1 from public.student_records), 'student reads only own ledger');
select pg_temp.assert_true((select count(*) = 0 from public.olon_invoices), 'student cannot read invoices');
select pg_temp.assert_true((select count(*) = 0 from public.olon_rebate_entries), 'student cannot read rebates');
select pg_temp.assert_true((select count(*) = 0 from public.olon_profile_media), 'ranked student cover and nickname remain private');
select pg_temp.assert_true((select count(*) = 1 from storage.objects where bucket_id = 'olon-profile-media'), 'ranked avatar readable but cover hidden');
select pg_temp.assert_true((select count(*) = 1 from public.olon_top3_avatar_paths(
  array['10000000-0000-4000-8000-000000000003']::uuid[])), 'ranked avatar projection remains available');
select pg_temp.assert_true((select rank = 1 and display_name = 'Test B' and return_pct = 10
  from public.olon_automatic_top3('annual',to_char((now() at time zone 'America/Puerto_Rico')::date,'YYYY'))), 'automatic podium unchanged');
select pg_temp.assert_true((select measured_count = 2 from public.olon_student_rank()), 'existing rank query still works');
select pg_temp.assert_true((select jsonb_array_length(public.olon_security_me()->'sessions') = 2), 'session list scoped to viewer');
select pg_temp.assert_true(public.olon_security_revoke_others() = 1, 'other sessions revoked');
select pg_temp.assert_true((select jsonb_array_length(public.olon_security_me()->'sessions') = 1), 'current session retained');
select pg_temp.assert_denied('select public.olon_security_admin_overview()', 'student dashboard');
select pg_temp.assert_denied('select public.olon_security_admin_action(''promote'',''10000000-0000-4000-8000-000000000002'')', 'self elevation RPC');
select pg_temp.assert_denied('update public.profiles set role=''admin''', 'self elevation table');
select pg_temp.assert_denied('select public.olon_registration_audit(null,null,''student_deleted'')', 'forged edge audit');
select pg_temp.assert_denied('select * from private.olon_security_events', 'raw audit records');
select pg_temp.assert_denied('delete from private.olon_security_events', 'audit log tampering');
select pg_temp.assert_denied('truncate public.olon_ranking_name_preferences', 'ranking preference truncate');
select pg_temp.assert_denied(
 'insert into public.student_records(student_id,record_date,deposit,gain,loss,record_kind) values(''10000000-0000-4000-8000-000000000003'',current_date,0,1,0,''trading'')',
 'cross-user record insertion');
with changed as (
  update public.student_records set gain=999 where student_id='10000000-0000-4000-8000-000000000003' returning id
) select pg_temp.assert_true(not exists (select from changed), 'cross-user update blocked');
with removed as (
  delete from public.student_records where student_id='10000000-0000-4000-8000-000000000003' returning id
) select pg_temp.assert_true(not exists (select from removed), 'cross-user delete blocked');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","session_id":"20000000-0000-4000-8000-000000000004","aal":"aal1"}',true);
select pg_temp.assert_true((select count(*)=0 from public.student_records),'revoked token cannot read records');
select pg_temp.assert_denied('select public.olon_security_me()', 'revoked session cannot use Security Center');

select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","session_id":"20000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
select pg_temp.assert_true((select count(*) = 3 from public.profiles), 'staged existing admin retains access before enrolling');
select pg_temp.assert_denied('select public.olon_security_admin_overview()', 'center requires admin MFA during staging');
reset role;

insert into auth.mfa_factors(id,user_id,status,factor_type) values
 ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','verified','totp'),
 ('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','verified','totp'),
 ('50000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','verified','totp'),
 ('50000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003','verified','totp');
update auth.sessions set aal='aal2', factor_id='50000000-0000-4000-8000-000000000001'
where id='20000000-0000-4000-8000-000000000001';

set local role authenticated;
select pg_temp.assert_true((select count(*)=1 from public.profiles), 'AAL1 cannot retain admin roster access after MFA enrollment');
select set_config('request.jwt.claims',
 '{"sub":"10000000-0000-4000-8000-000000000003","session_id":"20000000-0000-4000-8000-000000000003","aal":"aal1"}',true);
select pg_temp.assert_true((select count(*)=0 from public.student_records), 'MFA student needs step-up to read private records');
select set_config('request.jwt.claims',jsonb_build_object(
 'sub','10000000-0000-4000-8000-000000000001','session_id','20000000-0000-4000-8000-000000000001','aal','aal2',
 'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from now()-interval '6 minutes'))))
)::text,true);
select pg_temp.assert_true(public.olon_security_can_admin(), 'verified admin read access');
select pg_temp.assert_true(not public.olon_security_can_admin(true), 'old TOTP denied for sensitive edge actions');
select pg_temp.assert_denied('select public.olon_security_admin_action(''enforce_mfa'')', 'stale MFA cannot activate policy');
select set_config('request.jwt.claims',jsonb_build_object(
 'sub','10000000-0000-4000-8000-000000000001','session_id','20000000-0000-4000-8000-000000000001','aal','aal2',
 'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from now()))))
)::text,true);
select pg_temp.assert_true(public.olon_security_can_admin(true), 'fresh MFA accepted at edge gate');
select pg_temp.assert_true(public.olon_security_admin_action('enforce_mfa')=1,'global admin MFA enabled');
select pg_temp.assert_true((public.olon_security_admin_overview()->>'admin_mfa_enforced')::boolean,'policy visible in dashboard');
select pg_temp.assert_true(public.olon_security_admin_overview()->'failed_sign_ins'='null'::jsonb, 'missing telemetry is not zero');
select pg_temp.assert_true(public.olon_security_admin_action('promote','10000000-0000-4000-8000-000000000003')=1,'protected role promotion');
select pg_temp.assert_true(public.olon_security_admin_action('demote','10000000-0000-4000-8000-000000000003')=1,'protected role demotion');
select pg_temp.assert_true(public.olon_security_admin_action('suspend','10000000-0000-4000-8000-000000000002')=1,'protected suspension');
select pg_temp.assert_true(public.olon_security_admin_action('reactivate','10000000-0000-4000-8000-000000000002')=1,'protected reactivation');
select pg_temp.assert_true((public.olon_security_admin_overview()->'events') @> '[{"action":"access_changed","details":{"to":"suspended"}}]', 'suspension recorded');
select pg_temp.assert_true((public.olon_security_admin_overview()->'events') @> '[{"action":"role_changed","details":{"to":"admin"}}]', 'role recorded');

reset role;
select pg_temp.assert_true(not exists (
  select from auth.sessions where user_id='10000000-0000-4000-8000-000000000002'
), 'reactivation does not restore revoked sessions');
select set_config('request.jwt.claims','{}',true);
update auth.users set encrypted_password='opaque test value' where id='10000000-0000-4000-8000-000000000002';
select pg_temp.assert_true(exists (
  select from private.olon_security_events where action='password_changed' and details='{}'
), 'password change recorded without password data');
rollback;
