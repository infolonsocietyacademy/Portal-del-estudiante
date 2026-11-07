alter table public.profiles
  drop constraint profiles_status_check,
  add constraint profiles_status_check check (
    status in ('pending','active','approved','suspended','expired')
    or (role = 'student' and status = 'deleting')
  );

-- A profile being removed cannot be restored through the ordinary directory controls.
alter policy olon_profiles_update_admin on public.profiles
  using ((select private.is_olon_admin()) and role = 'student' and status <> 'deleting')
  with check ((select private.is_olon_admin()) and role = 'student' and status <> 'deleting');

-- The Edge Function deletes the actual objects through the Storage API before Auth deletion.
create function public.olon_student_storage_batch(p_student uuid)
returns table (bucket_id text, name text)
language sql
stable security invoker
set search_path = ''
as $$
  select o.bucket_id, o.name
  from storage.objects o
  where exists (
    select 1 from public.profiles p
    where p.id = p_student and p.role = 'student' and p.status = 'deleting'
  )
  and (
    o.owner_id = p_student::text or o.owner = p_student
    or (
      o.bucket_id in ('olon-profile-media','olon-vip-receipts','olon-trade-journal')
      and split_part(o.name,'/',1) = p_student::text
    )
  )
  order by o.bucket_id, o.name
  limit 100;
$$;

revoke all on function public.olon_student_storage_batch(uuid) from public, anon, authenticated;
grant execute on function public.olon_student_storage_batch(uuid) to service_role;
