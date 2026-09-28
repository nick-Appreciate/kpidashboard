import { requireAuth } from '../../../../lib/auth';

export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    // Same fix as the properties route: de-duplicating in JS capped the scan
    // at 1000 rows, which would drop late-alphabet statuses once the table
    // grew past that. Only three statuses exist today so nothing was missing
    // yet, but the query was wrong for the same reason.
    const { data, error } = await supabase.rpc('leasing_report_filter_options');

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    const statuses = (Array.isArray(data) ? data[0] : data)?.statuses ?? [];

    return Response.json(statuses, { headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=600' } });

  } catch (error) {
    console.error('Error fetching statuses:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
