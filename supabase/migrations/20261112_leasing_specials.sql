-- Current leasing special ("Winter Leasing Special", …). One active row drives
-- the website promo banner and the lead engine's follow-up text #2.
CREATE TABLE IF NOT EXISTS public.leasing_specials (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  active      boolean NOT NULL DEFAULT true,
  name_en     text NOT NULL,          -- "Winter Leasing Special"
  name_es     text NOT NULL,          -- "promoción de invierno"
  details_en  text,                   -- optional fine print, e.g. "$500 off first month"
  details_es  text
);
-- Only one special can be current at a time.
CREATE UNIQUE INDEX IF NOT EXISTS leasing_specials_one_active ON public.leasing_specials (active) WHERE active;
ALTER TABLE public.leasing_specials ENABLE ROW LEVEL SECURITY;
-- The public website shows the current special, so anon may read active rows.
CREATE POLICY "public_read_active" ON public.leasing_specials FOR SELECT TO anon, authenticated USING (active);
CREATE POLICY "authenticated_read_all" ON public.leasing_specials FOR SELECT TO authenticated USING (true);
-- Admins edit it from Leasing Automations.
CREATE POLICY "admin_insert" ON public.leasing_specials FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.app_users u WHERE u.email = (auth.jwt() ->> 'email') AND u.role = 'admin'));
CREATE POLICY "admin_update" ON public.leasing_specials FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users u WHERE u.email = (auth.jwt() ->> 'email') AND u.role = 'admin'));
INSERT INTO public.leasing_specials (name_en, name_es) VALUES ('Winter Leasing Special', 'promoción de invierno');
