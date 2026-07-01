-- Speed-to-lead instrumentation for leasing_reports.
--
-- Background: the AppFolio `guest_cards` report exposes only the MOST RECENT
-- activity (`last_activity_date` / `last_activity_type`, e.g. "Text Sent"),
-- not a first-response timestamp. To measure time-to-first-response we latch
-- the first time we ever observe an OUTBOUND response activity on a guest
-- card and never overwrite it thereafter (see sync-appfolio `syncGuestCards`).
--
-- Precision note: `inquiry_received` is already minute-precise (timestamptz).
-- `last_activity_at` below stores AppFolio's activity timestamp un-truncated
-- (the legacy `last_activity_date` column is date-only and stays for back-compat).
-- Historical rows cannot be backfilled — the report only ever returns the
-- CURRENT last activity — so meaningful data accumulates going forward.

-- Full-precision copy of the most recent activity timestamp.
ALTER TABLE public.leasing_reports
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

-- Latched first outbound response. Set once, when the first response activity
-- is observed; never overwritten (the sync guards on `first_response_at IS NULL`).
ALTER TABLE public.leasing_reports
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz;

-- The activity type that constituted the first response (e.g. "Text Sent",
-- "Email Sent", "Auto-Response Email Sent").
ALTER TABLE public.leasing_reports
  ADD COLUMN IF NOT EXISTS first_response_type text;

COMMENT ON COLUMN public.leasing_reports.first_response_at IS
  'First observed outbound response to the inquiry (latched, never overwritten). Speed-to-lead = first_response_at - inquiry_received.';

-- Speeds up the dashboard''s "responses in the last N days" window scan.
CREATE INDEX IF NOT EXISTS leasing_reports_first_response_at_idx
  ON public.leasing_reports (first_response_at);

-- Latch the first outbound response for any guest card that doesn''t have one
-- yet. Called at the end of syncGuestCards on every hourly sync. Idempotent:
-- the `first_response_at IS NULL` guard means a value, once set, is permanent,
-- so it always records the EARLIEST response we observed, not the latest.
CREATE OR REPLACE FUNCTION public.latch_leasing_first_response()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.leasing_reports
  SET first_response_at   = last_activity_at,
      first_response_type = last_activity_type
  WHERE first_response_at IS NULL
    AND last_activity_at  IS NOT NULL
    AND inquiry_received  IS NOT NULL
    -- Only latch FRESH inquiries. Without this, the first run would stamp old
    -- leads'' current (late) last-activity as their "first response" — the sim
    -- showed an 11-day avg gap. Restricting to recent inquiries means the
    -- first outbound touch we observe really is the first response. Every new
    -- lead is caught within this window by the hourly sync.
    AND inquiry_received >= now() - interval '3 days'
    -- Guard against date-truncated / stale activity producing a response that
    -- appears to precede the inquiry (which would yield a negative latency).
    AND last_activity_at >= inquiry_received
    -- Only genuine OUTBOUND contact counts as a "response":
    --   *Sent  -> Text Sent, Email Sent, Auto-Response Email Sent, Showing Auto Followup Email Sent
    --   Call   -> a logged phone call (staff)
    -- Deliberately EXCLUDED: "Call to Action Triggered/Overdue" (internal
    -- workflow reminders), "Inbound Call Received"/"* Received" (inbound),
    -- status changes, notes.
    AND (
      last_activity_type ILIKE '%sent%'
      OR last_activity_type = 'Call'
    );
$$;
