import { supabase } from '../../../lib/supabase';

// Convert UTC date to Central Time and return YYYY-MM-DD string
function toCentralDate(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  // Convert to Central Time (America/Chicago)
  const centralDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return `${centralDate.getFullYear()}-${String(centralDate.getMonth() + 1).padStart(2, '0')}-${String(centralDate.getDate()).padStart(2, '0')}`;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const property = searchParams.get('property');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    
    // Build base query
    let baseQuery = supabase.from('leasing_reports').select('*');
    
    if (property) baseQuery = baseQuery.eq('property', property);
    if (status) baseQuery = baseQuery.eq('status', status);
    if (startDate) baseQuery = baseQuery.gte('inquiry_received', startDate);
    if (endDate) baseQuery = baseQuery.lte('inquiry_received', endDate);
    
    const { data: inquiries, error } = await baseQuery;
    
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    
    // Calculate statistics
    const total = inquiries.length;
    const propertyCount = new Set(inquiries.map(i => i.property)).size;
    
    // Status distribution
    const statusCounts = {};
    inquiries.forEach(inq => {
      if (inq.status) {
        statusCounts[inq.status] = (statusCounts[inq.status] || 0) + 1;
      }
    });
    const statusDistribution = Object.entries(statusCounts).map(([status, count]) => ({
      status,
      count
    }));
    
    // Lead type distribution
    const leadTypeCounts = {};
    inquiries.forEach(inq => {
      if (inq.lead_type) {
        leadTypeCounts[inq.lead_type] = (leadTypeCounts[inq.lead_type] || 0) + 1;
      }
    });
    const leadTypeDistribution = Object.entries(leadTypeCounts).map(([lead_type, count]) => ({
      lead_type,
      count
    }));
    
    // Daily data (using Central Time)
    const dailyCounts = {};
    inquiries.forEach(inq => {
      if (inq.inquiry_received) {
        const inquiryDate = toCentralDate(inq.inquiry_received);
        if (inquiryDate) {
          dailyCounts[inquiryDate] = (dailyCounts[inquiryDate] || 0) + 1;
        }
      }
    });
    const dailyData = Object.entries(dailyCounts)
      .map(([inquiry_date, count]) => ({ inquiry_date, count }))
      .sort((a, b) => a.inquiry_date.localeCompare(b.inquiry_date));
    
    // Weekly data using rolling 7-day periods (from today going back)
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const rollingWeekRanges = [];
    const maxWeeks = 12;
    
    for (let i = 0; i < maxWeeks; i++) {
      const endDate = new Date(todayEnd.getTime() - (i * 7 * 24 * 60 * 60 * 1000));
      const startDate = new Date(endDate.getTime() - (6 * 24 * 60 * 60 * 1000));
      startDate.setHours(0, 0, 0, 0);
      
      const weekLabel = `${startDate.getMonth() + 1}/${startDate.getDate()}-${endDate.getMonth() + 1}/${endDate.getDate()}`;
      rollingWeekRanges.unshift({ start: new Date(startDate), end: new Date(endDate), label: weekLabel });
    }
    
    const weeklyCounts = {};
    rollingWeekRanges.forEach(range => {
      weeklyCounts[range.label] = 0;
    });
    
    inquiries.forEach(inq => {
      if (inq.inquiry_received) {
        const date = new Date(inq.inquiry_received);
        for (const range of rollingWeekRanges) {
          if (date >= range.start && date <= range.end) {
            weeklyCounts[range.label] = (weeklyCounts[range.label] || 0) + 1;
            break;
          }
        }
      }
    });
    
    const weeklyData = rollingWeekRanges.map(range => ({
      week: range.label,
      count: weeklyCounts[range.label] || 0
    }));
    
    // Monthly data (using Central Time)
    const monthlyCounts = {};
    inquiries.forEach(inq => {
      if (inq.inquiry_received) {
        const centralDate = toCentralDate(inq.inquiry_received);
        if (centralDate) {
          const month = centralDate.substring(0, 7);
          monthlyCounts[month] = (monthlyCounts[month] || 0) + 1;
        }
      }
    });
    const monthlyData = Object.entries(monthlyCounts)
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));
    
    // Top properties
    const propertyCounts = {};
    inquiries.forEach(inq => {
      propertyCounts[inq.property] = (propertyCounts[inq.property] || 0) + 1;
    });
    const topProperties = Object.entries(propertyCounts)
      .map(([property, count]) => ({ property, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    // Source distribution (using source column)
    const sourceCounts = {};
    inquiries.forEach(inq => {
      const source = inq.source || 'Unknown';
      sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    });
    const sourceDistribution = Object.entries(sourceCounts)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);
    
    // Unit type distribution (using bed_bath_preference column, excluding nulls and grouping similar types)
    const unitTypeCounts = {};
    inquiries.forEach(inq => {
      if (inq.bed_bath_preference && inq.bed_bath_preference !== '- / -') {
        let unitType = inq.bed_bath_preference;
        // Group partial unit types into their full equivalents
        if (unitType.startsWith('2 / -') || unitType.startsWith('2/ -')) {
          unitType = '2 / 1.00';
        } else if (unitType.startsWith('1 / -') || unitType.startsWith('1/ -')) {
          unitType = '1 / 1.00';
        } else if (unitType.startsWith('3 / -') || unitType.startsWith('3/ -')) {
          unitType = '3 / 2.00';
        } else if (unitType.startsWith('4 / -') || unitType.startsWith('4/ -')) {
          unitType = '4 / 2.00';
        }
        unitTypeCounts[unitType] = (unitTypeCounts[unitType] || 0) + 1;
      }
    });
    const unitTypeDistribution = Object.entries(unitTypeCounts)
      .map(([unit_type, count]) => ({ unit_type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    // Get the most recent data insert timestamp across all tables
    const { data: lastLeasingInsert } = await supabase
      .from('leasing_reports')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);
    
    const { data: lastShowingInsert } = await supabase
      .from('showings')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);
    
    const { data: lastApplicationInsert } = await supabase
      .from('rental_applications')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);
    
    // Find the most recent timestamp across all tables
    const timestamps = [
      lastLeasingInsert?.[0]?.created_at,
      lastShowingInsert?.[0]?.created_at,
      lastApplicationInsert?.[0]?.created_at
    ].filter(Boolean).map(t => new Date(t));
    
    const lastDataInsert = timestamps.length > 0 
      ? new Date(Math.max(...timestamps)).toISOString()
      : null;
    
    return Response.json({
      total,
      propertyCount,
      statusDistribution,
      leadTypeDistribution,
      dailyData,
      weeklyData,
      monthlyData,
      topProperties,
      sourceDistribution,
      unitTypeDistribution,
      lastDataInsert
    });
    
  } catch (error) {
    console.error('Error fetching stats:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
