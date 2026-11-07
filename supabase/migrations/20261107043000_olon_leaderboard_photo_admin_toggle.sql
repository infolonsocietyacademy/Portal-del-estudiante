-- Permit an active administrator to toggle photo visibility on an
-- already-published ranking without deleting/recreating the student results.
-- Only the photo_consent_confirmed column is editable through this grant.
alter table public.olon_leaderboard
  add constraint olon_leaderboard_photo_needs_published_name
  check (not photo_consent_confirmed or (published and consent_confirmed));

grant update (photo_consent_confirmed) on public.olon_leaderboard to authenticated;

create policy olon_leaderboard_admin_photo_update
  on public.olon_leaderboard for update to authenticated
  using (
    (select private.is_olon_admin())
    and published and consent_confirmed
  )
  with check (
    (select private.is_olon_admin())
    and published and consent_confirmed
  );