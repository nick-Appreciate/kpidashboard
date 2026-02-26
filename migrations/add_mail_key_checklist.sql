-- Add mail_key checklist columns for Glen Oaks units
ALTER TABLE rehabs 
ADD COLUMN IF NOT EXISTS mail_key_completed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS mail_key_excluded BOOLEAN DEFAULT FALSE;
