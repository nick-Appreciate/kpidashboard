import { supabase } from '../../../lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const property = searchParams.get('property');
    const agingBucket = searchParams.get('aging'); // 0-30, 30-60, 60-90, 90+
    
    // Get the latest snapshot date first
    const { data: latestSnapshot } = await supabase
      .from('af_delinquency')
      .select('snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1);
    
    const latestDate = latestSnapshot?.[0]?.snapshot_date;
    
    // Query only the latest snapshot for current items
    let query = supabase
      .from('af_delinquency')
      .select('*')
      .gt('amount_receivable', 0)
      .order('amount_receivable', { ascending: false });
    
    if (latestDate) {
      query = query.eq('snapshot_date', latestDate);
    }
    
    if (property && property !== 'all') {
      query = query.eq('property_name', property);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Filter by aging bucket if specified
    let filteredData = data || [];
    if (agingBucket) {
      filteredData = filteredData.filter(item => {
        switch (agingBucket) {
          case '0-30':
            return parseFloat(item.days_0_to_30 || 0) > 0;
          case '30-60':
            return parseFloat(item.days_30_to_60 || 0) > 0;
          case '60-90':
            return parseFloat(item.days_60_to_90 || 0) > 0;
          case '90+':
            return parseFloat(item.days_90_plus || 0) > 0;
          default:
            return true;
        }
      });
    }
    
    // Calculate summary stats
    const summary = {
      totalAccounts: filteredData.length,
      totalReceivable: filteredData.reduce((sum, item) => sum + parseFloat(item.amount_receivable || 0), 0),
      notYetDue: filteredData.reduce((sum, item) => sum + parseFloat(item.not_yet_due || 0), 0),
      days0to30: filteredData.reduce((sum, item) => sum + parseFloat(item.days_0_to_30 || 0), 0),
      days30to60: filteredData.reduce((sum, item) => sum + parseFloat(item.days_30_to_60 || 0), 0),
      days60to90: filteredData.reduce((sum, item) => sum + parseFloat(item.days_60_to_90 || 0), 0),
      days90plus: filteredData.reduce((sum, item) => sum + parseFloat(item.days_90_plus || 0), 0),
      inCollections: filteredData.filter(item => item.in_collections).length
    };
    
    // Get unique properties for filter
    const properties = [...new Set((data || []).map(item => item.property_name))].filter(Boolean).sort();
    
    // Get historical trend data (last 60 days)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const sixtyDaysAgoStr = sixtyDaysAgo.toISOString().split('T')[0];
    
    const { data: trendData, error: trendError } = await supabase
      .from('af_delinquency')
      .select('snapshot_date, days_0_to_30, days_30_to_60, days_60_to_90, days_90_plus')
      .gte('snapshot_date', sixtyDaysAgoStr)
      .order('snapshot_date', { ascending: true });
    
    // Aggregate trend data by snapshot_date
    const trendByDate = {};
    (trendData || []).forEach(item => {
      const date = item.snapshot_date;
      if (!trendByDate[date]) {
        trendByDate[date] = {
          date,
          days_0_30: 0,
          days_30_60: 0,
          days_60_90: 0,
          days_90_plus: 0
        };
      }
      trendByDate[date].days_0_30 += parseFloat(item.days_0_to_30 || 0);
      trendByDate[date].days_30_60 += parseFloat(item.days_30_to_60 || 0);
      trendByDate[date].days_60_90 += parseFloat(item.days_60_to_90 || 0);
      trendByDate[date].days_90_plus += parseFloat(item.days_90_plus || 0);
    });
    
    const trend = Object.values(trendByDate).sort((a, b) => a.date.localeCompare(b.date));
    
    return NextResponse.json({
      items: filteredData,
      summary,
      properties,
      trend
    });
    
  } catch (error) {
    console.error('Error fetching collections:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
