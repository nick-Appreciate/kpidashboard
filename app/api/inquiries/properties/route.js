import { requireAuth } from '../../../../lib/auth';

export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { data, error } = await supabase
      .from('leasing_reports')
      .select('property')
      .order('property');
    
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    
    // Get unique properties
    const properties = [...new Set(data.map(item => item.property))];
    
    return Response.json(properties, { headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=600' } });

  } catch (error) {
    console.error('Error fetching properties:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
