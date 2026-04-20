-- Speed up "unpaid as of date X" lookups used by the Unpaid Bills metric on
-- the Financials page. The query pattern is:
--   SELECT SUM(amount) FROM af_bill_detail
--   WHERE property_name = ? AND bill_date <= ? AND (paid_date IS NULL OR paid_date > ?)
CREATE INDEX IF NOT EXISTS idx_bill_detail_unpaid_lookup
  ON af_bill_detail (property_name, bill_date, paid_date);
