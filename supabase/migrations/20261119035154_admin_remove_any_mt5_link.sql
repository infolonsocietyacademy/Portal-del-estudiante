ALTER TABLE public.olon_own_accounts ADD COLUMN admin_deleted_at timestamptz;
-- Preserve verified history while removing a link from the administration directory.
CREATE OR REPLACE FUNCTION public.olon_own_delete_account(p_account_id uuid,p_student_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NOT public.olon_own_remove_account(p_account_id,p_student_id) THEN RETURN false; END IF;
 UPDATE public.olon_own_accounts SET admin_deleted_at=coalesce(admin_deleted_at,now()),updated_at=now()
 WHERE id=p_account_id AND student_id=p_student_id;
 RETURN true;
END; $fn$;
REVOKE ALL ON FUNCTION public.olon_own_delete_account(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.olon_own_delete_account(uuid,uuid) TO service_role;

