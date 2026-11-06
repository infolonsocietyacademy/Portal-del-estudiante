alter table public.student_records
  add column withdrawal numeric not null default 0,
  add column record_kind text,
  add column revision bigint not null default 0,
  add constraint student_records_amounts_by_kind check (
    case record_kind
      when 'deposit' then deposit > 0 and withdrawal = 0 and gain = 0 and loss = 0
      when 'withdrawal' then withdrawal > 0 and deposit = 0 and gain = 0 and loss = 0
      when 'trading' then withdrawal = 0 and deposit = 0 and gain >= 0 and loss >= 0
      else record_kind is null and withdrawal = 0
    end
  );

create function private.olon_student_record_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;

revoke execute on function private.olon_student_record_revision() from public, anon, authenticated;

create trigger olon_student_record_revision
  before update on public.student_records
  for each row execute function private.olon_student_record_revision();

revoke update on public.student_records from public, anon, authenticated;
grant update (record_date, deposit, withdrawal, gain, loss, note) on public.student_records to authenticated;

create policy record_update_self on public.student_records
  for update to authenticated
  using (student_id = (select auth.uid()) and (select private.olon_is_active_member()))
  with check (student_id = (select auth.uid()) and (select private.olon_is_active_member()));

create or replace function public.olon_public_portal_metrics()
returns table(active_students bigint, registered_trades bigint)
language sql
stable security definer
set search_path = ''
as $$
  select
    (select count(*) from public.profiles where role = 'student' and status in ('active','approved')),
    (select count(*) from public.student_records
      where record_kind = 'trading'
        or (record_kind is null and (deposit = 0 or gain <> 0 or loss <> 0)));
$$;
