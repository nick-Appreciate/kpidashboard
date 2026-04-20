-- Two snapshot-mode views over af_cash_flow for the Financials page toggle:
--
--   af_cash_flow_day_of_month
--     For each (property, account, period_start), return the snapshot whose
--     synced_at::date <= min(period_start + (today_day_of_month - 1) days,
--                           period_end, CURRENT_DATE).
--     Answers "where were we on day N of each month?" where N = today's
--     day. Useful for apples-to-apples MTD comparisons across months.
--
--   af_cash_flow_month_end
--     For each (property, account, period_start), return the snapshot whose
--     synced_at::date <= least(period_end, CURRENT_DATE).
--     Past months → final day-of-month snapshot (pre-reconciliation).
--     Current month → most recent snapshot.
--
-- Both use security_invoker = on so RLS on the underlying af_cash_flow
-- applies.

CREATE OR REPLACE VIEW af_cash_flow_day_of_month
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
WHERE synced_at::date <= LEAST(
  (period_start + ((EXTRACT(DAY FROM CURRENT_DATE)::int - 1) || ' days')::interval)::date,
  period_end,
  CURRENT_DATE
)
ORDER BY property_name, account_name, period_start, synced_at DESC;

GRANT SELECT ON af_cash_flow_day_of_month TO authenticated;


CREATE OR REPLACE VIEW af_cash_flow_month_end
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
WHERE synced_at::date <= LEAST(period_end, CURRENT_DATE)
ORDER BY property_name, account_name, period_start, synced_at DESC;

GRANT SELECT ON af_cash_flow_month_end TO authenticated;
