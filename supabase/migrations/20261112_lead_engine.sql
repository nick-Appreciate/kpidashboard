-- Lead engine: our own prospect messaging, outside AppFolio's automations.
--
--   web_inquiries      — tour/question requests from appreciate.io listings
--   justcall_texts     — every JustCall SMS in/out (webhook + poll backfill)
--   lead_outbox        — every message the engine sends or decided not to send
--   sms_opt_outs       — STOP replies; checked before every automated text
--   lead_engine_settings — single row: kill switch, dry-run, line, templates
--
-- All tables are written only by edge functions / server routes using the
-- service role. Authenticated dashboard users can read.

CREATE TABLE IF NOT EXISTS public.web_inquiries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  listing_id       text,                 -- AppFolio listable_uid
  listing_address  text,
  property_name    text,
  first_name       text NOT NULL,
  last_name        text,
  email            text,
  phone            text,
  phone_norm       text,
  move_in          date,
  message          text,
  wants_tour       boolean NOT NULL DEFAULT false,
  sms_consent      boolean NOT NULL DEFAULT false,  -- transactional texts about this inquiry
  marketing_consent boolean NOT NULL DEFAULT false, -- promo texts (specials) beyond 90 days
  locale           text NOT NULL DEFAULT 'en',
  user_agent       text,
  appfolio_status  text,                 -- 'created' | 'failed'
  appfolio_error   text
);
CREATE INDEX IF NOT EXISTS web_inquiries_phone_idx ON public.web_inquiries (phone_norm);
CREATE INDEX IF NOT EXISTS web_inquiries_created_idx ON public.web_inquiries (created_at DESC);

CREATE TABLE IF NOT EXISTS public.justcall_texts (
  id                    text PRIMARY KEY,
  contact_number        text,
  contact_number_norm   text,
  contact_name          text,
  justcall_number       text,
  justcall_number_norm  text,
  justcall_line_name    text,
  direction             text,           -- 'Outgoing' | 'Incoming'
  body                  text,
  is_mms                boolean,
  sms_at                timestamptz,
  agent_id              text,
  agent_name            text,
  agent_email           text,
  delivery_status       text,
  synced_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS justcall_texts_contact_idx ON public.justcall_texts (contact_number_norm, sms_at);
CREATE INDEX IF NOT EXISTS justcall_texts_at_idx ON public.justcall_texts (sms_at DESC);

CREATE TABLE IF NOT EXISTS public.sms_opt_outs (
  phone_norm     text PRIMARY KEY,
  opted_out_at   timestamptz NOT NULL DEFAULT now(),
  source         text,                  -- 'justcall_stop' | 'manual'
  message        text
);

CREATE TABLE IF NOT EXISTS public.lead_outbox (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  kind               text NOT NULL,     -- instant | tour_reminder_day | tour_reminder_2h | no_show | post_tour | reengage
  dedupe_key         text NOT NULL,     -- e.g. phone for instant, showing id for reminders, campaign for reengage
  channel            text NOT NULL DEFAULT 'sms',
  phone_norm         text,
  email              text,
  leasing_report_id  uuid,
  web_inquiry_id     uuid,
  showing_id         text,
  property_name      text,
  lead_name          text,
  body               text,
  send_after         timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'pending', -- pending | sent | dry_run | skipped | failed
  skip_reason        text,
  sent_at            timestamptz,
  external_id        text,              -- JustCall text id
  error              text,
  attempts           int NOT NULL DEFAULT 0,
  UNIQUE (kind, dedupe_key)
);
CREATE INDEX IF NOT EXISTS lead_outbox_pending_idx ON public.lead_outbox (send_after) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS lead_outbox_phone_idx ON public.lead_outbox (phone_norm, created_at);

CREATE TABLE IF NOT EXISTS public.lead_engine_settings (
  id                 int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled            boolean NOT NULL DEFAULT true,   -- false = engine records nothing and sends nothing
  dry_run            boolean NOT NULL DEFAULT true,   -- true = compose + log as 'dry_run', never send
  live_since         timestamptz NOT NULL DEFAULT now(), -- leads received before this are never auto-texted
  from_number        text NOT NULL DEFAULT '18167650427', -- JustCall "Leasing" line
  instant_template_en text NOT NULL,
  instant_template_es text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.lead_engine_settings (id, instant_template_en, instant_template_es) VALUES (1,
  'Hi {first}, this is Appreciate Leasing. Thanks for your interest in {property}! When would you like to come see it? Reply with a day and time that works for you, or call us at (816) 765-0427. Reply STOP to opt out.',
  'Hola {first}, somos Appreciate Leasing. ¡Gracias por tu interés en {property}! ¿Cuándo te gustaría verlo? Responde con un día y hora que te funcione, o llámanos al (816) 765-0427. Responde STOP para no recibir mensajes.')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.web_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.justcall_texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_opt_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_engine_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read" ON public.web_inquiries FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.justcall_texts FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.sms_opt_outs FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.lead_outbox FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.lead_engine_settings FOR SELECT TO authenticated USING (true);

-- Tour booking from the website: the slot comes from AppFolio's public
-- availability API (the property manager's AppFolio calendar), and the
-- showing is booked in AppFolio.
ALTER TABLE public.web_inquiries
  ADD COLUMN IF NOT EXISTS showing_start timestamptz,
  ADD COLUMN IF NOT EXISTS showing_agent_id int,
  ADD COLUMN IF NOT EXISTS appfolio_guest_card_id text,
  ADD COLUMN IF NOT EXISTS showing_status text,   -- 'booked' | 'slot_taken' | 'failed'
  ADD COLUMN IF NOT EXISTS showing_error text;
ALTER TABLE public.lead_engine_settings
  ADD COLUMN IF NOT EXISTS booked_template_en text NOT NULL DEFAULT 'Hi {first}, you''re booked to tour {property} on {when}. Reply YES to confirm, or reply here if you need a different time. Questions? Call (816) 765-0427. Reply STOP to opt out.',
  ADD COLUMN IF NOT EXISTS booked_template_es text NOT NULL DEFAULT 'Hola {first}, tu visita a {property} está agendada para el {when}. Responde SÍ para confirmar, o escríbenos si necesitas otra hora. ¿Preguntas? Llama al (816) 765-0427. Responde STOP para no recibir mensajes.';

-- Instant text carries a link into our tour picker ({tour_line} is filled by
-- the lead engine: a booking link when the property has a live listing, else
-- "reply with a day and time").
UPDATE public.lead_engine_settings SET
  instant_template_en = 'Hi {first}, this is Appreciate Leasing. Thanks for your interest in {property}! {tour_line} Questions? Reply here or call (816) 765-0427. Reply STOP to opt out.',
  instant_template_es = 'Hola {first}, somos Appreciate Leasing. ¡Gracias por tu interés en {property}! {tour_line} ¿Preguntas? Responde aquí o llama al (816) 765-0427. Responde STOP para no recibir mensajes.'
WHERE id = 1;

-- Personal tour links (appreciate.io/t/<token>) in lead texts: open straight to
-- the tour picker with the prospect's guest card + contact info pre-attached,
-- so booking is two taps (time → confirm). Read only server-side.
CREATE TABLE IF NOT EXISTS public.tour_links (
  token             text PRIMARY KEY,
  created_at        timestamptz NOT NULL DEFAULT now(),
  listing_id        text NOT NULL,
  property_name     text,
  guest_card_id     text,
  leasing_report_id uuid,
  first_name        text,
  last_name         text,
  phone_norm        text,
  email             text,
  locale            text NOT NULL DEFAULT 'en',
  opened_at         timestamptz,
  booked_at         timestamptz
);
CREATE INDEX IF NOT EXISTS tour_links_phone_idx ON public.tour_links (phone_norm);
ALTER TABLE public.tour_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read" ON public.tour_links FOR SELECT TO authenticated USING (true);
ALTER TABLE public.web_inquiries ADD COLUMN IF NOT EXISTS tour_token text;
