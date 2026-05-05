-- Churn metrics aggregator over public.lease_history_unified.
-- Supports month or quarter grain. Returns one row per period with:
--   move_outs, early_moveouts, evictions
--   occupied_at_period_start (count of tenancies overlapping the period start)
--   total_units (current portfolio size — latest rent_roll_snapshots count)
--   churn_rate_pct      = move_outs / occupied_at_period_start
--   eviction_rate_pct   = evictions / total_units
--   median_tenancy_months for tenancies that ended in that period (robust
--                         at small per-period n; preferred over mean)
--   avg_tenancy_months    kept for context but expect monthly volatility

DROP FUNCTION IF EXISTS public.get_churn_metrics_monthly(date, date);
DROP FUNCTION IF EXISTS public.get_churn_metrics(text, date, date);

CREATE OR REPLACE FUNCTION public.get_churn_metrics(
  grain      text DEFAULT 'month',
  start_date date DEFAULT NULL,
  end_date   date DEFAULT NULL
)
RETURNS TABLE (
  period_start              date,
  period_label              text,
  move_outs                 integer,
  early_moveouts            integer,
  evictions                 integer,
  occupied_at_period_start  integer,
  total_units               integer,
  churn_rate_pct            numeric,
  eviction_rate_pct         numeric,
  median_tenancy_months     numeric,
  avg_tenancy_months        numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH params AS (
    SELECT
      CASE WHEN grain = 'quarter' THEN 'quarter' ELSE 'month' END AS g,
      COALESCE(start_date, DATE '2023-08-01') AS lo,
      COALESCE(end_date,   date_trunc('month', CURRENT_DATE)::date) AS hi
  ),
  bounds AS (
    SELECT g, date_trunc(g, lo)::date AS lo, date_trunc(g, hi)::date AS hi FROM params
  ),
  total_units_cte AS (
    SELECT COUNT(DISTINCT property || '|' || unit)::int AS total_units
    FROM public.rent_roll_snapshots
    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM public.rent_roll_snapshots)
  ),
  periods AS (
    SELECT
      generate_series(b.lo, b.hi,
        CASE WHEN b.g = 'quarter' THEN INTERVAL '3 months' ELSE INTERVAL '1 month' END
      )::date AS period_start,
      b.g AS g
    FROM bounds b
  ),
  unified AS MATERIALIZED (
    SELECT move_in, move_out, move_out_reason, is_eviction, tenancy_days
    FROM public.lease_history_unified
  ),
  moveouts_by_period AS (
    SELECT
      date_trunc((SELECT g FROM bounds), move_out)::date AS period_start,
      COUNT(*)::int                                                AS move_outs,
      COUNT(*) FILTER (WHERE move_out_reason = 'early')::int        AS early_moveouts,
      COUNT(*) FILTER (WHERE is_eviction)::int                      AS evictions,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY tenancy_days)
        FILTER (WHERE tenancy_days IS NOT NULL)                     AS median_tenancy_days,
      AVG(tenancy_days) FILTER (WHERE tenancy_days IS NOT NULL)     AS avg_tenancy_days
    FROM unified
    WHERE move_out IS NOT NULL
    GROUP BY 1
  ),
  occupied_at AS (
    SELECT
      p.period_start,
      (SELECT COUNT(*)::int FROM unified u
        WHERE u.move_in IS NOT NULL
          AND u.move_in <= p.period_start
          AND (u.move_out IS NULL OR u.move_out >= p.period_start)
      ) AS occupied
    FROM periods p
  )
  SELECT
    p.period_start,
    CASE WHEN p.g = 'quarter'
         THEN to_char(p.period_start, '"Q"Q YYYY')
         ELSE to_char(p.period_start, 'Mon YYYY') END                   AS period_label,
    COALESCE(mb.move_outs, 0),
    COALESCE(mb.early_moveouts, 0),
    COALESCE(mb.evictions, 0),
    o.occupied,
    tu.total_units,
    CASE WHEN o.occupied > 0
         THEN ROUND(100.0 * COALESCE(mb.move_outs,0)::numeric / o.occupied, 2) END,
    CASE WHEN tu.total_units > 0
         THEN ROUND(100.0 * COALESCE(mb.evictions,0)::numeric / tu.total_units, 2) END,
    CASE WHEN mb.median_tenancy_days IS NOT NULL
         THEN ROUND((mb.median_tenancy_days / 30.44)::numeric, 1) END,
    CASE WHEN mb.avg_tenancy_days IS NOT NULL
         THEN ROUND((mb.avg_tenancy_days / 30.44)::numeric, 1) END
  FROM periods p
  CROSS JOIN total_units_cte tu
  LEFT JOIN moveouts_by_period mb ON mb.period_start = p.period_start
  LEFT JOIN occupied_at        o  ON o.period_start  = p.period_start
  ORDER BY p.period_start;
$$;

COMMENT ON FUNCTION public.get_churn_metrics(text, date, date) IS
  'Churn metrics from lease_history_unified at month or quarter grain.';
