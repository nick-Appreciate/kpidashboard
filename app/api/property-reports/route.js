import { requireAuth } from '../../../lib/auth';

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

    const recordsWithMetadata = records.map(record => ({
      ...record,
      source_file: metadata?.filename
    }));

    const { data: upsertedData, error: upsertError } = await supabase
      .from('property_reports')
      .upsert(recordsWithMetadata, {
        onConflict: 'property,unit,lease_from,lease_to'
      })
      .select();

    if (upsertError) {
      console.error('Upsert error:', upsertError);
      return Response.json({ error: upsertError.message }, { status: 500 });
    }

    return Response.json({
      message: 'Property reports imported successfully',
      inserted: upsertedData.length,
      total: records.length
    });
  } catch (error) {
    console.error('Error importing property reports:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
