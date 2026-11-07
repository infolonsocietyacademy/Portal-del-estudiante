-- OLON leaderboard: curated TOP 3 by week, month, year.
-- Public to authenticated ACTIVE members only after explicit publication consent.
-- No private student trade records are exposed.
create table if not exists public.olon_leaderboard (
  period_type text not null check (period_type in ('weekly','monthly','annual')),
  period_key text not null check (char_length(period_key) between 4 and 8),
  rank integer not null check (rank between 1 and 3),
  student_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  return_pct numeric(9,2) not null check (return_pct between -100 and 100000),
  published boolean not null default false,
  consent_confirmed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(period_type,period_key,rank),
  unique(period_type,period_key,student_id),
  check(not published or consent_confirmed)
);
create index if not exists olon_leaderboard_student_idx on public.olon_leaderboard(student_id);
alter table public.olon_leaderboard enable row level security;

revoke all on public.olon_leaderboard from public, anon, authenticated;
grant select,insert,delete on public.olon_leaderboard to authenticated;

create policy olon_leaderboard_read on public.olon_leaderboard
  for select to authenticated
  using ((select private.is_olon_admin())
    or (published and consent_confirmed and (select private.olon_is_active_member())));

create policy olon_leaderboard_admin_insert on public.olon_leaderboard
  for insert to authenticated with check ((select private.is_olon_admin()));

create policy olon_leaderboard_admin_delete on public.olon_leaderboard
  for delete to authenticated using ((select private.is_olon_admin()));

-- One atomic operation prevents temporary empty rankings / duplicate ranks on reordering.
-- SECURITY INVOKER: all insert/delete operations remain protected by table RLS.
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
    select 1 from jsonb_to_recordset(v_entries) as e(rank integer,student_id uuid,return_pct numeric)
    where e.rank not between 1 and 3 or e.rank is null or e.student_id is null
      or e.return_pct is null or e.return_pct < -100 or e.return_pct > 100000
  ) then raise exception 'Invalid ranking entry'; end if;

  if (select count(distinct e.rank) from jsonb_to_recordset(v_entries) as e(rank integer,student_id uuid,return_pct numeric)) <> v_expected
    or (select count(distinct e.student_id) from jsonb_to_recordset(v_entries) as e(rank integer,student_id uuid,return_pct numeric)) <> v_expected
  then raise exception 'Repeated rank or student'; end if;

  -- No accidental publication of nonexistent / inactive / administrator profiles.
  if (select count(*) from jsonb_to_recordset(v_entries) as e(rank integer,student_id uuid,return_pct numeric)
      join public.profiles p on p.id=e.student_id where p.role='student' and p.status='active') <> v_expected
  then raise exception 'Select only active student accounts'; end if;

  delete from public.olon_leaderboard where period_type=p_period_type and period_key=p_period_key;

  insert into public.olon_leaderboard
    (period_type,period_key,rank,student_id,display_name,return_pct,published,consent_confirmed)
  select p_period_type,p_period_key,e.rank,e.student_id,p.full_name,e.return_pct,true,true
  from jsonb_to_recordset(v_entries) as e(rank integer,student_id uuid,return_pct numeric)
  join public.profiles p on p.id=e.student_id and p.role='student' and p.status='active';

  get diagnostics v_written = row_count;
  if v_written <> v_expected then raise exception 'Could not save the ranking'; end if;
  return v_written;
end;
$function$;

revoke all on function public.olon_replace_leaderboard(text,text,jsonb,boolean) from public, anon;
grant execute on function public.olon_replace_leaderboard(text,text,jsonb,boolean) to authenticated;
