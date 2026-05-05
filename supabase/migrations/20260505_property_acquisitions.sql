-- Acquisition date per property. Used by lease_history_unified to clamp
-- move_in for inherited tenants — so a tenant living there since 2015 at
-- a property we bought in 2024 doesn't show up as a 9-year tenancy when
-- they finally move out.
--
-- Keyed on property_name as it appears in lease_history_unified — a mix
-- of canonical AppFolio names and DoorLoop address-level names. The 3
-- Whitegate Drive addresses are pre-mapped to Pioneer Apartments because
-- they're the same physical complex.

CREATE TABLE IF NOT EXISTS public.property_acquisitions (
  property_name    text PRIMARY KEY,
  acquisition_date date NOT NULL,
  source           text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.property_acquisitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_property_acquisitions"
  ON public.property_acquisitions;
CREATE POLICY "authenticated_read_property_acquisitions"
  ON public.property_acquisitions
  FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO public.property_acquisitions (property_name, acquisition_date, source, notes) VALUES
  ('Pioneer Apartments',                '2022-05-01', 'user',     'Confirmed by user 2026-05-05'),
  ('Hilltop Townhomes',                 '2023-01-01', 'user',     'Confirmed by user 2026-05-05'),
  ('Oakwood Gardens',                   '2023-11-01', 'proxy',    'Earliest DL charge 2023-11-01'),
  ('Maple Manor Apartments',            '2024-01-18', 'proxy',    'Earliest DL charge 2024-01-18'),
  ('Normandy Apartments',               '2024-06-19', 'proxy',    'Earliest DL charge 2024-06-19'),
  ('Glen Oaks',                         '2024-10-01', 'proxy',    'Earliest DL charge 2024-10-01'),
  ('1511 Sylvan Lane',                  '2022-05-20', 'proxy',    'Earliest DL charge 2022-05-20'),
  ('407 Pecan Street',                  '2022-12-30', 'proxy',    'Earliest DL charge 2022-12-30'),
  ('3909 North Oakland Gravel Road',    '2022-12-10', 'proxy',    'Earliest DL charge 2022-12-10'),
  ('801-803 Washington Avenue',         '2022-05-01', 'user',     'Confirmed by user 2026-05-05'),
  ('811 South Fairview Road',           '2021-06-01', 'user',     'Confirmed by user 2026-05-05'),
  ('2404 Whitegate Drive',              '2022-05-01', 'inferred', 'Belongs to Pioneer Apartments'),
  ('2406 Whitegate Drive',              '2022-05-01', 'inferred', 'Belongs to Pioneer Apartments'),
  ('2414 Whitegate Drive',              '2022-05-01', 'inferred', 'Belongs to Pioneer Apartments')
ON CONFLICT (property_name) DO NOTHING;

COMMENT ON TABLE public.property_acquisitions IS
  'Property acquisition dates. Used to clamp inherited tenants'' move_in in lease_history_unified so churn metrics reflect tenancy under our ownership only.';
