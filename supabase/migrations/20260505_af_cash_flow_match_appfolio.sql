-- Two fixes to make the Financials dashboard's default match what an
-- AppFolio cash-flow export shows for any given period.
--
-- 1. af_cash_flow_latest was picking the latest snapshot per (property,
--    account, period) independently. When a sync omitted a row that an
--    earlier sync had (e.g., AppFolio reclassified a bill), the stale
--    detail row stuck around as "latest" while the recomputed summary
--    rows reflected the new state. Result: detail rows didn't sum to the
--    summary row. New view returns rows from a single coherent sync run
--    by filtering to within 5 minutes of each period's most recent
--    synced_at.
--
-- 2. af_cash_flow_auto was using month_end for past months and latest
--    only for the current month. AppFolio's "Last Month" report uses the
--    most recent posting state regardless, so to match it we always read
--    latest. Auto is now just an alias for latest.
--
-- Default for the Financials API is 'auto', so this single change makes
-- the dashboard match AppFolio out of the box for every period.

CREATE OR REPLACE VIEW af_cash_flow_latest
WITH (security_invoker = on) AS
WITH latest_sync_per_period AS (
  SELECT period_start, MAX(synced_at) AS latest_synced_at
  FROM af_cash_flow
  GROUP BY period_start
)
SELECT
  cf.id,
  cf.period_start,
  cf.period_end,
  cf.account_name,
  cf.account_path,
  cf.account_depth,
  cf.row_type,
  cf.property_name,
  cf.amount,
  cf.synced_at,
  cf.account_type,
  cf.account_number,
  cf.parent_account
FROM af_cash_flow cf
JOIN latest_sync_per_period lp
  ON cf.period_start = lp.period_start
  AND cf.synced_at >= lp.latest_synced_at - INTERVAL '5 minutes';

COMMENT ON VIEW af_cash_flow_latest IS
  'Per-period coherent latest-sync view. All rows whose synced_at is within 5 minutes of the period''s most recent synced_at — captures one full sync run, never mixing detail rows from one sync with summary rows from another.';

CREATE OR REPLACE VIEW af_cash_flow_auto
WITH (security_invoker = on) AS
SELECT * FROM af_cash_flow_latest;

COMMENT ON VIEW af_cash_flow_auto IS
  'Alias for af_cash_flow_latest. Default mode for the Financials dashboard. Matches what an AppFolio cash-flow export shows for any given period.';
