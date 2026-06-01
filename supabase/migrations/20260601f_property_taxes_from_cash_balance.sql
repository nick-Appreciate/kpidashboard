-- Tax overlay sourced from Cash Balance.xls (holding-company sheets'
-- "Property Taxes" columns: Sunny Slope, Farquhar, Oak Tree (Simmons),
-- Maple Manor (Simmons), Normandy (Simmons), KCK Holdings (Simmons)).
--
-- Method: trailing-12-months total (latest payment Dec 2025 — May 2026)
-- divided by 12. Applied to the currently-active period for each
-- property (period_end IS NULL).
--
-- Hilltop tax goes on the Summit Ridge Townhomes period (the active
-- one); the spreadsheet still tracked taxes in the KCK Holdings sheet
-- as of May 2026 (post-divestiture), suggesting either the sheet
-- hasn't yet been updated to reflect ownership transfer, OR Summit
-- Ridge is reimbursing via the old account. Verify with Mike.
--
-- Missing from the spreadsheet (still need to be entered):
--   Glen Oaks, Oakwood Gardens
WITH new_taxes(property_name, monthly_taxes) AS (
  VALUES
    ('811 South Fairview Road',          116.17),
    ('3909 North Oakland Gravel Road',   169.33),
    ('407 Pecan Street',                  85.83),
    ('801-803 Washington Avenue',         48.67),
    ('Pioneer Apartments',               583.58),
    ('1511 Sylvan Lane',                 195.50),
    ('Maple Manor Apartments',          1199.58),
    ('Normandy Apartments',             4219.17),
    ('Hilltop Townhomes',               4787.75)
)
UPDATE public.property_period pp
SET monthly_taxes = nt.monthly_taxes,
    notes = COALESCE(pp.notes || ' | ', '') ||
            'Tax overlay TTM/12 from Cash Balance.xls (2025-12 batch)',
    updated_at = now(),
    source = CASE WHEN pp.source = 'inferred_from_legacy_tables'
                   THEN 'inferred_from_legacy_tables_w_taxes'
                  ELSE 'manual' END
FROM new_taxes nt
WHERE pp.property_name = nt.property_name
  AND pp.period_end IS NULL;
