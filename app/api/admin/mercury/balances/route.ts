import { NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get('days') || '30';

    // Calculate start date in Central Time
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

    let query = supabase
      .from('mercury_daily_balances')
      .select('*')
      .order('snapshot_date', { ascending: true });

    // If not "all", filter by date range
    if (daysParam !== 'all') {
      const days = parseInt(daysParam, 10);
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - days);
      const startDateStr = startDate.toISOString().split('T')[0];
      query = query.gte('snapshot_date', startDateStr);
    }

    const { data, error } = await query;

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
