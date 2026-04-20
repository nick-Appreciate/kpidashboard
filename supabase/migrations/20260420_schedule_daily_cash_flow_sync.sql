-- Schedule a daily sync of af_cash_flow at midnight Central Time (05:00 UTC
-- during CDT). Runs sync-appfolio with ?report=cash_flow, which now APPENDS
-- a fresh snapshot per day rather than overwriting. Paired with the existing
-- 15-minute "all" sync (which no longer includes cash_flow) to keep table
-- growth bounded.
SELECT cron.schedule(
  'sync-appfolio-cash-flow-daily',
  '0 5 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/sync-appfolio?report=cash_flow',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
    ),
    body := jsonb_build_object('scheduled', true, 'time', now()),
    timeout_milliseconds := 300000
  ) AS request_id;
  $$
);
