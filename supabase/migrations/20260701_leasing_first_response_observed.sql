-- Speed-to-lead, take 2: observation-time capture.
--
-- Validation showed AppFolio's guest_cards report exposes `last_activity_date`
-- as DATE-ONLY (all timestamps came back at 00:00:00), and there is no
-- minute-level activity/communication report in the API. Webhooks are gated
-- to Stack partners and don't cover lead comms. So we cannot read the true
-- response time from AppFolio.
--
-- Instead we capture the response time as WHEN OUR SYNC FIRST OBSERVES an
-- outbound activity on a fresh guest card -- i.e. now() at latch time. The
-- accuracy is therefore bounded by the guest_cards sync cadence: hourly today,
-- tightened to ~5-15 min by a dedicated poll. This slightly OVER-states
-- latency (we see it no earlier than it happened), which is the safe direction
-- for an SLA -- it never makes response look faster than it was.
--
-- Trade-off retained: only responses that create an AppFolio guest-card
-- activity (Text/Email Sent, Auto-Response, logged Call) are captured. A VA
-- phone call that is never logged in AppFolio still leaves no trace.

CREATE OR REPLACE FUNCTION public.latch_leasing_first_response()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.leasing_reports
  SET first_response_at   = now(),                 -- observation time, not AppFolio's date-only stamp
      first_response_type = last_activity_type
  WHERE first_response_at IS NULL
    AND inquiry_received IS NOT NULL
    -- Only fresh inquiries, so the first outbound activity we observe is
    -- genuinely the first response (not an old lead's latest touch).
    AND inquiry_received >= now() - interval '3 days'
    AND last_activity_type IS NOT NULL
    -- Genuine OUTBOUND contact only. *Sent covers Text/Email/Auto-Response/
    -- Showing-Followup; 'Call' is a logged phone call. Excludes "Call to
    -- Action *" reminders, "* Received" inbound, status changes, notes.
    AND (
      last_activity_type ILIKE '%sent%'
      OR last_activity_type = 'Call'
    );
$$;

COMMENT ON COLUMN public.leasing_reports.first_response_at IS
  'When our sync first OBSERVED an outbound response to the inquiry (accuracy bounded by guest_cards sync cadence). Speed-to-lead = first_response_at - inquiry_received.';
