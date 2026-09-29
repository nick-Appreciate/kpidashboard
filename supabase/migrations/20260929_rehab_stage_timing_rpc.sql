-- Per-rehab stage durations, derived from the status spans recorded by
-- rehabs_log_status_span (see 20260929_rehab_status_history.sql).
--
-- Notice and Eviction are deliberately excluded from the three tracked stages
-- AND from elapsed_days: the tenant is still living there, so no rehab time has
-- accrued. The turn clock starts when the unit is actually vacant. `in_rehab`
-- marks those rows so callers drop them from charts and averages instead of
-- inferring it from the status string. Rented is terminal. Everything else
-- buckets into waiting / construction / leasing.
--
-- Two flags keep the caller honest about what each number is worth:
--
--   measured  - false for a backfilled row. A backfilled span carries the
--               unit's CURRENT status, so its bucket attribution is
--               meaningless; only its elapsed time is real. Callers must not
--               present an unmeasured row as a stage breakdown.
--
--   end_basis - where the end of the window came from:
--                 open            still in the pipeline, clock running to now()
--                 completion_date rehab marked Complete on a known date
--                 archived_at     inferred; the unit dropped off AppFolio's
--                                 vacancy list and the sync archived it. Within
--                                 about a day of the real event (snapshots are
--                                 daily) but not a recorded completion.
--                 unknown         no usable end date; elapsed_days is null and
--                                 the row must be excluded from averages.
drop function if exists public.rehab_stage_timing();

create or replace function public.rehab_stage_timing()
returns table (
  rehab_id           uuid,
  property           text,
  unit               text,
  rehab_status       text,
  lifecycle_status   text,
  vacancy_start_date date,
  completion_date    date,
  waiting_days       numeric,
  construction_days  numeric,
  leasing_days       numeric,
  tracked_days       numeric,
  elapsed_days       numeric,
  end_basis          text,
  measured           boolean,
  is_open            boolean,
  in_rehab           boolean
)
language sql
stable
security invoker
as $$
  with spans as (
    select
      h.rehab_id,
      h.backfilled,
      h.started_at,
      coalesce(h.ended_at, now()) as ended_at,
      case
        when h.status in ('Not Started', 'Back Burner', 'Supervisor onboard', 'Supervisor Onboard', 'Waiting') then 'waiting'
        when h.status = 'In Progress' then 'construction'
        when h.status = 'Complete'    then 'leasing'
        else 'excluded'
      end as bucket,
      greatest(
        extract(epoch from (coalesce(h.ended_at, now()) - h.started_at)) / 86400.0,
        0
      ) as days
    from public.rehab_status_history h
  ),
  per_rehab as (
    select
      s.rehab_id,
      sum(case when not s.backfilled and s.bucket = 'waiting'      then s.days else 0 end) as waiting_days,
      sum(case when not s.backfilled and s.bucket = 'construction' then s.days else 0 end) as construction_days,
      sum(case when not s.backfilled and s.bucket = 'leasing'      then s.days else 0 end) as leasing_days,
      min(s.started_at) as first_start,
      max(s.ended_at)   as last_end,
      bool_or(s.backfilled) as any_backfilled
    from spans s
    group by s.rehab_id
  ),
  resolved as (
    select
      r.id, r.property, r.unit, r.rehab_status, r.status,
      r.vacancy_start_date, r.completion_date,
      p.waiting_days, p.construction_days, p.leasing_days,
      p.first_start, p.last_end,
      not coalesce(p.any_backfilled, true) as measured,
      coalesce(r.status, '') not in ('archived', 'completed') as is_open,
      -- Tenant still in place => the rehab clock has not started.
      coalesce(r.rehab_status, '') not in ('Notice', 'Eviction') as in_rehab,
      case
        when coalesce(r.status, '') not in ('archived', 'completed') then 'open'
        when r.completion_date is not null then 'completion_date'
        when r.updated_at is not null then 'archived_at'
        else 'unknown'
      end as end_basis
    from public.rehabs r
    left join per_rehab p on p.rehab_id = r.id
  )
  select
    d.id, d.property, d.unit, d.rehab_status, d.status,
    d.vacancy_start_date, d.completion_date,
    round(coalesce(d.waiting_days, 0), 1),
    round(coalesce(d.construction_days, 0), 1),
    round(coalesce(d.leasing_days, 0), 1),
    round(coalesce(d.waiting_days, 0) + coalesce(d.construction_days, 0) + coalesce(d.leasing_days, 0), 1),
    case
      -- Pre-vacancy: no rehab time has accrued, so report nothing rather than
      -- the notice/eviction age.
      when not d.in_rehab then null
      when d.end_basis = 'unknown' then null
      -- Once a unit has real measured spans, the spans are the truth.
      when d.measured then round(
        greatest(extract(epoch from (d.last_end - d.first_start)) / 86400.0, 0), 1)
      -- Otherwise derive from the dated fields on rehabs, never from the
      -- backfilled span's own end, so end_basis and the number always agree.
      when d.vacancy_start_date is null then null
      when d.end_basis = 'open' then round(
        greatest(extract(epoch from (now() - d.vacancy_start_date::timestamptz)) / 86400.0, 0), 1)
      when d.end_basis = 'completion_date' then round(
        greatest(extract(epoch from (d.completion_date::timestamptz - d.vacancy_start_date::timestamptz)) / 86400.0, 0), 1)
      else round(
        greatest(extract(epoch from (d.last_end - d.vacancy_start_date::timestamptz)) / 86400.0, 0), 1)
    end,
    d.end_basis,
    d.measured,
    d.is_open,
    d.in_rehab
  from resolved d;
$$;

grant execute on function public.rehab_stage_timing() to authenticated;
