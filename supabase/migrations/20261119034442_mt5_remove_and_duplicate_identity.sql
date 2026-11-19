-- Account removal preserves the permanent vault; only active links reserve an identity.
ALTER TABLE public.olon_own_accounts ADD COLUMN identity_fingerprint text;
UPDATE public.olon_own_accounts a SET identity_fingerprint=v.identity_fingerprint
FROM public.olon_mt_vault_accounts v WHERE v.id=a.vault_account_id;
CREATE UNIQUE INDEX olon_own_active_identity ON public.olon_own_accounts(identity_fingerprint)
WHERE status<>'revoked' AND identity_fingerprint IS NOT NULL;

CREATE OR REPLACE FUNCTION public.olon_own_connect_account(p_student_id uuid,p_agent_id uuid,p_server text,p_login text,p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_key bytea; v_identity text; v_id uuid; v_count integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('olon_own_account_links',0));
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_student_id AND status='active')
 OR NOT EXISTS(SELECT 1 FROM public.olon_own_agents WHERE id=p_agent_id AND status='paired')
 OR trim(p_login)!~'^[0-9]{4,20}$' OR length(trim(p_server)) NOT BETWEEN 2 AND 120
 OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Invalid MT5 registration' USING ERRCODE='22023'; END IF;
 SELECT secret INTO v_key FROM olon_internal.mt_vault_identity_secret WHERE slot=1;
 IF v_key IS NULL THEN RAISE EXCEPTION 'Identity key unavailable'; END IF;
 v_identity=encode(extensions.hmac(convert_to('mt5|'||lower(trim(p_server))||'|'||trim(p_login),'UTF8'),v_key,'sha256'),'hex');
 IF EXISTS(SELECT 1 FROM public.olon_own_accounts a WHERE a.status<>'revoked' AND a.platform='mt5'
 AND (a.identity_fingerprint=v_identity OR (a.identity_fingerprint IS NULL
 AND lower(trim(a.broker_server))=lower(trim(p_server)) AND right(a.login_masked,4)=right(trim(p_login),4)))) THEN
  RAISE EXCEPTION 'MT5_ACCOUNT_EXISTS' USING ERRCODE='23505';
 END IF;
 SELECT count(*) INTO v_count FROM public.olon_own_accounts WHERE student_id=p_student_id AND status<>'revoked';
 IF v_count>=10 THEN RAISE EXCEPTION 'MT5_ACCOUNT_LIMIT' USING ERRCODE='P0001'; END IF;
 INSERT INTO public.olon_own_accounts(student_id,agent_id,platform,broker_server,login_masked,encrypted_payload,status,is_primary,identity_fingerprint)
 VALUES(p_student_id,p_agent_id,'mt5',trim(p_server),'••••'||right(trim(p_login),4),p_payload,'waiting',
 NOT EXISTS(SELECT 1 FROM public.olon_own_accounts WHERE student_id=p_student_id AND status<>'revoked' AND is_primary),v_identity)
 RETURNING id INTO v_id;
 RETURN v_id;
END; $fn$;
REVOKE ALL ON FUNCTION public.olon_own_connect_account(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.olon_own_connect_account(uuid,uuid,text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.olon_own_remove_account(p_account_id uuid,p_student_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_primary boolean; v_status text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('olon_own_account_links',0));
 SELECT is_primary,status INTO v_primary,v_status FROM public.olon_own_accounts
 WHERE id=p_account_id AND student_id=p_student_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF v_status='revoked' THEN RETURN true; END IF;
 UPDATE public.olon_own_accounts SET status='revoked',is_primary=false,
 encrypted_payload='{"revoked":true}'::jsonb,last_error=null,updated_at=now()
 WHERE id=p_account_id AND student_id=p_student_id;
 IF v_primary AND NOT EXISTS(SELECT 1 FROM public.olon_own_accounts WHERE student_id=p_student_id AND status<>'revoked' AND is_primary) THEN
  UPDATE public.olon_own_accounts SET is_primary=true,updated_at=now()
  WHERE id=(SELECT id FROM public.olon_own_accounts WHERE student_id=p_student_id AND status<>'revoked' ORDER BY created_at DESC,id DESC LIMIT 1);
 END IF;
 RETURN true;
END; $fn$;
REVOKE ALL ON FUNCTION public.olon_own_remove_account(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.olon_own_remove_account(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.olon_mt_register_own_vault(p_own_id uuid, p_login text, p_platform text, p_server text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_a public.olon_own_accounts%ROWTYPE;
 v_key bytea;
 v_fingerprint text;
 v_id uuid;
 v_old public.olon_mt_vault_providers%ROWTYPE;
BEGIN
 SELECT * INTO v_a FROM public.olon_own_accounts WHERE id=p_own_id AND status<>'revoked' FOR UPDATE;
 IF NOT FOUND OR v_a.platform<>p_platform OR lower(trim(v_a.broker_server))<>lower(trim(p_server))
    OR p_platform<>'mt5' OR trim(p_login) !~ '^[0-9]{4,20}$' THEN
   RAISE EXCEPTION 'Invalid own connector account identity' USING ERRCODE='22023';
 END IF;
 SELECT secret INTO v_key FROM olon_internal.mt_vault_identity_secret WHERE slot=1;
 IF v_key IS NULL THEN RAISE EXCEPTION 'Account vault identity key is unavailable'; END IF;
 v_fingerprint=encode(extensions.hmac(convert_to(p_platform||'|'||lower(trim(p_server))||'|'||trim(p_login),'UTF8'),v_key,'sha256'),'hex');
 IF v_a.identity_fingerprint IS NOT NULL AND v_a.identity_fingerprint<>v_fingerprint THEN
   RAISE EXCEPTION 'MT5 identity does not match registered account' USING ERRCODE='22023';
 END IF;
 UPDATE public.olon_own_accounts SET identity_fingerprint=v_fingerprint WHERE id=v_a.id;
 INSERT INTO public.olon_mt_vault_accounts(student_id,identity_fingerprint,platform,broker_server,login_masked,active_provider_account_id)
 VALUES(v_a.student_id,v_fingerprint,p_platform,trim(p_server),'••••'||right(trim(p_login),4),v_a.provider_account_id)
 ON CONFLICT(student_id,identity_fingerprint) DO UPDATE
 SET active_provider_account_id=excluded.active_provider_account_id,archived_at=null,
 last_connected_at=now(),login_masked=excluded.login_masked
 RETURNING id INTO v_id;
 SELECT * INTO v_old FROM public.olon_mt_vault_providers WHERE provider_account_id=v_a.provider_account_id;
 IF FOUND AND (v_old.vault_account_id<>v_id OR v_old.student_id<>v_a.student_id) THEN
   RAISE EXCEPTION 'Account identity conflict' USING ERRCODE='23505';
 END IF;
 INSERT INTO public.olon_mt_vault_providers(provider_account_id,vault_account_id,student_id)
 VALUES(v_a.provider_account_id,v_id,v_a.student_id)
 ON CONFLICT(provider_account_id) DO NOTHING;
 UPDATE public.olon_own_accounts SET vault_account_id=v_id,login_masked='••••'||right(trim(p_login),4),updated_at=now()
 WHERE id=v_a.id;
 RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.olon_mt_register_own_vault(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.olon_mt_register_own_vault(uuid,text,text,text) TO service_role;

