-- Static per-property monthly debt service + insurance premiums.
-- Sourced from "Cash Balance (4).xls" → 'Elate Insurance Summary' and
-- 'Elate Loans Summary' tabs (kept by Mike Farquhar).
--
-- These costs are paid OUTSIDE AppFolio (from holding-company / personal
-- accounts), so AppFolio's owner-distribution number on its own
-- over-states what the owner actually netted from each property. The
-- Financials "Owner Net Income" chart joins distributions out of
-- af_cash_flow with this lookup to compute true net to owner.
CREATE TABLE IF NOT EXISTS public.property_debt_insurance (
  property_name      text PRIMARY KEY,
  holding_company    text,
  spreadsheet_name   text,
  monthly_insurance  numeric(12,2),
  monthly_debt_service numeric(12,2),
  notes              text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.property_debt_insurance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read" ON public.property_debt_insurance;
CREATE POLICY "authenticated_read" ON public.property_debt_insurance
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.property_debt_insurance
  (property_name, holding_company, spreadsheet_name, monthly_insurance, monthly_debt_service, notes)
VALUES
  ('811 South Fairview Road',       'Sunny Slope Enterprises LLC',  '811 S Fairview',         126.42,    963.35, NULL),
  ('3909 North Oakland Gravel Road','Sunny Slope Enterprises LLC',  '3909 N Oakland Gravel',  204.98,   1232.21, NULL),
  ('407 Pecan Street',              'Farquhar Properties LLC',      '407 Pecan',              198.55,   1139.00, NULL),
  ('801-803 Washington Avenue',     'Farquhar Properties LLC',      '801-803 Washington',     124.83,    573.91, NULL),
  ('Pioneer Apartments',            'Oak Tree Enterprises LLC Class A','Pioneer Apartments',  2123.83,  5611.39, 'Morstan policy; LOC closed 09/08/25'),
  ('1511 Sylvan Lane',              'Oak Tree Enterprises LLC Class A','1511 Sylvan',          238.35,   951.14, NULL),
  ('Oakwood Gardens',               'Oak Tree Enterprises LLC Class B','Oakwood Gardens Apartments', 2558.14, 21688.20, 'Insurance financed via Peoples Premium Finance ($2558.14/mo); debt is ARLO $20,048.92 + West Plains $1,639.28'),
  ('Maple Manor Apartments',        'Maple Manor MO LLC',           'Maple Manor',           3122.26,  15029.50, 'Refinanced ARLO → Central Bank; same payment'),
  ('Normandy Apartments',           'Normandy Apartments LLC',      'Normandy Apartments',   1333.83,   9042.70, 'Refinanced 06/06/25')
ON CONFLICT (property_name) DO UPDATE SET
  holding_company      = EXCLUDED.holding_company,
  spreadsheet_name     = EXCLUDED.spreadsheet_name,
  monthly_insurance    = EXCLUDED.monthly_insurance,
  monthly_debt_service = EXCLUDED.monthly_debt_service,
  notes                = EXCLUDED.notes,
  updated_at           = now();
