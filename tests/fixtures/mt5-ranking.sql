CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA private;
CREATE SCHEMA auth;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, full_name text, role text, status text, next_payment_date date
);
CREATE TABLE public.olon_own_accounts (
  student_id uuid, provider_account_id uuid, vault_account_id uuid,
  status text, last_sync_at timestamptz
);
CREATE TABLE public.olon_metaapi_accounts (
  student_id uuid, provider_account_id uuid, connection_status text, provider_state text
);
CREATE TABLE public.olon_mt_sync_state (
  student_id uuid, provider_account_id uuid, vault_account_id uuid,
  backfill_done boolean, last_success_at timestamptz, source_version integer
);
CREATE TABLE public.olon_mt_deals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id uuid,
  provider_account_id uuid, vault_account_id uuid, deal_id text,
  deal_type text, entry_type text, occurred_at timestamptz, broker_time text,
  profit numeric NOT NULL DEFAULT 0, commission numeric NOT NULL DEFAULT 0,
  swap numeric NOT NULL DEFAULT 0, fee numeric NOT NULL DEFAULT 0,
  UNIQUE (vault_account_id,deal_id), UNIQUE (provider_account_id,deal_id)
);
CREATE TABLE public.olon_ranking_name_preferences (student_id uuid PRIMARY KEY, show_name boolean);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE FUNCTION private.is_olon_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND status='active');
$$;
CREATE FUNCTION private.olon_is_active_member() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND status IN ('active','approved')
    AND (next_payment_date IS NULL OR next_payment_date>(now() AT TIME ZONE 'America/Puerto_Rico')::date));
$$;
GRANT USAGE ON SCHEMA private,auth TO authenticated;

INSERT INTO public.profiles VALUES
 ('00000000-0000-0000-0000-000000000001','Admin','admin','active',NULL),
 ('00000000-0000-0000-0000-000000000002','Test account','student','active',NULL),
 ('00000000-0000-0000-0000-000000000003','Real trader','student','active',NULL),
 ('00000000-0000-0000-0000-000000000004','Other trader','student','active',NULL);
INSERT INTO public.olon_own_accounts
 SELECT p.id, ('10000000-0000-0000-0000-'||right(p.id::text,12))::uuid,
   ('20000000-0000-0000-0000-'||right(p.id::text,12))::uuid,'active',now()
 FROM public.profiles p WHERE p.role='student';
INSERT INTO public.olon_mt_sync_state
 SELECT student_id,provider_account_id,vault_account_id,true,now(),1 FROM public.olon_own_accounts;
-- The real trader's old provider remains connected during a provider transition.
INSERT INTO public.olon_metaapi_accounts VALUES
 ('00000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000003','CONNECTED','DEPLOYED');
INSERT INTO public.olon_mt_sync_state VALUES
 ('00000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000003',true,now()-interval '1 day',1);
-- Capital imported by the old provider, closures imported by the current provider.
INSERT INTO public.olon_mt_deals
 (student_id,provider_account_id,vault_account_id,deal_id,deal_type,entry_type,occurred_at,broker_time,profit)
 SELECT student_id,
   CASE WHEN right(student_id::text,1)='3' THEN '30000000-0000-0000-0000-000000000003'::uuid ELSE provider_account_id END,
   vault_account_id,'deposit','DEAL_TYPE_BALANCE',NULL,'2026-10-01 00:00Z','2026-10-01 02:00:00',100
 FROM public.olon_own_accounts;
INSERT INTO public.olon_mt_deals
 (student_id,provider_account_id,vault_account_id,deal_id,deal_type,entry_type,occurred_at,broker_time,profit,commission,swap,fee)
 SELECT student_id,provider_account_id,vault_account_id,'closure','DEAL_TYPE_SELL','DEAL_ENTRY_OUT',
   '2026-11-12 03:00Z','2026-11-12 05:00:00',
   CASE right(student_id::text,1) WHEN '2' THEN 1000 WHEN '3' THEN 25 ELSE 15 END,-2,-2,-1
 FROM public.olon_own_accounts;
