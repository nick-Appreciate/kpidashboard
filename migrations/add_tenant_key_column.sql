-- Add tenant_key_completed column to rehabs table
ALTER TABLE rehabs ADD COLUMN IF NOT EXISTS tenant_key_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE rehabs ADD COLUMN IF NOT EXISTS tenant_key_completed_at TIMESTAMPTZ;
