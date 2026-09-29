import { requireAuth } from '../../../../lib/auth';
import { NextResponse } from 'next/server';
import { resolvePropertySelection } from '../../../../lib/propertyGroups';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Snapshots were taken roughly weekly until this date, daily afterwards. Points
// before it carry about a week of error on each vacancy start, so the chart
// marks the boundary instead of pretending the whole series is one resolution.
const DAILY_SNAPSHOTS_FROM = '2026-02-01';

export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { searchParams } = new URL(request.url);
    const selection = searchParams.get('property') || 'all';
    const daysParam = searchParams.get('days') || '365';
    const isAllTime = daysParam === 'all';
    const days = parseInt(daysParam, 10);

    // Resolving a region needs the concrete property names. Read them from the
    // latest snapshot rather than scanning the whole column — a bare distinct
    // over 81k rows silently truncates at PostgREST's 1000-row cap, which is
    // exactly how Oakwood went missing from the leasing filter.
    let properties = null;
    if (selection && selection !== 'all' && selection !== 'portfolio') {
      const { data: latest } = await supabase
        .from('rent_roll_snapshots')
        .select('snapshot_date')
        .order('snapshot_date', { ascending: false })
        .limit(1);
      const latestDate = latest?.[0]?.snapshot_date;

      let available = [];
      if (latestDate) {
        const { data: rows } = await supabase
          .from('rent_roll_snapshots')
          .select('property')
          .eq('snapshot_date', latestDate);
        available = Array.from(new Set((rows || []).map(r => r.property).filter(Boolean)));
      }
      // Region membership lives only in lib/propertyGroups.js.
      properties = resolvePropertySelection(selection, available);
    }

    const { data, error } = await supabase.rpc('avg_days_vacant_over_time', {
      p_properties: properties,
    });
    if (error) {
      console.error('avg_days_vacant_over_time failed:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let series = (data || []).map(r => ({
      snapshot_date: r.snapshot_date,
      vacant_units: Number(r.vacant_units ?? 0),
      unrented_units: Number(r.unrented_units ?? 0),
      rented_units: Number(r.rented_units ?? 0),
      total_units: Number(r.total_units ?? 0),
      vacancy_rate: r.vacancy_rate === null ? null : Number(r.vacancy_rate),
      avg_days_vacant: r.avg_days_vacant === null ? null : Number(r.avg_days_vacant),
      median_days_vacant: r.median_days_vacant === null ? null : Number(r.median_days_vacant),
      p90_days_vacant: r.p90_days_vacant === null ? null : Number(r.p90_days_vacant),
      max_days_vacant: r.max_days_vacant === null ? null : Number(r.max_days_vacant),
      daily_resolution: r.snapshot_date >= DAILY_SNAPSHOTS_FROM,
    }));

    if (!isAllTime && Number.isFinite(days) && days > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      series = series.filter(p => p.snapshot_date >= cutoffStr);
    }

    const latestPoint = series.length ? series[series.length - 1] : null;
    const firstPoint = series.length ? series[0] : null;

    return NextResponse.json({
      selection,
      days: isAllTime ? 'all' : days,
      daily_snapshots_from: DAILY_SNAPSHOTS_FROM,
      series,
      summary: latestPoint && {
        as_of: latestPoint.snapshot_date,
        vacant_units: latestPoint.vacant_units,
        vacancy_rate: latestPoint.vacancy_rate,
        avg_days_vacant: latestPoint.avg_days_vacant,
        median_days_vacant: latestPoint.median_days_vacant,
        p90_days_vacant: latestPoint.p90_days_vacant,
        max_days_vacant: latestPoint.max_days_vacant,
        // Direction of travel over the window actually being shown.
        avg_change: firstPoint && firstPoint.avg_days_vacant !== null && latestPoint.avg_days_vacant !== null
          ? Math.round((latestPoint.avg_days_vacant - firstPoint.avg_days_vacant) * 10) / 10
          : null,
        median_change: firstPoint && firstPoint.median_days_vacant !== null && latestPoint.median_days_vacant !== null
          ? Math.round((latestPoint.median_days_vacant - firstPoint.median_days_vacant) * 10) / 10
          : null,
      },
    });
  } catch (err) {
    console.error('Error in vacancy-trend GET:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
