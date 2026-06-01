-- Property-level financial overlay was originally just insurance + debt
-- (sourced from Cash Balance.xls). User wants taxes too — these are paid
-- outside AppFolio so they need to be modeled the same way to get true
-- owner net income.
ALTER TABLE public.property_debt_insurance
  ADD COLUMN IF NOT EXISTS monthly_taxes numeric(12,2);

-- Make sure properties from AppFolio that we haven't modeled yet still
-- appear on the editor (so the user can fill them in). Insert blank
-- rows for any current AppFolio property that doesn't have a row yet.
INSERT INTO public.property_debt_insurance (property_name, notes)
SELECT DISTINCT property_name, 'Auto-seeded for editor; no costs entered yet'
FROM af_cash_flow_latest
WHERE property_name IS NOT NULL
  AND property_name <> 'Total'
  AND property_name NOT IN (SELECT property_name FROM property_debt_insurance)
ON CONFLICT (property_name) DO NOTHING;
