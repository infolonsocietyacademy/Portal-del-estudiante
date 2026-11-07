-- OLON: show a student's current private avatar only after separate photo consent.
-- Existing published rankings remain photo-private until republished with authorization.
alter table public.olon_leaderboard
  add column if not exists photo_consent_confirmed boolean not null default false;

-- Allow active members to resolve an avatar path only for explicitly consented,
-- already published leaderboard entries. This never grants access to cover images.
create policy olon_profile_media_ranked_avatar_read
  on public.olon_profile_media for select to authenticated
  using (
    avatar_path is not null
    and (select private.olon_is_active_member())
    and exists (
      select 1 from public.olon_leaderboard l
      where l.student_id = olon_profile_media.student_id
        and l.published and l.consent_confirmed and l.photo_consent_confirmed
    )
  );

-- Only the avatar object currently referenced in the profile may be signed/read.
-- The private bucket and the existing owner-only policies are preserved.
create policy olon_profile_media_ranked_avatar_file_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'olon-profile-media'
    and name ~ '^[0-9a-f-]{36}/avatar/[0-9a-f-]{36}\\.jpg$'
    and (select private.olon_is_active_member())
    and exists (
      select 1 from public.olon_profile_media m
      join public.olon_leaderboard l on l.student_id = m.student_id
      where m.avatar_path = objects.name
        and l.published and l.consent_confirmed and l.photo_consent_confirmed
    )
  );

-- Extend the existing four-argument function rather than adding an overload.
-- The extra consent flag is inside each entry; default false for older clients.
create or replace function public.olon_replace_leaderboard(
  p_period_type text, p_period_key text,
  p_entries jsonb, p_consent_confirmed boolean default false
) returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_entries jsonb := coalesce(p_entries,'[]'::jsonb);
  v_expected integer;
  v_written integer;
begin
  if (select auth.uid()) is null or not (select private.is_olon_admin()) then
    raise exception 'Only an active administrator can publish the ranking';
  end if;

  if p_period_type not in ('weekly','monthly','annual')
     or (p_period_type='weekly' and p_period_key !~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$')
     or (p_period_type='monthly' and p_period_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
     or (p_period_type='annual' and p_period_key !~ '^[0-9]{4}$')
     or p_period_key is null then
    raise exception 'Invalid ranking period';
  end if;

  if jsonb_typeof(v_entries) <> 'array' then
    raise exception 'Ranking entries must be an array';
  end if;
  v_expected := jsonb_array_length(v_entries);
  if v_expected > 3 then raise exception 'Maximum three students per ranking'; end if;
  if v_expected > 0 and p_consent_confirmed is distinct from true then
    raise exception 'Confirm permission from each student before publication';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(v_entries)
      as e(rank integer,student_id uuid,return_pct numeric,photo_consent_confirmed boolean)
    where e.rank not between 1 and 3 or e.rank is null or e.student_id is null
      or e.return_pct is null or e.return_pct < -100 or e.return_pct > 100000
  ) then raise exception 'Invalid ranking entry'; end if;

  if (select count(distinct e.rank) from jsonb_to_recordset(v_entries)
    as e(rank integer,student_id uuid,return_pct numeric)) <> v_expected
    or (select count(distinct e.student_id) from jsonb_to_recordset(v_entries)
    as e(rank integer,student_id uuid,return_pct numeric)) <> v_expected
  then raise exception 'Repeated rank or student'; end if;

  if (select count(*) from jsonb_to_recordset(v_entries)
    as e(rank integer,student_id uuid,return_pct numeric)
    join public.profiles p on p.id=e.student_id
    where p.role='student' and p.status='active') <> v_expected
  then raise exception 'Select only active student accounts'; end if;

  delete from public.olon_leaderboard
  where period_type=p_period_type and period_key=p_period_key;

  insert into public.olon_leaderboard
    (period_type,period_key,rank,student_id,display_name,return_pct,
     published,consent_confirmed,photo_consent_confirmed)
  select p_period_type,p_period_key,e.rank,e.student_id,p.full_name,e.return_pct,
         true,true,coalesce(e.photo_consent_confirmed,false)
  from jsonb_to_recordset(v_entries)
    as e(rank integer,student_id uuid,return_pct numeric,photo_consent_confirmed boolean)
  join public.profiles p on p.id=e.student_id
    and p.role='student' and p.status='active';

  get diagnostics v_written = row_count;
  if v_written <> v_expected then raise exception 'Could not save the ranking'; end if;
  return v_written;
end;
$function$;
