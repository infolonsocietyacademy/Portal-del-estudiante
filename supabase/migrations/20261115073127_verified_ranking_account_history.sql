-- Ranking participation is server-controlled, separate from login and name privacy.
CREATE TABLE private.olon_ranking_exclusions (
  student_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.olon_ranking_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.olon_ranking_exclusions FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE private.olon_ranking_exclusions IS
  'Owner-managed test accounts excluded from every ranking; account access and financial history remain intact.';

-- One calculation serves the podium, private historical rank and admin results.
CREATE OR REPLACE FUNCTION private.olon_mt_rank_performance(p_period_type text, p_period_key text)
RETURNS TABLE(student_id uuid, deposited numeric, net numeric, trade_count bigint, return_pct numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  WITH sources AS (
    SELECT a.student_id, a.provider_account_id,
      coalesce(a.vault_account_id, st.vault_account_id) AS vault_account_id,
      coalesce((to_jsonb(st)->>'source_version')::integer, 1) AS source_version,
      1 AS priority, st.last_success_at
    FROM public.olon_own_accounts a
    JOIN public.olon_mt_sync_state st ON st.provider_account_id=a.provider_account_id
      AND st.student_id=a.student_id AND st.backfill_done IS TRUE
      AND st.last_success_at IS NOT NULL
    WHERE a.status='active' AND a.last_sync_at IS NOT NULL
    UNION ALL
    SELECT a.student_id, a.provider_account_id, st.vault_account_id,
      coalesce((to_jsonb(st)->>'source_version')::integer, 1),
      2, st.last_success_at
    FROM public.olon_metaapi_accounts a
    JOIN public.olon_mt_sync_state st ON st.provider_account_id=a.provider_account_id
      AND st.student_id=a.student_id AND st.backfill_done IS TRUE
      AND st.last_success_at IS NOT NULL
    WHERE upper(coalesce(a.connection_status,''))='CONNECTED'
      AND upper(coalesce(a.provider_state,''))='DEPLOYED'
  ), preferred AS (
    SELECT s.*, row_number() OVER (
      PARTITION BY s.student_id, s.vault_account_id,
        CASE WHEN s.vault_account_id IS NULL THEN s.provider_account_id END
      ORDER BY s.priority, s.last_success_at DESC, s.provider_account_id
    ) AS source_position
    FROM sources s
  ), deals AS (
    SELECT d.*,
      coalesce(nullif(d.broker_time,'')::timestamp, d.occurred_at AT TIME ZONE 'UTC') AS business_time
    FROM public.olon_mt_deals d
    WHERE EXISTS (
      SELECT 1 FROM preferred c
      WHERE c.source_position=1 AND c.student_id=d.student_id
        AND CASE
          -- A reconciled native snapshot supersedes the provider archives.
          WHEN c.source_version>=2 THEN d.provider_account_id=c.provider_account_id
          -- Earlier imports share unique vault/ticket keys across providers.
          WHEN c.vault_account_id IS NOT NULL THEN d.vault_account_id=c.vault_account_id
          ELSE d.provider_account_id=c.provider_account_id
        END
    )
  ), period_deals AS (
    SELECT d.*,
      (p_period_type='all'
        OR (p_period_type='weekly' AND to_char(d.business_time,'IYYY-"W"IW')=p_period_key)
        OR (p_period_type='monthly' AND to_char(d.business_time,'YYYY-MM')=p_period_key)
        OR (p_period_type='annual' AND to_char(d.business_time,'YYYY')=p_period_key)) AS in_period
    FROM deals d
  ), sums AS (
    SELECT p.id AS sid,
      coalesce(sum(d.profit) FILTER (WHERE d.deal_type='DEAL_TYPE_BALANCE' AND d.profit>0),0)::numeric AS capital,
      coalesce(sum(d.profit+d.commission+d.swap+d.fee) FILTER (
        WHERE d.deal_type IN ('DEAL_TYPE_BUY','DEAL_TYPE_SELL') AND d.in_period
      ),0)::numeric AS pnl,
      count(d.id) FILTER (WHERE d.deal_type IN ('DEAL_TYPE_BUY','DEAL_TYPE_SELL')
        AND d.entry_type IN ('DEAL_ENTRY_OUT','DEAL_ENTRY_OUT_BY','DEAL_ENTRY_INOUT')
        AND d.in_period)::bigint AS operations
    FROM public.profiles p
    LEFT JOIN period_deals d ON d.student_id=p.id
    WHERE p.role='student'
    GROUP BY p.id
  )
  SELECT s.sid, s.capital, s.pnl, s.operations,
    CASE WHEN s.capital>0 AND s.operations>0
      AND p.status IN ('active','approved')
      AND (p.next_payment_date IS NULL OR p.next_payment_date>(now() AT TIME ZONE 'America/Puerto_Rico')::date)
      AND NOT EXISTS (SELECT 1 FROM private.olon_ranking_exclusions x WHERE x.student_id=s.sid)
    THEN round(s.pnl*100/s.capital,2) ELSE NULL::numeric END
  FROM sums s JOIN public.profiles p ON p.id=s.sid;
$function$;
REVOKE ALL ON FUNCTION private.olon_mt_rank_performance(text,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.olon_compute_automatic_top3(p_period_type text, p_period_key text)
RETURNS TABLE(rank integer, student_id uuid, display_name text, return_pct numeric, photo_consent_confirmed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  WITH ranked AS (
    SELECT f.student_id, p.full_name, coalesce(o.show_name,true) AS name_ok, f.return_pct,
      row_number() OVER (ORDER BY f.return_pct DESC, f.net DESC, f.student_id) AS pos
    FROM private.olon_mt_rank_performance(p_period_type,p_period_key) f
    JOIN public.profiles p ON p.id=f.student_id
    LEFT JOIN public.olon_ranking_name_preferences o ON o.student_id=f.student_id
    WHERE f.return_pct IS NOT NULL
  )
  SELECT r.pos::integer,
    CASE WHEN r.name_ok OR (SELECT private.is_olon_admin()) THEN r.student_id ELSE NULL::uuid END,
    CASE WHEN r.name_ok OR (SELECT private.is_olon_admin())
      THEN coalesce(nullif(btrim(r.full_name),''),'Trader OLON')
      ELSE 'Trader OLON #'||r.pos::text END,
    r.return_pct, false
  FROM ranked r
  WHERE r.pos<=3 AND (SELECT auth.uid()) IS NOT NULL
    AND ((SELECT private.olon_is_active_member()) OR (SELECT private.is_olon_admin()))
  ORDER BY r.pos;
$function$;

CREATE OR REPLACE FUNCTION public.olon_admin_student_performance(p_period_type text DEFAULT 'all', p_period_key text DEFAULT NULL)
RETURNS TABLE(student_id uuid, deposited numeric, net numeric, trade_count bigint, return_pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (SELECT private.is_olon_admin()) THEN
    RAISE EXCEPTION 'Only an active administrator may view student performance' USING errcode='42501';
  END IF;
  IF p_period_type IS NULL OR p_period_type NOT IN ('all','weekly','monthly','annual') OR
    (p_period_type='weekly' AND coalesce(p_period_key,'') !~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$') OR
    (p_period_type='monthly' AND coalesce(p_period_key,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') OR
    (p_period_type='annual' AND coalesce(p_period_key,'') !~ '^[0-9]{4}$') THEN
    RAISE EXCEPTION 'Invalid student performance period' USING errcode='22023';
  END IF;
  RETURN QUERY SELECT f.student_id,f.deposited,f.net,f.trade_count,f.return_pct
    FROM private.olon_mt_rank_performance(p_period_type,p_period_key) f;
END;
$function$;

CREATE OR REPLACE FUNCTION public.olon_student_rank()
RETURNS TABLE(rank_position bigint, measured_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE viewer uuid := (SELECT auth.uid());
BEGIN
  IF viewer IS NULL OR NOT ((SELECT private.olon_is_active_member()) OR (SELECT private.is_olon_admin())) THEN
    RAISE EXCEPTION 'Not authorized' USING errcode='42501';
  END IF;
  RETURN QUERY
  WITH scores AS (
    SELECT f.student_id, row_number() OVER (ORDER BY f.return_pct DESC,f.net DESC,f.student_id) AS pos
    FROM private.olon_mt_rank_performance('all',NULL) f
    WHERE f.return_pct IS NOT NULL
  )
  SELECT (SELECT s.pos FROM scores s WHERE s.student_id=viewer), (SELECT count(*) FROM scores);
END;
$function$;

-- Preserve the protected public API and the private implementation's existing access.
REVOKE ALL ON FUNCTION private.olon_compute_automatic_top3(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.olon_compute_automatic_top3(text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.olon_student_rank() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.olon_admin_student_performance(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.olon_student_rank() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.olon_admin_student_performance(text,text) TO authenticated, service_role;
