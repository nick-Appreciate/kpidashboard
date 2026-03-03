import { supabase } from '../../../lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// --- Granularity bucketing helpers ---

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function bucketDate(dateStr, granularity) {
  const [y, m, d] = dateStr.split('-').map(Number);
  switch (granularity) {
    case 'daily':
      return { key: dateStr, label: `${m}/${d}` };
    case 'weekly': {
      // Calendar week starting Sunday
      const date = new Date(y, m - 1, d);
      const day = date.getDay(); // 0=Sun
      const sun = new Date(date);
      sun.setDate(date.getDate() - day);
      const sk = `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')}`;
      return { key: sk, label: `${sun.getMonth() + 1}/${sun.getDate()}` };
    }
    case 'monthly':
      return { key: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTH_ABBR[m - 1]} '${String(y).slice(2)}` };
    case 'quarterly': {
      const q = Math.ceil(m / 3);
      return { key: `${y}-Q${q}`, label: `Q${q} '${String(y).slice(2)}` };
    }
    default:
      return { key: dateStr, label: `${m}/${d}` };
  }
}

function generateAllBuckets(startDateStr, endDateStr, granularity) {
  if (!startDateStr || !endDateStr) return [];
  const seen = new Set();
  const buckets = [];
  const start = parseDateStr(startDateStr);
  const end = parseDateStr(endDateStr);

  const cur = new Date(start);
  while (cur <= end) {
    const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    const b = bucketDate(ds, granularity);
    if (!seen.has(b.key)) {
      seen.add(b.key);
      buckets.push(b);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return buckets;
}

function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Region definitions - matches occupancy dashboard
const KC_PROPERTIES = ['hilltop', 'oakwood', 'glen oaks', 'normandy', 'maple manor'];

function filterByRegion(records, region) {
  if (!region) return records;
  return records.filter(record => {
    // Check property field first, fall back to unit field for rental_applications
    const prop = (record.property || '').toLowerCase();
    const unit = (record.unit || '').toLowerCase();
    const matchesKC = KC_PROPERTIES.some(kc => prop.includes(kc) || unit.includes(kc));
    if (region === 'region_kansas_city') return matchesKC;
    if (region === 'region_columbia') return !matchesKC;
    return true;
  });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const stagesParam = searchParams.get('stages'); // comma-separated list for multi-select
    const stage = searchParams.get('stage'); // single stage (backwards compatible)
    const property = searchParams.get('property');
    const region = searchParams.get('region');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const granularity = searchParams.get('granularity') || 'weekly';

    // For monthly/quarterly, backfill start date to ensure at least 8 data points
    let effectiveStartDate = startDate;
    if (startDate && (granularity === 'monthly' || granularity === 'quarterly')) {
      const minBuckets = 8;
      const anchor = parseDateStr(startDate);
      if (granularity === 'monthly') {
        const minStart = new Date(anchor);
        minStart.setMonth(minStart.getMonth() - (minBuckets - 1));
        minStart.setDate(1); // align to month start
        if (minStart < anchor) effectiveStartDate = `${minStart.getFullYear()}-${String(minStart.getMonth() + 1).padStart(2, '0')}-${String(minStart.getDate()).padStart(2, '0')}`;
      } else {
        const minStart = new Date(anchor);
        minStart.setMonth(minStart.getMonth() - (minBuckets * 3 - 1));
        const qMonth = Math.floor(minStart.getMonth() / 3) * 3;
        minStart.setMonth(qMonth);
        minStart.setDate(1); // align to quarter start
        if (minStart < anchor) effectiveStartDate = `${minStart.getFullYear()}-${String(minStart.getMonth() + 1).padStart(2, '0')}-${String(minStart.getDate()).padStart(2, '0')}`;
      }
    }

    // Support both single stage and multi-select
    const selectedStages = stagesParam ? stagesParam.split(',') : (stage ? [stage] : []);
    
    if (selectedStages.length === 0) {
      return NextResponse.json({ error: 'No stage selected' }, { status: 400 });
    }
    
    // Define funnel order for determining previous stages
    const funnelOrder = ['inquiries', 'showings_scheduled', 'showings_completed', 'applications', 'leases'];
    
    // Determine which previous stages we need to fetch for conversion calculation
    const stagesToFetch = new Set(selectedStages);
    selectedStages.forEach(stg => {
      const idx = funnelOrder.indexOf(stg);
      if (idx > 0) {
        const prevStage = funnelOrder[idx - 1];
        if (prevStage !== 'inquiries') { // Inquiries already fetched separately
          stagesToFetch.add(prevStage);
        }
      }
    });

    // Fetch name lookup from leasing_reports (inquiry_id -> name)
    // Also fetch all inquiries for baseline conversion calculation
    let inquiriesQuery = supabase.from('leasing_reports').select('inquiry_id, name, guest_card_id, inquiry_received, property');
    if (effectiveStartDate) inquiriesQuery = inquiriesQuery.gte('inquiry_received', effectiveStartDate);
    if (endDate) inquiriesQuery = inquiriesQuery.lte('inquiry_received', endDate + 'T23:59:59');
    if (property && property !== 'all') inquiriesQuery = inquiriesQuery.eq('property', property);

    let { data: leasingData } = await inquiriesQuery;
    // Apply region filter to inquiry baseline data
    if (region) leasingData = filterByRegion(leasingData || [], region);
    
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

    for (const currentStage of stagesToFetch) {
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
        case 'leases':
          tableName = 'rental_applications';
          dateField = 'received';
          break;
        default:
          continue;
      }

      // Build query based on stage
      let query = supabase.from(tableName).select('*');

      // Apply date filters
      if (effectiveStartDate) query = query.gte(dateField, effectiveStartDate);
      if (endDate) query = query.lte(dateField, endDate + 'T23:59:59');

      // Apply stage-specific filters
      if (currentStage === 'showings_completed') {
        query = query.eq('status', 'Completed');
      } else if (currentStage === 'leases') {
        query = query.or('status.eq.Converted,application_status.eq.Approved');
      }

      // Apply property filter for tables that have it
      if (property && property !== 'all') {
        if (tableName === 'leasing_reports' || tableName === 'showings') {
          query = query.eq('property', property);
        } else if (tableName === 'rental_applications') {
          // rental_applications stores property in the unit field as "Property - Unit - Address"
          query = query.like('unit', `${property} - %`);
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

    // Apply region filter to all records (post-fetch filtering)
    if (region) allRecords = filterByRegion(allRecords, region);

    // Check if any records from selected stages have dates after today
    // If no future data exists, cap endDate to today (normal cutoff)
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const hasFutureData = allRecords.some(record => {
      if (!selectedStages.includes(record._stage)) return false;
      const dateVal = record[record._dateField];
      if (!dateVal) return false;
      return new Date(dateVal) > todayEnd;
    });

    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const effectiveEndDate = hasFutureData ? endDate : todayStr;

    // Process data separately for each stage
    // Pass both selectedStages (for display) and all fetched stages (for conversion calculation)
    const result = processStageDataByStage(allRecords, selectedStages, dailyInquiryCounts, weeklyInquiryCounts, effectiveStartDate, effectiveEndDate, [...stagesToFetch], granularity);
    result.hasFutureData = hasFutureData;

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
    const source = record.inquiry_source || record.source || record.lead_source || 'Unknown';
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

function processStageDataByStage(records, stages, dailyInquiryCounts = {}, weeklyInquiryCounts = {}, startDate = null, endDate = null, allFetchedStages = [], granularity = 'weekly') {
  const stageColors = {
    'inquiries': '#667eea',
    'showings_scheduled': '#8b5cf6',
    'showings_completed': '#764ba2',
    'applications': '#f093fb',
    'leases': '#43e97b'
  };

  const stageNames = {
    'inquiries': 'Inquiries',
    'showings_scheduled': 'Showings Scheduled',
    'showings_completed': 'Showings Completed',
    'applications': 'Applications',
    'leases': 'Leases'
  };

  const emptyResult = {
    total: 0, stages: [], granularity,
    allBuckets: [], timeSeriesDataByStage: {}, conversionByStage: {}, dataBySource: { sources: [], data: [] },
    topProperties: [], statusDistribution: [], sourceDistribution: [], leadTypeDistribution: []
  };

  if (!records || records.length === 0) return emptyResult;

  const getDateValue = (record) => {
    if (record._dateField) return record[record._dateField];
    return record.inquiry_received || record.showing_time || record.received;
  };

  const toDateStr = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  // Determine chart date range
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let chartStartDate = startDate ? parseDateStr(startDate) : null;
  let chartEndDate = endDate ? parseDateStr(endDate) : today;

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
  if (!chartStartDate) {
    chartStartDate = new Date(today);
    chartStartDate.setDate(chartStartDate.getDate() - 30);
  }

  // Generate all buckets for the selected granularity
  const startStr = toDateStr(chartStartDate);
  const endStr = toDateStr(chartEndDate);
  const allBuckets = generateAllBuckets(startStr, endStr, granularity);
  const bucketKeySet = new Set(allBuckets.map(b => b.key));

  // Process data for each stage
  const timeSeriesDataByStage = {};
  const stageTotals = {};
  const stagesToProcess = allFetchedStages.length > 0 ? allFetchedStages : stages;

  stagesToProcess.forEach(stage => {
    let stageRecords = records.filter(r => r._stage === stage);

    // For leases stage, deduplicate by unit - keep only most recent per unit
    if (stage === 'leases') {
      const unitMap = new Map();
      stageRecords.forEach(record => {
        const unit = record.unit || 'Unknown';
        const dateVal = getDateValue(record);
        const existing = unitMap.get(unit);
        if (!existing || (dateVal && new Date(dateVal) > new Date(existing.date))) {
          unitMap.set(unit, { record, date: dateVal });
        }
      });
      stageRecords = Array.from(unitMap.values()).map(v => v.record);
    }

    stageTotals[stage] = stageRecords.length;

    // Bucket counts and details
    const bucketCounts = {};
    const bucketDetails = {};
    const bucketUnits = {}; // For leases dedup per bucket

    stageRecords.forEach(record => {
      const dateVal = getDateValue(record);
      if (dateVal) {
        const date = new Date(dateVal);
        const dateStr = toDateStr(date);
        const b = bucketDate(dateStr, granularity);

        // For leases, deduplicate by unit per bucket
        if (stage === 'leases') {
          const unit = record.unit || 'Unknown';
          if (!bucketUnits[b.key]) bucketUnits[b.key] = new Set();
          if (bucketUnits[b.key].has(unit)) return;
          bucketUnits[b.key].add(unit);
        }

        bucketCounts[b.key] = (bucketCounts[b.key] || 0) + 1;

        if (!bucketDetails[b.key]) bucketDetails[b.key] = [];
        const name = record._resolvedName || record.name || record.guest_card_name || record.applicants || 'Unknown';
        const id = record.id || record.inquiry_id || record.showing_id || record.rental_application_id || '';
        let property = record.property || '';
        let unit = record.showing_unit || '';
        if (!property && record.unit && record.unit.includes(' - ')) {
          const parts = record.unit.split(' - ');
          property = parts[0];
          unit = parts[1] || '';
        }
        bucketDetails[b.key].push({ name, id, property, unit });
      }
    });

    timeSeriesDataByStage[stage] = {
      label: stageNames[stage],
      color: stageColors[stage],
      data: allBuckets.map(b => ({
        bucket: b.key,
        label: b.label,
        count: bucketCounts[b.key] || 0,
        details: bucketDetails[b.key] || []
      }))
    };
  });

  // Aggregate distributions across all records
  const propertyCounts = {};
  const statusCounts = {};
  const sourceCounts = {};
  const leadTypeCounts = {};

  records.forEach(record => {
    if (record.property) propertyCounts[record.property] = (propertyCounts[record.property] || 0) + 1;
    const status = record.status || record.application_status || 'Unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    const source = record.inquiry_source || record.source || record.lead_source || 'Unknown';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    const leadType = record.lead_type || record.type || 'Unknown';
    leadTypeCounts[leadType] = (leadTypeCounts[leadType] || 0) + 1;
  });

  const uniqueProperties = new Set(records.map(r => r.property).filter(Boolean));

  // Calculate conversion percentages per bucket
  const funnelOrder = ['inquiries', 'showings_scheduled', 'showings_completed', 'applications', 'leases'];

  // Bucket inquiry counts for conversion baseline
  const rawInquiryDates = weeklyInquiryCounts._rawDates || [];
  const inquiryBucketCounts = {};
  rawInquiryDates.forEach(date => {
    const dateStr = toDateStr(date);
    const b = bucketDate(dateStr, granularity);
    inquiryBucketCounts[b.key] = (inquiryBucketCounts[b.key] || 0) + 1;
  });

  const conversionByStage = {};
  stages.forEach(stage => {
    const stageIndex = funnelOrder.indexOf(stage);
    const previousStage = stageIndex > 0 ? funnelOrder[stageIndex - 1] : null;

    if (stage === 'inquiries') {
      conversionByStage[stage] = {
        label: stageNames[stage],
        color: stageColors[stage],
        data: allBuckets.map(b => ({
          bucket: b.key, label: b.label,
          percentage: 100,
          count: inquiryBucketCounts[b.key] || 0,
          baseline: inquiryBucketCounts[b.key] || 0,
          baselineLabel: 'Inquiries'
        }))
      };
    } else {
      const stageData = timeSeriesDataByStage[stage];
      let getPrevCount, baselineLabel;

      if (previousStage === 'inquiries') {
        getPrevCount = (bucketKey) => inquiryBucketCounts[bucketKey] || 0;
        baselineLabel = 'Inquiries';
      } else if (timeSeriesDataByStage[previousStage]) {
        const prevDataMap = {};
        timeSeriesDataByStage[previousStage].data.forEach(d => { prevDataMap[d.bucket] = d.count; });
        getPrevCount = (bucketKey) => prevDataMap[bucketKey] || 0;
        baselineLabel = stageNames[previousStage];
      } else {
        getPrevCount = (bucketKey) => inquiryBucketCounts[bucketKey] || 0;
        baselineLabel = 'Inquiries';
      }

      conversionByStage[stage] = {
        label: `${stageNames[stage]} (from ${baselineLabel})`,
        color: stageColors[stage],
        data: allBuckets.map(b => {
          const stageCount = stageData.data.find(d => d.bucket === b.key)?.count || 0;
          const previousCount = getPrevCount(b.key);
          const percentage = previousCount > 0 ? Math.round((stageCount / previousCount) * 100) : 0;
          return { bucket: b.key, label: b.label, percentage, count: stageCount, baseline: previousCount, baselineLabel };
        })
      };
    }
  });

  // Build data by source bucketed by granularity
  const sourceByBucket = {};
  const sourceGrandTotals = {};

  records.forEach(record => {
    if (!stages.includes(record._stage)) return;
    const dateVal = getDateValue(record);
    if (!dateVal) return;
    const date = new Date(dateVal);
    const dateStr = toDateStr(date);
    const b = bucketDate(dateStr, granularity);
    const source = record.inquiry_source || record.source || record.lead_source || 'Unknown';

    if (!sourceByBucket[b.key]) sourceByBucket[b.key] = {};
    sourceByBucket[b.key][source] = (sourceByBucket[b.key][source] || 0) + 1;
    sourceGrandTotals[source] = (sourceGrandTotals[source] || 0) + 1;
  });

  const topSourceNames = Object.entries(sourceGrandTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([source]) => source);

  const dataBySource = {
    sources: topSourceNames,
    data: allBuckets.map(b => {
      const point = { bucket: b.key, label: b.label };
      topSourceNames.forEach(source => {
        point[source] = sourceByBucket[b.key]?.[source] || 0;
      });
      return point;
    })
  };

  return {
    total: records.length,
    stageTotals,
    propertyCount: uniqueProperties.size,
    stages,
    granularity,
    allBuckets,
    timeSeriesDataByStage,
    conversionByStage,
    dataBySource,
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
