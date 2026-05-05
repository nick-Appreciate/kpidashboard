-- Unified lease history across DoorLoop (pre-AppFolio) and AppFolio.
-- Built as a SQL view so it always reflects current data and dedup logic
-- can be iterated on without backfills.
--
-- Output columns:
--   source                   'doorloop' | 'appfolio'
--   external_id              lease_id (DL) or occupancy_id (AF)
--   tenant_name              raw name from each system
--   tenant_name_normalized   primary tenant only — strips parenthesized
--                            notes, anything after "&" or " and ", lowercased
--   property_name, unit_name unit identifiers (aligned between systems)
--   lease_start, lease_end   scheduled dates (DoorLoop only; AF nulls)
--   move_in, move_out        actual dates. AF move_out comes from
--                            af_tenant_directory; DL move_out is a proxy from
--                            leases_audit (first active=true→false transition)
--                            with the 2024-08-25 and 2024-08-27 bulk-update
--                            days excluded
--   move_out_reason          end_of_lease | early | eviction | unknown | NULL
--   is_eviction              boolean
--   tenancy_status           lowercased status from each system
--   original_status          raw status from each system
--   tenancy_days             move_out − move_in (when both present)
--   rent                     monthly recurring rent (DoorLoop only for now)
--
-- Dedup: a DoorLoop lease is suppressed when AppFolio has a row with the
-- same normalized primary tenant name AND a date window that overlaps the
-- DoorLoop lease window. AppFolio always wins on collision.

CREATE OR REPLACE VIEW public.lease_history_unified AS
WITH
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
    move_in,
    move_out,
    CASE WHEN status='Evict' THEN 'eviction'
         WHEN status='Past'  THEN 'unknown'
         ELSE NULL END AS move_out_reason,
    (status='Evict') AS is_eviction,
    LOWER(status) AS tenancy_status,
    status AS original_status,
    CASE WHEN move_in IS NOT NULL AND move_out IS NOT NULL AND move_out>=move_in
         THEN (move_out - move_in) END AS tenancy_days,
    NULL::numeric AS rent
  FROM appfolio_named
),
appfolio_name_index AS (
  SELECT DISTINCT
    TRIM(tenant_name_normalized) AS tenant_name_normalized,
    move_in, move_out
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
  WHERE prev_active=TRUE AND active=FALSE
    AND stamp::date NOT IN (DATE '2024-08-25', DATE '2024-08-27')
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
    l.start_date::date AS move_in,
    COALESCE(mo.move_out_date,
             CASE WHEN l.status IN ('expired','inactive') THEN l.end_date::date END) AS move_out,
    CASE WHEN l.eviction_pending THEN 'eviction'
         WHEN l.status='inactive' AND mo.move_out_date IS NOT NULL
              AND l.end_date IS NOT NULL
              AND mo.move_out_date < l.end_date::date THEN 'early'
         WHEN l.status IN ('inactive','expired') THEN 'end_of_lease'
         ELSE NULL END AS move_out_reason,
    l.eviction_pending AS is_eviction,
    l.status AS tenancy_status,
    l.status AS original_status,
    CASE WHEN l.start_date IS NOT NULL
              AND COALESCE(mo.move_out_date, l.end_date::date) IS NOT NULL
              AND COALESCE(mo.move_out_date, l.end_date::date) >= l.start_date::date
         THEN COALESCE(mo.move_out_date, l.end_date::date) - l.start_date::date END AS tenancy_days,
    l.total_recurring_rent AS rent
  FROM leases.leases l
  LEFT JOIN properties.properties p ON p.property_id = l.property_id
  LEFT JOIN properties.units u ON u.unit_id = l.unit_id
  LEFT JOIN doorloop_moveout mo ON mo.lease_id = l.lease_id
)
SELECT * FROM appfolio_rows
UNION ALL
SELECT d.* FROM doorloop_rows d
WHERE TRIM(d.tenant_name_normalized) = ''
   OR NOT EXISTS (
        SELECT 1 FROM appfolio_name_index ai
        WHERE ai.tenant_name_normalized = TRIM(d.tenant_name_normalized)
          AND ai.move_in <= COALESCE(d.move_out, d.lease_end, CURRENT_DATE)
          AND COALESCE(ai.move_out, CURRENT_DATE) >= d.move_in
      );

COMMENT ON VIEW public.lease_history_unified IS
  'Unified lease history across DoorLoop (leases.leases) and AppFolio (af_tenant_directory). Tenant names normalized to the primary tenant (strips co-tenants after "&" or " and ", and parenthesized notes). DoorLoop leases are suppressed when AppFolio has the same primary tenant within an overlapping date window. DoorLoop move_out is a proxy from leases_audit (first active=true→false transition); the 2024-08-25 and 2024-08-27 bulk-update days are excluded.';
