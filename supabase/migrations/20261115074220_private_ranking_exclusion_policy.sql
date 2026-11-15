-- Only the table owner configures participation. Keep client access denied
-- even if a future broad grant or permissive policy is introduced.
CREATE POLICY olon_ranking_exclusions_no_client_access
ON private.olon_ranking_exclusions AS RESTRICTIVE
FOR ALL TO anon, authenticated
USING (false) WITH CHECK (false);
