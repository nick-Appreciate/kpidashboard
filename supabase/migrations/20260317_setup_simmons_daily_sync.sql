-- Schedule daily Simmons Bank deposit sync via pg_cron
-- Runs every 6 hours to catch new deposits throughout the day
-- Uses fire-and-forget pattern: edge function triggers bot, bot handles the rest

-- Remove existing job if any
SELECT cron.unschedule('sync-simmons-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-simmons-daily'
);

-- Schedule: every 6 hours at minute 15 (offset from BPU at minute 30)
SELECT cron.schedule(
  'sync-simmons-daily',
  '15 */6 * * *',  -- At :15 past every 6th hour (00:15, 06:15, 12:15, 18:15)
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/sync-simmons',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
    ),
    body := jsonb_build_object('scheduled', true, 'days', 14, 'extract', true, 'time', now()),
    timeout_milliseconds := 60000  -- 1 minute timeout (fire-and-forget, bot handles the rest)
  ) AS request_id;
  $$
);

-- Verify
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'sync-simmons-daily';
