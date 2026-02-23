-- Add excluded columns for checklist items (3-state toggle: pending/complete/excluded)
ALTER TABLE rehabs ADD COLUMN IF NOT EXISTS vendor_key_excluded BOOLEAN DEFAULT FALSE;
ALTER TABLE rehabs ADD COLUMN IF NOT EXISTS utilities_excluded BOOLEAN DEFAULT FALSE;
ALTER TABLE rehabs ADD COLUMN IF NOT EXISTS pest_control_excluded BOOLEAN DEFAULT FALSE;
ALTER TABLE rehabs ADD COLUMN IF NOT EXISTS surface_restoration_excluded BOOLEAN DEFAULT FALSE;
ALTER TABLE rehabs ADD COLUMN IF NOT EXISTS junk_removal_excluded BOOLEAN DEFAULT FALSE;
ALTER TABLE rehabs ADD COLUMN IF NOT EXISTS cleaned_excluded BOOLEAN DEFAULT FALSE;
ALTER TABLE rehabs ADD COLUMN IF NOT EXISTS tenant_key_excluded BOOLEAN DEFAULT FALSE;
ALTER TABLE rehabs ADD COLUMN IF NOT EXISTS leasing_signoff_excluded BOOLEAN DEFAULT FALSE;
