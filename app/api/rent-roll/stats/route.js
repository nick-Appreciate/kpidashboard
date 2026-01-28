import { supabase } from '../../../../lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const property = searchParams.get('property');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    
    // Get the latest snapshot date
    const { data: latestSnapshot } = await supabase
      .from('rent_roll_snapshots')
      .select('snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1);
    
    const latestDate = latestSnapshot?.[0]?.snapshot_date;
    
    if (!latestDate) {
      return NextResponse.json({
        error: 'No rent roll data available',
        hasData: false
      });
    }
    
    // Build query for current snapshot
    let currentQuery = supabase
      .from('rent_roll_snapshots')
      .select('*')
      .eq('snapshot_date', latestDate);
    
    if (property && property !== 'all') {
      currentQuery = currentQuery.eq('property', property);
    }
    
    const { data: currentData, error } = await currentQuery;
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Calculate current stats
    const totalUnits = currentData.length;
    // Occupied = units where someone is physically living (Current, Evict, Notice-Unrented)
    // This matches Appfolio's occupancy calculation
    const occupiedUnits = currentData.filter(u => 
      u.status === 'Current' || 
      u.status === 'Evict' || 
      u.status === 'Notice-Unrented'
    ).length;
    const vacantUnits = currentData.filter(u => u.status?.startsWith('Vacant')).length;
    const noticeUnits = currentData.filter(u => u.status?.startsWith('Notice')).length;
    const evictUnits = currentData.filter(u => u.status === 'Evict').length;
    
    const occupancyRate = totalUnits > 0 ? ((occupiedUnits / totalUnits) * 100).toFixed(1) : 0;
    
    const totalRent = currentData.reduce((sum, u) => sum + (parseFloat(u.total_rent) || 0), 0);
    const totalPastDue = currentData.reduce((sum, u) => sum + (parseFloat(u.past_due) || 0), 0);
    const totalSqft = currentData.reduce((sum, u) => sum + (parseInt(u.sqft) || 0), 0);
    
    // Status distribution
    const statusCounts = {};
    currentData.forEach(u => {
      const status = u.status || 'Unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    const statusDistribution = Object.entries(statusCounts)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
    
    // Property distribution
    const propertyCounts = {};
    const propertyOccupancy = {};
    currentData.forEach(u => {
      const prop = u.property || 'Unknown';
      propertyCounts[prop] = (propertyCounts[prop] || 0) + 1;
      if (!propertyOccupancy[prop]) {
        propertyOccupancy[prop] = { total: 0, occupied: 0 };
      }
      propertyOccupancy[prop].total++;
      // Occupied = Current, Evict, or Notice-Unrented (someone physically living there)
      if (u.status === 'Current' || u.status === 'Evict' || u.status === 'Notice-Unrented') {
        propertyOccupancy[prop].occupied++;
      }
    });
    
    const propertyStats = Object.entries(propertyOccupancy)
      .map(([property, stats]) => ({
        property,
        totalUnits: stats.total,
        occupiedUnits: stats.occupied,
        occupancyRate: ((stats.occupied / stats.total) * 100).toFixed(1)
      }))
      .sort((a, b) => b.totalUnits - a.totalUnits);
    
    // Lease expiration analysis
    const today = new Date();
    const thirtyDays = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const sixtyDays = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
    const ninetyDays = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
    
    const leaseExpirations = {
      expired: 0,
      within30Days: 0,
      within60Days: 0,
      within90Days: 0,
      beyond90Days: 0,
      noLeaseEnd: 0
    };
    
    currentData.forEach(u => {
      if (!u.lease_to) {
        leaseExpirations.noLeaseEnd++;
        return;
      }
      const leaseEnd = new Date(u.lease_to);
      if (leaseEnd < today) {
        leaseExpirations.expired++;
      } else if (leaseEnd <= thirtyDays) {
        leaseExpirations.within30Days++;
      } else if (leaseEnd <= sixtyDays) {
        leaseExpirations.within60Days++;
      } else if (leaseEnd <= ninetyDays) {
        leaseExpirations.within90Days++;
      } else {
        leaseExpirations.beyond90Days++;
      }
    });
    
    // Get historical occupancy data - fetch all snapshots with pagination to avoid row limits
    // Supabase has a max of 1000 rows per request, so we need to paginate
    let allHistoryData = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      let historyQuery = supabase
        .from('rent_roll_snapshots')
        .select('snapshot_date, status, property')
        .order('snapshot_date', { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      
      if (startDate) {
        historyQuery = historyQuery.gte('snapshot_date', startDate);
      }
      if (endDate) {
        historyQuery = historyQuery.lte('snapshot_date', endDate);
      }
      if (property && property !== 'all') {
        historyQuery = historyQuery.eq('property', property);
      }
      
      const { data: pageData, error: pageError } = await historyQuery;
      
      if (pageError || !pageData || pageData.length === 0) {
        hasMore = false;
      } else {
        allHistoryData = allHistoryData.concat(pageData);
        hasMore = pageData.length === pageSize;
        page++;
      }
      
      // Safety limit to prevent infinite loops
      if (page > 10) hasMore = false;
    }
    
    const historyData = allHistoryData;
    
    // Aggregate by date
    const dailyStats = {};
    const dataToProcess = historyData || [];
    dataToProcess.forEach(record => {
      const date = record.snapshot_date;
      if (!dailyStats[date]) {
        dailyStats[date] = { total: 0, occupied: 0, vacant: 0, pastDue: 0 };
      }
      dailyStats[date].total++;
      // Occupied = Current, Evict, or Notice-Unrented (someone physically living there)
      if (record.status === 'Current' || record.status === 'Evict' || record.status === 'Notice-Unrented') {
        dailyStats[date].occupied++;
      }
      if (record.status?.startsWith('Vacant')) {
        dailyStats[date].vacant++;
      }
    });
    
    const occupancyTrend = Object.entries(dailyStats)
      .map(([date, stats]) => ({
        date,
        occupancyRate: ((stats.occupied / stats.total) * 100).toFixed(1),
        totalUnits: stats.total,
        occupiedUnits: stats.occupied,
        vacantUnits: stats.vacant
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    // Get list of properties for filter
    const { data: propertiesList } = await supabase
      .from('rent_roll_snapshots')
      .select('property')
      .eq('snapshot_date', latestDate);
    
    const uniqueProperties = [...new Set(propertiesList?.map(p => p.property))].sort();
    
    // Get delinquency by property
    const delinquencyByProperty = {};
    currentData.forEach(u => {
      const prop = u.property || 'Unknown';
      if (!delinquencyByProperty[prop]) {
        delinquencyByProperty[prop] = 0;
      }
      delinquencyByProperty[prop] += parseFloat(u.past_due) || 0;
    });
    
    const delinquencyStats = Object.entries(delinquencyByProperty)
      .map(([property, amount]) => ({ property, amount }))
      .filter(d => d.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    
    return NextResponse.json({
      hasData: true,
      latestSnapshotDate: latestDate,
      summary: {
        totalUnits,
        occupiedUnits,
        vacantUnits,
        noticeUnits,
        evictUnits,
        occupancyRate: parseFloat(occupancyRate),
        totalRent,
        totalPastDue,
        totalSqft
      },
      statusDistribution,
      propertyStats,
      leaseExpirations,
      occupancyTrend,
      delinquencyStats,
      properties: uniqueProperties,
      units: currentData
    });
    
  } catch (error) {
    console.error('Error fetching rent roll stats:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
