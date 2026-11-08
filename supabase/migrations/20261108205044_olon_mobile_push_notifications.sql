-- Web Push is opt-in and device-specific. No new anonymous/authenticated grants.
create table private.olon_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 2048),
  p256dh text not null check (char_length(p256dh) between 80 and 100),
  auth_key text not null check (char_length(auth_key) between 20 and 30),
  label text not null default 'Dispositivo' check (char_length(label) between 1 and 40),
  classes_enabled boolean not null default false,
  vip_enabled boolean not null default false,
  baseline_publications jsonb not null default '[]'::jsonb
    check (jsonb_typeof(baseline_publications) = 'array' and jsonb_array_length(baseline_publications) <= 2000),
  consent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_checked_at timestamptz,
  last_test_at timestamptz
);
create index olon_push_devices_owner on private.olon_push_devices(user_id);

create table private.olon_push_deliveries (
  device_id uuid not null references private.olon_push_devices(id) on delete cascade,
  event_key text not null check (char_length(event_key) <= 180),
  attempts integer not null default 1 check (attempts between 1 and 4),
  leased_until timestamptz,
  retry_after timestamptz not null default now(),
  sent_at timestamptz,
  last_status integer,
  expires_at timestamptz not null,
  primary key (device_id,event_key)
);
create index olon_push_deliveries_expiry on private.olon_push_deliveries(expires_at);

create table private.olon_push_runtime (
  name text primary key,
  lock_owner uuid not null,
  leased_until timestamptz not null
);

alter table private.olon_push_devices enable row level security;
alter table private.olon_push_deliveries enable row level security;
alter table private.olon_push_runtime enable row level security;
revoke all on private.olon_push_devices, private.olon_push_deliveries, private.olon_push_runtime from public, anon, authenticated;

comment on table private.olon_push_devices is 'Opt-in Web Push subscriptions, available only through authenticated server handlers. Never exposed to the browser Data API.';
comment on table private.olon_push_deliveries is 'Internal deduplication/retry state. No notification body or financial data is stored.';

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Vault credentials are created once by the server, not committed to source.
-- Skip HTTP work entirely until at least one active member opts in.
create function private.olon_mobile_push_tick()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare settings jsonb;
begin
  if not exists (
    select 1 from private.olon_push_devices d join public.profiles p on p.id=d.user_id
    where p.status in ('active','approved') and (d.classes_enabled or d.vip_enabled)
  ) then return null; end if;
  select decrypted_secret::jsonb into settings from vault.decrypted_secrets where name='olon_mobile_push_v1';
  if settings is null then return null; end if;
  return net.http_post(
    url := (settings->>'projectUrl') || '/functions/v1/portal-notifications',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || (settings->>'gatewayKey'),
      'apikey',settings->>'gatewayKey','x-olon-push-job',settings->>'jobSecret'),
    body := '{"action":"dispatch"}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function private.olon_mobile_push_tick() from public, anon, authenticated;

select cron.schedule('olon-mobile-push-every-5-minutes','*/5 * * * *',
  'select private.olon_mobile_push_tick();');
