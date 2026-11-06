create table public.olon_classes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  starts_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 480),
  description text not null default '' check (char_length(description) <= 1000),
  join_url text check (join_url ~ '^https://[^[:space:]]+$' and char_length(join_url) <= 700),
  replay_url text check (replay_url ~ '^https://[^[:space:]]+$' and char_length(replay_url) <= 700),
  material_url text check (material_url ~ '^https://[^[:space:]]+$' and char_length(material_url) <= 700),
  published boolean not null default true
);

create table public.olon_vip_receipts (
  id uuid primary key,
  student_id uuid not null references public.profiles(id) on delete cascade,
  object_path text not null unique check (
    object_path ~ ('^' || student_id::text || '/' || id::text || '\.(jpg|png|webp|heic|heif|pdf)$')
  ),
  student_note text not null default '' check (char_length(student_note) <= 300),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_note text not null default '' check (char_length(review_note) <= 300),
  next_payment_date date,
  check ((status = 'pending' and reviewed_at is null and next_payment_date is null)
      or (status = 'confirmed' and reviewed_at is not null and next_payment_date is not null)
      or (status = 'rejected' and reviewed_at is not null and next_payment_date is null))
);

create unique index olon_vip_one_pending on public.olon_vip_receipts(student_id) where status = 'pending';
create index olon_vip_receipt_student_date on public.olon_vip_receipts(student_id, submitted_at desc);

create table public.olon_trade_journals (
  record_id uuid primary key references public.student_records(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  before_trade text not null default '' check (char_length(before_trade) <= 1500),
  after_trade text not null default '' check (char_length(after_trade) <= 1500),
  image_path text check (
    image_path ~ ('^' || student_id::text || '/' || record_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')
  ),
  revision bigint not null default 0,
  unique (image_path)
);

create index olon_trade_journal_student on public.olon_trade_journals(student_id);
create trigger olon_trade_journal_revision before update on public.olon_trade_journals
  for each row execute function private.olon_student_record_revision();

create table public.olon_checklist_rules (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  schedule_rule text not null default '' check (char_length(schedule_rule) <= 180),
  risk_rule text not null default '' check (char_length(risk_rule) <= 180),
  entry_rule text not null default '' check (char_length(entry_rule) <= 180)
);

create table public.olon_checklist_days (
  student_id uuid not null references public.profiles(id) on delete cascade,
  record_date date not null,
  schedule_rule text not null check (char_length(schedule_rule) <= 180),
  risk_rule text not null check (char_length(risk_rule) <= 180),
  entry_rule text not null check (char_length(entry_rule) <= 180),
  schedule_ok boolean not null,
  risk_ok boolean not null,
  entry_ok boolean not null,
  primary key (student_id, record_date),
  check ((not schedule_ok or schedule_rule <> '') and (not risk_ok or risk_rule <> '') and (not entry_ok or entry_rule <> ''))
);

alter table public.olon_classes enable row level security;
alter table public.olon_vip_receipts enable row level security;
alter table public.olon_trade_journals enable row level security;
alter table public.olon_checklist_rules enable row level security;
alter table public.olon_checklist_days enable row level security;

revoke all on public.olon_classes, public.olon_vip_receipts, public.olon_trade_journals,
  public.olon_checklist_rules, public.olon_checklist_days from public, anon, authenticated;
grant select, insert, update on public.olon_classes to authenticated;
grant select on public.olon_vip_receipts, public.olon_trade_journals to authenticated;
grant insert (id, student_id, object_path, student_note) on public.olon_vip_receipts to authenticated;
grant update (status, reviewed_at, review_note, next_payment_date) on public.olon_vip_receipts to authenticated;
grant insert (record_id, student_id, before_trade, after_trade, image_path) on public.olon_trade_journals to authenticated;
grant update (before_trade, after_trade, image_path) on public.olon_trade_journals to authenticated;
grant select, insert, update on public.olon_checklist_rules, public.olon_checklist_days to authenticated;

create policy olon_classes_read on public.olon_classes for select to authenticated
  using ((select private.is_olon_admin()) or (published and (select private.olon_is_active_member())));
create policy olon_classes_admin_add on public.olon_classes for insert to authenticated
  with check ((select private.is_olon_admin()));
create policy olon_classes_admin_change on public.olon_classes for update to authenticated
  using ((select private.is_olon_admin())) with check ((select private.is_olon_admin()));

create policy olon_vip_read on public.olon_vip_receipts for select to authenticated
  using ((select private.is_olon_admin()) or
    (student_id = (select auth.uid()) and (select private.olon_is_active_member())));
create policy olon_vip_send on public.olon_vip_receipts for insert to authenticated
  with check (student_id = (select auth.uid()) and (select private.olon_is_active_member()) and status = 'pending'
    and exists (select 1 from storage.objects o where o.bucket_id = 'olon-vip-receipts' and o.name = object_path));
create policy olon_vip_review on public.olon_vip_receipts for update to authenticated
  using ((select private.is_olon_admin()) and status = 'pending')
  with check ((select private.is_olon_admin()) and status in ('confirmed','rejected'));

create policy olon_journal_read on public.olon_trade_journals for select to authenticated
  using (student_id = (select auth.uid()) and (select private.olon_is_active_member()));
create policy olon_journal_add on public.olon_trade_journals for insert to authenticated
  with check (
    student_id = (select auth.uid()) and (select private.olon_is_active_member())
    and exists (select 1 from public.student_records r where r.id = record_id and r.student_id = (select auth.uid())
      and (r.record_kind = 'trading' or (r.record_kind is null and (r.deposit = 0 or r.gain <> 0 or r.loss <> 0))))
    and (image_path is null or exists (select 1 from storage.objects o where o.bucket_id = 'olon-trade-journal' and o.name = image_path))
  );
create policy olon_journal_change on public.olon_trade_journals for update to authenticated
  using (student_id = (select auth.uid()) and (select private.olon_is_active_member()))
  with check (student_id = (select auth.uid()) and (select private.olon_is_active_member())
    and (image_path is null or exists (select 1 from storage.objects o where o.bucket_id = 'olon-trade-journal' and o.name = image_path)));

create policy olon_checklist_rules_own on public.olon_checklist_rules for all to authenticated
  using (student_id = (select auth.uid()) and (select private.olon_is_active_member()))
  with check (student_id = (select auth.uid()) and (select private.olon_is_active_member()));
create policy olon_checklist_days_own on public.olon_checklist_days for all to authenticated
  using (student_id = (select auth.uid()) and (select private.olon_is_active_member()))
  with check (student_id = (select auth.uid()) and (select private.olon_is_active_member()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('olon-vip-receipts', 'olon-vip-receipts', false, 8388608, array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']),
  ('olon-trade-journal', 'olon-trade-journal', false, 6291456, array['image/jpeg','image/png','image/webp']);

create policy olon_vip_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'olon-vip-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.olon_is_active_member())
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|heic|heif|pdf)$');
create function private.olon_vip_file_was_submitted(p_name text)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select (select private.is_olon_admin()) and exists (
    select 1 from public.olon_vip_receipts where object_path = p_name
  );
$$;

revoke execute on function private.olon_vip_file_was_submitted(text) from public, anon;
grant execute on function private.olon_vip_file_was_submitted(text) to authenticated;

create policy olon_vip_files_read on storage.objects for select to authenticated
  using (bucket_id = 'olon-vip-receipts' and (
    ((storage.foldername(name))[1] = (select auth.uid())::text and (select private.olon_is_active_member()))
    or private.olon_vip_file_was_submitted(name)
  ));
create policy olon_vip_files_discard_draft on storage.objects for delete to authenticated
  using (bucket_id = 'olon-vip-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.olon_is_active_member())
    and not exists (select 1 from public.olon_vip_receipts r where r.object_path = name));

create policy olon_journal_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'olon-trade-journal' and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.olon_is_active_member())
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
    and exists (select 1 from public.student_records r where r.id::text = (storage.foldername(name))[2]
      and r.student_id = (select auth.uid())
      and (r.record_kind = 'trading' or (r.record_kind is null and (r.deposit = 0 or r.gain <> 0 or r.loss <> 0)))));
create policy olon_journal_files_read on storage.objects for select to authenticated
  using (bucket_id = 'olon-trade-journal' and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.olon_is_active_member()));
create policy olon_journal_files_discard_draft on storage.objects for delete to authenticated
  using (bucket_id = 'olon-trade-journal' and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.olon_is_active_member())
    and not exists (select 1 from public.olon_trade_journals j where j.image_path = name));

create function public.olon_review_vip_receipt(p_receipt uuid, p_approve boolean, p_next_payment date, p_note text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  if not (select private.is_olon_admin()) then
    raise exception 'Acceso exclusivo de administración' using errcode = '42501';
  end if;
  if p_approve is null or char_length(coalesce(p_note, '')) > 300
    or (p_approve and (p_next_payment is null or p_next_payment <= (now() at time zone 'America/Puerto_Rico')::date)) then
    raise exception 'Verifica la próxima fecha de pago y la nota' using errcode = '22023';
  end if;

  update public.olon_vip_receipts
    set status = case when p_approve then 'confirmed' else 'rejected' end,
        reviewed_at = now(), review_note = btrim(coalesce(p_note,'')),
        next_payment_date = case when p_approve then p_next_payment end
    where id = p_receipt and status = 'pending'
    returning student_id into owner_id;
  if not found then return false; end if;

  if p_approve then
    update public.profiles set next_payment_date = p_next_payment where id = owner_id and role = 'student';
    if not found then
      raise exception 'No se pudo actualizar la fecha del estudiante' using errcode = '42501';
    end if;
  end if;
  return true;
end;
$$;

revoke execute on function public.olon_review_vip_receipt(uuid, boolean, date, text) from public, anon;
grant execute on function public.olon_review_vip_receipt(uuid, boolean, date, text) to authenticated;
