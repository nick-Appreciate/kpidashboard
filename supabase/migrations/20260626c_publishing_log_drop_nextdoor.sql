-- NextDoor was dropped from the publishing dashboard — keep the CHECK
-- constraint aligned with the actual channel set so accidental writes
-- of 'nextdoor' fail loudly instead of silently accumulating dead rows.
ALTER TABLE public.publishing_log DROP CONSTRAINT publishing_log_channel_check;
ALTER TABLE public.publishing_log ADD CONSTRAINT publishing_log_channel_check
  CHECK (channel IN ('fb_marketplace','craigslist'));
