-- Increase Simmons sync frequency from every 6 hours to every 2 hours
-- Combined with the 30-minute server-side watchdog, this ensures sessions
-- recover within 30 min and data syncs at least every 2 hours.

-- Remove existing 6-hour job
SELECT cron.unschedule('sync-simmons-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-simmons-daily'
);

-- Schedule: every 2 hours at minute 15
SELECT cron.schedule(
  'sync-simmons-2h',
  '15 */2 * * *',  -- At :15 past every 2nd hour (00:15, 02:15, 04:15, ...)
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/sync-simmons',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
    ),
    body := jsonb_build_object('scheduled', true, 'days', 14, 'extract', true, 'time', now()),
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);

-- Verify
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname LIKE 'sync-simmons%';
