-- JustCall call logs — the source for "time to first warm contact".
--
-- AppFolio exposes no usable manual-call timing (its guest_cards "Call"
-- activity is date-only). The team dials through JustCall, whose /v2.1/calls
-- API returns minute-precise call logs. We sync them here and match to
-- inquiries by phone to compute first-warm-contact latency.
--
-- API history is limited to the last 3 months, so a scheduled sync (see
-- sync-justcall) accumulates history permanently in this table.

CREATE TABLE IF NOT EXISTS public.justcall_calls (
  id                   text PRIMARY KEY,          -- JustCall call id
  call_sid             text,
  contact_number       text,                      -- raw contact phone as returned
  contact_number_norm  text,                      -- last 10 digits, for matching to leads
  direction            text,                      -- 'Outgoing' | 'Incoming'
  call_type            text,                      -- 'Answered' | 'Missed' | 'Voicemail' | 'Abandoned'
  call_at              timestamptz,               -- UTC datetime of the call
  duration_seconds     integer,
  agent_id             text,
  agent_name           text,
  agent_email          text,
  recording            text,
  synced_at            timestamptz DEFAULT now()
);

COMMENT ON TABLE public.justcall_calls IS
  'JustCall call logs (last-3-months API window, accumulated). A warm contact = direction=Outgoing AND call_type=Answered. Matched to leasing_reports by contact_number_norm.';

-- Matching + recency scans.
CREATE INDEX IF NOT EXISTS justcall_calls_norm_at_idx ON public.justcall_calls (contact_number_norm, call_at);
CREATE INDEX IF NOT EXISTS justcall_calls_call_at_idx ON public.justcall_calls (call_at);

-- RLS: authenticated users may read (the app gates access above this via
-- app_users); the sync writes with the service role, which bypasses RLS.
ALTER TABLE public.justcall_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS justcall_calls_select ON public.justcall_calls;
CREATE POLICY justcall_calls_select ON public.justcall_calls
  FOR SELECT TO authenticated USING (true);
