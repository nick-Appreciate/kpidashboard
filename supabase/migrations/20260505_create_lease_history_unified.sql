-- Unified lease history across DoorLoop (pre-AppFolio) and AppFolio.
-- Built as a SQL view so it always reflects current data and dedup logic
-- can be iterated on without backfills.
--
-- Output columns:
--   source                   'doorloop' | 'appfolio'
--   external_id              lease_id (DL) or occupancy_id (AF)
--   tenant_name              raw name from each system
--   tenant_name_normalized   primary tenant only
--   property_name, unit_name unit identifiers (aligned between systems)
--   lease_start, lease_end   scheduled dates (DoorLoop only)
--   move_in_raw              actual move-in (AF) or lease start (DL)
--   acquisition_date         from public.property_acquisitions when known
--   divestiture_date         informational only — view does NOT clamp on it.
--                            Per-period cutoffs are applied by
--                            get_churn_metrics(cutoff_dates) for Farquhar.
--   move_in                  GREATEST(move_in_raw, acquisition_date)
--   move_out                 actual (AF) or audit-derived (DL).
--                            Bulk admin-cleanup days where dozens of stale
--                            DoorLoop leases were marked inactive at once
--                            are filtered (see bulk_event_dates CTE).
--   move_out_reason          end_of_lease | early | eviction | unknown | NULL
--   is_eviction              boolean
--   tenancy_status           lowercased status from each system
--   original_status          raw status from each system
--   tenancy_days             move_out − clamped move_in (when both present)
--   rent                     monthly recurring rent (DoorLoop only for now)
--
-- Bulk-event date list:
--   Days where DoorLoop had ≥25 deactivations on a single mid-month date
--   with broad start-date spans = admin cleanup, not real churn. Adding
--   to the list later: just append to the bulk_event_dates CTE.

DROP VIEW IF EXISTS public.lease_history_unified CASCADE;

CREATE VIEW public.lease_history_unified AS
WITH
bulk_event_dates AS (
  SELECT unnest(ARRAY[
    DATE '2023-08-09',  -- 47 deactivations, span 21yr
    DATE '2023-09-10',  -- 28 deactivations
    DATE '2023-09-26',  -- 25 deactivations
    DATE '2023-11-28',  -- 33 deactivations
    DATE '2023-12-10',  -- 13 deactivations, span 5.6yr
    DATE '2024-08-25',  -- 308 deactivations
    DATE '2024-08-27'   -- 284 deactivations
  ]) AS d
),
appfolio_named AS (
  SELECT
    a.id, a.occupancy_id, a.tenant_id, a.property_id,
    a.property_name, a.unit, a.move_in, a.move_out, a.status,
    COALESCE(
      (SELECT s.tenant_name FROM public.rent_roll_snapshots s
        WHERE s.property = a.property_name AND s.unit = a.unit
          AND s.tenant_name IS NOT NULL
        ORDER BY s.snapshot_date DESC LIMIT 1),
      (SELECT e.tenant_name FROM public.tenant_events e
        WHERE e.property = a.property_name AND e.unit = a.unit
          AND e.tenant_name IS NOT NULL
        ORDER BY e.snapshot_date DESC LIMIT 1)
    ) AS tenant_name
  FROM public.af_tenant_directory a
),
appfolio_rows AS (
  SELECT
    'appfolio'::text AS source,
    occupancy_id::text AS external_id,
    tenant_name,
    LOWER(REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(COALESCE(tenant_name,''), '\s*\([^)]*\)', '', 'g'),
        '\s*(&| and ).*$', '', 'i'),
      '\s+', ' ', 'g')) AS tenant_name_normalized,
    property_name,
    unit AS unit_name,
    NULL::date AS lease_start,
    NULL::date AS lease_end,
    move_in AS move_in_raw,
    move_out,
    LOWER(status) AS tenancy_status,
    status AS original_status,
    (status='Evict') AS is_eviction,
    CASE WHEN status='Evict' THEN 'eviction'
         WHEN status='Past'  THEN 'unknown'
         ELSE NULL END AS move_out_reason,
    NULL::numeric AS rent
  FROM appfolio_named
),
appfolio_name_index AS (
  SELECT DISTINCT
    TRIM(tenant_name_normalized) AS tenant_name_normalized,
    move_in_raw AS move_in, move_out
  FROM appfolio_rows
  WHERE TRIM(tenant_name_normalized) <> ''
),
doorloop_moveout AS (
  SELECT lease_id, MIN(stamp)::date AS move_out_date
  FROM (
    SELECT lease_id, stamp, active,
           LAG(active) OVER (PARTITION BY lease_id ORDER BY stamp) AS prev_active
    FROM leases.leases_audit
  ) t
  WHERE prev_active = TRUE AND active = FALSE
    AND stamp::date NOT IN (SELECT d FROM bulk_event_dates)
  GROUP BY lease_id
),
doorloop_rows AS (
  SELECT
    'doorloop'::text AS source,
    l.lease_id::text AS external_id,
    l.name AS tenant_name,
    LOWER(REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(COALESCE(l.name,''), '\s*\([^)]*\)', '', 'g'),
        '\s*(&| and ).*$', '', 'i'),
      '\s+', ' ', 'g')) AS tenant_name_normalized,
    p.name AS property_name,
    u.name AS unit_name,
    l.start_date::date AS lease_start,
    l.end_date::date AS lease_end,
    l.start_date::date AS move_in_raw,
    -- For expired/inactive leases without an audit-derived move-out, fall
    -- back to end_date — but skip the fallback if end_date is itself a
    -- bulk-event date (those are bookkeeping stamps, not real moves).
    COALESCE(
      mo.move_out_date,
      CASE WHEN l.status IN ('expired','inactive')
            AND l.end_date::date NOT IN (SELECT d FROM bulk_event_dates)
           THEN l.end_date::date END
    ) AS move_out,
    l.status AS tenancy_status,
    l.status AS original_status,
    l.eviction_pending AS is_eviction,
    CASE WHEN l.eviction_pending THEN 'eviction'
         WHEN l.status='inactive' AND mo.move_out_date IS NOT NULL
              AND l.end_date IS NOT NULL
              AND mo.move_out_date < l.end_date::date THEN 'early'
         WHEN l.status IN ('inactive','expired') THEN 'end_of_lease'
         ELSE NULL END AS move_out_reason,
    l.total_recurring_rent AS rent
  FROM leases.leases l
  LEFT JOIN properties.properties p ON p.property_id = l.property_id
  LEFT JOIN properties.units u ON u.unit_id = l.unit_id
  LEFT JOIN doorloop_moveout mo ON mo.lease_id = l.lease_id
),
combined AS (
  SELECT * FROM appfolio_rows
  UNION ALL
  SELECT d.* FROM doorloop_rows d
  WHERE TRIM(d.tenant_name_normalized) = ''
     OR NOT EXISTS (
          SELECT 1 FROM appfolio_name_index ai
          WHERE ai.tenant_name_normalized = TRIM(d.tenant_name_normalized)
            AND ai.move_in <= COALESCE(d.move_out, d.lease_end, CURRENT_DATE)
            AND COALESCE(ai.move_out, CURRENT_DATE) >= d.move_in_raw
        )
)
SELECT
  c.source,
  c.external_id,
  c.tenant_name,
  c.tenant_name_normalized,
  c.property_name,
  c.unit_name,
  c.lease_start,
  c.lease_end,
  c.move_in_raw,
  pa.acquisition_date,
  pa.divestiture_date,
  GREATEST(c.move_in_raw, pa.acquisition_date) AS move_in,
  c.move_out,
  c.move_out_reason,
  c.is_eviction,
  c.tenancy_status,
  c.original_status,
  CASE
    WHEN c.move_in_raw IS NOT NULL AND c.move_out IS NOT NULL
     AND c.move_out >= GREATEST(c.move_in_raw, pa.acquisition_date)
    THEN c.move_out - GREATEST(c.move_in_raw, pa.acquisition_date)
  END AS tenancy_days,
  c.rent
FROM combined c
LEFT JOIN public.property_acquisitions pa ON pa.property_name = c.property_name;

COMMENT ON VIEW public.lease_history_unified IS
  'Unified lease history. move_in clamped to acquisition_date. move_out filtered for bulk admin-cleanup dates (DoorLoop ops where dozens of stale leases got marked inactive on a single day) — both audit-log and end_date fallback paths.';
