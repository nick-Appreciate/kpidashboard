-- Keep JustCall call logs fresh: pull the last 2 days every 15 minutes.
-- Upsert-by-id makes the overlapping window idempotent; new calls land within
-- ~15 min and history accumulates past the API's 3-month limit. Reuses the
-- project_url / anon_key vault secrets from 20260209_setup_hourly_sync.sql.

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('sync-justcall-15min') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-justcall-15min'
);

SELECT cron.schedule(
  'sync-justcall-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/sync-justcall?days=2',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
    ),
    body := jsonb_build_object('scheduled', true, 'time', now()),
    timeout_milliseconds := 90000
  ) AS request_id;
  $$
);
