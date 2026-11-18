-- All access, code-state and audit updates are committed together.
alter table public.olon_license_audit drop constraint olon_license_audit_event_type_check;
alter table public.olon_license_audit add constraint olon_license_audit_event_type_check
 check (event_type in ('generated','assigned','redeemed','revoked','reissued','viewed','edited'));

create or replace function public.olon_admin_manage_license(
 p_license uuid, p_actor uuid, p_action text, p_days integer default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $function$
declare
 v_license public.olon_licenses%rowtype;
 v_terms public.olon_license_terms%rowtype;
 v_student uuid;
 v_is_current boolean := false;
 v_expiry timestamptz;
begin
 if not exists (select 1 from public.profiles where id=p_actor and role='admin' and status='active') then
  return jsonb_build_object('ok',false,'status',403,'error','Acceso exclusivo de administración');
 end if;
 if p_action is null or p_action not in ('edit','revoke') then
  return jsonb_build_object('ok',false,'status',400,'error','Acción inválida');
 end if;
 if p_action='edit' and (p_days is null or p_days<1 or p_days>365) then
  return jsonb_build_object('ok',false,'status',400,'error','Selecciona de 1 a 365 días desde hoy');
 end if;
 -- Lock in the same order as redemption: license, student profile, access term.
 select * into v_license from public.olon_licenses where id=p_license for update;
 if not found then
  return jsonb_build_object('ok',false,'status',404,'error','Licencia no encontrada');
 end if;
 if v_license.status='revoked' then
  if p_action='revoke' then return jsonb_build_object('ok',true,'already_revoked',true,'access_revoked',false); end if;
  return jsonb_build_object('ok',false,'status',409,'error','La licencia está revocada');
 end if;
 v_student := coalesce(v_license.redeemed_by,v_license.issued_to);
 if v_license.status='redeemed' and v_student is not null then
  perform 1 from public.profiles where id=v_student and role='student' for update;
  if not found then
   return jsonb_build_object('ok',false,'status',409,'error','El estudiante ya no está disponible');
  end if;
  select * into v_terms from public.olon_license_terms where student_id=v_student for update;
  v_is_current := found and v_terms.last_license_id is not distinct from p_license;
 end if;
 if p_action='edit' then
  if v_license.status<>'redeemed' or not v_is_current then
   return jsonb_build_object('ok',false,'status',409,'error','Solo puedes editar la licencia que gestiona el acceso actual. Actualiza la tabla.');
  end if;
  v_expiry := now() + make_interval(days=>p_days);
  update public.olon_license_terms set expires_at=v_expiry,updated_at=now() where student_id=v_student;
  update public.profiles set next_payment_date=(v_expiry at time zone 'America/Puerto_Rico')::date where id=v_student;
  update public.olon_licenses set duration_days=p_days where id=p_license;
  insert into public.olon_license_audit(license_id,student_id,event_type,performed_by)
   values(p_license,v_student,'edited',p_actor);
  return jsonb_build_object('ok',true,'active',true,'id',p_license,'days',p_days,'expires_at',v_expiry);
 end if;
 if v_is_current then
  -- Never extend an already expired term or affect a more recent renewal.
  v_expiry := least(v_terms.expires_at,now());
  update public.olon_license_terms set expires_at=v_expiry,updated_at=now() where student_id=v_student;
  update public.profiles set next_payment_date=(v_expiry at time zone 'America/Puerto_Rico')::date where id=v_student;
 end if;
 update public.olon_licenses set status='revoked',revoked_at=now() where id=p_license;
 insert into public.olon_license_audit(license_id,student_id,event_type,performed_by)
  values(p_license,v_student,'revoked',p_actor);
 return jsonb_build_object('ok',true,'id',p_license,'access_revoked',v_is_current);
end;
$function$;
revoke all on function public.olon_admin_manage_license(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.olon_admin_manage_license(uuid,uuid,text,integer) to service_role;
