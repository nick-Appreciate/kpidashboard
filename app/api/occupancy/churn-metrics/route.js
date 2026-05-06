import { requireAuth } from '../../../../lib/auth';
import { NextResponse } from 'next/server';
import { resolvePropertySelection, cutoffDatesFor } from '../../../../lib/propertyGroups';

export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const { searchParams } = new URL(request.url);
  const grainParam = searchParams.get('grain');
  const grain = grainParam === 'quarter' ? 'quarter' : 'month';
  const startDate = searchParams.get('startDate') || null;
  const endDate = searchParams.get('endDate') || null;
  // The dashboard sends one of: a property name, 'farquhar',
  // 'region_kansas_city', 'region_columbia', or 'portfolio'/'all'.
  const property = searchParams.get('property') || searchParams.get('region') || null;

  // Pull the universe of property names from property_acquisitions so the
  // resolver can evaluate region and farquhar filters consistently.
  let propertyFilter = null;
  let cutoffDates = null;
  if (property && property !== 'portfolio' && property !== 'all') {
    const { data: known } = await supabase
      .from('property_acquisitions')
      .select('property_name');
    const universe = (known || []).map(r => r.property_name);
    propertyFilter = resolvePropertySelection(property, universe);
    cutoffDates = cutoffDatesFor(property);
  }

  const { data, error } = await supabase.rpc('get_churn_metrics', {
    grain,
    start_date: startDate,
    end_date: endDate,
    property_filter: propertyFilter,
    cutoff_dates: cutoffDates,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ grain, periods: data || [] });
}
