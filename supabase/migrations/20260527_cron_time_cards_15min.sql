-- Tighten the Time Cards syncs to 15-minute cadence. Offset by 5 min from
-- the existing */15 crowd (sync-appfolio, parse-invoice-pdf, sync-brex)
-- so we spread the per-cycle network load.
--
-- Replaces:
--   sync-work-order-labor-hourly (25 * * * *)
--   sync-rippling-daily          (0 9 * * *)
--
-- Rationale: today's clocked-in shifts were stale on the Time Cards
-- dashboard because Rippling only synced once a day. Bumping both to
-- 15 minutes keeps the clocked-vs-billed ratio current within ~15 min
-- of either source changing.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-work-order-labor-hourly') THEN
    PERFORM cron.unschedule('sync-work-order-labor-hourly');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-rippling-daily') THEN
    PERFORM cron.unschedule('sync-rippling-daily');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-work-order-labor-15min') THEN
    PERFORM cron.unschedule('sync-work-order-labor-15min');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-rippling-15min') THEN
    PERFORM cron.unschedule('sync-rippling-15min');
  END IF;
END $$;

SELECT cron.schedule(
  'sync-work-order-labor-15min',
  '5,20,35,50 * * * *',
  $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/sync-work-order-labor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
    ),
    body := jsonb_build_object('scheduled', true, 'time', now()),
    timeout_milliseconds := 300000
  ) AS request_id;
  $cmd$
);

SELECT cron.schedule(
  'sync-rippling-15min',
  '10,25,40,55 * * * *',
  $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/sync-rippling',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
    ),
    body := jsonb_build_object('scheduled', true, 'time', now()),
    timeout_milliseconds := 300000
  ) AS request_id;
  $cmd$
);
