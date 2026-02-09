import { supabase } from '../../../lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const stagesParam = searchParams.get('stages'); // comma-separated list for multi-select
    const stage = searchParams.get('stage'); // single stage (backwards compatible)
    const property = searchParams.get('property');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Support both single stage and multi-select
    const selectedStages = stagesParam ? stagesParam.split(',') : (stage ? [stage] : []);
    
    if (selectedStages.length === 0) {
      return NextResponse.json({ error: 'No stage selected' }, { status: 400 });
    }

    // Fetch name lookup from leasing_reports (inquiry_id -> name)
    // Also fetch all inquiries for baseline conversion calculation
    let inquiriesQuery = supabase.from('leasing_reports').select('inquiry_id, name, guest_card_id, inquiry_received');
    if (startDate) inquiriesQuery = inquiriesQuery.gte('inquiry_received', startDate);
    if (endDate) inquiriesQuery = inquiriesQuery.lte('inquiry_received', endDate + 'T23:59:59');
    if (property && property !== 'all') inquiriesQuery = inquiriesQuery.eq('property', property);
    
    const { data: leasingData } = await inquiriesQuery;
    
    const nameLookup = {};
    const guestCardLookup = {};
    const dailyInquiryCounts = {}; // For conversion percentage baseline
    
    const weeklyInquiryCounts = {}; // For weekly conversion percentage baseline
    
    leasingData?.forEach(row => {
      if (row.inquiry_id && row.name) {
        nameLookup[row.inquiry_id] = row.name;
      }
      if (row.guest_card_id && row.name) {
        guestCardLookup[row.guest_card_id] = row.name;
      }
      // Count inquiries by date for conversion baseline
      if (row.inquiry_received) {
        const date = new Date(row.inquiry_received);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        dailyInquiryCounts[dateStr] = (dailyInquiryCounts[dateStr] || 0) + 1;
        
        // Store raw inquiry data for rolling week calculation later
        if (!weeklyInquiryCounts._rawDates) weeklyInquiryCounts._rawDates = [];
        weeklyInquiryCounts._rawDates.push(date);
      }
    });

    let allRecords = [];

    for (const currentStage of selectedStages) {
      let tableName = '';
      let dateField = '';

      // Determine which table and filters to use based on stage
      switch (currentStage) {
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
          continue;
      }

      // Build query based on stage
      let query = supabase.from(tableName).select('*');

      // Apply date filters
      if (startDate) query = query.gte(dateField, startDate);
      if (endDate) query = query.lte(dateField, endDate + 'T23:59:59');

      // Apply stage-specific filters
      if (currentStage === 'showings_completed') {
        query = query.eq('status', 'Completed');
      } else if (currentStage === 'tenants') {
        query = query.or('status.eq.Converted,application_status.eq.Approved');
      }

      // Apply property filter for tables that have it
      if (property && property !== 'all') {
        if (tableName === 'leasing_reports' || tableName === 'showings') {
          query = query.eq('property', property);
        }
      }

      const { data: records, error } = await query;
      if (error) throw error;

      // Enrich records with names from lookup and add stage info
      const enrichedRecords = (records || []).map(record => {
        let resolvedName = record.name || record.guest_card_name || record.applicants;
        
        // Try to resolve name from inquiry_id lookup
        if ((!resolvedName || resolvedName === 'Unknown') && record.inquiry_id) {
          resolvedName = nameLookup[record.inquiry_id] || resolvedName;
        }
        
        // Try to resolve name from guest_card_id lookup
        if ((!resolvedName || resolvedName === 'Unknown') && record.guest_card_id) {
          resolvedName = guestCardLookup[record.guest_card_id] || resolvedName;
        }
        
        return {
          ...record,
          _resolvedName: resolvedName || 'Unknown',
          _stage: currentStage,
          _dateField: dateField
        };
      });

      allRecords = allRecords.concat(enrichedRecords);
    }

    // Process data separately for each stage
    const result = processStageDataByStage(allRecords, selectedStages, dailyInquiryCounts, weeklyInquiryCounts, startDate, endDate);

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

  // Get date field based on record's stage (for multi-select support)
  const getDateValue = (record) => {
    // Use the _dateField if available (from multi-select enrichment)
    if (record._dateField) {
      return record[record._dateField];
    }
    // Fallback to checking all possible date fields
    return record.inquiry_received || record.showing_time || record.received;
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
      
      // Store name and ID for tooltip - use _resolvedName from cross-reference
      if (!dailyDetails[dateStr]) dailyDetails[dateStr] = [];
      const name = record._resolvedName || record.name || record.guest_card_name || record.applicants || 'Unknown';
      const id = record.id || record.inquiry_id || record.showing_id || record.rental_application_id || '';
      const stage = record._stage || '';
      dailyDetails[dateStr].push({ name, id, stage });
      
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
      
      // Store name and ID for tooltip - use _resolvedName from cross-reference
      if (!weeklyDetails[weekStr]) weeklyDetails[weekStr] = [];
      const name = record._resolvedName || record.name || record.guest_card_name || record.applicants || 'Unknown';
      const id = record.id || record.inquiry_id || record.showing_id || record.rental_application_id || '';
      const stage = record._stage || '';
      weeklyDetails[weekStr].push({ name, id, stage });
      
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

function processStageDataByStage(records, stages, dailyInquiryCounts = {}, weeklyInquiryCounts = {}, startDate = null, endDate = null) {
  if (!records || records.length === 0) {
    return {
      total: 0,
      stages: [],
      dailyDataByStage: {},
      weeklyDataByStage: {},
      weeklyConversionByStage: {},
      allDates: [],
      allWeeks: [],
      weeklyInquiryCounts: weeklyInquiryCounts,
      topProperties: [],
      statusDistribution: [],
      sourceDistribution: [],
      leadTypeDistribution: []
    };
  }

  const stageColors = {
    'inquiries': '#667eea',
    'showings_scheduled': '#8b5cf6',
    'showings_completed': '#764ba2',
    'applications': '#f093fb',
    'tenants': '#43e97b'
  };

  const stageNames = {
    'inquiries': 'Inquiries',
    'showings_scheduled': 'Showings Scheduled',
    'showings_completed': 'Showings Completed',
    'applications': 'Applications',
    'tenants': 'Tenants'
  };

  // Get date field based on record's stage
  const getDateValue = (record) => {
    if (record._dateField) {
      return record[record._dateField];
    }
    return record.inquiry_received || record.showing_time || record.received;
  };

  // Use filter dates for the chart range, not data min/max
  // This ensures charts always show the full selected date range
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Parse filter dates or use defaults
  // Use local date parsing to avoid timezone issues (YYYY-MM-DD -> local midnight)
  let chartStartDate = null;
  let chartEndDate = today;
  
  if (startDate) {
    const [year, month, day] = startDate.split('-').map(Number);
    chartStartDate = new Date(year, month - 1, day);
  }
  if (endDate) {
    const [year, month, day] = endDate.split('-').map(Number);
    chartEndDate = new Date(year, month - 1, day);
  }
  
  // Ensure endDate doesn't exceed today
  if (chartEndDate > today) {
    chartEndDate = today;
  }
  
  // If no startDate provided, calculate from data
  if (!chartStartDate) {
    records.forEach(record => {
      const dateVal = getDateValue(record);
      if (dateVal) {
        const date = new Date(dateVal);
        const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        if (!chartStartDate || dateOnly < chartStartDate) chartStartDate = new Date(dateOnly);
      }
    });
  }
  
  // Default to 30 days ago if still no start date
  if (!chartStartDate) {
    chartStartDate = new Date(today);
    chartStartDate.setDate(chartStartDate.getDate() - 30);
  }

  // Generate all dates in range from startDate to endDate (today)
  const allDates = [];
  
  if (chartStartDate && chartEndDate) {
    const currentDate = new Date(chartStartDate);
    chartEndDate.setHours(23, 59, 59, 999);
    while (currentDate <= chartEndDate) {
      const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
      allDates.push(dateStr);
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  // Generate rolling 7-day periods (from today going back)
  // Each period is labeled by its end date (most recent day in the period)
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const allWeeks = [];
  const rollingWeekRanges = []; // Store {start, end} for each rolling week
  
  // Calculate how many weeks back we need to go based on filter date range
  const weeksBack = chartStartDate ? Math.ceil((todayEnd - chartStartDate) / (7 * 24 * 60 * 60 * 1000)) + 1 : 8;
  const maxWeeks = Math.min(weeksBack, 12); // Cap at 12 weeks
  
  for (let i = 0; i < maxWeeks; i++) {
    const endDate = new Date(todayEnd.getTime() - (i * 7 * 24 * 60 * 60 * 1000));
    const startDate = new Date(endDate.getTime() - (6 * 24 * 60 * 60 * 1000));
    startDate.setHours(0, 0, 0, 0);
    
    const weekLabel = `${startDate.getMonth() + 1}/${startDate.getDate()}-${endDate.getMonth() + 1}/${endDate.getDate()}`;
    allWeeks.unshift(weekLabel); // Add to beginning so oldest is first
    rollingWeekRanges.unshift({ start: new Date(startDate), end: new Date(endDate), label: weekLabel });
  }

  // Process data for each stage separately
  const dailyDataByStage = {};
  const weeklyDataByStage = {};
  const stageTotals = {};

  stages.forEach(stage => {
    const stageRecords = records.filter(r => r._stage === stage);
    stageTotals[stage] = stageRecords.length;

    // Daily counts for this stage
    const dailyCounts = {};
    const dailyDetails = {};
    
    stageRecords.forEach(record => {
      const dateVal = getDateValue(record);
      if (dateVal) {
        const date = new Date(dateVal);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        dailyCounts[dateStr] = (dailyCounts[dateStr] || 0) + 1;
        
        if (!dailyDetails[dateStr]) dailyDetails[dateStr] = [];
        const name = record._resolvedName || record.name || record.guest_card_name || record.applicants || 'Unknown';
        const id = record.id || record.inquiry_id || record.showing_id || record.rental_application_id || '';
        // For rental_applications, unit field contains "Property - Unit - Address"
        let property = record.property || '';
        let unit = record.showing_unit || '';
        if (!property && record.unit && record.unit.includes(' - ')) {
          const parts = record.unit.split(' - ');
          property = parts[0];
          unit = parts[1] || '';
        }
        dailyDetails[dateStr].push({ name, id, property, unit });
      }
    });

    // Fill in all dates with counts (0 for missing)
    dailyDataByStage[stage] = {
      label: stageNames[stage],
      color: stageColors[stage],
      data: allDates.map(dateStr => ({
        date: dateStr,
        count: dailyCounts[dateStr] || 0,
        details: dailyDetails[dateStr] || []
      }))
    };

    // Weekly counts for this stage using rolling 7-day periods
    const weeklyCounts = {};
    const weeklyDetails = {};
    
    // Initialize counts for each rolling week
    rollingWeekRanges.forEach(range => {
      weeklyCounts[range.label] = 0;
      weeklyDetails[range.label] = [];
    });
    
    stageRecords.forEach(record => {
      const dateVal = getDateValue(record);
      if (dateVal) {
        const date = new Date(dateVal);
        
        // Find which rolling week this date falls into
        for (const range of rollingWeekRanges) {
          if (date >= range.start && date <= range.end) {
            weeklyCounts[range.label] = (weeklyCounts[range.label] || 0) + 1;
            
            if (!weeklyDetails[range.label]) weeklyDetails[range.label] = [];
            const name = record._resolvedName || record.name || record.guest_card_name || record.applicants || 'Unknown';
            const id = record.id || record.inquiry_id || record.showing_id || record.rental_application_id || '';
            // For rental_applications, unit field contains "Property - Unit - Address"
            let property = record.property || '';
            let unit = record.showing_unit || '';
            if (!property && record.unit && record.unit.includes(' - ')) {
              const parts = record.unit.split(' - ');
              property = parts[0];
              unit = parts[1] || '';
            }
            weeklyDetails[range.label].push({ name, id, property, unit });
            break; // Each record only belongs to one week
          }
        }
      }
    });

    // Fill in all weeks with counts (0 for missing)
    weeklyDataByStage[stage] = {
      label: stageNames[stage],
      color: stageColors[stage],
      data: allWeeks.map(weekLabel => ({
        week: weekLabel,
        count: weeklyCounts[weekLabel] || 0,
        details: weeklyDetails[weekLabel] || []
      }))
    };
  });

  // Aggregate distributions across all records
  const propertyCounts = {};
  const statusCounts = {};
  const sourceCounts = {};
  const leadTypeCounts = {};

  records.forEach(record => {
    if (record.property) {
      propertyCounts[record.property] = (propertyCounts[record.property] || 0) + 1;
    }
    const status = record.status || record.application_status || 'Unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    const source = record.source || record.lead_source || 'Unknown';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    const leadType = record.lead_type || record.type || 'Unknown';
    leadTypeCounts[leadType] = (leadTypeCounts[leadType] || 0) + 1;
  });

  const uniqueProperties = new Set(records.map(r => r.property).filter(Boolean));

  // Define the funnel order for calculating conversion from previous stage
  const funnelOrder = ['inquiries', 'showings_scheduled', 'showings_completed', 'applications', 'tenants'];
  
  // Calculate rolling weekly inquiry counts for conversion baseline
  const rollingWeeklyInquiryCounts = {};
  const rawInquiryDates = weeklyInquiryCounts._rawDates || [];
  rollingWeekRanges.forEach(range => {
    rollingWeeklyInquiryCounts[range.label] = rawInquiryDates.filter(
      date => date >= range.start && date <= range.end
    ).length;
  });
  
  // Calculate weekly conversion percentages for each stage (as % of previous stage)
  const weeklyConversionByStage = {};
  stages.forEach(stage => {
    const stageIndex = funnelOrder.indexOf(stage);
    const previousStage = stageIndex > 0 ? funnelOrder[stageIndex - 1] : null;
    
    if (stage === 'inquiries') {
      // Inquiries is the first stage, always 100%
      weeklyConversionByStage[stage] = {
        label: stageNames[stage],
        color: stageColors[stage],
        data: allWeeks.map(weekLabel => ({
          week: weekLabel,
          percentage: 100,
          count: rollingWeeklyInquiryCounts[weekLabel] || 0,
          baseline: rollingWeeklyInquiryCounts[weekLabel] || 0,
          baselineLabel: 'Inquiries'
        }))
      };
    } else {
      const stageData = weeklyDataByStage[stage];
      
      // Get the previous stage's weekly data for baseline
      let getPreviousStageCount;
      let baselineLabel;
      
      if (previousStage === 'inquiries') {
        getPreviousStageCount = (weekLabel) => rollingWeeklyInquiryCounts[weekLabel] || 0;
        baselineLabel = 'Inquiries';
      } else if (weeklyDataByStage[previousStage]) {
        getPreviousStageCount = (weekLabel, idx) => weeklyDataByStage[previousStage].data[idx]?.count || 0;
        baselineLabel = stageNames[previousStage];
      } else {
        // Fallback to inquiries if previous stage not in selection
        getPreviousStageCount = (weekLabel) => rollingWeeklyInquiryCounts[weekLabel] || 0;
        baselineLabel = 'Inquiries';
      }
      
      weeklyConversionByStage[stage] = {
        label: `${stageNames[stage]} (from ${baselineLabel})`,
        color: stageColors[stage],
        data: allWeeks.map((weekLabel, idx) => {
          const stageCount = stageData.data[idx]?.count || 0;
          const previousCount = getPreviousStageCount(weekLabel, idx);
          const percentage = previousCount > 0 ? Math.round((stageCount / previousCount) * 100) : 0;
          return {
            week: weekLabel,
            percentage,
            count: stageCount,
            baseline: previousCount,
            baselineLabel: baselineLabel
          };
        })
      };
    }
  });

  return {
    total: records.length,
    stageTotals,
    propertyCount: uniqueProperties.size,
    stages,
    allDates,
    allWeeks,
    dailyDataByStage,
    weeklyDataByStage,
    weeklyConversionByStage,
    weeklyInquiryCounts,
    topProperties: Object.entries(propertyCounts)
      .map(([property, count]) => ({ property, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    statusDistribution: Object.entries(statusCounts)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    sourceDistribution: Object.entries(sourceCounts)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    leadTypeDistribution: Object.entries(leadTypeCounts)
      .map(([lead_type, count]) => ({ lead_type, count }))
      .sort((a, b) => b.count - a.count)
  };
}
