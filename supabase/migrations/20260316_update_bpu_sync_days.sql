-- Update BPU sync cron job to use 14-day lookback (was 3 days, causing data gaps)
-- Also: edge function now uses fire-and-forget /api/scrape-async endpoints
-- so it won't timeout waiting for the browser scrape to complete.

-- Unschedule existing job
SELECT cron.unschedule('sync-bpu-hourly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-bpu-hourly'
);

-- Reschedule with 14-day lookback
SELECT cron.schedule(
  'sync-bpu-hourly',
  '30 * * * *',  -- Every hour at minute 30
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/sync-bpu',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
    ),
    body := jsonb_build_object('scheduled', true, 'days', 14, 'time', now()),
    timeout_milliseconds := 60000  -- 1 minute timeout (fire-and-forget, bot handles the rest)
  ) AS request_id;
  $$
);

-- Verify
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'sync-bpu-hourly';
