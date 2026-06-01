-- Maple Manor insurance was double-counting on the Owner Net Income chart.
-- The management company pays the property insurance directly out of
-- AppFolio (account 5050.1 "Property Management Expense: Property
-- insurance", ~$3,239/mo for May 2026), so it's already netted out of
-- the property's distributions. Subtracting the spreadsheet's
-- monthly_insurance again was overcounting by ~$3,122/mo.
--
-- Set monthly_insurance to 0 for Maple Manor only. Other properties keep
-- their original values — they pay insurance from holding-company
-- accounts outside AppFolio so the spreadsheet number is still needed.
UPDATE public.property_debt_insurance
SET monthly_insurance = 0,
    notes = COALESCE(notes || ' | ', '')
            || 'Insurance paid by mgmt co through AppFolio (account 5050.1, ~$3,239/mo) — not subtracted here to avoid double counting',
    updated_at = now()
WHERE property_name = 'Maple Manor Apartments';
