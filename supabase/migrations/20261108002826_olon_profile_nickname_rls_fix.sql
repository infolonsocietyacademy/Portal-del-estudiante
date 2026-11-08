-- Break the Storage -> profile -> Storage RLS cycle during nickname updates.
-- The helper returns only an authorization decision, in the non-exposed schema.
-- Access remains limited to active viewers and the current, consented TOP 3 avatar.
create or replace function private.olon_can_read_ranked_avatar(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
    and ((select private.olon_is_active_member()) or (select private.is_olon_admin()))
    and exists (
      select 1
      from public.olon_profile_media m
      join public.olon_leaderboard l on l.student_id = m.student_id
      where m.avatar_path = p_path
        and l.published and l.consent_confirmed and l.photo_consent_confirmed
    );
$function$;

revoke all on function private.olon_can_read_ranked_avatar(text) from public, anon, authenticated;
grant execute on function private.olon_can_read_ranked_avatar(text) to authenticated;

alter policy olon_profile_media_ranked_avatar_file_read
  on storage.objects
  using (
    bucket_id = 'olon-profile-media'
    and (storage.foldername(name))[2] = 'avatar'
    and private.olon_can_read_ranked_avatar(name)
  );
