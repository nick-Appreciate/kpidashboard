-- Enable required extensions (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Store the project URL and anon key in Vault for secure access
-- First, check if secrets already exist and delete them to avoid duplicates
DO $$
BEGIN
  -- Delete existing secrets if they exist
  DELETE FROM vault.secrets WHERE name = 'project_url';
  DELETE FROM vault.secrets WHERE name = 'anon_key';
EXCEPTION
  WHEN undefined_table THEN
    -- vault.secrets doesn't exist, that's fine
    NULL;
END $$;

-- Create the secrets in Vault
SELECT vault.create_secret('https://hkmfsnhmxhhndzfxqmhp.supabase.co', 'project_url');
SELECT vault.create_secret('sb_publishable__xU1-FC05yBQ3UpIYp422A_WsA0iBUF', 'anon_key');

-- Unschedule existing job if it exists (to avoid duplicates)
SELECT cron.unschedule('sync-appfolio-hourly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-appfolio-hourly'
);

-- Schedule the sync-appfolio Edge Function to run every hour
SELECT cron.schedule(
  'sync-appfolio-hourly',
  '0 * * * *',  -- Every hour at minute 0
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/sync-appfolio',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
    ),
    body := jsonb_build_object('scheduled', true, 'time', now()),
    timeout_milliseconds := 300000  -- 5 minute timeout for the sync
  ) AS request_id;
  $$
);

-- Verify the job was created
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'sync-appfolio-hourly';
