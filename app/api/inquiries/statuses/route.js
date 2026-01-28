import { supabase } from '../../../../lib/supabase';

export async function GET(request) {
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
    
    return Response.json(statuses);
    
  } catch (error) {
    console.error('Error fetching statuses:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
