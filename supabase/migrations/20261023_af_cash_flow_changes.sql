-- Financials stopped loading: every daily cash-flow sync appends the whole
-- report to af_cash_flow (~3,500 rows), so the table reached ~496K rows for
-- 3,527 distinct lines. The snapshot views DISTINCT ON over all of it, took
-- ~8.6s per page and hit the authenticated statement timeout.
--
-- af_cash_flow_changes keeps only the rows that differ from the previous
-- snapshot of the same line (~27K). "Latest snapshot on or before date D"
-- gives the same values from either table, so the views now read from this
-- one. af_cash_flow itself is untouched and stays the raw history.

CREATE TABLE IF NOT EXISTS public.af_cash_flow_changes (LIKE public.af_cash_flow INCLUDING DEFAULTS);
ALTER TABLE public.af_cash_flow_changes ADD PRIMARY KEY (id);

INSERT INTO public.af_cash_flow_changes
SELECT id, period_start, period_end, account_name, account_path, account_depth, row_type,
       property_name, amount, synced_at, account_type, account_number, parent_account
FROM (
  SELECT f.*,
    ROW(f.amount, f.row_type, f.account_type, f.account_path, f.account_depth, f.parent_account, f.period_end)
      IS DISTINCT FROM
    lag(ROW(f.amount, f.row_type, f.account_type, f.account_path, f.account_depth, f.parent_account, f.period_end))
      OVER (PARTITION BY f.property_name, f.account_number, f.account_name, f.period_start ORDER BY f.synced_at) AS changed
  FROM public.af_cash_flow f
) x
WHERE changed
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_cfc_latest_by_number
  ON public.af_cash_flow_changes (property_name, account_number, account_name, period_start, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_cfc_latest_by_name
  ON public.af_cash_flow_changes (property_name, account_name, period_start, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_cfc_period ON public.af_cash_flow_changes (period_start);

ALTER TABLE public.af_cash_flow_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated read" ON public.af_cash_flow_changes;
CREATE POLICY "Allow authenticated read" ON public.af_cash_flow_changes FOR SELECT TO authenticated USING (true);

-- Keep it current. A new row is recorded only when it differs from the most
-- recent earlier snapshot of the same line. Comparing against the snapshot
-- just before NEW.synced_at (not the newest overall) keeps out-of-order
-- backfills correct.
CREATE OR REPLACE FUNCTION public.af_cash_flow_record_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE prev public.af_cash_flow_changes%ROWTYPE;
BEGIN
  SELECT * INTO prev FROM public.af_cash_flow_changes c
  WHERE c.property_name IS NOT DISTINCT FROM NEW.property_name
    AND c.account_number IS NOT DISTINCT FROM NEW.account_number
    AND c.account_name IS NOT DISTINCT FROM NEW.account_name
    AND c.period_start = NEW.period_start
    AND c.synced_at < NEW.synced_at
  ORDER BY c.synced_at DESC
  LIMIT 1;

  IF NOT FOUND OR
     ROW(prev.amount, prev.row_type, prev.account_type, prev.account_path, prev.account_depth, prev.parent_account, prev.period_end)
       IS DISTINCT FROM
     ROW(NEW.amount, NEW.row_type, NEW.account_type, NEW.account_path, NEW.account_depth, NEW.parent_account, NEW.period_end)
  THEN
    INSERT INTO public.af_cash_flow_changes
      (id, period_start, period_end, account_name, account_path, account_depth, row_type,
       property_name, amount, synced_at, account_type, account_number, parent_account)
    VALUES
      (NEW.id, NEW.period_start, NEW.period_end, NEW.account_name, NEW.account_path, NEW.account_depth, NEW.row_type,
       NEW.property_name, NEW.amount, NEW.synced_at, NEW.account_type, NEW.account_number, NEW.parent_account)
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.af_cash_flow_record_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_af_cash_flow_record_change ON public.af_cash_flow;
CREATE TRIGGER trg_af_cash_flow_record_change
  AFTER INSERT ON public.af_cash_flow
  FOR EACH ROW EXECUTE FUNCTION public.af_cash_flow_record_change();

-- Same definitions as before, reading the compact table.
CREATE OR REPLACE VIEW public.af_cash_flow_latest WITH (security_invoker = true) AS
SELECT DISTINCT ON (property_name, account_number, account_name, period_start)
  id, period_start, period_end, account_name, account_path, account_depth, row_type,
  property_name, amount, synced_at, account_type, account_number, parent_account
FROM public.af_cash_flow_changes
ORDER BY property_name, account_number, account_name, period_start, synced_at DESC;

CREATE OR REPLACE VIEW public.af_cash_flow_day_of_month WITH (security_invoker = true) AS
SELECT DISTINCT ON (property_name, account_name, period_start)
  id, period_start, period_end, account_name, account_path, account_depth, row_type,
  property_name, amount, synced_at, account_type, account_number, parent_account
FROM public.af_cash_flow_changes
WHERE synced_at::date <= LEAST(
  (period_start + (((EXTRACT(day FROM CURRENT_DATE))::integer - 1) || ' days')::interval)::date,
  period_end, CURRENT_DATE)
ORDER BY property_name, account_name, period_start, synced_at DESC;

CREATE OR REPLACE VIEW public.af_cash_flow_month_end WITH (security_invoker = true) AS
SELECT DISTINCT ON (property_name, account_name, period_start)
  id, period_start, period_end, account_name, account_path, account_depth, row_type,
  property_name, amount, synced_at, account_type, account_number, parent_account
FROM public.af_cash_flow_changes
WHERE synced_at::date <= LEAST(period_end, CURRENT_DATE)
ORDER BY property_name, account_name, period_start, synced_at DESC;
