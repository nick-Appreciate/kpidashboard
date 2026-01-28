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
    
    // Weekly data (using Central Time)
    const getWeekStart = (centralDateStr) => {
      const [year, month, day] = centralDateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      const dayOfWeek = date.getDay();
      date.setDate(date.getDate() - dayOfWeek);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };
    
    const weeklyCounts = {};
    inquiries.forEach(inq => {
      if (inq.inquiry_received) {
        const centralDate = toCentralDate(inq.inquiry_received);
        if (centralDate) {
          const week = getWeekStart(centralDate);
          weeklyCounts[week] = (weeklyCounts[week] || 0) + 1;
        }
      }
    });
    const weeklyData = Object.entries(weeklyCounts)
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => a.week.localeCompare(b.week));
    
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
      unitTypeDistribution
    });
    
  } catch (error) {
    console.error('Error fetching stats:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
