import { requireAuth } from '../../../../lib/auth';

export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { data, error } = await supabase
      .from('leasing_reports')
      .select('status')
      .not('status', 'is', null)
      .order('status');
    
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    
    // Get unique statuses
    const statuses = [...new Set(data.map(item => item.status))];
    
    return Response.json(statuses, { headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=600' } });

  } catch (error) {
    console.error('Error fetching statuses:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
