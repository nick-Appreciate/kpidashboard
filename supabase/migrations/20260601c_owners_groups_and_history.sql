-- Owners feature — Phase 1: data layer.
--   ownership_groups        — user-defined groups for cross-cutting filter
--   owner_group_memberships — many-to-many: owners ↔ groups
--   owner_property_history  — per-owner-per-property ownership window
--                              (seeded from af_owner_directory parsing
--                              + property_acquisitions dates; editable
--                              on the /admin/owners page)

CREATE TABLE IF NOT EXISTS public.ownership_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  color       text DEFAULT '#06b6d4',
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text
);

CREATE TABLE IF NOT EXISTS public.owner_group_memberships (
  owner_id  integer NOT NULL REFERENCES public.af_owner_directory(owner_id) ON DELETE CASCADE,
  group_id  uuid    NOT NULL REFERENCES public.ownership_groups(id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  added_by  text,
  PRIMARY KEY (owner_id, group_id)
);

CREATE TABLE IF NOT EXISTS public.owner_property_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       integer NOT NULL REFERENCES public.af_owner_directory(owner_id) ON DELETE CASCADE,
  property_name  text    NOT NULL,
  ownership_pct  numeric(5,2),
  start_date     date,
  end_date       date,
  source         text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, property_name, start_date)
);

CREATE INDEX IF NOT EXISTS idx_ophist_owner ON public.owner_property_history(owner_id);
CREATE INDEX IF NOT EXISTS idx_ophist_property ON public.owner_property_history(property_name);
CREATE INDEX IF NOT EXISTS idx_ophist_active ON public.owner_property_history(end_date) WHERE end_date IS NULL;

ALTER TABLE public.ownership_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_property_history  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read" ON public.ownership_groups;
DROP POLICY IF EXISTS "authenticated_read" ON public.owner_group_memberships;
DROP POLICY IF EXISTS "authenticated_read" ON public.owner_property_history;
CREATE POLICY "authenticated_read" ON public.ownership_groups        FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.owner_group_memberships FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.owner_property_history  FOR SELECT TO authenticated USING (true);

-- Seed from current AppFolio state
WITH parsed AS (
  SELECT
    o.owner_id,
    trim(both ' ,' from substring(part FROM '(.+?)\s*\(\d+'))   AS property_name,
    NULLIF(substring(part FROM '\((\d+(?:\.\d+)?)%\)'), '')::numeric AS pct
  FROM af_owner_directory o,
       LATERAL regexp_split_to_table(o.properties_owned, ',\s*') AS part
  WHERE o.properties_owned IS NOT NULL AND o.properties_owned <> ''
)
INSERT INTO public.owner_property_history (owner_id, property_name, ownership_pct, start_date, end_date, source)
SELECT
  p.owner_id, p.property_name, p.pct,
  pa.acquisition_date, pa.divestiture_date,
  CASE WHEN pa.acquisition_date IS NOT NULL THEN 'inferred_acquisition' ELSE 'af_directory' END
FROM parsed p
LEFT JOIN property_acquisitions pa ON pa.property_name = p.property_name
ON CONFLICT (owner_id, property_name, start_date) DO NOTHING;
