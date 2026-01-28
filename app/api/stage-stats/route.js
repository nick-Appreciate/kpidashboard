import { supabase } from '../../../lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const stage = searchParams.get('stage'); // inquiries, showings_scheduled, showings_completed, applications, tenants
    const property = searchParams.get('property');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    let data = [];
    let tableName = '';
    let dateField = '';

    // Determine which table and filters to use based on stage
    switch (stage) {
      case 'inquiries':
        tableName = 'leasing_reports';
        dateField = 'inquiry_received';
        break;
      case 'showings_scheduled':
        tableName = 'showings';
        dateField = 'showing_time';
        break;
      case 'showings_completed':
        tableName = 'showings';
        dateField = 'showing_time';
        break;
      case 'applications':
        tableName = 'rental_applications';
        dateField = 'received';
        break;
      case 'tenants':
        tableName = 'rental_applications';
        dateField = 'received';
        break;
      default:
        tableName = 'leasing_reports';
        dateField = 'inquiry_received';
    }

    // Build query based on stage
    let query = supabase.from(tableName).select('*');

    // Apply date filters
    if (startDate) query = query.gte(dateField, startDate);
    if (endDate) query = query.lte(dateField, endDate + 'T23:59:59');

    // Apply stage-specific filters
    if (stage === 'showings_completed') {
      query = query.eq('status', 'Completed');
    } else if (stage === 'tenants') {
      query = query.or('status.eq.Converted,status.eq.Converting,application_status.eq.Approved');
    }

    // Apply property filter for tables that have it
    if (property && property !== 'all') {
      if (tableName === 'leasing_reports' || tableName === 'showings') {
        query = query.eq('property', property);
      }
    }

    const { data: records, error } = await query;
    if (error) throw error;

    // Process data for charts based on stage
    const result = processStageData(records, stage, dateField);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching stage stats:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function processStageData(records, stage, dateField) {
  if (!records || records.length === 0) {
    return {
      total: 0,
      dailyData: [],
      weeklyData: [],
      topProperties: [],
      statusDistribution: [],
      sourceDistribution: [],
      leadTypeDistribution: []
    };
  }

  // Get date field based on stage
  const getDateValue = (record) => {
    switch (stage) {
      case 'inquiries':
        return record.inquiry_received;
      case 'showings_scheduled':
      case 'showings_completed':
        return record.showing_time;
      case 'applications':
      case 'tenants':
        return record.received;
      default:
        return record.inquiry_received || record.showing_time || record.received;
    }
  };

  // Daily data - collect counts and names/IDs
  const dailyCounts = {};
  const dailyDetails = {}; // Store names and IDs for each date
  let minDate = null;
  let maxDate = null;
  
  records.forEach(record => {
    const dateVal = getDateValue(record);
    if (dateVal) {
      const date = new Date(dateVal);
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      dailyCounts[dateStr] = (dailyCounts[dateStr] || 0) + 1;
      
      // Store name and ID for tooltip
      if (!dailyDetails[dateStr]) dailyDetails[dateStr] = [];
      const name = record.name || record.prospect_name || record.applicant_name || 'Unknown';
      const id = record.id || record.inquiry_id || '';
      dailyDetails[dateStr].push({ name, id });
      
      // Track min/max dates
      if (!minDate || date < minDate) minDate = new Date(date);
      if (!maxDate || date > maxDate) maxDate = new Date(date);
    }
  });

  // Fill in missing dates with zero counts
  const dailyData = [];
  if (minDate && maxDate) {
    const currentDate = new Date(minDate);
    while (currentDate <= maxDate) {
      const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
      dailyData.push({
        inquiry_date: dateStr,
        count: dailyCounts[dateStr] || 0,
        details: dailyDetails[dateStr] || []
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  // Weekly data - collect counts and names/IDs
  const weeklyCounts = {};
  const weeklyDetails = {}; // Store names and IDs for each week
  let minWeek = null;
  let maxWeek = null;
  
  records.forEach(record => {
    const dateVal = getDateValue(record);
    if (dateVal) {
      const date = new Date(dateVal);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
      weeklyCounts[weekStr] = (weeklyCounts[weekStr] || 0) + 1;
      
      // Store name and ID for tooltip
      if (!weeklyDetails[weekStr]) weeklyDetails[weekStr] = [];
      const name = record.name || record.prospect_name || record.applicant_name || 'Unknown';
      const id = record.id || record.inquiry_id || '';
      weeklyDetails[weekStr].push({ name, id });
      
      // Track min/max weeks
      if (!minWeek || weekStart < minWeek) minWeek = new Date(weekStart);
      if (!maxWeek || weekStart > maxWeek) maxWeek = new Date(weekStart);
    }
  });

  // Fill in missing weeks with zero counts
  const weeklyData = [];
  if (minWeek && maxWeek) {
    const currentWeek = new Date(minWeek);
    while (currentWeek <= maxWeek) {
      const weekStr = `${currentWeek.getFullYear()}-${String(currentWeek.getMonth() + 1).padStart(2, '0')}-${String(currentWeek.getDate()).padStart(2, '0')}`;
      weeklyData.push({
        week: weekStr,
        count: weeklyCounts[weekStr] || 0,
        details: weeklyDetails[weekStr] || []
      });
      currentWeek.setDate(currentWeek.getDate() + 7);
    }
  }

  // Top properties (for stages that have property field)
  const propertyCounts = {};
  records.forEach(record => {
    const prop = record.property;
    if (prop) {
      propertyCounts[prop] = (propertyCounts[prop] || 0) + 1;
    }
  });

  const topProperties = Object.entries(propertyCounts)
    .map(([property, count]) => ({ property, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Status distribution
  const statusCounts = {};
  records.forEach(record => {
    const status = record.status || record.application_status || 'Unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  const statusDistribution = Object.entries(statusCounts)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  // Source distribution
  const sourceCounts = {};
  records.forEach(record => {
    const source = record.source || record.lead_source || 'Unknown';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  });

  const sourceDistribution = Object.entries(sourceCounts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Lead type distribution (mainly for inquiries)
  const leadTypeCounts = {};
  records.forEach(record => {
    const leadType = record.lead_type || record.type || 'Unknown';
    leadTypeCounts[leadType] = (leadTypeCounts[leadType] || 0) + 1;
  });

  const leadTypeDistribution = Object.entries(leadTypeCounts)
    .map(([lead_type, count]) => ({ lead_type, count }))
    .sort((a, b) => b.count - a.count);

  // Get unique property count
  const uniqueProperties = new Set(records.map(r => r.property).filter(Boolean));

  return {
    total: records.length,
    propertyCount: uniqueProperties.size,
    dailyData,
    weeklyData,
    topProperties,
    statusDistribution,
    sourceDistribution,
    leadTypeDistribution
  };
}
