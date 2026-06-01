-- Property-period centric model
--
-- Replaces the owner-centric scaffolding with property-as-first-class.
-- A "property period" is one window during which we managed a single
-- property under one ownership structure. Same property can have
-- multiple periods (e.g. Hilltop: KCK Holdings → Summit Ridge Townhomes
-- on 2026-04-22).
CREATE TABLE IF NOT EXISTS public.property_period (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_name         text NOT NULL,
  af_property_id        integer,
  period_start          date,
  period_end            date,
  holding_company       text,
  notes                 text,
  monthly_insurance     numeric(12,2),
  monthly_taxes         numeric(12,2),
  monthly_debt_service  numeric(12,2),
  source                text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pperiod_property ON public.property_period(property_name);
CREATE INDEX IF NOT EXISTS idx_pperiod_active   ON public.property_period(period_end) WHERE period_end IS NULL;

CREATE TABLE IF NOT EXISTS public.property_period_group_memberships (
  period_id  uuid NOT NULL REFERENCES public.property_period(id) ON DELETE CASCADE,
  group_id   uuid NOT NULL REFERENCES public.ownership_groups(id) ON DELETE CASCADE,
  added_at   timestamptz NOT NULL DEFAULT now(),
  added_by   text,
  PRIMARY KEY (period_id, group_id)
);

ALTER TABLE public.property_period                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_period_group_memberships     ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read" ON public.property_period;
DROP POLICY IF EXISTS "authenticated_read" ON public.property_period_group_memberships;
CREATE POLICY "authenticated_read" ON public.property_period                   FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.property_period_group_memberships FOR SELECT TO authenticated USING (true);

-- Seed from existing property_debt_insurance + property_acquisitions
INSERT INTO public.property_period
  (property_name, period_start, period_end, holding_company,
   monthly_insurance, monthly_taxes, monthly_debt_service, notes, source)
SELECT
  pdi.property_name,
  pa.acquisition_date,
  CASE WHEN pdi.property_name = 'Hilltop Townhomes' THEN '2026-04-22'::date
       ELSE pa.divestiture_date END,
  CASE WHEN pdi.property_name = 'Hilltop Townhomes' THEN 'KCK Holdings, LLC'
       ELSE pdi.holding_company END,
  pdi.monthly_insurance, pdi.monthly_taxes, pdi.monthly_debt_service,
  pdi.notes,
  'inferred_from_legacy_tables'
FROM property_debt_insurance pdi
LEFT JOIN property_acquisitions pa ON pa.property_name = pdi.property_name
ON CONFLICT DO NOTHING;

-- Hilltop period 2 — Summit Ridge Townhomes, 2026-04-22 → present
INSERT INTO public.property_period
  (property_name, period_start, period_end, holding_company, notes, source)
VALUES (
  'Hilltop Townhomes', '2026-04-22', NULL, 'Summit Ridge Townhomes, LLC',
  'New ownership effective 2026-04-22 — insurance/taxes/debt not yet entered',
  'manual'
);
