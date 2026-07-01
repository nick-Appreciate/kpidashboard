-- Dedicated 5-minute guest_cards poll for speed-to-lead capture.
--
-- The main sync runs the FULL report suite hourly. Speed-to-lead needs the
-- guest_cards report far more often: at ~5 min we (a) observe the first
-- outbound "Text Sent" while it's still the most-recent activity, before a
-- "Call to Action" reminder masks it, and (b) bound observation latency to
-- ~5 min. This job hits ONLY ?report=guest_cards (one AppFolio call), so it's
-- cheap enough to run every 5 minutes. Reuses the project_url / anon_key vault
-- secrets created in 20260209_setup_hourly_sync.sql.

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Unschedule if it already exists (idempotent re-runs).
SELECT cron.unschedule('sync-appfolio-guest-cards-5min') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-appfolio-guest-cards-5min'
);

SELECT cron.schedule(
  'sync-appfolio-guest-cards-5min',
  '*/5 * * * *',  -- every 5 minutes
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/sync-appfolio?report=guest_cards',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
    ),
    body := jsonb_build_object('scheduled', true, 'time', now()),
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);

SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'sync-appfolio-guest-cards-5min';
