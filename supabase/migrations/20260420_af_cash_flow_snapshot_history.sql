-- Convert af_cash_flow from overwrite-on-sync to append-only snapshot history.
-- Every sync now adds a new set of rows keyed by synced_at, so we can answer
-- "what did month X look like on day Y" going forward.
--
-- The UI reads through a new view af_cash_flow_latest that returns only the
-- most recent snapshot per (property, account, period_start) so current
-- behavior is unchanged until we build new UI that uses the history.

-- 1. Drop the old unique constraint that prevented multiple snapshots per month.
ALTER TABLE af_cash_flow
  DROP CONSTRAINT IF EXISTS af_cash_flow_period_start_account_name_property_name_key;

-- 2. Add a new unique constraint that includes synced_at so inserts within a
-- single sync can't collide, but subsequent syncs append cleanly.
ALTER TABLE af_cash_flow
  ADD CONSTRAINT af_cash_flow_snapshot_unique
  UNIQUE (period_start, account_name, property_name, synced_at);

-- 3. Index to make the DISTINCT ON "latest per month" lookup fast.
CREATE INDEX IF NOT EXISTS idx_cf_latest_snapshot
  ON af_cash_flow (property_name, account_name, period_start, synced_at DESC);

-- 4. View that returns only the latest snapshot per (property, account, month).
-- security_invoker = on makes the view respect the caller's RLS on
-- af_cash_flow (authenticated-can-select) rather than running as the owner.
CREATE OR REPLACE VIEW af_cash_flow_latest
WITH (security_invoker = on) AS
SELECT DISTINCT ON (property_name, account_name, period_start)
  id,
  period_start,
  period_end,
  account_name,
  account_path,
  account_depth,
  row_type,
  property_name,
  amount,
  synced_at,
  account_type,
  account_number,
  parent_account
FROM af_cash_flow
ORDER BY property_name, account_name, period_start, synced_at DESC;

GRANT SELECT ON af_cash_flow_latest TO authenticated;
