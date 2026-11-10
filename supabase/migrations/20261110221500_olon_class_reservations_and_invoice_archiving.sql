-- OLON: reservations and installment ledger. Existing invoices and payments are never deleted.
alter table public.olon_invoices
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

create table if not exists public.olon_invoice_reservations (
  invoice_id uuid primary key references public.olon_invoices(id) on delete restrict,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create table if not exists public.olon_invoice_payments (
  id uuid primary key,
  invoice_id uuid not null references public.olon_invoice_reservations(invoice_id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null,
  method text not null check (char_length(method) between 1 and 50),
  reference text not null default '' check (char_length(reference) <= 160),
  recorded_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists olon_invoice_payments_invoice_idx on public.olon_invoice_payments(invoice_id,created_at);
create index if not exists olon_invoice_active_idx on public.olon_invoices(sequence_number desc) where archived_at is null;

alter table public.olon_invoice_reservations enable row level security;
alter table public.olon_invoice_payments enable row level security;
revoke all on public.olon_invoice_reservations from public,anon,authenticated;
revoke all on public.olon_invoice_payments from public,anon,authenticated;
grant select,insert on public.olon_invoice_reservations to authenticated;
grant select,insert on public.olon_invoice_payments to authenticated;
grant update (archived_at,archived_by) on public.olon_invoices to authenticated;
create policy olon_reservation_read_admin on public.olon_invoice_reservations
 for select to authenticated using ((select private.is_olon_admin()));
create policy olon_reservation_insert_admin on public.olon_invoice_reservations
 for insert to authenticated with check ((select private.is_olon_admin()) and created_by=(select auth.uid()));
create policy olon_invoice_payment_read_admin on public.olon_invoice_payments
 for select to authenticated using ((select private.is_olon_admin()));
create policy olon_invoice_payment_insert_admin on public.olon_invoice_payments
 for insert to authenticated with check ((select private.is_olon_admin()) and recorded_by=(select auth.uid()));

-- Enforce payment state even when the regular invoice editor/API is used directly.
create or replace function private.olon_guard_reserved_invoice()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare received bigint; total_due bigint;
begin
  if tg_op='UPDATE' and old.archived_at is not null then
    raise exception 'La factura fue eliminada del historial activo';
  end if;
  if new.archived_at is not null and tg_op='UPDATE' then
    new.archived_by := (select auth.uid());
    if new.archived_by is null then raise exception 'Sesión no autorizada'; end if;
  end if;
  if exists (select 1 from public.olon_invoice_reservations r where r.invoice_id=new.id) then
    select coalesce(sum(p.amount_cents),0) into received
      from public.olon_invoice_payments p where p.invoice_id=new.id;
    total_due := new.subtotal_cents - round(new.subtotal_cents::numeric * new.discount_basis_points/10000)::bigint;
    if received>total_due then raise exception 'El total no puede ser menor a los abonos registrados'; end if;
    if received>0 and new.status='cancelled' then raise exception 'La reserva tiene abonos. Requiere conciliación antes de anular'; end if;
    if new.status='paid' and received<total_due then raise exception 'La reserva no puede marcarse pagada con saldo pendiente'; end if;
    if received=total_due and total_due>0 and new.status<>'cancelled' then
      new.status:='paid';
      new.form_data:=jsonb_set(new.form_data,'{status}','"paid"'::jsonb,true);
    elsif received<total_due and new.status='paid' then
      raise exception 'La reserva tiene balance pendiente';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.olon_guard_reserved_invoice() from public,anon,authenticated;
drop trigger if exists zz_olon_guard_reserved_invoice on public.olon_invoices;
create trigger zz_olon_guard_reserved_invoice before insert or update on public.olon_invoices
for each row execute function private.olon_guard_reserved_invoice();

-- Direct-table inserts receive the same balance validation as the RPC.
create or replace function private.olon_validate_installment()
returns trigger language plpgsql security invoker set search_path='' as $$
declare invoice public.olon_invoices; existing bigint;
begin
 if not (select private.is_olon_admin()) or new.recorded_by is distinct from (select auth.uid()) then
   raise exception 'Acceso exclusivo de administración' using errcode='42501';
 end if;
 select * into invoice from public.olon_invoices where id=new.invoice_id for update;
 if not found or invoice.archived_at is not null or invoice.status<>'pending' then
   raise exception 'La factura no acepta nuevos abonos';
 end if;
 select coalesce(sum(amount_cents),0) into existing
   from public.olon_invoice_payments where invoice_id=new.invoice_id;
 if existing+new.amount_cents>invoice.total_cents then
   raise exception 'El abono supera el saldo pendiente';
 end if;
 if new.paid_on>((now() at time zone 'America/Puerto_Rico')::date) then
   raise exception 'No se permiten abonos con fecha futura';
 end if;
 return new;
end;$$;
revoke all on function private.olon_validate_installment() from public,anon,authenticated;
create trigger olon_payment_validate before insert on public.olon_invoice_payments
for each row execute function private.olon_validate_installment();
create or replace function private.olon_sync_paid_installment()
returns trigger language plpgsql security invoker set search_path='' as $$
declare credited bigint; due bigint;
begin
 select total_cents into due from public.olon_invoices where id=new.invoice_id;
 select sum(amount_cents) into credited from public.olon_invoice_payments where invoice_id=new.invoice_id;
 if due=credited then
   update public.olon_invoices
   set form_data=jsonb_set(form_data,'{status}','"paid"'::jsonb,true)
   where id=new.invoice_id and status='pending';
 end if;
 return null;
end;$$;
revoke all on function private.olon_sync_paid_installment() from public,anon,authenticated;
create trigger olon_payment_sync after insert on public.olon_invoice_payments
for each row execute function private.olon_sync_paid_installment();

create or replace function public.olon_start_invoice_reservation(p_invoice_id uuid)
returns public.olon_invoice_reservations language plpgsql security invoker set search_path='' as $$
declare item public.olon_invoices; reservation public.olon_invoice_reservations;
begin
  if not (select private.is_olon_admin()) then raise exception 'Acceso exclusivo de administración' using errcode='42501'; end if;
  select * into item from public.olon_invoices where id=p_invoice_id for update;
  if not found or item.archived_at is not null then raise exception 'Factura no disponible'; end if;
  if item.status<>'pending' or item.total_cents<=0 then raise exception 'Se necesita una factura pendiente con importe mayor a cero'; end if;
  insert into public.olon_invoice_reservations(invoice_id,created_by)
    values(p_invoice_id,(select auth.uid())) on conflict(invoice_id) do nothing;
  select * into reservation from public.olon_invoice_reservations where invoice_id=p_invoice_id;
  return reservation;
end;$$;
revoke all on function public.olon_start_invoice_reservation(uuid) from public,anon;
grant execute on function public.olon_start_invoice_reservation(uuid) to authenticated;

create or replace function public.olon_add_invoice_payment(
 p_invoice_id uuid,p_payment_id uuid,p_amount_cents bigint,p_paid_on date,p_method text,p_reference text default '')
returns public.olon_invoice_payments language plpgsql security invoker set search_path='' as $$
declare item public.olon_invoices; payment public.olon_invoice_payments; received bigint;
begin
 if not (select private.is_olon_admin()) then raise exception 'Acceso exclusivo de administración' using errcode='42501'; end if;
 if p_payment_id is null or p_amount_cents is null or p_amount_cents<=0 or p_paid_on is null
 or p_paid_on> ((now() at time zone 'America/Puerto_Rico')::date)
 or char_length(btrim(coalesce(p_method,''))) not between 1 and 50
 or char_length(coalesce(p_reference,''))>160 then raise exception 'Datos de abono inválidos'; end if;
 select * into item from public.olon_invoices where id=p_invoice_id for update;
 if not found or item.archived_at is not null or item.status='cancelled' then raise exception 'Factura no disponible'; end if;
 if not exists(select 1 from public.olon_invoice_reservations where invoice_id=p_invoice_id) then raise exception 'Activa la reserva antes de registrar abonos'; end if;
 select * into payment from public.olon_invoice_payments where id=p_payment_id;
 if found then
   if payment.invoice_id<>p_invoice_id or payment.amount_cents<>p_amount_cents or payment.paid_on<>p_paid_on or payment.method<>btrim(p_method) or payment.reference<>btrim(coalesce(p_reference,'')) then raise exception 'Identificador de abono repetido'; end if;
   return payment;
 end if;
 select coalesce(sum(amount_cents),0) into received from public.olon_invoice_payments where invoice_id=p_invoice_id;
 if received + p_amount_cents > item.total_cents then raise exception 'El abono supera el saldo pendiente'; end if;
 insert into public.olon_invoice_payments(id,invoice_id,amount_cents,paid_on,method,reference,recorded_by)
 values(p_payment_id,p_invoice_id,p_amount_cents,p_paid_on,btrim(p_method),btrim(coalesce(p_reference,'')),(select auth.uid()))
 returning * into payment;
 if received + p_amount_cents = item.total_cents then
   update public.olon_invoices
   set form_data=jsonb_set(form_data,'{status}','"paid"'::jsonb,true)
   where id=p_invoice_id;
 end if;
 return payment;
end;$$;
revoke all on function public.olon_add_invoice_payment(uuid,uuid,bigint,date,text,text) from public,anon;
grant execute on function public.olon_add_invoice_payment(uuid,uuid,bigint,date,text,text) to authenticated;

create or replace function public.olon_archive_invoice(p_invoice_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare item public.olon_invoices;
begin
 if not (select private.is_olon_admin()) then raise exception 'Acceso exclusivo de administración' using errcode='42501'; end if;
 select * into item from public.olon_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Factura no encontrada'; end if;
 if item.archived_at is not null then return true; end if;
 update public.olon_invoices set archived_at=statement_timestamp(),archived_by=(select auth.uid()) where id=p_invoice_id;
 return true;
end;$$;
revoke all on function public.olon_archive_invoice(uuid) from public,anon;
grant execute on function public.olon_archive_invoice(uuid) to authenticated;

create or replace function public.olon_invoice_summary()
returns jsonb language sql stable security invoker set search_path='' as $$
 with balances as (
   select i.status,i.issue_date,i.total_cents,i.id,
     coalesce((select sum(p.amount_cents) from public.olon_invoice_payments p where p.invoice_id=i.id),0) as credited
   from public.olon_invoices i where i.archived_at is null
 )
 select jsonb_build_object(
   'invoice_count',count(*),
   'paid_cents',coalesce(sum(total_cents) filter(where status='paid'),0),
   'pending_cents',coalesce(sum(greatest(0,total_cents-credited)) filter(where status='pending'),0),
   'month_cents',coalesce(sum(total_cents) filter(where status<>'cancelled'
      and date_trunc('month',issue_date::timestamp)=date_trunc('month',now() at time zone 'America/Puerto_Rico')),0)
 ) from balances;
$$;
revoke all on function public.olon_invoice_summary() from public,anon;
grant execute on function public.olon_invoice_summary() to authenticated;
