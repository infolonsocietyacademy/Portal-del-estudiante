-- Only profitable traders qualify for weekly, monthly and annual podiums.
-- Filter before numbering; financial reporting keeps every result.
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
    WHERE f.return_pct > 0 AND f.net > 0
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
