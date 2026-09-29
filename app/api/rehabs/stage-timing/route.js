import { requireAuth } from '../../../../lib/auth';
import { NextResponse } from 'next/server';
import { filterRecordsByRegion } from '../../../../lib/propertyGroups';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// The turn-time target: waiting + under construction + leasing, per unit.
const GOAL_DAYS = 14;

function mean(nums) {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10;
}

function median(nums) {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(v * 10) / 10;
}

export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = new URL(request.url);
    const property = searchParams.get('property');
    const region = searchParams.get('region');
    // 'open' = units still in the pipeline. 'all' includes finished cycles,
    // which is what you want when judging averages.
    const scope = searchParams.get('scope') === 'all' ? 'all' : 'open';

    const { data, error } = await auth.supabase.rpc('rehab_stage_timing');
    if (error) {
      console.error('rehab_stage_timing failed:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let rows = (data || []).map(r => ({
      ...r,
      waiting_days: Number(r.waiting_days ?? 0),
      construction_days: Number(r.construction_days ?? 0),
      leasing_days: Number(r.leasing_days ?? 0),
      tracked_days: Number(r.tracked_days ?? 0),
      elapsed_days: r.elapsed_days === null ? null : Number(r.elapsed_days),
    }));

    if (property && property !== 'all' && property !== 'portfolio' && property !== 'farquhar') {
      rows = rows.filter(r => r.property === property);
    }
    // Region membership lives only in lib/propertyGroups.js — never re-derived here.
    rows = filterRecordsByRegion(rows, region);

    if (scope === 'open') rows = rows.filter(r => r.is_open);

    // Notice and Eviction mean the tenant is still in place, so no rehab time
    // has accrued. They're reported as a count, not plotted or averaged.
    const preVacancy = rows.filter(r => !r.in_rehab);
    rows = rows.filter(r => r.in_rehab);

    const measured = rows.filter(r => r.measured);
    const withElapsed = rows.filter(r => r.elapsed_days !== null);

    const byEndBasis = rows.reduce((acc, r) => {
      acc[r.end_basis] = (acc[r.end_basis] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      goal_days: GOAL_DAYS,
      scope,
      units: rows,
      summary: {
        count: rows.length,
        measured_count: measured.length,
        pre_vacancy_count: preVacancy.length,
        // Stage averages are only meaningful for units whose spans were
        // actually observed; a backfilled row has no real split.
        avg_waiting: mean(measured.map(r => r.waiting_days)),
        avg_construction: mean(measured.map(r => r.construction_days)),
        avg_leasing: mean(measured.map(r => r.leasing_days)),
        avg_tracked: mean(measured.map(r => r.tracked_days)),
        // Elapsed works for every unit with a usable end date, so it's the
        // honest headline number until measured spans accumulate.
        avg_elapsed: mean(withElapsed.map(r => r.elapsed_days)),
        median_elapsed: median(withElapsed.map(r => r.elapsed_days)),
        elapsed_count: withElapsed.length,
        within_goal: withElapsed.filter(r => r.elapsed_days <= GOAL_DAYS).length,
        over_goal: withElapsed.filter(r => r.elapsed_days > GOAL_DAYS).length,
        by_end_basis: byEndBasis,
      },
    });
  } catch (err) {
    console.error('Error in rehabs stage-timing GET:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
