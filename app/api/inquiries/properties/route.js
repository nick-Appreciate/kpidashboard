import { supabase } from '../../../../lib/supabase';

export async function GET(request) {
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
    
    return Response.json(properties);
    
  } catch (error) {
    console.error('Error fetching properties:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
