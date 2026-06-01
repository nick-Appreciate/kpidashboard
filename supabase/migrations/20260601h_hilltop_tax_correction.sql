-- Hilltop Townhomes (parcel 124301, 2600 Delavan Ave KCK) tax correction.
-- Wyandotte County PDF confirmed:
--   - New owner Summit Ridge Townhomes LLC (Las Vegas NV mailing)
--     took over 2026-04-22 (book/page 2026R-05310)
--   - 2025 assessed value: $251,650
--   - 2025 appraised:      $2,188,260
--   - Tax roll page was empty (new owner not yet billed)
--
-- Estimate 2025 tax from assessed × Wyandotte's published levy:
--   $251,650 × 160.381/1000 = $40,360 general
--   + ~3.3% fees (per Glen Oaks pattern) → ~$41,700/yr → $3,476/mo
--
-- Previous overlay: $4,788/mo (Cash Balance.xls TTM) — ~38% too high,
-- same double-counting pattern as Normandy (escrow + tax bill summed).
--
-- Applied to BOTH Hilltop periods:
--   period 1: KCK Holdings, LLC          2023-01-01 → 2026-04-22
--   period 2: Summit Ridge Townhomes LLC 2026-04-22 → present
-- since the property tax bill is per-parcel, not per-owner.
UPDATE public.property_period
SET monthly_taxes = 3476.50,
    notes = COALESCE(notes || ' | ', '') ||
            'Wyandotte 2025 assessed $251,650 × 160.381/1000 + ~3% fees; parcel 124301',
    updated_at = now(),
    source = 'manual'
WHERE property_name = 'Hilltop Townhomes';
