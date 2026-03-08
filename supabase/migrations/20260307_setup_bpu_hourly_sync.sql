-- Schedule the sync-bpu Edge Function to run every hour at minute 30
-- (offset from AppFolio sync at minute 0 to avoid overlap)

-- Unschedule existing job if it exists (to avoid duplicates)
SELECT cron.unschedule('sync-bpu-hourly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-bpu-hourly'
);

-- Schedule hourly BPU sync
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
    body := jsonb_build_object('scheduled', true, 'days', 3, 'time', now()),
    timeout_milliseconds := 300000  -- 5 minute timeout
  ) AS request_id;
  $$
);

-- Verify the job was created
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'sync-bpu-hourly';
