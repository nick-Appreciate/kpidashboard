-- Schedule the sync-appfolio-listings edge function hourly.
-- Fires at minute 45 to offset from AppFolio sync (:00), BPU (:30), etc.

SELECT cron.unschedule('sync-appfolio-listings-hourly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-appfolio-listings-hourly'
);

SELECT cron.schedule(
  'sync-appfolio-listings-hourly',
  '45 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/sync-appfolio-listings',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
    ),
    body := jsonb_build_object('scheduled', true, 'time', now()),
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);

SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'sync-appfolio-listings-hourly';
