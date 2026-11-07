create table public.olon_rebate_reports (
  id uuid primary key,
  file_sha256 text not null unique check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_name text not null check (char_length(file_name) between 1 and 255),
  imported_by uuid not null,
  imported_at timestamptz not null default now(),
  first_date date not null,
  last_date date not null,
  row_count integer not null check (row_count between 1 and 5000),
  reported_lots numeric(20,6) not null,
  currencies jsonb not null,
  inserted_rows integer not null check (inserted_rows >= 0),
  duplicate_rows integer not null check (duplicate_rows >= 0),
  conflict_rows integer not null check (conflict_rows >= 0),
  check (inserted_rows + duplicate_rows + conflict_rows = row_count),
  check (first_date <= last_date)
);

create table public.olon_rebate_entries (
  identity_key text primary key check (identity_key ~ '^[0-9a-f]{64}$'),
  row_hash text not null check (row_hash ~ '^[0-9a-f]{64}$'),
  first_report_id uuid not null references public.olon_rebate_reports(id),
  platform text not null check (platform ~ '^[A-Z0-9._-]{1,16}$'),
  referral_id text not null check (referral_id ~ '^[0-9]{1,40}$'),
  customer_id text not null check (customer_id ~ '^[0-9]{1,40}$'),
  customer_name text not null check (char_length(customer_name) between 1 and 160),
  account_name text not null check (char_length(account_name) <= 160),
  order_id text not null check (order_id ~ '^[0-9]{1,40}$'),
  rebate_id text not null check (rebate_id ~ '^[0-9]{1,40}$'),
  wallet_id text not null check (wallet_id ~ '^[0-9]{1,40}$'),
  symbol text not null check (char_length(symbol) between 1 and 40),
  side text not null check (side in ('buy','sell','unspecified')),
  trade_date date not null check (trade_date between date '2000-01-01' and date '2100-12-31'),
  lots numeric(20,6) not null check (lots between 0 and 999999999),
  rebate numeric(20,6) not null check (rebate between -999999999 and 999999999),
  currency text not null check (currency ~ '^[A-Z]{3}$')
);
create index olon_rebate_entry_date on public.olon_rebate_entries(trade_date desc);
create index olon_rebate_entry_customer on public.olon_rebate_entries(customer_id);
create index olon_rebate_entry_report on public.olon_rebate_entries(first_report_id);
create index olon_rebate_reports_date on public.olon_rebate_reports(imported_at desc);
create index olon_rebate_reports_author on public.olon_rebate_reports(imported_by);

alter table public.olon_rebate_reports enable row level security;
alter table public.olon_rebate_entries enable row level security;
revoke all on public.olon_rebate_reports, public.olon_rebate_entries from public, anon, authenticated;
grant select, insert on public.olon_rebate_reports, public.olon_rebate_entries to authenticated;
create policy olon_rebate_reports_admin_read on public.olon_rebate_reports for select to authenticated
  using ((select private.is_olon_admin()));
create policy olon_rebate_reports_admin_add on public.olon_rebate_reports for insert to authenticated
  with check ((select private.is_olon_admin()) and imported_by = (select auth.uid()));
create policy olon_rebate_entries_admin_read on public.olon_rebate_entries for select to authenticated
  using ((select private.is_olon_admin()));
create policy olon_rebate_entries_admin_add on public.olon_rebate_entries for insert to authenticated
  with check ((select private.is_olon_admin()));

create function private.olon_parse_rebate_rows(p_rows jsonb)
returns table(
  identity_key text, row_hash text, platform text, referral_id text, customer_id text,
  customer_name text, account_name text, order_id text, rebate_id text, wallet_id text,
  symbol text, side text, trade_date date, lots numeric, rebate numeric, currency text
)
language plpgsql stable security invoker set search_path = ''
as $$
declare r jsonb; field_name text; field_value text; position integer := 0;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000
     or octet_length(p_rows::text) > 8000000 then raise exception 'El reporte debe tener entre 1 y 5,000 registros'; end if;
  for r in select value from jsonb_array_elements(p_rows)
  loop
    position := position + 1;
    if jsonb_typeof(r) <> 'object' then raise exception 'Registro % no válido', position; end if;
    foreach field_name in array array['referral_id','customer_id','order_id','rebate_id','wallet_id']
    loop
      field_value := btrim(coalesce(r ->> field_name,''));
      if field_value !~ '^[0-9]{1,40}$' then raise exception 'Identificador % no válido en el registro %', field_name, position; end if;
    end loop;
    platform := upper(btrim(coalesce(r ->> 'platform','')));
    referral_id := (r ->> 'referral_id')::numeric::text;
    customer_id := (r ->> 'customer_id')::numeric::text;
    order_id := (r ->> 'order_id')::numeric::text;
    rebate_id := (r ->> 'rebate_id')::numeric::text;
    wallet_id := (r ->> 'wallet_id')::numeric::text;
    customer_name := btrim(coalesce(r ->> 'customer_name',''));
    account_name := btrim(coalesce(r ->> 'account_name',''));
    symbol := upper(btrim(coalesce(r ->> 'symbol','')));
    side := lower(btrim(coalesce(r ->> 'side','')));
    currency := upper(btrim(coalesce(r ->> 'currency','')));
    if platform !~ '^[A-Z0-9._-]{1,16}$' or currency !~ '^[A-Z]{3}$'
       or side not in ('buy','sell','unspecified')
       or char_length(customer_name) not between 1 and 160 or char_length(account_name) > 160
       or char_length(symbol) not between 1 and 40 then raise exception 'Datos de cliente o moneda no válidos en el registro %', position; end if;
    if coalesce(r ->> 'lots','') !~ '^[0-9]{1,9}(\.[0-9]{1,6})?$'
       or coalesce(r ->> 'rebate','') !~ '^-?[0-9]{1,9}(\.[0-9]{1,6})?$' then
      raise exception 'Lotaje o rebate no válido en el registro %', position;
    end if;
    lots := (r ->> 'lots')::numeric(20,6);
    rebate := (r ->> 'rebate')::numeric(20,6);
    if lots > 999999999 or abs(rebate) > 999999999 then raise exception 'Importe fuera de rango'; end if;
    if coalesce(r ->> 'trade_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Fecha no válida en el registro %', position; end if;
    trade_date := (r ->> 'trade_date')::date;
    if trade_date not between date '2000-01-01' and date '2100-12-31' then raise exception 'Fecha fuera de rango'; end if;
    identity_key := encode(sha256(convert_to(jsonb_build_array('AXI',platform,referral_id,customer_id,order_id,rebate_id,wallet_id,currency)::text,'UTF8')),'hex');
    row_hash := encode(sha256(convert_to(jsonb_build_array(symbol,side,trade_date::text,lots::numeric(20,6)::text,rebate::numeric(20,6)::text)::text,'UTF8')),'hex');
    return next;
  end loop;
end;
$$;
revoke all on function private.olon_parse_rebate_rows(jsonb) from public, anon;
grant execute on function private.olon_parse_rebate_rows(jsonb) to authenticated;

create function public.olon_import_rebate_report(
  p_request_id uuid, p_file_name text, p_file_sha256 text, p_rows jsonb, p_dry_run boolean default true
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  normalized jsonb; canonical jsonb; report_currency jsonb; response jsonb;
  existing public.olon_rebate_reports; first_day date; last_day date;
  total_rows integer; new_rows integer; duplicate_rows integer; conflict_rows integer;
  total_lots numeric; earning_lots numeric; report_clients integer; actual_inserted integer;
begin
  if not (select private.is_olon_admin()) then raise exception 'Acceso exclusivo de administración' using errcode='42501'; end if;
  if p_request_id is null or p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$'
    or char_length(btrim(coalesce(p_file_name,''))) not between 1 and 255 or p_dry_run is null then raise exception 'Archivo o identificador de importación no válido'; end if;
  select jsonb_agg(to_jsonb(r)) into normalized from private.olon_parse_rebate_rows(p_rows) r;
  if exists (select 1 from jsonb_to_recordset(normalized) as r(identity_key text,row_hash text)
    group by r.identity_key having count(distinct r.row_hash)>1) then
    raise exception 'El archivo contiene una misma orden con importes distintos. Revisa el Excel antes de importarlo';
  end if;
  select jsonb_agg(to_jsonb(r)) into canonical from (
    select distinct on (r.identity_key) r.*
    from jsonb_populate_recordset(null::public.olon_rebate_entries, normalized) r order by r.identity_key
  ) r;
  if not p_dry_run then perform pg_advisory_xact_lock(hashtextextended('olon-rebate-import',0)); end if;
  select * into existing from public.olon_rebate_reports where file_sha256=p_file_sha256;
  select count(*),min(r.trade_date),max(r.trade_date),coalesce(sum(r.lots),0),
    coalesce(sum(r.lots) filter(where r.rebate<>0),0),
    count(distinct (r.platform,r.referral_id,r.customer_id))
    into total_rows,first_day,last_day,total_lots,earning_lots,report_clients
    from jsonb_populate_recordset(null::public.olon_rebate_entries,canonical) r;
  select jsonb_agg(jsonb_build_object('currency',t.currency,'rebate',t.rebate) order by t.currency) into report_currency
    from (select r.currency,sum(r.rebate) rebate from jsonb_populate_recordset(null::public.olon_rebate_entries,canonical) r group by r.currency) t;
  select count(*) filter(where e.identity_key is null),count(*) filter(where e.row_hash=r.row_hash),
    count(*) filter(where e.row_hash<>r.row_hash) into new_rows,duplicate_rows,conflict_rows
    from jsonb_populate_recordset(null::public.olon_rebate_entries,canonical) r
    left join public.olon_rebate_entries e on e.identity_key=r.identity_key;
  response := jsonb_build_object('row_count',total_rows,'lots',total_lots,'earning_lots',earning_lots,
    'currencies',report_currency,'client_count',report_clients,'first_date',first_day,'last_date',last_day,
    'new_rows',new_rows,'duplicate_rows',duplicate_rows,'conflict_rows',conflict_rows,
    'repeated_in_file',jsonb_array_length(p_rows)-total_rows,'already_imported',existing.id is not null);
  if p_dry_run then return response; end if;
  if existing.id is not null then return response || jsonb_build_object('import_id',existing.id,'new_rows',0); end if;
  if exists(select 1 from public.olon_rebate_reports where id=p_request_id) then raise exception 'Este intento de importación pertenece a otro archivo'; end if;
  insert into public.olon_rebate_reports(id,file_sha256,file_name,imported_by,first_date,last_date,row_count,reported_lots,currencies,inserted_rows,duplicate_rows,conflict_rows)
    values(p_request_id,p_file_sha256,btrim(p_file_name),(select auth.uid()),first_day,last_day,total_rows,total_lots,report_currency,new_rows,duplicate_rows,conflict_rows);
  insert into public.olon_rebate_entries(identity_key,row_hash,first_report_id,platform,referral_id,customer_id,customer_name,account_name,order_id,rebate_id,wallet_id,symbol,side,trade_date,lots,rebate,currency)
    select r.identity_key,r.row_hash,p_request_id,r.platform,r.referral_id,r.customer_id,r.customer_name,r.account_name,r.order_id,r.rebate_id,r.wallet_id,r.symbol,r.side,r.trade_date,r.lots,r.rebate,r.currency
    from jsonb_populate_recordset(null::public.olon_rebate_entries,canonical) r
    where not exists (select 1 from public.olon_rebate_entries e where e.identity_key=r.identity_key);
  get diagnostics actual_inserted = row_count;
  if actual_inserted<>new_rows then raise exception 'El historial cambió durante la importación. Vuelve a intentarlo'; end if;
  return response || jsonb_build_object('import_id',p_request_id);
end;
$$;
revoke all on function public.olon_import_rebate_report(uuid,text,text,jsonb,boolean) from public, anon;
grant execute on function public.olon_import_rebate_report(uuid,text,text,jsonb,boolean) to authenticated;

create function public.olon_rebate_dashboard(p_from date default null,p_to date default null,p_search text default '',p_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare response jsonb;
begin
  if not (select private.is_olon_admin()) then raise exception 'Acceso exclusivo de administración' using errcode='42501'; end if;
  if p_from>p_to or p_page is null or p_page<0 or p_page>100000 or char_length(coalesce(p_search,''))>160 then raise exception 'Filtros no válidos'; end if;
  with filtered as materialized (
    select * from public.olon_rebate_entries e
    where (p_from is null or e.trade_date>=p_from) and (p_to is null or e.trade_date<=p_to)
      and (coalesce(p_search,'')='' or strpos(lower(e.customer_name||' '||e.customer_id),lower(btrim(p_search)))>0)
  ), clients as materialized (
    select platform,referral_id,customer_id,min(customer_name) customer_name,currency,
      sum(lots) lots,sum(rebate) rebate,count(*) row_count,max(trade_date) last_date
      from filtered group by platform,referral_id,customer_id,currency
  ), currencies as (
    select currency,sum(rebate) rebate from filtered group by currency
  ), reports as (
    select id,file_name,imported_at,first_date,last_date,row_count,reported_lots,currencies,inserted_rows,duplicate_rows,conflict_rows
      from public.olon_rebate_reports order by imported_at desc limit 10
  )
  select jsonb_build_object(
    'lots',coalesce((select sum(lots) from filtered),0),
    'earning_lots',coalesce((select sum(lots) from filtered where rebate<>0),0),
    'row_count',(select count(*) from filtered),
    'client_count',(select count(distinct (platform,referral_id,customer_id)) from filtered),
    'first_date',(select min(trade_date) from filtered),'last_date',(select max(trade_date) from filtered),
    'currencies',coalesce((select jsonb_agg(to_jsonb(c) order by currency) from currencies c),'[]'::jsonb),
    'client_rows',(select count(*) from clients),
    'clients',coalesce((select jsonb_agg(to_jsonb(c) order by lots desc,customer_id) from (
      select * from clients order by lots desc,customer_id,currency limit 20 offset p_page*20) c),'[]'::jsonb),
    'reports',coalesce((select jsonb_agg(to_jsonb(r) order by imported_at desc) from reports r),'[]'::jsonb)
  ) into response;
  return response;
end;
$$;
revoke all on function public.olon_rebate_dashboard(date,date,text,integer) from public, anon;
grant execute on function public.olon_rebate_dashboard(date,date,text,integer) to authenticated;

comment on table public.olon_rebate_entries is 'Administrative broker-report rows. Lots sum the reported Size field, including zero-rebate rows. Rebate Earnings is imported directly, without an assumed per-lot rate.';
comment on table public.olon_rebate_reports is 'File import audit. Repeated orders are skipped; differing existing financial values are reported as conflicts, never overwritten.';
