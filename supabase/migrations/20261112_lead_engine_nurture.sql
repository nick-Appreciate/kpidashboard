-- Lead engine phase 2: follow-up (nurture) sequence, email channel, Slack
-- alerts to #leasing, and "Reply YES" tour confirmations.

ALTER TABLE public.lead_outbox ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE public.lead_engine_settings
  ADD COLUMN IF NOT EXISTS email_enabled boolean NOT NULL DEFAULT false,   -- on once mail.appreciate.io verifies in Resend
  ADD COLUMN IF NOT EXISTS email_from text NOT NULL DEFAULT 'Appreciate Leasing <leasing@mail.appreciate.io>',
  ADD COLUMN IF NOT EXISTS email_reply_to text,                          -- a real inbox the team reads
  ADD COLUMN IF NOT EXISTS email_footer text NOT NULL DEFAULT 'Appreciate Property Management · Kansas City, MO',
  ADD COLUMN IF NOT EXISTS nurture_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alerts_enabled boolean NOT NULL DEFAULT true;

-- Slack alerts to #leasing (prospect replies, missed calls, needs-a-person,
-- tours booked/confirmed, opt-outs). One row per alert; dedupe_key stops repeats.
CREATE TABLE IF NOT EXISTS public.lead_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL,
  dedupe_key  text NOT NULL,
  phone_norm  text,
  text        text NOT NULL,
  status      text NOT NULL DEFAULT 'pending',  -- pending | sent | failed | held
  sent_at     timestamptz,
  error       text,
  UNIQUE (kind, dedupe_key)
);
CREATE INDEX IF NOT EXISTS lead_alerts_pending_idx ON public.lead_alerts (created_at) WHERE status = 'pending';

-- "Reply YES" tour confirmations from texts.
CREATE TABLE IF NOT EXISTS public.showing_confirmations (
  showing_id    text PRIMARY KEY,
  phone_norm    text,
  confirmed_at  timestamptz NOT NULL DEFAULT now(),
  message       text,
  justcall_text_id text
);
CREATE INDEX IF NOT EXISTS showing_confirmations_phone_idx ON public.showing_confirmations (phone_norm);

ALTER TABLE public.lead_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.showing_confirmations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read" ON public.lead_alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.showing_confirmations FOR SELECT TO authenticated USING (true);

-- Slack @mention for alerts someone has to act on (Jader handles lead follow-up).
ALTER TABLE public.lead_engine_settings
  ADD COLUMN IF NOT EXISTS alert_mention text DEFAULT '<@U08KSLADF0W>',
  ADD COLUMN IF NOT EXISTS alert_mention_kinds text[] NOT NULL DEFAULT ARRAY['prospect_reply','missed_call','needs_person'];
