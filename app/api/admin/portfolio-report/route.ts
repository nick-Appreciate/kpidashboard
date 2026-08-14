import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/auth';

// Portfolio status report — returns EVERYTHING needed for the report page in a
// single unfiltered payload. All aggregation + filtering is done client-side so
// changing the property filter re-renders instantly without a network round-trip.
//
// Payload:
//   properties_by_date        — per-property snapshot rows on each anchor date
//   ar_series_by_property     — per-property daily AR/receivables history (past year)
//   same_store_series_by_prop — per-property cumulative organic AR growth history
//   available_properties      — picker options
//   anchor_dates              — which snapshot_dates map to now / 1mo / 3mo / earliest

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  // 1. Find anchor dates
  const anchorsQ = await supabase
    .from('portfolio_snapshots')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: false })
    .limit(1);
  if (anchorsQ.error) return NextResponse.json({ error: anchorsQ.error.message }, { status: 500 });
  if (!anchorsQ.data || anchorsQ.data.length === 0) {
    return NextResponse.json({ error: 'portfolio_snapshots is empty' }, { status: 500 });
  }
  const today = anchorsQ.data[0].snapshot_date as string;

  const earliestQ = await supabase
    .from('portfolio_snapshots')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: true })
    .limit(1);
  const earliest = earliestQ.data?.[0]?.snapshot_date as string;

  async function nearestOnOrBefore(target: string): Promise<string | null> {
    const r = await supabase
      .from('portfolio_snapshots')
      .select('snapshot_date')
      .lte('snapshot_date', target)
      .order('snapshot_date', { ascending: false })
      .limit(1);
    return r.data?.[0]?.snapshot_date ?? null;
  }

  const todayDate = new Date(today);
  const d30 = new Date(todayDate); d30.setDate(d30.getDate() - 30);
  const d90 = new Date(todayDate); d90.setDate(d90.getDate() - 90);
  const d365 = new Date(todayDate); d365.setDate(d365.getDate() - 365);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const [m1, m3, y1] = await Promise.all([
    nearestOnOrBefore(iso(d30)),
    nearestOnOrBefore(iso(d90)),
    nearestOnOrBefore(iso(d365)),
  ]);
  const yearAnchor = y1 || earliest;
  const anchorDates = Array.from(new Set([today, m1, m3, yearAnchor].filter(Boolean))) as string[];

  // 2. Per-property rows on each anchor date
  const propsQ = await supabase
    .from('portfolio_snapshots')
    .select('*')
    .in('snapshot_date', anchorDates);
  if (propsQ.error) return NextResponse.json({ error: propsQ.error.message }, { status: 500 });

  const byDate: Record<string, any[]> = {};
  for (const row of (propsQ.data || [])) {
    (byDate[row.snapshot_date] ||= []).push(row);
  }

  // 3. Per-property AR time series (past year), chunked to dodge Supabase's 1k default
  const oneYearAgo = iso(new Date(todayDate.getTime() - 365 * 86400000));
  const propIdsQ = await supabase
    .from('portfolio_snapshots')
    .select('property_id')
    .eq('snapshot_date', today);
  const allPropIds: number[] = Array.from(new Set((propIdsQ.data || []).map((r: any) => r.property_id)));
  const arSeriesByProperty: Record<number, any[]> = {};
  for (const pid of allPropIds) {
    const r = await supabase
      .from('portfolio_snapshots')
      .select('snapshot_date, total_receivable, ar_0_30, ar_30_60, ar_60_90, ar_90_plus, ar_under_mgmt')
      .eq('property_id', pid)
      .gte('snapshot_date', oneYearAgo)
      .order('snapshot_date', { ascending: true });
    arSeriesByProperty[pid] = (r.data || []).map((row: any) => ({
      date: row.snapshot_date,
      total_receivable: Number(row.total_receivable) || 0,
      ar_0_30:  Number(row.ar_0_30) || 0,
      ar_30_60: Number(row.ar_30_60) || 0,
      ar_60_90: Number(row.ar_60_90) || 0,
      ar_90_plus: Number(row.ar_90_plus) || 0,
      ar_under_mgmt: Number(row.ar_under_mgmt) || 0,
    }));
  }

  // 4. Same-store series, packed server-side into a single JSONB so no PostgREST
  // row-count cap can silently truncate what the client sees. Returns:
  //   { "Glen Oaks": [{date, same_store_ar, units_included}, ...], ... }
  const ssQ = await supabase.rpc('portfolio_same_store_ar_series_grouped');
  const sameStoreByProperty: Record<string, any[]> = (ssQ.data as any) || {};

  // 4b. Current vacancies with leasing status + latest rehab status + market rent
  const vacQ = await supabase.rpc('portfolio_vacancies_today');
  const vacancies = (vacQ.data || []).map((v: any) => ({
    property_id: v.property_id,
    property: v.property,
    unit: v.unit,
    bed_bath: v.bed_bath,
    sqft: v.sqft,
    leasing_status: v.leasing_status,
    rehab_status: v.rehab_status,
    market_rent: v.market_rent == null ? null : Number(v.market_rent),
    notice_lease_end: v.notice_lease_end,
    tenant_on_notice: v.tenant_on_notice,
  }));

  // 5. Available properties (for picker + name↔id mapping)
  const availableQ = await supabase
    .from('portfolio_snapshots')
    .select('property_id, property_name, total_units')
    .eq('snapshot_date', today)
    .order('property_name', { ascending: true });
  const availableProperties = (availableQ.data || []).map((r: any) => ({
    property_id: r.property_id,
    property_name: (r.property_name || '').split(' - ')[0].trim(),
    property_name_full: r.property_name,
    total_units: r.total_units,
  }));

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    today,
    earliest,
    anchor_dates: {
      now: today,
      mo1: m1,
      mo3: m3,
      yr1: yearAnchor,
    },
    properties_by_date: byDate,
    ar_series_by_property: arSeriesByProperty,
    same_store_series_by_property: sameStoreByProperty,
    available_properties: availableProperties,
    vacancies,
  });
}
