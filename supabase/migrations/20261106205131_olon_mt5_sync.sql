create table private.olon_mt5_codes (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null
);

create table private.olon_mt5_connections (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  account_login text not null,
  broker_server text not null,
  currency text not null,
  token_hash text unique,
  linked_at timestamptz not null default now(),
  synced_at timestamptz,
  unique (student_id, account_login, broker_server, currency)
);

create unique index olon_mt5_one_active
  on private.olon_mt5_connections (student_id) where token_hash is not null;

create table private.olon_mt5_deals (
  connection_id uuid not null references private.olon_mt5_connections(id) on delete cascade,
  ticket text not null,
  broker_time timestamp not null,
  symbol text not null,
  kind text not null,
  entry text not null,
  profit numeric(24,8) not null,
  commission numeric(24,8) not null,
  swap numeric(24,8) not null,
  fee numeric(24,8) not null,
  primary key (connection_id, ticket)
);

create index olon_mt5_deal_time on private.olon_mt5_deals (connection_id, broker_time, ticket);

alter table private.olon_mt5_codes enable row level security;
alter table private.olon_mt5_connections enable row level security;
alter table private.olon_mt5_deals enable row level security;

revoke all on private.olon_mt5_codes, private.olon_mt5_connections, private.olon_mt5_deals
  from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on private.olon_mt5_codes, private.olon_mt5_connections,
  private.olon_mt5_deals to service_role;

create function public.olon_mt5_service(p_action text, p_payload jsonb, p_student uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_student uuid := p_student;
  v_connection private.olon_mt5_connections%rowtype;
  v_date date;
  v_result jsonb;
  v_more boolean;
  v_key text := p_payload->>'key_hash';
begin
  if p_action = 'pair' then
    select student_id into v_student
      from private.olon_mt5_codes
      where code_hash = v_key and expires_at > now();
  elsif p_action = 'sync' then
    select student_id into v_student
      from private.olon_mt5_connections where token_hash = v_key;
  end if;

  -- Serialize mutations for this student so revocation and replay are atomic.
  if p_action in ('code', 'disconnect', 'pair', 'sync') then
    perform 1 from public.profiles
      where id = v_student and role = 'student' and status in ('active','approved')
      for no key update;
  else
    perform 1 from public.profiles
      where id = v_student and role = 'student' and status in ('active','approved');
  end if;
  if not found then
    return jsonb_build_object('error', 'access');
  end if;

  if p_action = 'code' then
    insert into private.olon_mt5_codes (student_id, code_hash, expires_at)
      values (v_student, v_key, now() + interval '10 minutes')
      on conflict (student_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at
      returning to_jsonb(expires_at) into v_result;
    return jsonb_build_object('expires_at', v_result);
  elsif p_action = 'disconnect' then
    delete from private.olon_mt5_codes where student_id = v_student;
    update private.olon_mt5_connections set token_hash = null
      where student_id = v_student and token_hash is not null;
    return jsonb_build_object('ok', true);
  elsif p_action = 'pair' then
    delete from private.olon_mt5_codes
      where student_id = v_student and code_hash = v_key and expires_at > now();
    if not found then
      return jsonb_build_object('error', 'access');
    end if;
    update private.olon_mt5_connections set token_hash = null
      where student_id = v_student and token_hash is not null;
    insert into private.olon_mt5_connections (student_id, account_login, broker_server, currency, token_hash)
      values (v_student, p_payload->>'login', p_payload->>'server', p_payload->>'currency', p_payload->>'token_hash')
      on conflict (student_id, account_login, broker_server, currency) do update
      set token_hash = excluded.token_hash, linked_at = clock_timestamp();
    return jsonb_build_object('ok', true);
  elsif p_action = 'sync' then
    select * into v_connection from private.olon_mt5_connections
      where student_id = v_student and token_hash = v_key
        and account_login = p_payload->>'login' and broker_server = p_payload->>'server'
        and currency = p_payload->>'currency';
    if not found then
      return jsonb_build_object('error', 'access');
    end if;

    insert into private.olon_mt5_deals as saved
      (connection_id, ticket, broker_time, symbol, kind, entry, profit, commission, swap, fee)
    select v_connection.id, d.ticket, d.broker_time, d.symbol, d.kind, d.entry, d.profit, d.commission, d.swap, d.fee
    from jsonb_to_recordset(p_payload->'deals') as d(
      ticket text, broker_time timestamp, symbol text, kind text, entry text,
      profit numeric, commission numeric, swap numeric, fee numeric
    )
    on conflict (connection_id, ticket) do update set
      broker_time = excluded.broker_time, symbol = excluded.symbol, kind = excluded.kind, entry = excluded.entry,
      profit = excluded.profit, commission = excluded.commission, swap = excluded.swap, fee = excluded.fee
    where (saved.broker_time, saved.symbol, saved.kind, saved.entry, saved.profit, saved.commission, saved.swap, saved.fee)
      is distinct from (excluded.broker_time, excluded.symbol, excluded.kind, excluded.entry,
                        excluded.profit, excluded.commission, excluded.swap, excluded.fee);

    update private.olon_mt5_connections set synced_at = clock_timestamp() where id = v_connection.id;
    return jsonb_build_object('ok', true);
  end if;

  select * into v_connection from private.olon_mt5_connections
    where student_id = v_student
    order by (token_hash is not null) desc, linked_at desc limit 1;

  if p_action = 'month' then
    v_date := (p_payload->>'date')::date;
    select coalesce(jsonb_agg(to_jsonb(days) order by date), '[]'::jsonb) into v_result
    from (
      select broker_time::date as date,
        sum(greatest(net, 0)) as gain, sum(greatest(-net, 0)) as loss, count(*) as count
      from (
        select broker_time, profit + commission + swap + fee as net
        from private.olon_mt5_deals
        where connection_id = v_connection.id and broker_time >= v_date
          and broker_time < v_date + interval '1 month'
      ) deals
      group by broker_time::date
    ) days;

    return jsonb_build_object('account', case when v_connection.id is not null then
      jsonb_build_object('id', v_connection.id, 'login', right(v_connection.account_login, 4),
        'server', v_connection.broker_server, 'currency', v_connection.currency,
        'connected', v_connection.token_hash is not null,
        'linked_at', v_connection.linked_at, 'synced_at', v_connection.synced_at) end,
      'days', v_result);
  elsif p_action = 'day' then
    if v_connection.id is null or v_connection.id::text <> p_payload->>'account' then
      return jsonb_build_object('error', 'account');
    end if;
    v_date := (p_payload->>'date')::date;
    select coalesce(jsonb_agg(to_jsonb(deals) order by broker_time desc, ticket desc), '[]'::jsonb)
      into v_result from (
        select ticket, broker_time, symbol, kind, entry, profit, commission, swap, fee
        from private.olon_mt5_deals where connection_id = v_connection.id
          and broker_time >= v_date and broker_time < v_date + 1
        order by broker_time desc, ticket desc limit 101 offset (p_payload->>'offset')::int
      ) deals;
    v_more := jsonb_array_length(v_result) > 100;
    return jsonb_build_object('deals', v_result - 100, 'more', v_more);
  end if;

  return jsonb_build_object('error', 'action');
end;
$$;

revoke all on function public.olon_mt5_service(text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.olon_mt5_service(text, jsonb, uuid) to service_role;
