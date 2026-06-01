-- Tax overlay corrections from Wyandotte County (KS) assessor public records,
-- pulled 2026-06-01.
--
-- Glen Oaks    parcel 037017  N 58TH ST LLC               2025 tax $52,369.72
-- Normandy     parcel 928711  NORMANDY APARTMENTS LLC     2025 tax $26,649.46
-- Oakwood      parcel 403000  OAK TREE ENTERPRISES LLC    2025 tax $36,831.42
--
-- Normandy's previous overlay was $4,219/mo (from spreadsheet TTM), nearly
-- 2x the actual annual tax. The TTM in Cash Balance.xls was summing BOTH
-- lender escrow deposits AND the actual tax bill — i.e. double-counting.
-- Glen Oaks + Oakwood were blank — now populated.
WITH new_taxes(property_name, monthly_taxes, source_note) AS (
  VALUES
    ('Glen Oaks',           4364.14, 'Wyandotte County 2025 tax bill $52,369.72 / 12 (incl. $1,650.12 fees); parcel 037017'),
    ('Normandy Apartments', 2220.79, 'Wyandotte County 2025 tax bill $26,649.46 / 12; parcel 928711 (was 2x too high from spreadsheet TTM double-count)'),
    ('Oakwood Gardens',     3069.29, 'Wyandotte County 2025 tax bill $36,831.42 / 12; parcel 403000')
)
UPDATE public.property_period pp
SET monthly_taxes = nt.monthly_taxes,
    notes = COALESCE(pp.notes || ' | ', '') || nt.source_note,
    updated_at = now(),
    source = 'manual'
FROM new_taxes nt
WHERE pp.property_name = nt.property_name
  AND pp.period_end IS NULL;
