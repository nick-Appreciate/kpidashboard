-- Shared secret pg_cron passes to lead-engine (deployed verify_jwt=false; the
-- function authenticates callers itself). Only service_role can check it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'lead_engine_secret') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'lead_engine_secret', 'Shared secret pg_cron passes to the lead-engine edge function');
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.lead_engine_secret_ok(p text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(p, '') <> '' AND p = (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lead_engine_secret');
$$;
REVOKE ALL ON FUNCTION public.lead_engine_secret_ok(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_engine_secret_ok(text) TO service_role;

-- 30-second AppFolio poll → instant text; 5-minute tour sequences.
SELECT cron.schedule('lead-engine-poll-30s', '30 seconds', $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/lead-engine?mode=poll',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'x-lead-engine-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lead_engine_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 25000) $$);
SELECT cron.schedule('lead-engine-sequences-5min', '*/5 * * * *', $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/lead-engine?mode=sequences',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'x-lead-engine-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lead_engine_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000) $$);
