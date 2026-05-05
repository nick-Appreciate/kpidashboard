-- Monthly churn metrics, fed from public.lease_history_unified.
-- Returns one row per month with:
--   move_outs, early_moveouts, evictions
--   occupied_at_month_start (count of tenancies overlapping the month start)
--   churn_rate_pct  = move_outs / occupied_at_month_start
--   fail_rate_pct   = (early + evictions) / move_outs
--   avg_tenancy_months for tenancies that ended in that month
-- The view is pulled into a MATERIALIZED CTE so the heavy work runs once
-- per call instead of once per month.

CREATE OR REPLACE FUNCTION public.get_churn_metrics_monthly(
  start_date date DEFAULT NULL,
  end_date   date DEFAULT NULL
)
RETURNS TABLE (
  month                   date,
  move_outs               integer,
  early_moveouts          integer,
  evictions               integer,
  occupied_at_month_start integer,
  churn_rate_pct          numeric,
  fail_rate_pct           numeric,
  avg_tenancy_months      numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT
      COALESCE(start_date, DATE '2023-08-01') AS lo,
      COALESCE(end_date,   date_trunc('month', CURRENT_DATE)::date) AS hi
  ),
  months AS (
    SELECT generate_series(b.lo, b.hi, INTERVAL '1 month')::date AS month FROM bounds b
  ),
  unified AS MATERIALIZED (
    SELECT move_in, move_out, move_out_reason, is_eviction, tenancy_days
    FROM public.lease_history_unified
  ),
  moveouts_by_month AS (
    SELECT
      date_trunc('month', move_out)::date AS month,
      COUNT(*)::int                                                AS move_outs,
      COUNT(*) FILTER (WHERE move_out_reason = 'early')::int        AS early_moveouts,
      COUNT(*) FILTER (WHERE is_eviction)::int                      AS evictions,
      AVG(tenancy_days) FILTER (WHERE tenancy_days IS NOT NULL)     AS avg_tenancy_days
    FROM unified
    WHERE move_out IS NOT NULL
    GROUP BY 1
  ),
  occupied_at AS (
    SELECT
      m.month,
      (SELECT COUNT(*)::int FROM unified u
        WHERE u.move_in IS NOT NULL
          AND u.move_in <= m.month
          AND (u.move_out IS NULL OR u.move_out >= m.month)
      ) AS occupied
    FROM months m
  )
  SELECT
    m.month,
    COALESCE(mb.move_outs, 0),
    COALESCE(mb.early_moveouts, 0),
    COALESCE(mb.evictions, 0),
    o.occupied,
    CASE WHEN o.occupied > 0
         THEN ROUND(100.0 * COALESCE(mb.move_outs,0)::numeric / o.occupied, 2) END,
    CASE WHEN COALESCE(mb.move_outs,0) > 0
         THEN ROUND(100.0 * (COALESCE(mb.early_moveouts,0) + COALESCE(mb.evictions,0))::numeric / mb.move_outs, 2) END,
    CASE WHEN mb.avg_tenancy_days IS NOT NULL
         THEN ROUND((mb.avg_tenancy_days / 30.44)::numeric, 1) END
  FROM months m
  LEFT JOIN moveouts_by_month mb ON mb.month = m.month
  LEFT JOIN occupied_at      o  ON o.month  = m.month
  ORDER BY m.month;
$$;

COMMENT ON FUNCTION public.get_churn_metrics_monthly(date, date) IS
  'Returns monthly churn metrics from lease_history_unified.';
