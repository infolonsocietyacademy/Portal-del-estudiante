-- Fix avatar viewer permissions for both authorized students and the portal administrator.
-- Storage remains private: only the currently selected avatar of an explicitly
-- consented and published ranking participant is readable.
alter policy olon_profile_media_ranked_avatar_read
  on public.olon_profile_media
  using (
    avatar_path is not null
    and ((select private.olon_is_active_member()) or (select private.is_olon_admin()))
    and exists (
      select 1 from public.olon_leaderboard l
      where l.student_id=olon_profile_media.student_id
        and l.published and l.consent_confirmed and l.photo_consent_confirmed
    )
  );

alter policy olon_profile_media_ranked_avatar_file_read
  on storage.objects
  using (
    bucket_id='olon-profile-media'
    and (storage.foldername(name))[2]='avatar'
    and ((select private.olon_is_active_member()) or (select private.is_olon_admin()))
    and exists (
      select 1 from public.olon_profile_media m
      join public.olon_leaderboard l on l.student_id=m.student_id
      where m.avatar_path=objects.name
        and l.published and l.consent_confirmed and l.photo_consent_confirmed
    )
  );
