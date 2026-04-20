import { requireAuth } from '../../../../lib/auth';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { searchParams } = new URL(request.url);
    const months = parseInt(searchParams.get('months') || '12', 10);
    const properties = searchParams.get('properties')?.split(',').filter(Boolean) || [];
    const rowTypes = searchParams.get('row_types')?.split(',').filter(Boolean) || [];

    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    // Fetch all cash flow data in pages of 1000
    let allData: any[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      // af_cash_flow_latest returns only the most recent snapshot per
      // (property, account, period_start). The underlying af_cash_flow table
      // now keeps full snapshot history — views that want historical MTD
      // should query af_cash_flow directly with a synced_at filter.
      let query = supabase
        .from('af_cash_flow_latest')
        .select('period_start, period_end, account_name, account_number, account_type, account_depth, row_type, parent_account, property_name, amount')
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

    // Fetch distinct properties (also from the latest-snapshot view)
    const { data: propRows } = await supabase
      .from('af_cash_flow_latest')
      .select('property_name')
      .neq('property_name', 'Total')
      .gte('period_start', cutoffStr);

    const uniqueProperties = Array.from(new Set((propRows || []).map((r: any) => r.property_name))).sort();

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
      propertyOwners: propDirRows || []
    });
  } catch (err: any) {
    console.error('Cash flow API error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to fetch cash flow data' }, { status: 500 });
  }
}
