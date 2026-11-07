create table public.olon_profile_media (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  avatar_path text check (avatar_path ~ ('^' || student_id::text || '/avatar/[0-9a-f-]{36}\.jpg$')),
  cover_path text check (cover_path ~ ('^' || student_id::text || '/cover/[0-9a-f-]{36}\.jpg$')),
  revision bigint not null default 0
);

alter table public.olon_profile_media enable row level security;
revoke all on public.olon_profile_media from public, anon, authenticated;
grant select on public.olon_profile_media to authenticated;
grant insert (student_id, avatar_path, cover_path) on public.olon_profile_media to authenticated;
grant update (avatar_path, cover_path) on public.olon_profile_media to authenticated;

create trigger olon_profile_media_revision before update on public.olon_profile_media
  for each row execute function private.olon_student_record_revision();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values ('olon-profile-media', 'olon-profile-media', false, 3145728, array['image/jpeg']);

create policy olon_profile_media_files_read on storage.objects for select to authenticated
  using (bucket_id = 'olon-profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.olon_is_active_member()) and not (select private.is_olon_admin()));
create policy olon_profile_media_files_add on storage.objects for insert to authenticated
  with check (bucket_id = 'olon-profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/(avatar|cover)/[0-9a-f-]{36}\.jpg$'
    and (select private.olon_is_active_member()) and not (select private.is_olon_admin()));
create policy olon_profile_media_files_discard on storage.objects for delete to authenticated
  using (bucket_id = 'olon-profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.olon_is_active_member()) and not (select private.is_olon_admin())
    and not exists (
      select 1 from public.olon_profile_media m where m.student_id = (select auth.uid())
        and (m.avatar_path = name or m.cover_path = name)
    ));

create policy olon_profile_media_read on public.olon_profile_media for select to authenticated
  using (student_id = (select auth.uid()) and (select private.olon_is_active_member()) and not (select private.is_olon_admin()));
create policy olon_profile_media_add on public.olon_profile_media for insert to authenticated
  with check (student_id = (select auth.uid()) and (select private.olon_is_active_member()) and not (select private.is_olon_admin())
    and (avatar_path is null or exists (select 1 from storage.objects where bucket_id = 'olon-profile-media' and name = avatar_path))
    and (cover_path is null or exists (select 1 from storage.objects where bucket_id = 'olon-profile-media' and name = cover_path)));
create policy olon_profile_media_edit on public.olon_profile_media for update to authenticated
  using (student_id = (select auth.uid()) and (select private.olon_is_active_member()) and not (select private.is_olon_admin()))
  with check (student_id = (select auth.uid()) and (select private.olon_is_active_member()) and not (select private.is_olon_admin())
    and (avatar_path is null or exists (select 1 from storage.objects where bucket_id = 'olon-profile-media' and name = avatar_path))
    and (cover_path is null or exists (select 1 from storage.objects where bucket_id = 'olon-profile-media' and name = cover_path)));
