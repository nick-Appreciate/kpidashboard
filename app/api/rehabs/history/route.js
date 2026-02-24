import { supabase } from '../../../../lib/supabase';
import { NextResponse } from 'next/server';

// Helper to get current date in Central Time
function getCentralTimeDate() {
  const now = new Date();
  const centralTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return centralTime.toISOString().split('T')[0];
}

// GET - Fetch historical rehab snapshots
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);
    const property = searchParams.get('property');
    
    // Calculate start date in Central Time
    const today = getCentralTimeDate();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    let query = supabase
      .from('rehab_daily_snapshots')
      .select('*')
      .gte('snapshot_date', startDateStr)
      .order('snapshot_date', { ascending: true });
    
    if (property && property !== 'all' && property !== 'portfolio') {
      query = query.eq('property', property);
    } else {
      // For portfolio view, get aggregated data (property = null means portfolio-wide)
      query = query.is('property', null);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching rehab history:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ history: data || [], today });
  } catch (err) {
    console.error('Error in rehab history:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST - Save daily snapshot (called by cron or manually)
export async function POST(request) {
  try {
    const today = getCentralTimeDate();
    
    // Fetch current rehab data
    const { data: rehabs, error: rehabError } = await supabase
      .from('rehabs')
      .select('*')
      .in('status', ['pending_setup', 'in_progress']);
    
    if (rehabError) {
      return NextResponse.json({ error: rehabError.message }, { status: 500 });
    }
    
    // Calculate portfolio-wide stats
    const statusCounts = {
      not_started: 0,
      supervisor_onboard: 0,
      back_burner: 0,
      waiting: 0,
      in_progress: 0,
      complete: 0
    };
    
    // Also track by property
    const byProperty = {};
    
    rehabs?.forEach(r => {
      const status = r.rehab_status || 'Not Started';
      const statusKey = status.toLowerCase().replace(/ /g, '_');
      
      if (statusCounts.hasOwnProperty(statusKey)) {
        statusCounts[statusKey]++;
      }
      
      // Track by property
      if (!byProperty[r.property]) {
        byProperty[r.property] = {
          not_started: 0,
          supervisor_onboard: 0,
          back_burner: 0,
          waiting: 0,
          in_progress: 0,
          complete: 0,
          total_units: 0
        };
      }
      byProperty[r.property].total_units++;
      if (byProperty[r.property].hasOwnProperty(statusKey)) {
        byProperty[r.property][statusKey]++;
      }
    });
    
    // Upsert portfolio-wide snapshot
    const { error: portfolioError } = await supabase
      .from('rehab_daily_snapshots')
      .upsert({
        snapshot_date: today,
        property: null, // null = portfolio-wide
        total_units: rehabs?.length || 0,
        ...statusCounts
      }, { onConflict: 'snapshot_date,property' });
    
    if (portfolioError) {
      console.error('Error saving portfolio snapshot:', portfolioError);
    }
    
    // Upsert per-property snapshots
    for (const [property, counts] of Object.entries(byProperty)) {
      const { error: propError } = await supabase
        .from('rehab_daily_snapshots')
        .upsert({
          snapshot_date: today,
          property,
          ...counts
        }, { onConflict: 'snapshot_date,property' });
      
      if (propError) {
        console.error(`Error saving snapshot for ${property}:`, propError);
      }
    }
    
    return NextResponse.json({ 
      success: true, 
      date: today,
      totalUnits: rehabs?.length || 0,
      statusCounts,
      propertiesTracked: Object.keys(byProperty).length
    });
  } catch (err) {
    console.error('Error saving rehab snapshot:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
