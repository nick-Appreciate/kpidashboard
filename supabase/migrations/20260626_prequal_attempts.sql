-- Pre-qualification gate attempts logged from the public listings site.
-- Every "Apply Now" click opens a modal asking for income, credit band,
-- and contact info; the result is logged here regardless of pass/fail
-- so we can analyze lead quality by listing, by source, over time.
--
-- Built in response to Phase 2b of the leasing audit: 49% of KC apps
-- get denied, with the rate climbing to 62% on units over $1300/mo.
-- This gives us the data to qualify upstream instead of consuming
-- property-manager time on denials.
CREATE TABLE public.prequal_attempts (
  id BIGSERIAL PRIMARY KEY,
  listing_id text NOT NULL,
  listing_address text,
  listing_rent numeric,
  email text NOT NULL,
  monthly_income numeric NOT NULL,
  credit_band text NOT NULL,
  desired_move_in date,
  passed boolean NOT NULL,
  fail_reasons text[],
  locale text DEFAULT 'en',
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX prequal_attempts_listing_idx ON public.prequal_attempts (listing_id);
CREATE INDEX prequal_attempts_created_idx ON public.prequal_attempts (created_at DESC);
CREATE INDEX prequal_attempts_passed_idx  ON public.prequal_attempts (passed, created_at DESC);

ALTER TABLE public.prequal_attempts ENABLE ROW LEVEL SECURITY;

-- The public site posts attempts via an unauthenticated request — the
-- API route uses the service role for inserts so RLS doesn't need a
-- permissive INSERT policy. Reads are restricted to authenticated users.
CREATE POLICY "Authenticated can read prequal attempts"
  ON public.prequal_attempts
  FOR SELECT TO authenticated USING (true);
