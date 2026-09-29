-- Average days vacant, as of each rent-roll snapshot.
--
-- rehab_daily_snapshots.avg_days_vacant exists but is all zeros across all
-- 2,160 rows, so this reconstructs the series from rent_roll_snapshots instead
-- (81k rows, 2024-05-07 onward).
--
-- "Vacant" means the unit is actually empty (Vacant-Unrented or Vacant-Rented).
-- Notice and Evict are excluded: the tenant is still living there, which is the
-- same convention the rehab turn clock uses.
--
-- Each unit's current vacancy run is found by gaps-and-islands over its own
-- observations, so a unit that goes vacant, re-leases, and goes vacant again
-- gets a fresh clock rather than one cumulative total.
--
-- Resolution caveat, surfaced as days_since_prev_snapshot: snapshots were taken
-- roughly weekly from 2024-05 until 2026-01, then daily from 2026-02 on. In the
-- weekly era a vacancy start is only known to within about a week, so early
-- points carry more error than later ones. Callers should show that rather than
-- drawing one smooth line across the change.
--
-- Note for readers of the output: the mean runs far above the median here
-- because a few units have been vacant for hundreds of days. The median is the
-- turn-performance number; the mean is the portfolio-drag number.
create or replace function public.avg_days_vacant_over_time(p_properties text[] default null)
returns table (
  snapshot_date            date,
  vacant_units             integer,
  unrented_units           integer,
  rented_units             integer,
  total_units              integer,
  vacancy_rate             numeric,
  avg_days_vacant          numeric,
  median_days_vacant       numeric,
  p90_days_vacant          numeric,
  max_days_vacant          numeric,
  days_since_prev_snapshot integer
)
language sql
stable
security invoker
as $$
  with flagged as (
    select
      s.property,
      s.unit,
      s.snapshot_date,
      s.status,
      (s.status in ('Vacant-Unrented', 'Vacant-Rented')) as is_vacant
    from public.rent_roll_snapshots s
    where p_properties is null or s.property = any(p_properties)
  ),
  islands as (
    select
      f.*,
      row_number() over (partition by f.property, f.unit order by f.snapshot_date)
        - row_number() over (partition by f.property, f.unit, f.is_vacant order by f.snapshot_date)
        as grp
    from flagged f
  ),
  runs as (
    select
      i.*,
      min(i.snapshot_date) over (
        partition by i.property, i.unit, i.is_vacant, i.grp
      ) as run_start
    from islands i
  ),
  per_day as (
    select
      r.snapshot_date,
      count(*) filter (where r.is_vacant)::integer as vacant_units,
      count(*) filter (where r.status = 'Vacant-Unrented')::integer as unrented_units,
      count(*) filter (where r.status = 'Vacant-Rented')::integer as rented_units,
      count(*)::integer as total_units,
      round(
        100.0 * count(*) filter (where r.is_vacant) / nullif(count(*), 0), 1
      ) as vacancy_rate,
      round(avg(r.snapshot_date - r.run_start) filter (where r.is_vacant), 1) as avg_days_vacant,
      round(
        (percentile_cont(0.5) within group (order by (r.snapshot_date - r.run_start))
          filter (where r.is_vacant))::numeric, 1
      ) as median_days_vacant,
      round(
        (percentile_cont(0.9) within group (order by (r.snapshot_date - r.run_start))
          filter (where r.is_vacant))::numeric, 1
      ) as p90_days_vacant,
      (max(r.snapshot_date - r.run_start) filter (where r.is_vacant))::numeric as max_days_vacant
    from runs r
    group by r.snapshot_date
  )
  select
    p.snapshot_date,
    p.vacant_units,
    p.unrented_units,
    p.rented_units,
    p.total_units,
    p.vacancy_rate,
    p.avg_days_vacant,
    p.median_days_vacant,
    p.p90_days_vacant,
    p.max_days_vacant,
    (p.snapshot_date - lag(p.snapshot_date) over (order by p.snapshot_date))::integer
      as days_since_prev_snapshot
  from per_day p
  order by p.snapshot_date;
$$;

grant execute on function public.avg_days_vacant_over_time(text[]) to authenticated;
