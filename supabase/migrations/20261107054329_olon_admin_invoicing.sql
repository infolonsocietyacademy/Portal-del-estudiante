-- Portal-only series. The independent OLFX application's OSA series is unchanged.
create table public.olon_invoices (
  id uuid primary key,
  sequence_number bigint generated always as identity unique,
  invoice_number text generated always as
    ('OSA-P-' || lpad(sequence_number::text, greatest(6, length(sequence_number::text)), '0')) stored unique,
  student_id uuid references public.profiles(id) on delete set null,
  form_data jsonb not null,
  client_name text not null,
  service text not null,
  status text not null check (status in ('pending','paid','cancelled')),
  issue_date date not null,
  due_date date,
  subtotal_cents bigint not null check (subtotal_cents between 0 and 10000000000),
  discount_basis_points integer not null check (discount_basis_points between 0 and 10000),
  total_cents bigint generated always as
    (subtotal_cents - round(subtotal_cents::numeric * discount_basis_points / 10000)::bigint) stored,
  revision bigint not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or due_date >= issue_date),
  check (jsonb_typeof(form_data) = 'object' and octet_length(form_data::text) <= 10000)
);

create index olon_invoice_student on public.olon_invoices(student_id) where student_id is not null;
create index olon_invoice_status_date on public.olon_invoices(status, issue_date desc);
create index olon_invoice_created_by on public.olon_invoices(created_by);

alter table public.olon_invoices enable row level security;
revoke all on public.olon_invoices from public, anon, authenticated;
grant select on public.olon_invoices to authenticated;
grant insert (id, student_id, form_data), update (student_id, form_data) on public.olon_invoices to authenticated;
grant usage on sequence public.olon_invoices_sequence_number_seq to authenticated;

create policy olon_invoice_admin_read on public.olon_invoices for select to authenticated
  using ((select private.is_olon_admin()));
create policy olon_invoice_admin_add on public.olon_invoices for insert to authenticated
  with check ((select private.is_olon_admin()));
create policy olon_invoice_admin_edit on public.olon_invoices for update to authenticated
  using ((select private.is_olon_admin())) with check ((select private.is_olon_admin()));

-- Server-side normalization and calculations also apply to direct API writes.
create function private.olon_prepare_invoice()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  field_name text;
  field_limit integer;
  cleaned jsonb := '{}'::jsonb;
  value_text text;
  price numeric;
  discount numeric;
  benefit numeric;
begin
  if not (select private.is_olon_admin()) then
    raise exception 'Acceso exclusivo de administración' using errcode = '42501';
  end if;
  if new.form_data is null or jsonb_typeof(new.form_data) <> 'object'
     or octet_length(new.form_data::text) > 10000 then
    raise exception 'Los datos de la factura no son válidos';
  end if;
  for field_name, field_limit in select * from (values
    ('client',110),('detail',130),('issueDate',10),('dueDate',10),('status',10),
    ('service',150),('price',16),('discount',8),('discountLabel',80),
    ('benefit',130),('benefitValue',16),('paymentMethods',140),('paymentDetails',200),('notes',600)
  ) as fields(name,max_length)
  loop
    if new.form_data ? field_name and jsonb_typeof(new.form_data -> field_name) <> 'string' then
      raise exception 'Formato incorrecto para el campo %', field_name;
    end if;
    value_text := btrim(coalesce(new.form_data ->> field_name, ''));
    if char_length(value_text) > field_limit then
      raise exception 'El campo % supera el máximo permitido', field_name;
    end if;
    cleaned := cleaned || jsonb_build_object(field_name, value_text);
  end loop;
  if coalesce(cleaned ->> 'client','') = '' or coalesce(cleaned ->> 'service','') = '' then
    raise exception 'Completa el nombre del cliente y el servicio';
  end if;
  if (cleaned ->> 'price') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$'
     or coalesce(nullif(cleaned ->> 'discount',''),'0') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$'
     or coalesce(nullif(cleaned ->> 'benefitValue',''),'0') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' then
    raise exception 'El precio y el descuento deben tener un máximo de dos decimales';
  end if;
  price := (cleaned ->> 'price')::numeric;
  discount := coalesce(nullif(cleaned ->> 'discount',''),'0')::numeric;
  benefit := coalesce(nullif(cleaned ->> 'benefitValue',''),'0')::numeric;
  if price > 100000000 or discount > 100 or benefit > 100000000 then
    raise exception 'El importe o descuento supera el máximo permitido';
  end if;
  if (cleaned ->> 'issueDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or (coalesce(cleaned ->> 'dueDate','') <> '' and (cleaned ->> 'dueDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
    raise exception 'Completa correctamente la fecha de emisión y vencimiento';
  end if;
  if (cleaned ->> 'status') not in ('pending','paid','cancelled') then
    raise exception 'Selecciona un estado válido';
  end if;
  if new.student_id is not null and not exists (
    select 1 from public.profiles p where p.id = new.student_id and p.role = 'student'
  ) then
    raise exception 'El estudiante seleccionado no está disponible';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := statement_timestamp();
    new.revision := 1;
  else
    if new.id is distinct from old.id or new.sequence_number is distinct from old.sequence_number
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception 'No se puede cambiar la identidad de una factura';
    end if;
    new.revision := old.revision + 1;
  end if;
  new.form_data := cleaned;
  new.client_name := cleaned ->> 'client';
  new.service := cleaned ->> 'service';
  new.status := cleaned ->> 'status';
  new.issue_date := (cleaned ->> 'issueDate')::date;
  new.due_date := nullif(cleaned ->> 'dueDate','')::date;
  if new.due_date < new.issue_date then
    raise exception 'El vencimiento no puede ser anterior a la emisión';
  end if;
  new.subtotal_cents := round(price * 100)::bigint;
  new.discount_basis_points := round(discount * 100)::integer;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function private.olon_prepare_invoice() from public, anon, authenticated;
create trigger olon_invoice_prepare before insert or update on public.olon_invoices
  for each row execute function private.olon_prepare_invoice();

-- Idempotent retries and optimistic concurrency prevent duplicate invoices/lost edits.
create function public.olon_save_invoice(
  p_id uuid, p_data jsonb, p_student_id uuid default null, p_expected_revision bigint default null
) returns public.olon_invoices
language plpgsql security invoker set search_path = ''
as $$
declare invoice public.olon_invoices;
begin
  if not (select private.is_olon_admin()) then
    raise exception 'Acceso exclusivo de administración' using errcode = '42501';
  end if;
  if p_id is null then raise exception 'Identificador de factura no válido'; end if;
  select * into invoice from public.olon_invoices where id = p_id for update;
  if not found then
    if p_expected_revision is not null then
      raise exception 'No se encontró esta factura. Actualiza el historial';
    end if;
    insert into public.olon_invoices (id, form_data, student_id)
      values (p_id, p_data, p_student_id) on conflict (id) do nothing returning * into invoice;
    if found then return invoice; end if;
    select * into invoice from public.olon_invoices where id = p_id for update;
  end if;
  if invoice.form_data = p_data and invoice.student_id is not distinct from p_student_id then
    return invoice;
  end if;
  if p_expected_revision is null or invoice.revision <> p_expected_revision then
    raise exception 'La factura cambió en otra sesión. Abre de nuevo la factura para actualizarla';
  end if;
  update public.olon_invoices set form_data = p_data, student_id = p_student_id where id = p_id returning * into invoice;
  return invoice;
end;
$$;
revoke all on function public.olon_save_invoice(uuid,jsonb,uuid,bigint) from public, anon;
grant execute on function public.olon_save_invoice(uuid,jsonb,uuid,bigint) to authenticated;

create function public.olon_invoice_summary()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'invoice_count', count(*),
    'paid_cents', coalesce(sum(total_cents) filter (where status='paid'),0),
    'pending_cents', coalesce(sum(total_cents) filter (where status='pending'),0),
    'month_cents', coalesce(sum(total_cents) filter (where status<>'cancelled'
      and date_trunc('month', issue_date::timestamp) = date_trunc('month', now() at time zone 'America/Puerto_Rico')),0)
  ) from public.olon_invoices;
$$;
revoke all on function public.olon_invoice_summary() from public, anon;
grant execute on function public.olon_invoice_summary() to authenticated;

comment on table public.olon_invoices is 'Administrative invoices; OSA-P portal series; financial records are retained when a student is removed.';
