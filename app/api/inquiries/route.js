import { requireAuth } from '../../../lib/auth';

// Region definitions - matches occupancy dashboard
const KC_PROPERTIES = ['hilltop', 'oakwood', 'glen oaks', 'normandy', 'maple manor'];

function filterByRegion(records, region) {
  if (!region) return records;
  return records.filter(record => {
    const prop = (record.property || '').toLowerCase();
    const matchesKC = KC_PROPERTIES.some(kc => prop.includes(kc));
    if (region === 'region_kansas_city') return matchesKC;
    if (region === 'region_columbia') return !matchesKC;
    if (region === 'farquhar') {
      const hilltopGone = new Date() >= new Date('2026-04-22T00:00:00');
      return !prop.includes('glen oaks') && !(hilltopGone && prop.includes('hilltop'));
    }
    return true;
  });
}

export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { searchParams } = new URL(request.url);
    const property = searchParams.get('property');
    const region = searchParams.get('region');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const limit = parseInt(searchParams.get('limit') || '1000');

    let query = supabase
      .from('leasing_reports')
      .select('*')
      .order('inquiry_received', { ascending: false })
      .limit(limit);

    if (property) {
      query = query.eq('property', property);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (startDate) {
      query = query.gte('inquiry_received', startDate);
    }

    if (endDate) {
      query = query.lte('inquiry_received', endDate);
    }

    let { data, error } = await query;

    if (error) {
      console.error('Supabase error:', error);
      return Response.json({ error: error.message }, { status: 500 });
    }

    // Apply region filter post-fetch
    if (region) data = filterByRegion(data || [], region);

    return Response.json({
      inquiries: data,
      count: data.length
    });
    
  } catch (error) {
    console.error('Error fetching inquiries:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const body = await request.json();
    const { records, metadata } = body;
    
    if (!records || !Array.isArray(records)) {
      return Response.json({ error: 'records array is required' }, { status: 400 });
    }

    const recordsWithMetadata = records.map(record => {
      // Normalize field names - handle variations like "Inquiry ID" -> inquiry_id
      const normalized = { ...record };
      if (record['Inquiry ID'] && !record.inquiry_id) {
        normalized.inquiry_id = record['Inquiry ID'];
        delete normalized['Inquiry ID'];
      }
      if (record['InquiryID'] && !record.inquiry_id) {
        normalized.inquiry_id = record['InquiryID'];
        delete normalized['InquiryID'];
      }
      normalized.source_file = metadata?.filename;
      return normalized;
    });

    const { data: upsertedData, error: upsertError } = await supabase
      .from('leasing_reports')
      .upsert(recordsWithMetadata, {
        onConflict: 'property,name,inquiry_received'
      })
      .select();
    
    if (upsertError) {
      console.error('Upsert error:', upsertError);
      return Response.json({ error: upsertError.message }, { status: 500 });
    }
    
    return Response.json({
      message: 'Leasing reports imported successfully',
      inserted: upsertedData.length,
      total: records.length
    });
    
  } catch (error) {
    console.error('Error importing inquiries:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
