import { requireAuth } from '../../../../lib/auth';

export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    // DISTINCT happens in the database. Selecting the column and de-duplicating
    // here capped the scan at PostgREST's 1000-row limit, and because the rows
    // came back ordered by property that silently dropped the tail of the
    // alphabet — Oakwood Gardens and Pioneer Apartments never reached the
    // dropdown, so neither could be filtered on.
    const { data, error } = await supabase.rpc('leasing_report_filter_options');

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    const properties = (Array.isArray(data) ? data[0] : data)?.properties ?? [];

    return Response.json(properties, { headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=600' } });

  } catch (error) {
    console.error('Error fetching properties:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
