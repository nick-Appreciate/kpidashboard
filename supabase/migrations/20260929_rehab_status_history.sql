-- Stage-timing history for rehabs.
--
-- Why this exists: app/api/rehabs/route.js has been calling
--   supabase.from('rehab_status_history').insert(...)
-- from both POST and PATCH since it was written, but public.rehab_status_history
-- never existed. The only table by that name lives in the `properties` schema
-- with an unrelated column layout (status/start_date/end_date, 0 rows), the JS
-- client defaults to `public`, and neither call site checked its error — so
-- every status change has been silently dropped. This creates the table the
-- application has been trying to write to all along.
--
-- Two deliberate departures from what the app was attempting:
--
--  * Spans, not transitions. A row records the status a unit WAS in and the
--    window it held it, so "days in each stage" is a sum over rows rather than
--    a pairing exercise over transition events.
--
--  * A trigger, not app-level inserts. The GET handler mutates rehab_status in
--    four separate places while syncing against AppFolio (the pre-vacancy
--    default, the stale notice/eviction unlock, Vacant-Rented -> Rented, and
--    the Rented unlock) and none of them logged. A trigger catches every path,
--    including future ones.

create table if not exists public.rehab_status_history (
  id          uuid primary key default gen_random_uuid(),
  rehab_id    uuid not null references public.rehabs(id) on delete cascade,
  property    text,
  unit        text,
  status      text not null,
  started_at  timestamptz not null default now(),
  -- null = the span the unit is in right now.
  ended_at    timestamptz,
  -- Seeded from vacancy_start_date rather than observed. These carry a real
  -- total duration but no stage split, so the UI must not present them as a
  -- measured waiting/construction/leasing breakdown.
  backfilled  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists rehab_status_history_rehab_idx
  on public.rehab_status_history (rehab_id, started_at);

-- A unit can only be in one status at a time; this makes that an invariant
-- rather than a convention the trigger is trusted to keep.
create unique index if not exists rehab_status_history_one_open_idx
  on public.rehab_status_history (rehab_id)
  where ended_at is null;

create or replace function public.log_rehab_status_span()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_active_before boolean;
  v_active_after  boolean;
begin
  if tg_op = 'INSERT' then
    insert into public.rehab_status_history (rehab_id, property, unit, status, started_at)
    values (new.id, new.property, new.unit,
            coalesce(new.rehab_status, 'Not Started'),
            -- The clock starts when the unit came off lease, not when the row
            -- happened to be created; the sync can create a rehab days later.
            coalesce(new.vacancy_start_date::timestamptz, v_now));
    return new;
  end if;

  v_active_before := coalesce(old.status, '') not in ('archived', 'completed');
  v_active_after  := coalesce(new.status, '') not in ('archived', 'completed');

  -- Leaving the active lifecycle stops the clock.
  if v_active_before and not v_active_after then
    update public.rehab_status_history
       set ended_at = v_now
     where rehab_id = new.id and ended_at is null;
    return new;
  end if;

  -- Coming back into it (un-archive) starts a fresh span.
  if v_active_after and not v_active_before then
    insert into public.rehab_status_history (rehab_id, property, unit, status, started_at)
    values (new.id, new.property, new.unit, coalesce(new.rehab_status, 'Not Started'), v_now);
    return new;
  end if;

  if v_active_after and new.rehab_status is distinct from old.rehab_status then
    update public.rehab_status_history
       set ended_at = v_now
     where rehab_id = new.id and ended_at is null;

    insert into public.rehab_status_history (rehab_id, property, unit, status, started_at)
    values (new.id, new.property, new.unit, coalesce(new.rehab_status, 'Not Started'), v_now);
  end if;

  return new;
end;
$$;

drop trigger if exists rehabs_log_status_span_ins on public.rehabs;
create trigger rehabs_log_status_span_ins
  after insert on public.rehabs
  for each row execute function public.log_rehab_status_span();

drop trigger if exists rehabs_log_status_span_upd on public.rehabs;
create trigger rehabs_log_status_span_upd
  after update on public.rehabs
  for each row execute function public.log_rehab_status_span();

-- Seed one span per existing rehab so the chart has a total-days figure on day
-- one. Guarded so re-running can't double-seed.
insert into public.rehab_status_history
  (rehab_id, property, unit, status, started_at, ended_at, backfilled)
select r.id, r.property, r.unit,
       coalesce(r.rehab_status, 'Not Started'),
       coalesce(r.vacancy_start_date::timestamptz, r.created_at, now()),
       case
         when coalesce(r.status, '') in ('archived', 'completed')
           then coalesce(r.completion_date::timestamptz, r.updated_at, now())
         else null
       end,
       true
from public.rehabs r
where not exists (
  select 1 from public.rehab_status_history h where h.rehab_id = r.id
);

alter table public.rehab_status_history enable row level security;

-- Read-only to the app. Every write goes through the security-definer trigger,
-- so history can't be edited out from under the numbers it feeds.
drop policy if exists authenticated_read on public.rehab_status_history;
create policy authenticated_read on public.rehab_status_history
  for select to authenticated using (true);

grant select on public.rehab_status_history to authenticated;
