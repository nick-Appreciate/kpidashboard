-- Leasing & renewal commissions (the "Commission tracker" sheet, automated).
--
-- Gross pool for a month = AppFolio bills on GL "Commissions/Placement Fees"
-- (Lease Fee 12.5% of rent, Renewal Fee 7.5%) whose paid_date falls in that
-- month — paid date reproduces the sheet to the cent for Nov 2025–Jul 2026.
-- Net = gross × an accelerator set by month-end occupancy, then split by role
-- (maintenance / PM) and evenly among the payees active in that role at
-- month end. Computation lives in lib/commissions.ts; approved runs are
-- frozen here so later AppFolio edits never change what was paid.

CREATE TABLE IF NOT EXISTS public.commission_plans (
  id                serial PRIMARY KEY,
  effective_from    date NOT NULL UNIQUE,
  maintenance_share numeric NOT NULL,          -- 0.20
  pm_share          numeric NOT NULL,          -- 0.80
  -- [{ "min_occupancy": 0, "multiplier": 0.40 }, { "min_occupancy": 90, ... }]
  tiers             jsonb NOT NULL,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commission_payees (
  id                 serial PRIMARY KEY,
  name               text NOT NULL,
  role               text NOT NULL CHECK (role IN ('pm', 'maintenance')),
  rippling_worker_id text,
  active_from        date NOT NULL,
  active_to          date,                      -- inclusive; null = still active
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commission_runs (
  month          date PRIMARY KEY,              -- first of the month
  gross          numeric NOT NULL,
  occupancy_pct  numeric NOT NULL,
  multiplier     numeric NOT NULL,
  net            numeric NOT NULL,
  lines          jsonb NOT NULL,                -- [{ name, role, rippling_worker_id, amount }]
  items          jsonb NOT NULL,                -- the AppFolio bills behind the gross
  status         text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'exported', 'paid')),
  approved_by    text NOT NULL,
  approved_at    timestamptz NOT NULL DEFAULT now(),
  exported_at    timestamptz,
  paid_at        timestamptz,
  note           text
);

ALTER TABLE public.commission_plans  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_payees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_runs   ENABLE ROW LEVEL SECURITY;

-- Read for signed-in users (the page itself is gated by role_page_permissions);
-- writes only through admin API routes using the caller's own client.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['commission_plans', 'commission_payees', 'commission_runs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Allow authenticated read" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Allow authenticated read" ON public.%I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins write" ON public.%I', t);
    EXECUTE format($p$CREATE POLICY "Admins write" ON public.%I FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.app_users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'admin'))
      WITH CHECK (EXISTS (SELECT 1 FROM public.app_users u WHERE u.email = auth.jwt()->>'email' AND u.role = 'admin'))$p$, t);
  END LOOP;
END $$;

-- The plan in the sheet since November 2025.
INSERT INTO public.commission_plans (effective_from, maintenance_share, pm_share, tiers, note)
VALUES ('2025-11-01', 0.20, 0.80,
  '[{"min_occupancy":0,"multiplier":0.40},{"min_occupancy":90,"multiplier":0.48},{"min_occupancy":91,"multiplier":0.56},{"min_occupancy":92,"multiplier":0.66},{"min_occupancy":93,"multiplier":0.76},{"min_occupancy":94,"multiplier":0.88},{"min_occupancy":95,"multiplier":1.00}]',
  'Commission tracker sheet: lease 12.5%, renewal 7.5%; maintenance 20% / PM 80%')
ON CONFLICT (effective_from) DO NOTHING;

-- Will left 2026-07-29, so Brett takes the full maintenance share from August.
INSERT INTO public.commission_payees (name, role, rippling_worker_id, active_from, active_to)
SELECT * FROM (VALUES
  ('Sarah Wilson',      'pm',          NULL::text,                 DATE '2025-11-01', NULL::date),
  ('Karen Danese',      'pm',          NULL,                       DATE '2025-11-01', NULL),
  ('Brett Seldomridge', 'maintenance', '67f327d6038e7ad166e404ac', DATE '2025-11-01', NULL),
  ('Will Herbert',      'maintenance', '661c8edbd3fab6e6d4f07ad8', DATE '2025-11-01', DATE '2026-07-31')
) v(name, role, rippling_worker_id, active_from, active_to)
WHERE NOT EXISTS (SELECT 1 FROM public.commission_payees);

INSERT INTO public.role_page_permissions (role, page_key, allowed)
SELECT r, 'commissions', false FROM unnest(ARRAY['manager', 'user']) r
WHERE NOT EXISTS (SELECT 1 FROM public.role_page_permissions WHERE page_key = 'commissions' AND role = r);

-- Nov 2025–Jul 2026 were already paid from the Commission tracker sheet.
-- Record them as paid, with the sheet's per-person amounts and the AppFolio
-- bills behind each month, so the dashboard shows history and never offers
-- to pay them again.
WITH v(month, gross, occ, mult, net, sarah, karen, will, brett) AS (VALUES
 (DATE '2025-11-01', 2118.00, 86.3, 0.4, 847.20, 338.88, 338.88, 84.72, 84.72),
 (DATE '2025-12-01', 1266.54, 87.5, 0.4, 506.62, 202.65, 202.65, 50.66, 50.66),
 (DATE '2026-01-01',  599.76, 87.5, 0.4, 239.90,  95.96,  95.96, 23.99, 23.99),
 (DATE '2026-02-01', 1362.58, 89.1, 0.4, 545.03, 218.01, 218.01, 54.50, 54.50),
 (DATE '2026-03-01', 1381.13, 89.5, 0.4, 552.45, 220.98, 220.98, 55.25, 55.25),
 (DATE '2026-04-01', 2511.66, 88.7, 0.4, 1004.66, 401.87, 401.87, 100.47, 100.47),
 (DATE '2026-05-01', 1627.66, 88.3, 0.4, 651.06, 260.43, 260.43, 65.11, 65.11),
 (DATE '2026-06-01', 1141.00, 87.9, 0.4, 456.40, 182.56, 182.56, 45.64, 45.64),
 (DATE '2026-07-01', 1966.95, 89.0, 0.4, 786.78, 314.71, 314.71, 78.68, 78.68)
)
INSERT INTO public.commission_runs (month, gross, occupancy_pct, multiplier, net, lines, items, status, approved_by, approved_at, note)
SELECT v.month, v.gross, v.occ, v.mult, v.net,
  jsonb_build_array(
    jsonb_build_object('name','Karen Danese','role','pm','rippling_worker_id',NULL,'share',0.4,'amount',v.karen),
    jsonb_build_object('name','Sarah Wilson','role','pm','rippling_worker_id',NULL,'share',0.4,'amount',v.sarah),
    jsonb_build_object('name','Brett Seldomridge','role','maintenance','rippling_worker_id','67f327d6038e7ad166e404ac','share',0.1,'amount',v.brett),
    jsonb_build_object('name','Will Herbert','role','maintenance','rippling_worker_id','661c8edbd3fab6e6d4f07ad8','share',0.1,'amount',v.will)),
  COALESCE((SELECT jsonb_agg(jsonb_build_object('bill_id', b.bill_id::text, 'property_name', b.property_name, 'unit', b.unit, 'memo', b.memo,
      'type', CASE WHEN b.memo ~* 'renewal' THEN 'Renewal' WHEN b.memo ~* 'lease' THEN 'Lease' ELSE 'Other' END,
      'amount', b.amount, 'bill_date', b.bill_date, 'paid_date', b.paid_date) ORDER BY b.paid_date)
    FROM public.af_bill_detail b
    WHERE b.gl_account_name = 'Commissions/Placement Fees' AND b.paid_date >= v.month AND b.paid_date < v.month + interval '1 month'), '[]'::jsonb),
  'paid', 'Commission tracker sheet', now(), 'Paid before the dashboard via the Commission tracker sheet'
FROM v
ON CONFLICT (month) DO NOTHING;
