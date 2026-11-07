alter table public.olon_profile_media add column display_name text
  check (display_name = btrim(display_name) and char_length(display_name) between 1 and 120);

grant insert (display_name), update (display_name) on public.olon_profile_media to authenticated;

alter policy olon_profile_media_read on public.olon_profile_media
  using (student_id = (select auth.uid()) and (select private.olon_is_active_member()));

alter policy olon_profile_media_add on public.olon_profile_media
  with check (student_id = (select auth.uid()) and (select private.olon_is_active_member())
    and (avatar_path is null or exists (
      select 1 from storage.objects where bucket_id = 'olon-profile-media' and name = avatar_path))
    and (cover_path is null or exists (
      select 1 from storage.objects where bucket_id = 'olon-profile-media' and name = cover_path)));

alter policy olon_profile_media_edit on public.olon_profile_media
  using (student_id = (select auth.uid()) and (select private.olon_is_active_member()))
  with check (student_id = (select auth.uid()) and (select private.olon_is_active_member())
    and (avatar_path is null or exists (
      select 1 from storage.objects where bucket_id = 'olon-profile-media' and name = avatar_path))
    and (cover_path is null or exists (
      select 1 from storage.objects where bucket_id = 'olon-profile-media' and name = cover_path)));

alter policy olon_profile_media_files_read on storage.objects
  using (bucket_id = 'olon-profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.olon_is_active_member()));

alter policy olon_profile_media_files_add on storage.objects
  with check (bucket_id = 'olon-profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/(avatar|cover)/[0-9a-f-]{36}\.jpg$'
    and (select private.olon_is_active_member()));

alter policy olon_profile_media_files_discard on storage.objects
  using (bucket_id = 'olon-profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.olon_is_active_member())
    and not exists (
      select 1 from public.olon_profile_media m where m.student_id = (select auth.uid())
        and (m.avatar_path = name or m.cover_path = name)
    ));

create or replace function private.olon_public_chat_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare who record;
begin
  if new.sender_id is distinct from (select auth.uid()) then
    raise exception 'Invalid chat sender' using errcode = '42501';
  end if;
  select p.role, p.status,
    coalesce(m.display_name, nullif(btrim(p.full_name), ''), 'Miembro de OLON') as display_name
  into who
  from public.profiles p
  left join public.olon_profile_media m on m.student_id = p.id
  where p.id = new.sender_id;
  if not found or who.status not in ('active','approved') then
    raise exception 'User not approved for chat' using errcode = '42501';
  end if;
  new.sender_role := who.role;
  new.sender_name := left(who.display_name, 120);
  new.created_at := statement_timestamp();
  new.message := btrim(new.message);
  return new;
end;
$$;

alter table public.olon_classes add column publication_id uuid unique;

-- Las sesiones existentes que aún están en agenda también se pueden ver como nuevas.
update public.olon_classes
  set publication_id = gen_random_uuid()
  where published and starts_at + make_interval(mins => duration_minutes) >= now();

create function private.olon_stamp_class_publication()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not new.published then
    new.publication_id := null;
  elsif tg_op = 'INSERT' then
    new.publication_id := gen_random_uuid();
  elsif not old.published then
    new.publication_id := gen_random_uuid();
  else
    new.publication_id := old.publication_id;
  end if;
  return new;
end;
$$;

revoke all on function private.olon_stamp_class_publication() from public, anon, authenticated;

create trigger olon_stamp_class_publication before insert or update on public.olon_classes
  for each row execute function private.olon_stamp_class_publication();

create table public.olon_class_reads (
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.olon_classes(id) on delete cascade,
  publication_id uuid not null,
  primary key (student_id, class_id, publication_id)
);

create index olon_class_reads_class_id on public.olon_class_reads(class_id);

alter table public.olon_class_reads enable row level security;
revoke all on public.olon_class_reads from public, anon, authenticated;
grant select, insert on public.olon_class_reads to authenticated;

create policy olon_class_reads_own on public.olon_class_reads for select to authenticated
  using (student_id = (select auth.uid()) and (select private.olon_is_active_member())
    and not (select private.is_olon_admin()));

create policy olon_class_reads_mark on public.olon_class_reads for insert to authenticated
  with check (student_id = (select auth.uid()) and (select private.olon_is_active_member())
    and not (select private.is_olon_admin())
    and exists (
      select 1 from public.olon_classes c
      where c.id = olon_class_reads.class_id and c.published and c.publication_id = olon_class_reads.publication_id
    ));

create function public.olon_unread_class_count()
returns bigint
language sql
stable security invoker
set search_path = ''
as $$
  select count(*)
  from public.olon_classes c
  where c.published and c.publication_id is not null
    and (select private.olon_is_active_member()) and not (select private.is_olon_admin())
    and not exists (
      select 1 from public.olon_class_reads r where r.student_id = (select auth.uid())
        and r.class_id = c.id and r.publication_id = c.publication_id
    );
$$;

create function public.olon_mark_classes_read(p_publications uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.olon_class_reads (student_id, class_id, publication_id)
  select (select auth.uid()), c.id, c.publication_id
  from public.olon_classes c
  where c.published and c.publication_id = any(p_publications)
    and (select private.olon_is_active_member()) and not (select private.is_olon_admin())
  on conflict do nothing;
$$;

revoke all on function public.olon_unread_class_count(), public.olon_mark_classes_read(uuid[]) from public, anon, authenticated;
grant execute on function public.olon_unread_class_count(), public.olon_mark_classes_read(uuid[]) to authenticated;

alter publication supabase_realtime add table public.olon_classes;
