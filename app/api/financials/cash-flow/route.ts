import { requireAuth } from '../../../../lib/auth';
import { NextResponse } from 'next/server';

// Snapshot modes — map directly to Postgres views over af_cash_flow. Each
// returns one row per (property, account, period_start) picked by a different
// rule. Default mode is 'day_of_month' (apples-to-apples MTD comparisons).
//
//   day_of_month: snapshot taken on today's day-of-month for each month
//                 (e.g. if today is the 20th, shows each month's 20th)
//   month_end:    past months → final-day snapshot; current month → latest
//   latest:       most recent snapshot period (including post-month re-syncs)
const MODE_VIEWS: Record<string, string> = {
  day_of_month: 'af_cash_flow_day_of_month',
  month_end: 'af_cash_flow_month_end',
  latest: 'af_cash_flow_latest',
};
const DEFAULT_MODE = 'day_of_month';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { searchParams } = new URL(request.url);
    const months = parseInt(searchParams.get('months') || '12', 10);
    const properties = searchParams.get('properties')?.split(',').filter(Boolean) || [];
    const rowTypes = searchParams.get('row_types')?.split(',').filter(Boolean) || [];
    const modeParam = searchParams.get('mode') || DEFAULT_MODE;
    const viewName = MODE_VIEWS[modeParam] ?? MODE_VIEWS[DEFAULT_MODE];

    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    // Fetch all cash flow data in pages of 1000 from the snapshot-mode view.
    let allData: any[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      let query = supabase
        .from(viewName)
        .select('period_start, period_end, account_name, account_number, account_type, account_depth, row_type, parent_account, property_name, amount, synced_at')
        .gte('period_start', cutoffStr)
        .order('period_start', { ascending: true })
        .order('account_number', { ascending: true, nullsFirst: false })
        .range(from, from + pageSize - 1);

      if (properties.length > 0) query = query.in('property_name', properties);
      if (rowTypes.length > 0) query = query.in('row_type', rowTypes);

      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) break;
      allData = allData.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    // Derive the distinct property list from the already-paginated allData
    // rather than running a separate .select('property_name') query. That
    // separate query hits PostgREST's default 1000-row response cap and
    // silently drops properties alphabetically late in the list (e.g.
    // Oakwood Gardens, Pioneer Apartments). Because `allData` is paginated
    // above, it contains every row and therefore every distinct property.
    const uniqueProperties = Array.from(
      new Set(allData.map((r: any) => r.property_name).filter((p: string) => p && p !== 'Total'))
    ).sort();

    // Fetch COA for ordering
    const { data: coaRows } = await supabase
      .from('af_chart_of_accounts')
      .select('number, account_name, account_type, sub_accountof')
      .eq('hidden', false)
      .order('number', { ascending: true });

    // Fetch property -> owner mapping
    const { data: propDirRows } = await supabase
      .from('af_property_directory')
      .select('property_name, owners, owner_ids, portfolio');

    return NextResponse.json({
      data: allData,
      properties: uniqueProperties,
      coa: coaRows || [],
      propertyOwners: propDirRows || [],
      mode: modeParam,
    });
  } catch (err: any) {
    console.error('Cash flow API error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to fetch cash flow data' }, { status: 500 });
  }
}
