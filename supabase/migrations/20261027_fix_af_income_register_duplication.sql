-- ─────────────────────────────────────────────────────────────────────────
-- af_income_register runaway duplication
--
-- On 2026-05-21 simmons_reconcile_resolutions was created with
--   af_id uuid REFERENCES af_income_register(id) ON DELETE CASCADE
-- Postgres refuses to TRUNCATE a table referenced by a foreign key, so
-- truncate_af_income_register() has errored on every run since. The
-- sync-appfolio edge function ignored that error and inserted a full copy
-- of the report every 15 minutes → ~157M rows / 30 GB by 2026-10-27.
--
-- 1) Drop the FK. It could never hold anyway: the sync regenerates every
--    row's uuid on each reload, so any af_id resolution is orphaned on the
--    next run. (0 of 6 resolutions use af_id today.)
-- 2) Empty the table. Its contents are a pure cache of AppFolio's
--    income_register report (receipt_date >= 2025-10-01), which the sync
--    re-pulls in full on its next run — so there is nothing to preserve,
--    and TRUNCATE returns the 30 GB to the OS immediately (no VACUUM FULL,
--    no 30 GB CREATE TABLE AS SELECT DISTINCT copy).
-- ─────────────────────────────────────────────────────────────────────────

-- Don't queue behind a long-running v_simmons_reconcile scan and block
-- every reader; fail fast and retry instead.
SET lock_timeout = '10s';

ALTER TABLE public.simmons_reconcile_resolutions
  DROP CONSTRAINT IF EXISTS simmons_reconcile_resolutions_af_id_fkey;

TRUNCATE public.af_income_register;

-- Alternative if the table ever needs to keep its rows (not needed today):
--   CREATE TABLE af_income_register_dedup AS
--     SELECT DISTINCT ON (txn_id, receipt_id, ...all data columns) *
--     FROM af_income_register ORDER BY ..., created_at DESC;
--   then swap names, recreate pkey + idx_af_income_register_{reference,receipt_date},
--   grants and RLS, and repoint v_simmons_reconcile.
