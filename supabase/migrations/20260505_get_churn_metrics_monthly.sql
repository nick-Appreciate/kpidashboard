-- Churn metrics aggregator over public.lease_history_unified.
-- Supports month or quarter grain. Returns one row per period with:
--   move_outs, early_moveouts, evictions  (DISTINCT (property, unit))
--   occupied_at_period_start              (DISTINCT (property, unit))
--   total_units                            current portfolio (latest snapshot)
--   churn_rate_pct                  = move_outs / occupied_at_period_start
--   eviction_rate_pct               = evictions / total_units
--   median_tenancy_at_exit_months   median tenancy of completed tenancies,
--                                   clamped to acquisition_date (ownership-tenure)
--   mean_tenancy_at_exit_months     mean tenancy clamped to acquisition_date
--   mean_tenancy_at_exit_raw_months mean tenancy IGNORING acquisition_date
--                                   — true full-history lease length, can be
--                                   much higher when long-tenured inherited
--                                   tenants leave
--   mean_tenancy_existing_months    mean tenancy of still-occupying tenants
--
-- Filters:
--   property_filter — list of property_name to include (NULL = all).
--   cutoff_dates    — JSONB { property: 'YYYY-MM-DD' } for properties that
--                     leave the filter on a specific date.

DROP FUNCTION IF EXISTS public.get_churn_metrics_monthly(date, date);
DROP FUNCTION IF EXISTS public.get_churn_metrics(text, date, date);
DROP FUNCTION IF EXISTS public.get_churn_metrics(text, date, date, text[]);
DROP FUNCTION IF EXISTS public.get_churn_metrics(text, date, date, text[], jsonb);

CREATE OR REPLACE FUNCTION public.get_churn_metrics(
  grain           text   DEFAULT 'month',
  start_date      date   DEFAULT NULL,
  end_date        date   DEFAULT NULL,
  property_filter text[] DEFAULT NULL,
  cutoff_dates    jsonb  DEFAULT NULL
)
RETURNS TABLE (
  period_start                       date,
  period_label                       text,
  move_outs                          integer,
  early_moveouts                     integer,
  evictions                          integer,
  occupied_at_period_start           integer,
  total_units                        integer,
  churn_rate_pct                     numeric,
  eviction_rate_pct                  numeric,
  median_tenancy_at_exit_months      numeric,
  mean_tenancy_at_exit_months        numeric,
  mean_tenancy_at_exit_raw_months    numeric,
  mean_tenancy_existing_months       numeric
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
      AND (property_filter IS NULL OR cardinality(property_filter) = 0
           OR property = ANY(property_filter))
      AND (cutoff_dates IS NULL
           OR NOT (cutoff_dates ? property)
           OR (cutoff_dates ->> property)::date >= CURRENT_DATE)
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
    SELECT property_name, unit_name,
           move_in, move_in_raw, move_out, move_out_reason, is_eviction,
           tenancy_days,
           CASE WHEN move_in_raw IS NOT NULL AND move_out IS NOT NULL
                 AND move_out >= move_in_raw
                THEN (move_out - move_in_raw)
                ELSE NULL END AS tenancy_days_raw,
           CASE WHEN cutoff_dates IS NOT NULL AND cutoff_dates ? property_name
                THEN (cutoff_dates ->> property_name)::date
                ELSE NULL END AS cutoff_date
    FROM public.lease_history_unified
    WHERE property_filter IS NULL
       OR cardinality(property_filter) = 0
       OR property_name = ANY(property_filter)
  ),
  moveouts_by_period AS (
    SELECT
      date_trunc((SELECT g FROM bounds), move_out)::date AS period_start,
      COUNT(DISTINCT property_name || '|' || unit_name)::int                AS move_outs,
      COUNT(DISTINCT CASE WHEN move_out_reason = 'early'
                          THEN property_name || '|' || unit_name END)::int  AS early_moveouts,
      COUNT(DISTINCT CASE WHEN is_eviction
                          THEN property_name || '|' || unit_name END)::int  AS evictions,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY tenancy_days)
        FILTER (WHERE tenancy_days IS NOT NULL)                              AS median_tenancy_days,
      AVG(tenancy_days) FILTER (WHERE tenancy_days IS NOT NULL)              AS avg_exit_tenancy_days,
      AVG(tenancy_days_raw) FILTER (WHERE tenancy_days_raw IS NOT NULL)      AS avg_exit_tenancy_days_raw
    FROM unified
    WHERE move_out IS NOT NULL
      AND (cutoff_date IS NULL OR move_out <= cutoff_date)
    GROUP BY 1
  ),
  occupied_at AS (
    SELECT
      p.period_start,
      (SELECT COUNT(DISTINCT u.property_name || '|' || u.unit_name)::int FROM unified u
        WHERE u.move_in IS NOT NULL
          AND u.move_in <= p.period_start
          AND (u.move_out IS NULL OR u.move_out >= p.period_start)
          AND (u.cutoff_date IS NULL OR u.cutoff_date > p.period_start)
      ) AS occupied,
      (SELECT AVG(p.period_start - u.move_in)
       FROM (
         SELECT DISTINCT ON (u.property_name, u.unit_name) u.move_in
         FROM unified u
         WHERE u.move_in IS NOT NULL
           AND u.move_in <= p.period_start
           AND (u.move_out IS NULL OR u.move_out >= p.period_start)
           AND (u.cutoff_date IS NULL OR u.cutoff_date > p.period_start)
         ORDER BY u.property_name, u.unit_name, u.move_in DESC
       ) u
      ) AS avg_existing_tenancy_days
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
    CASE WHEN mb.avg_exit_tenancy_days IS NOT NULL
         THEN ROUND((mb.avg_exit_tenancy_days / 30.44)::numeric, 1) END,
    CASE WHEN mb.avg_exit_tenancy_days_raw IS NOT NULL
         THEN ROUND((mb.avg_exit_tenancy_days_raw / 30.44)::numeric, 1) END,
    CASE WHEN o.avg_existing_tenancy_days IS NOT NULL
         THEN ROUND((o.avg_existing_tenancy_days / 30.44)::numeric, 1) END
  FROM periods p
  CROSS JOIN total_units_cte tu
  LEFT JOIN moveouts_by_period mb ON mb.period_start = p.period_start
  LEFT JOIN occupied_at        o  ON o.period_start  = p.period_start
  ORDER BY p.period_start;
$$;
