BEGIN;
DO $test$
DECLARE s uuid; other_student uuid; agent uuid; a uuid; b uuid; c uuid; n bigint; saved bigint;
BEGIN
 SELECT p.id INTO s FROM public.profiles p WHERE p.status='active'
 AND (SELECT count(*) FROM public.olon_own_accounts x WHERE x.student_id=p.id AND x.status<>'revoked')<7 ORDER BY p.id LIMIT 1;
 SELECT id INTO other_student FROM public.profiles WHERE status='active' AND id<>s LIMIT 1;
 SELECT id INTO agent FROM public.olon_own_agents WHERE status='paired' LIMIT 1;
 IF s IS NULL OR other_student IS NULL OR agent IS NULL THEN RAISE EXCEPTION 'Missing lifecycle test prerequisites'; END IF;
 SELECT count(*) INTO saved FROM public.olon_mt_deals;
 a=public.olon_own_connect_account(s,agent,'OLFX-LIFECYCLE-TEST','99202611190000004812','{"test":true}');
 BEGIN
  PERFORM public.olon_own_connect_account(other_student,agent,' olfx-lifecycle-test ','99202611190000004812','{"test":true}');
  RAISE EXCEPTION 'Duplicate registration was allowed';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 b=public.olon_own_connect_account(s,agent,'OLFX-LIFECYCLE-TEST','88202611190000004812','{"test":true}');
 IF a=b THEN RAISE EXCEPTION 'Equal suffix identities were merged'; END IF;
 IF public.olon_own_remove_account(a,other_student) THEN RAISE EXCEPTION 'Wrong owner removed account'; END IF;
 -- Make the test link principal, then verify atomic replacement after deletion.
 UPDATE public.olon_own_accounts SET is_primary=false WHERE student_id=s AND status<>'revoked';
 UPDATE public.olon_own_accounts SET is_primary=true WHERE id=a;
 IF NOT public.olon_own_remove_account(a,s) THEN RAISE EXCEPTION 'Removal failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.olon_own_accounts WHERE id=a AND status='revoked' AND NOT is_primary AND encrypted_payload='{"revoked":true}'::jsonb) THEN RAISE EXCEPTION 'Credentials not cleared'; END IF;
 SELECT count(*) INTO n FROM public.olon_own_accounts WHERE student_id=s AND status<>'revoked' AND is_primary;
 IF n<>1 THEN RAISE EXCEPTION 'Primary account not reassigned'; END IF;
 c=public.olon_own_connect_account(s,agent,'OLFX-LIFECYCLE-TEST','99202611190000004812','{"test":true}');
 IF c=a OR NOT EXISTS(SELECT 1 FROM public.olon_own_accounts WHERE id=c AND status='waiting') THEN RAISE EXCEPTION 'Reconnect was not queued'; END IF;
 IF (SELECT count(*) FROM public.olon_mt_deals)<>saved THEN RAISE EXCEPTION 'History changed'; END IF;
 IF has_function_privilege('anon','public.olon_own_remove_account(uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.olon_own_connect_account(uuid,uuid,text,text,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'Public role can call privileged account mutations'; END IF;
END; $test$;
SELECT 'MT5 lifecycle passed: duplicate, same suffix, ownership, removal, primary, reconnect, history and permissions' AS result;
ROLLBACK;
