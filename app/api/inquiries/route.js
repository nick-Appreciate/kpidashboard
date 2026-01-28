import { supabaseAdmin } from '../../../lib/supabase';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const property = searchParams.get('property');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const limit = parseInt(searchParams.get('limit') || '1000');
    
    let query = supabaseAdmin
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
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Supabase error:', error);
      return Response.json({ error: error.message }, { status: 500 });
    }
    
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

    const { data: upsertedData, error: upsertError } = await supabaseAdmin
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
