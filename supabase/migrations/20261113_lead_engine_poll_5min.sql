-- 2026-11-13: the project was on Nano compute and ran out of CPU/memory
-- (login outage). Compute upgraded to Small; the lead-engine AppFolio poll
-- drops from every 30s to every 5 min, and the old 5-min guest_cards sync is
-- removed (the lead-engine poll upserts the same rows). Website inquiries are
-- still texted instantly; AppFolio leads within ~5 min.
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'lead-engine-poll-30s'), schedule := '*/5 * * * *');
SELECT cron.unschedule('sync-appfolio-guest-cards-5min');
