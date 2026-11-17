-- Who booked each tour and when (AppFolio showings report created_at / created_by).
-- created_by is a staff name, "System Automation (AppFolio)" (prospect
-- self-scheduled online, incl. our tour links) or "Syndication System
-- (AppFolio)" (booked through a listing site such as Zillow).
ALTER TABLE public.showings
  ADD COLUMN IF NOT EXISTS booked_at timestamptz,
  ADD COLUMN IF NOT EXISTS booked_by text,
  ADD COLUMN IF NOT EXISTS booked_by_id text,
  ADD COLUMN IF NOT EXISTS unit_type text;
