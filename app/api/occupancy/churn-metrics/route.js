import { requireAuth } from '../../../../lib/auth';
import { NextResponse } from 'next/server';

export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate') || null;
  const endDate = searchParams.get('endDate') || null;

  const { data, error } = await supabase.rpc('get_churn_metrics_monthly', {
    start_date: startDate,
    end_date: endDate,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ months: data || [] });
}
