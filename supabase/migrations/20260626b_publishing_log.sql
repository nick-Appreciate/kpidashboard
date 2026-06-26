-- Per-unit per-channel publishing log. Drives the "last posted N days
-- ago" + "due for repost" badges on /admin/publishing.
--
-- Built as part of C1 from the leasing audit: AppFolio's syndication
-- doesn't reach Facebook Marketplace, Craigslist, or NextDoor — which
-- means we work around it with assisted manual posting. Each row is
-- the manager confirming "yes I just posted this unit to this channel."
CREATE TABLE public.publishing_log (
  id BIGSERIAL PRIMARY KEY,
  property text NOT NULL,
  unit text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('fb_marketplace','craigslist','nextdoor')),
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text
);

CREATE INDEX publishing_log_unit_idx    ON public.publishing_log (property, unit, channel, posted_at DESC);
CREATE INDEX publishing_log_channel_idx ON public.publishing_log (channel, posted_at DESC);

ALTER TABLE public.publishing_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read publishing log"
  ON public.publishing_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert publishing log"
  ON public.publishing_log FOR INSERT TO authenticated WITH CHECK (true);
