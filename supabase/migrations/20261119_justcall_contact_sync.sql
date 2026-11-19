-- JustCall contacts for every known phone number (tenant / vendor / former
-- tenant / prospect). One row per normalized number; the justcall-contacts
-- edge function pushes rows whose desired_hash differs from synced_hash.
CREATE TABLE IF NOT EXISTS public.justcall_contact_sync (
  phone_norm   text PRIMARY KEY,
  source       text NOT NULL,          -- tenant | vendor | former_tenant | prospect
  source_id    text,
  first_name   text NOT NULL,          -- e.g. "Jala T. Adams - 1906-11"
  last_name    text,
  company      text,
  desired_hash text NOT NULL,
  synced_hash  text,
  justcall_ids text[],
  prev_name    text,                   -- name JustCall had before we overwrote it
  action       text,                   -- created | updated | unchanged
  error        text,
  attempts     int NOT NULL DEFAULT 0,
  synced_at    timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.justcall_contact_sync ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_read ON public.justcall_contact_sync;
CREATE POLICY authenticated_read ON public.justcall_contact_sync FOR SELECT TO authenticated USING (true);

-- Every 5 minutes, 25 contacts per run (~50 JustCall requests). Backfill drains
-- in ~6–7 hours; afterwards runs are no-ops unless a name/unit/number changes.
SELECT cron.unschedule('justcall-contacts-5min') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'justcall-contacts-5min');
SELECT cron.schedule('justcall-contacts-5min', '1-59/3 * * * *', $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/justcall-contacts?limit=25',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'x-lead-engine-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lead_engine_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 150000) $$);

-- PostgREST can't compare two columns, so expose the comparison as a column.
ALTER TABLE public.justcall_contact_sync ADD COLUMN IF NOT EXISTS needs_sync boolean GENERATED ALWAYS AS (synced_hash IS DISTINCT FROM desired_hash) STORED;
CREATE INDEX IF NOT EXISTS justcall_contact_sync_needs_sync_idx ON public.justcall_contact_sync (source) WHERE needs_sync;
