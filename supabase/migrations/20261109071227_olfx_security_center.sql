-- Apply with the matching portal and Edge Function release. Existing accounts and data are retained.
begin;
set local lock_timeout = '5s';

create table private.olon_security_settings (
  singleton boolean primary key default true check (singleton),
  enforce_admin_mfa boolean not null default false
);
insert into private.olon_security_settings default values;

create table private.olon_security_events (
  id bigint generated always as identity primary key,
  happened_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  subject_id uuid,
  action text not null,
  resource text not null,
  details jsonb not null default '{}'
);
create index olon_security_events_subject_recent on private.olon_security_events(subject_id, id desc);
alter table private.olon_security_settings enable row level security;
alter table private.olon_security_events enable row level security;
revoke all on private.olon_security_settings, private.olon_security_events from public, anon, authenticated;

create function private.olon_session_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(auth.jwt()->>'session_id', '')::uuid;
$$;

create function private.olon_session_live() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = (select private.olon_session_id()) and s.user_id = (select auth.uid())
      and (s.not_after is null or s.not_after > now())
      and (u.banned_until is null or u.banned_until <= now())
  );
$$;

create function private.olon_session_mfa(p_totp_only boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal' = 'aal2', false) and exists (
    select 1 from auth.sessions s join auth.mfa_factors f
      on f.id = s.factor_id and f.user_id = s.user_id
    where s.id = (select private.olon_session_id()) and s.user_id = (select auth.uid())
      and s.aal::text = 'aal2' and f.status::text = 'verified'
      and (not p_totp_only or f.factor_type::text = 'totp')
  );
$$;

create function private.olon_account_session_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select private.olon_session_live()) and exists (
    select 1 from public.profiles p where p.id = (select auth.uid())
      and p.status in ('active', 'approved')
      and (
        not exists (
          select 1 from auth.mfa_factors f where f.user_id = p.id and f.status::text = 'verified'
        ) or (select private.olon_session_mfa(false))
      )
  );
$$;

create or replace function private.is_olon_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p where p.id = (select auth.uid())
      and p.role = 'admin' and p.status = 'active'
  ) and (select private.olon_session_live()) and (
    (not (select enforce_admin_mfa from private.olon_security_settings)
      and not exists (
        select 1 from auth.mfa_factors f where f.user_id = (select auth.uid())
          and f.status::text = 'verified' and f.factor_type::text = 'totp'
      ))
    or (select private.olon_session_mfa(true))
  );
$$;

create or replace function private.olon_is_active_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select private.olon_account_session_ok()) and exists (
    select 1 from public.profiles p where p.id = (select auth.uid())
      and case when p.role = 'admin' then (select private.is_olon_admin())
        else p.next_payment_date is null
          or p.next_payment_date > (now() at time zone 'America/Puerto_Rico')::date
      end
  );
$$;

create function private.olon_security_admin_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select private.is_olon_admin()) and (select private.olon_session_mfa(true));
$$;

create function private.olon_security_require_admin(p_fresh boolean) returns void
language plpgsql stable set search_path = '' as $$
begin
  if not private.olon_security_admin_ok() then
    raise exception 'Se requiere una sesión administrativa con MFA.' using errcode = '42501';
  end if;
  if p_fresh and not exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) m
    where m->>'method' = 'totp'
      and (m->>'timestamp')::bigint >= extract(epoch from now() - interval '5 minutes')
  ) then
    raise exception 'Confirma un código nuevo del autenticador.' using errcode = '42501';
  end if;
end;
$$;

-- These policies combine with the existing ownership and membership checks.
alter policy olon_profiles_read_self on public.profiles using (
  id = (select auth.uid()) and (select private.olon_session_live())
);
alter policy olon_ranking_name_read_own on public.olon_ranking_name_preferences using (
  (student_id = (select auth.uid()) and (select private.olon_is_active_member()))
  or (select private.is_olon_admin())
);
revoke all on public.olon_portal_reminders, public.olon_ranking_name_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.olon_portal_reminders to authenticated;
grant select, insert, update on public.olon_ranking_name_preferences to authenticated;

-- The browser used a narrow SELECT, but a direct client could select the whole ranked media row.
-- Keep private covers and nicknames owner-only, with a dedicated podium projection for avatar paths.
drop policy olon_profile_media_ranked_avatar_read on public.olon_profile_media;
alter policy olon_profile_media_add on public.olon_profile_media with check (
  student_id = (select auth.uid()) and (select private.olon_is_active_member())
  and (avatar_path is null or (
    avatar_path like student_id::text || '/avatar/%'
    and exists (select 1 from storage.objects o where o.bucket_id = 'olon-profile-media' and o.name = avatar_path)
  ))
  and (cover_path is null or (
    cover_path like student_id::text || '/cover/%'
    and exists (select 1 from storage.objects o where o.bucket_id = 'olon-profile-media' and o.name = cover_path)
  ))
);
alter policy olon_profile_media_edit on public.olon_profile_media with check (
  student_id = (select auth.uid()) and (select private.olon_is_active_member())
  and (avatar_path is null or (
    avatar_path like student_id::text || '/avatar/%'
    and exists (select 1 from storage.objects o where o.bucket_id = 'olon-profile-media' and o.name = avatar_path)
  ))
  and (cover_path is null or (
    cover_path like student_id::text || '/cover/%'
    and exists (select 1 from storage.objects o where o.bucket_id = 'olon-profile-media' and o.name = cover_path)
  ))
);

create function private.olon_top3_avatar_paths(p_students uuid[])
returns table(student_id uuid, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select m.student_id, m.avatar_path from public.olon_profile_media m
  where cardinality(p_students) between 1 and 3 and m.student_id = any(p_students)
    and m.avatar_path like m.student_id::text || '/avatar/%'
    and private.olon_ranked_avatar_allowed(m.student_id);
$$;

create function public.olon_top3_avatar_paths(p_students uuid[])
returns table(student_id uuid, avatar_path text)
language sql stable security invoker set search_path = '' as $$
  select * from private.olon_top3_avatar_paths(p_students);
$$;

-- Keep the existing rank calculation and projection while adding the same live membership gate.
alter function public.olon_student_rank() set schema private;
create function public.olon_student_rank()
returns table(rank_position bigint, measured_count bigint)
language sql stable security invoker set search_path = '' as $$
  select * from private.olon_student_rank();
$$;

-- Preserve the legacy rank definition while tightening its body as well, so callers cannot
-- bypass the gate by using the private implementation directly.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('private.olon_student_rank()'::regprocedure);
  if strpos(definition, ' if viewer is null or not exists') = 0 then
    raise exception 'Unexpected legacy rank definition. Review the current SQL before applying.';
  end if;
  execute replace(definition, ' if viewer is null or not exists',
    ' if not private.olon_is_active_member() or viewer is null or not exists');
end;
$$;

create function private.olon_security_audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_row jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_row jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  row_data jsonb := coalesce(new_row, old_row);
  event_name text := lower(tg_op);
  subject uuid;
  info jsonb := '{}';
begin
  if tg_table_name = 'profiles' then
    subject := (row_data->>'id')::uuid;
    if tg_op = 'UPDATE' then
      if auth.uid() is not null and old.status is distinct from new.status
        and (old.status = 'suspended' or new.status = 'suspended') then
        perform private.olon_security_require_admin(true);
      end if;
      if old.role is distinct from new.role then
        event_name := 'role_changed';
        info := jsonb_build_object('from', old.role, 'to', new.role);
      elsif old.status is distinct from new.status then
        event_name := 'access_changed';
        info := jsonb_build_object('from', old.status, 'to', new.status);
      elsif old.plan is distinct from new.plan or old.next_payment_date is distinct from new.next_payment_date then
        event_name := 'membership_changed';
      else
        return null;
      end if;
      if old.role is distinct from new.role or (
        old.status is distinct from new.status and new.status not in ('active', 'approved')
      ) then
        delete from auth.sessions where user_id = subject;
      end if;
    end if;
  elsif tg_table_name = 'users' then
    subject := new.id;
    if old.encrypted_password is distinct from new.encrypted_password then
      event_name := 'password_changed';
    elsif old.email is distinct from new.email then
      event_name := 'email_changed';
    else
      return null;
    end if;
  elsif tg_table_name = 'mfa_factors' then
    subject := (row_data->>'user_id')::uuid;
    if tg_op = 'DELETE' and old.status::text = 'verified' then
      event_name := 'mfa_removed';
    elsif tg_op = 'UPDATE' and old.status::text <> 'verified' and new.status::text = 'verified' then
      event_name := 'mfa_verified';
    else
      return null;
    end if;
  elsif tg_table_name = 'access_requests' then
    if old.status is not distinct from new.status then return null; end if;
    event_name := 'request_reviewed';
    info := jsonb_build_object('to', new.status);
  elsif tg_table_name = 'student_records' then
    subject := (row_data->>'student_id')::uuid;
  else
    subject := (row_data->>'student_id')::uuid;
    if tg_table_name = 'olon_vip_receipts' and tg_op = 'UPDATE' then
      event_name := 'receipt_reviewed';
    end if;
  end if;
  insert into private.olon_security_events(actor_id, subject_id, action, resource, details)
  values (
    coalesce(auth.uid(), nullif(current_setting('olon.security_actor', true), '')::uuid),
    subject, event_name, tg_table_name, info
  );
  return null;
end;
$$;

create trigger olon_security_profile_audit after insert or update or delete on public.profiles
for each row execute function private.olon_security_audit_row();
create trigger olon_security_password_audit after update of encrypted_password, email on auth.users
for each row execute function private.olon_security_audit_row();
create trigger olon_security_mfa_audit after update of status or delete on auth.mfa_factors
for each row execute function private.olon_security_audit_row();
create trigger olon_security_request_audit after update of status on public.access_requests
for each row execute function private.olon_security_audit_row();
create trigger olon_security_records_audit after insert or update or delete on public.student_records
for each row execute function private.olon_security_audit_row();
create trigger olon_security_journal_audit after insert or update or delete on public.olon_trade_journals
for each row execute function private.olon_security_audit_row();
create trigger olon_security_classes_audit after insert or update or delete on public.olon_classes
for each row execute function private.olon_security_audit_row();
create trigger olon_security_invoices_audit after insert or update or delete on public.olon_invoices
for each row execute function private.olon_security_audit_row();
create trigger olon_security_rebates_audit after insert on public.olon_rebate_reports
for each row execute function private.olon_security_audit_row();
create trigger olon_security_reminders_audit after insert or update or delete on public.olon_portal_reminders
for each row execute function private.olon_security_audit_row();
create trigger olon_security_receipts_audit after insert or update or delete on public.olon_vip_receipts
for each row execute function private.olon_security_audit_row();

-- A verified record in Auth does not mean the browser is online.
create function private.olon_security_me() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
  current_session uuid := private.olon_session_id();
  result jsonb;
begin
  if not private.olon_account_session_ok() then
    raise exception 'La sesión no tiene acceso a esta cuenta.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(to_jsonb(sessions) order by sessions.created_at desc)
      from (
        select s.created_at, s.refreshed_at at time zone 'UTC' as refreshed_at,
          s.id = current_session as current_session, left(s.user_agent, 240) as user_agent
        from auth.sessions s where s.user_id = viewer
          and (s.not_after is null or s.not_after > now())
        order by (s.id = current_session) desc, s.created_at desc limit 30
      ) sessions
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(to_jsonb(events) order by events.id desc) from (
        select id, happened_at, action, details from private.olon_security_events
        where subject_id = viewer and (
          resource in ('profiles', 'users', 'mfa_factors', 'sessions', 'registration')
        )
        order by id desc limit 25
      ) events
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create function private.olon_security_admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.olon_security_require_admin(false);
  select jsonb_build_object(
    'registered', (select count(*) from auth.users),
    'sessions', (select count(*) from auth.sessions s join auth.users u on u.id = s.user_id
      where (s.not_after is null or s.not_after > now()) and (u.banned_until is null or u.banned_until <= now())),
    'members_with_totp', (select count(distinct f.user_id) from auth.mfa_factors f
      where f.status::text = 'verified' and f.factor_type::text = 'totp'),
    'admins', (select count(*) from public.profiles p where p.role = 'admin' and p.status = 'active'),
    'admins_with_backup', (
      select count(*) from public.profiles p where p.role = 'admin' and p.status = 'active'
        and (select count(*) from auth.mfa_factors f where f.user_id = p.id
          and f.status::text = 'verified' and f.factor_type::text = 'totp') >= 2
    ),
    'admin_mfa_enforced', (select enforce_admin_mfa from private.olon_security_settings),
    'failed_sign_ins', null,
    'events', coalesce((
      select jsonb_agg(to_jsonb(events) order by events.id desc) from (
        select e.id, e.happened_at, e.action, e.resource, e.details,
          actor.full_name as actor, subject.full_name as subject
        from private.olon_security_events e
        left join public.profiles actor on actor.id = e.actor_id
        left join public.profiles subject on subject.id = e.subject_id
        order by e.id desc limit 50
      ) events
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create function private.olon_security_revoke_others() returns integer
language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  if not private.olon_account_session_ok() then
    raise exception 'Confirma tu identidad para gestionar sesiones.' using errcode = '42501';
  end if;
  delete from auth.sessions where user_id = auth.uid() and id <> private.olon_session_id();
  get diagnostics removed = row_count;
  insert into private.olon_security_events(actor_id, subject_id, action, resource, details)
  values (auth.uid(), auth.uid(), 'other_sessions_revoked', 'sessions', jsonb_build_object('count', removed));
  return removed;
end;
$$;

create function private.olon_security_admin_action(p_action text, p_target uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
  target public.profiles%rowtype;
  removed integer;
begin
  -- Serialize role changes and recheck the actor after waiting for a concurrent change.
  perform pg_advisory_xact_lock(16081626);
  perform private.olon_security_require_admin(true);
  if p_action = 'enforce_mfa' then
    if exists (
      select 1 from public.profiles p where p.role = 'admin' and p.status = 'active'
        and (select count(*) from auth.mfa_factors f where f.user_id = p.id
          and f.status::text = 'verified' and f.factor_type::text = 'totp') < 2
    ) then
      raise exception 'Cada administrador activo necesita dos autenticadores verificados.';
    end if;
    update private.olon_security_settings set enforce_admin_mfa = true where not enforce_admin_mfa;
    if found then
      insert into private.olon_security_events(actor_id, action, resource)
      values (viewer, 'admin_mfa_enforced', 'configuration');
    end if;
    return 1;
  end if;
  if p_target is null or p_target = viewer then
    raise exception 'Selecciona otra cuenta.' using errcode = '22023';
  end if;
  select * into target from public.profiles where id = p_target for update;
  if not found or target.status = 'deleting' then
    raise exception 'La cuenta no está disponible para esta acción.' using errcode = '22023';
  end if;
  case p_action
    when 'suspend' then
      update public.profiles set status = 'suspended' where id = p_target and status <> 'suspended';
    when 'reactivate' then
      if target.status <> 'suspended' then
        raise exception 'Solo se puede reactivar una cuenta suspendida.';
      end if;
      if target.role = 'admin' and (
        select count(*) from auth.mfa_factors where user_id = p_target and status::text = 'verified'
          and factor_type::text = 'totp'
      ) < 2 then
        raise exception 'La cuenta administradora necesita dos autenticadores verificados.';
      end if;
      update public.profiles set status = 'active' where id = p_target;
    when 'promote' then
      if target.role <> 'student' or target.status not in ('active', 'approved') or (
        select count(*) from auth.mfa_factors where user_id = p_target and status::text = 'verified'
          and factor_type::text = 'totp'
      ) < 2 then
        raise exception 'La cuenta debe ser un estudiante activo con dos autenticadores verificados.';
      end if;
      update public.profiles set role = 'admin', status = 'active' where id = p_target;
    when 'demote' then
      if target.role <> 'admin' then raise exception 'La cuenta no es administradora.'; end if;
      update public.profiles set role = 'student' where id = p_target;
    when 'revoke' then
      delete from auth.sessions where user_id = p_target;
      get diagnostics removed = row_count;
      insert into private.olon_security_events(actor_id, subject_id, action, resource, details)
      values (viewer, p_target, 'sessions_revoked', 'sessions', jsonb_build_object('count', removed));
      return removed;
    else
      raise exception 'Acción inválida.' using errcode = '22023';
  end case;
  return 1;
end;
$$;

create function public.olon_security_me() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.olon_security_me();
$$;
create function public.olon_security_admin_overview() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.olon_security_admin_overview();
$$;
create function public.olon_security_revoke_others() returns integer
language sql security invoker set search_path = '' as $$
  select private.olon_security_revoke_others();
$$;
create function public.olon_security_admin_action(p_action text, p_target uuid default null) returns integer
language sql security invoker set search_path = '' as $$
  select private.olon_security_admin_action(p_action, p_target);
$$;
create function public.olon_security_can_admin(p_fresh boolean default false) returns boolean
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.olon_security_require_admin(p_fresh);
  return true;
exception when insufficient_privilege then return false;
end;
$$;
create function public.olon_security_can_use_account() returns boolean
language sql stable security invoker set search_path = '' as $$
  select private.olon_account_session_ok();
$$;

create function private.olon_finish_registration(p_request uuid, p_user uuid, p_actor uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare requested_email text;
begin
  select email into requested_email from public.access_requests where id = p_request and status = 'pending' for update;
  if not found or not exists (
    select 1 from public.profiles where id = p_actor and role = 'admin' and status = 'active'
  ) or not exists (
    select 1 from auth.users where id = p_user and lower(email) = lower(requested_email)
      and invited_at is not null and raw_user_meta_data->>'olon_request_id' = p_request::text
  ) then
    return false;
  end if;
  perform set_config('olon.security_actor', p_actor::text, true);
  update public.profiles set status = 'active', plan = 'VIP Regular'
    where id = p_user and role = 'student' and status = 'pending';
  if not found then return false; end if;
  update public.access_requests set status = 'processed', processed_at = now() where id = p_request;
  return true;
end;
$$;

create function public.olon_finish_registration(p_request uuid, p_user uuid, p_actor uuid) returns boolean
language sql security invoker set search_path = '' as $$
  select private.olon_finish_registration(p_request, p_user, p_actor);
$$;

create function private.olon_registration_audit(p_actor uuid, p_subject uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_action not in ('recovery_email_requested', 'student_deleted', 'request_rejected') then
    raise exception 'Acción inválida.';
  end if;
  insert into private.olon_security_events(actor_id, subject_id, action, resource)
  values (p_actor, p_subject, p_action, 'registration');
end;
$$;
create function public.olon_registration_audit(p_actor uuid, p_subject uuid, p_action text) returns void
language sql security invoker set search_path = '' as $$
  select private.olon_registration_audit(p_actor, p_subject, p_action);
$$;

revoke execute on function private.olon_session_id(), private.olon_session_live(),
  private.olon_session_mfa(boolean), private.olon_account_session_ok(),
  private.olon_security_admin_ok(), private.olon_security_require_admin(boolean),
  private.olon_security_audit_row(), private.olon_security_me(), private.olon_security_admin_overview(),
  private.olon_security_revoke_others(), private.olon_security_admin_action(text, uuid),
  private.olon_top3_avatar_paths(uuid[]), private.olon_student_rank(),
  public.olon_security_me(), public.olon_security_admin_overview(),
  public.olon_security_revoke_others(), public.olon_security_admin_action(text, uuid),
  public.olon_security_can_admin(boolean), public.olon_security_can_use_account(),
  public.olon_top3_avatar_paths(uuid[]), public.olon_student_rank()
from public, anon, authenticated;
grant execute on function private.olon_session_live(), private.olon_account_session_ok(),
  private.olon_security_require_admin(boolean),
  private.olon_security_admin_ok(), private.olon_security_me(), private.olon_security_admin_overview(),
  private.olon_security_revoke_others(), private.olon_security_admin_action(text, uuid),
  private.olon_top3_avatar_paths(uuid[]), private.olon_student_rank(),
  public.olon_security_me(), public.olon_security_admin_overview(),
  public.olon_security_revoke_others(), public.olon_security_admin_action(text, uuid),
  public.olon_security_can_admin(boolean), public.olon_security_can_use_account(),
  public.olon_top3_avatar_paths(uuid[]), public.olon_student_rank()
to authenticated;
revoke execute on function private.olon_finish_registration(uuid, uuid, uuid),
  public.olon_finish_registration(uuid, uuid, uuid), private.olon_registration_audit(uuid, uuid, text),
  public.olon_registration_audit(uuid, uuid, text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.olon_finish_registration(uuid, uuid, uuid),
  public.olon_finish_registration(uuid, uuid, uuid), private.olon_registration_audit(uuid, uuid, text),
  public.olon_registration_audit(uuid, uuid, text) to service_role;

commit;
