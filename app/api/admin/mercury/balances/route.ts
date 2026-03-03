import { NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get('days') || '30';

    // Calculate start date in Central Time
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

    // Build date filter
    let startDateStr: string | null = null;
    if (daysParam !== 'all') {
      const days = parseInt(daysParam, 10);
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - days);
      startDateStr = startDate.toISOString().split('T')[0];
    }

    // Fetch all rows — paginate past Supabase 1000-row default limit
    let allData: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from('mercury_daily_balances')
        .select('*')
        .order('snapshot_date', { ascending: true })
        .range(from, from + pageSize - 1);

      if (startDateStr) {
        query = query.gte('snapshot_date', startDateStr);
      }

      const { data, error: pageError } = await query;

      if (pageError) {
        return NextResponse.json({ error: pageError.message }, { status: 500 });
      }

      allData = allData.concat(data || []);
      hasMore = (data?.length || 0) === pageSize;
      from += pageSize;
    }

    const data = allData;
    const error = null;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ balances: data || [], today });
  } catch (error) {
    console.error('Error fetching Mercury balances:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
