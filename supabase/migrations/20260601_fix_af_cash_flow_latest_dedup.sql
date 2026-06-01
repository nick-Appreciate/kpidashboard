-- Bug: the previous af_cash_flow_latest used a "rows synced within 5 minutes
-- of the latest synced_at per period" heuristic. When the daily sync runs
-- multiple times within 5 minutes (e.g. 05:01:01 and 05:01:06 on Jun 1),
-- BOTH batches passed through and every row's amount got summed twice.
-- May 2026 Owner Distribution showed $50,000 instead of the actual $25,000.
--
-- Correct dedup: DISTINCT ON the natural grain (property × account × period),
-- keeping the row with the latest synced_at. One row per unique slice.
--
-- This also fixes af_cash_flow_auto, which is just a passthrough of
-- af_cash_flow_latest.
CREATE OR REPLACE VIEW public.af_cash_flow_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (property_name, account_number, account_name, period_start)
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
ORDER BY property_name, account_number, account_name, period_start, synced_at DESC;
