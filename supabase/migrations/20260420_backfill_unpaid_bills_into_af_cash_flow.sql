-- Backfill 'Unpaid Bills' point-in-time snapshots into af_cash_flow so the
-- Financials page can chart Unpaid Bills alongside the cash-flow metrics,
-- with full history that respects the Day-of-Month / Month-End toggle.
--
-- Design:
--   - row_type = 'unpaid_bills' (a new row_type, NOT income/expense/noi/etc.
--     so NOI, Total Expense, Cash Flow calculations are unchanged and the
--     detail table's account-breakdown rows stay untouched).
--   - account_name = 'Unpaid Bills' (sentinel; unique per period+property+sync).
--   - One row per (property_name, period_start, synced_at) triple that
--     already exists in af_cash_flow, so every snapshot view picks up an
--     Unpaid Bills row the same way it picks cash-flow rows.
--   - amount = SUM(af_bill_detail.amount)
--             WHERE property matches
--               AND bill_date IS NOT NULL
--               AND bill_date <= synced_at::date
--               AND (paid_date IS NULL OR paid_date > synced_at::date)
--     i.e. bills entered on or before the snapshot that weren't paid yet.
--     For property_name='Total' we sum across all properties (portfolio).
--
-- Caveat: af_bill_detail is overwrite-on-sync (TRUNCATE + INSERT), so
-- historical "as of day X" is reconstructed from today's bill records.
-- Bills added or edited retroactively will shift historical values
-- slightly. Acceptable tradeoff for a point-in-time metric.

INSERT INTO af_cash_flow (
  period_start, period_end, account_name, account_path, account_depth,
  row_type, account_type, account_number, parent_account,
  property_name, amount, synced_at
)
WITH snapshot_points AS (
  SELECT DISTINCT period_start, period_end, property_name, synced_at
  FROM af_cash_flow
  WHERE row_type <> 'unpaid_bills'
)
SELECT
  sp.period_start,
  sp.period_end,
  'Unpaid Bills' AS account_name,
  NULL AS account_path,
  0 AS account_depth,
  'unpaid_bills' AS row_type,
  NULL AS account_type,
  NULL AS account_number,
  NULL AS parent_account,
  sp.property_name,
  COALESCE(
    CASE
      WHEN sp.property_name = 'Total' THEN (
        SELECT SUM(abd.amount)
        FROM af_bill_detail abd
        WHERE abd.bill_date IS NOT NULL
          AND abd.bill_date <= sp.synced_at::date
          AND (abd.paid_date IS NULL OR abd.paid_date > sp.synced_at::date)
      )
      ELSE (
        SELECT SUM(abd.amount)
        FROM af_bill_detail abd
        WHERE abd.property_name = sp.property_name
          AND abd.bill_date IS NOT NULL
          AND abd.bill_date <= sp.synced_at::date
          AND (abd.paid_date IS NULL OR abd.paid_date > sp.synced_at::date)
      )
    END,
    0
  ) AS amount,
  sp.synced_at
FROM snapshot_points sp
ON CONFLICT (period_start, account_name, property_name, synced_at) DO NOTHING;
