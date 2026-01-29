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
        .select('*')
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
    
    // Calculate healthy lease rate (good lease rate)
    // Based on formula: Good leases = non-vacant, non-evict, with lease end > 60 days
    // Denominator = non-vacant units only (exclude vacant from both numerator and denominator)
    let goodLeases = 0;
    let nonVacantUnits = 0;
    
    currentData.forEach(u => {
      // Exclude vacant units entirely from calculation
      if (u.status === 'Vacant-Unrented' || u.status === 'Vacant-Rented') {
        return;
      }
      
      nonVacantUnits++;
      
      // Exclude evictions from good leases
      if (u.status === 'Evict') {
        return;
      }
      
      // Units without lease end dates are month-to-month (bad leases)
      if (!u.lease_to) {
        return;
      }
      
      // Lease must be more than 60 days from today and not expired
      const leaseEnd = new Date(u.lease_to);
      const sixtyDaysFromNow = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
      
      // If lease is expired or in the past, it's a bad lease
      if (leaseEnd < today) {
        return;
      }
      
      if (leaseEnd <= sixtyDaysFromNow) {
        return;
      }
      
      // If all conditions met, it's a good lease
      goodLeases++;
    });
    
    // Divide by non-vacant units only
    const healthyLeaseRate = nonVacantUnits > 0 ? (goodLeases / nonVacantUnits * 100) : 0;
    
    // Calculate historical healthy lease rate trend
    // Apply the same logic as current calculation to each historical snapshot
    const healthyLeaseTrend = [];
    
    // Group historical data by snapshot date
    const snapshotsByDate = {};
    dataToProcess.forEach(record => {
      const date = record.snapshot_date;
      if (!snapshotsByDate[date]) {
        snapshotsByDate[date] = [];
      }
      snapshotsByDate[date].push(record);
    });
    
    // Calculate healthy lease rate for each snapshot date
    Object.keys(snapshotsByDate).sort().forEach(date => {
      const snapshotData = snapshotsByDate[date];
      let goodLeases = 0;
      let nonVacantUnits = 0;
      
      snapshotData.forEach(u => {
        // Exclude vacant units entirely from calculation
        if (u.status === 'Vacant-Unrented' || u.status === 'Vacant-Rented') {
          return;
        }
        
        nonVacantUnits++;
        
        // Exclude evictions from good leases
        if (u.status === 'Evict') {
          return;
        }
        
        // Units without lease end dates are month-to-month (bad leases)
        if (!u.lease_to) {
          return;
        }
        
        // Lease must be more than 60 days from the SNAPSHOT DATE and not expired
        const leaseEnd = new Date(u.lease_to);
        const snapshotDate = new Date(date);
        const sixtyDaysFromSnapshot = new Date(snapshotDate.getTime() + 60 * 24 * 60 * 60 * 1000);
        
        // If lease is expired as of the snapshot date, it's a bad lease
        if (leaseEnd < snapshotDate) {
          return;
        }
        
        if (leaseEnd <= sixtyDaysFromSnapshot) {
          return;
        }
        
        // If all conditions met, it's a good lease
        goodLeases++;
      });
      
      // Divide by non-vacant units only
      const rate = nonVacantUnits > 0 ? (goodLeases / nonVacantUnits * 100) : 0;
      
      healthyLeaseTrend.push({
        date,
        healthyLeaseRate: rate.toFixed(1),
        totalUnits: nonVacantUnits,
        goodLeases: goodLeases
      });
    });
    
    // Calculate lease health projections
    const currentDate = new Date();
    const sixtyDaysFromNow = new Date(currentDate.getTime() + 60 * 24 * 60 * 60 * 1000);
    const ninetyDaysFromNow = new Date(currentDate.getTime() + 90 * 24 * 60 * 60 * 1000);
    
    // Get all snapshot dates and find the most recent one
    const snapshotDates = [...new Set(dataToProcess.map(r => r.snapshot_date))].sort();
    const latestSnapshotDate = snapshotDates[snapshotDates.length - 1];
    const previousDate = snapshotDates[snapshotDates.length - 2]; // Last week of data
    
    // Get previous snapshot data
    const previousData = previousDate ? dataToProcess.filter(r => r.snapshot_date === previousDate) : [];
    
    // Helper function to check if a unit is a "bad lease"
    const isBadLease = (unit, referenceDate = currentDate) => {
      if (unit.status === 'Vacant-Unrented' || unit.status === 'Vacant-Rented') return false; // Exclude vacant
      if (unit.status === 'Evict') return true;
      if (!unit.lease_to) return true; // Month-to-month
      
      const leaseEnd = new Date(unit.lease_to);
      // If lease is expired or in the past, treat as month-to-month (bad lease)
      if (leaseEnd < referenceDate) return true;
      
      return leaseEnd <= new Date(referenceDate.getTime() + 60 * 24 * 60 * 60 * 1000);
    };
    
    // Count rescued leases
    let rescuedLeases = 0;
    if (previousData.length > 0) {
      previousData.forEach(prevUnit => {
        if (prevUnit.status === 'Vacant-Unrented' || prevUnit.status === 'Vacant-Rented') return;
        
        const wasBad = isBadLease(prevUnit, new Date(previousDate));
        
        if (wasBad) {
          // Check if it's good now
          const currentUnit = currentData.find(c => c.unit === prevUnit.unit && c.property === prevUnit.property);
          if (currentUnit) {
            const isGoodNow = !isBadLease(currentUnit);
            if (isGoodNow) {
              rescuedLeases++;
            }
          }
        }
      });
    }
    
    // Count new bad leases (net changes from last week)
    let newBadLeases = 0;
    if (previousData.length > 0) {
      currentData.forEach(currentUnit => {
        if (currentUnit.status === 'Vacant-Unrented' || currentUnit.status === 'Vacant-Rented') return;
        
        const isCurrentlyBad = isBadLease(currentUnit);
        
        if (isCurrentlyBad) {
          // Check if it was good in the previous snapshot
          const prevUnit = previousData.find(p => p.unit === currentUnit.unit && p.property === currentUnit.property);
          if (!prevUnit) {
            // New unit that's bad
            newBadLeases++;
          } else {
            const wasGood = !isBadLease(prevUnit, new Date(previousDate));
            if (wasGood) {
              // Was good, now bad
              newBadLeases++;
            }
          }
        }
      });
    }
    
    // Count upcoming bad leases (61-90 days)
    let upcomingBadLeases61to90 = 0;
    currentData.forEach(u => {
      if (u.status === 'Vacant-Unrented' || u.status === 'Vacant-Rented') return;
      
      if (u.lease_to) {
        const leaseEnd = new Date(u.lease_to);
        if (leaseEnd > sixtyDaysFromNow && leaseEnd <= ninetyDaysFromNow) {
          upcomingBadLeases61to90++;
        }
      }
    });
    
    // Get detailed bad lease information
    const badLeasesByReason = {
      evictions: [],
      monthToMonth: [],
      expiringWithin60Days: []
    };
    
    const upcomingExpirations = [];
    
    // Get renewal summary data
    let renewalData = [];
    try {
      const { data: renewalRows, error: renewalError } = await supabase
        .from('renewal_summary')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(2000);
      
      if (!renewalError && renewalRows) {
        renewalData = renewalRows;
      }
    } catch (error) {
      console.log('No renewal summary data found:', error.message);
    }
    
    // Helper function to normalize property names for matching
    const normalizePropertyName = (name) => {
      if (!name) return '';
      // Extract base name before " - " (e.g., "Glen Oaks - 3050 N 58th St..." -> "Glen Oaks")
      let baseName = name.includes(' - ') ? name.split(' - ')[0] : name;
      // Lowercase and remove extra spaces
      return baseName.toLowerCase().trim();
    };
    
    // Helper function to normalize unit names
    const normalizeUnitName = (unit) => {
      if (!unit) return '';
      // Remove leading zeros, lowercase, trim
      return String(unit).replace(/^0+/, '').toLowerCase().trim();
    };
    
    // Create multiple lookup maps for renewal data
    const renewalByPropertyUnit = {};  // property-unit -> renewal
    const renewalByUnit = {};          // unit -> [renewals] (for fallback matching)
    const renewalByTenantName = {};    // normalized tenant name -> [renewals]
    
    // Helper to score renewal priority (higher = better)
    const getRenewalPriority = (renewal) => {
      let score = 0;
      // Renewed with countersigned date is best
      if (renewal.status === 'Renewed' && renewal.countersigned_date) score += 1000;
      else if (renewal.status === 'Renewed') score += 800;
      else if (renewal.status === 'Pending') score += 500;
      else if (renewal.status === 'Did Not Renew') score += 100;
      else if (renewal.status === 'Canceled by User') score += 50;
      
      // More recent renewal_sent_date is better
      if (renewal.renewal_sent_date) {
        score += Math.floor(new Date(renewal.renewal_sent_date).getTime() / 86400000);
      }
      
      return score;
    };
    
    renewalData.forEach(renewal => {
      const basePropertyName = normalizePropertyName(renewal.property_name);
      const normalizedUnit = normalizeUnitName(renewal.unit_name);
      
      // Primary key: normalized property + unit
      const primaryKey = `${basePropertyName}-${normalizedUnit}`;
      const existingRenewal = renewalByPropertyUnit[primaryKey];
      
      // Keep the renewal with highest priority
      if (!existingRenewal || getRenewalPriority(renewal) > getRenewalPriority(existingRenewal)) {
        renewalByPropertyUnit[primaryKey] = renewal;
      }
      
      // Secondary: by unit only (for fallback)
      if (!renewalByUnit[normalizedUnit]) {
        renewalByUnit[normalizedUnit] = [];
      }
      renewalByUnit[normalizedUnit].push(renewal);
      
      // Tertiary: by tenant name (for additional matching)
      if (renewal.tenant_name) {
        const normalizedTenant = renewal.tenant_name.toLowerCase().trim();
        if (!renewalByTenantName[normalizedTenant]) {
          renewalByTenantName[normalizedTenant] = [];
        }
        renewalByTenantName[normalizedTenant].push(renewal);
      }
    });
    
    // Function to find best renewal match for a unit
    const findRenewalMatch = (unit) => {
      const normalizedProperty = normalizePropertyName(unit.property);
      const normalizedUnit = normalizeUnitName(unit.unit);
      
      // Try primary match: property + unit
      const primaryKey = `${normalizedProperty}-${normalizedUnit}`;
      if (renewalByPropertyUnit[primaryKey]) {
        return renewalByPropertyUnit[primaryKey];
      }
      
      // Try fallback: unit only, but filter by property similarity
      const unitMatches = renewalByUnit[normalizedUnit] || [];
      if (unitMatches.length > 0) {
        // Filter to matches with property name similarity
        const propertyMatches = unitMatches.filter(r => {
          const renewalProp = normalizePropertyName(r.property_name);
          // Check if property names share significant words
          const unitPropWords = normalizedProperty.split(/\s+/);
          const renewalPropWords = renewalProp.split(/\s+/);
          return unitPropWords.some(word => 
            word.length > 2 && renewalPropWords.includes(word)
          );
        });
        
        if (propertyMatches.length > 0) {
          // Return the one with highest priority
          return propertyMatches.reduce((best, current) => 
            getRenewalPriority(current) > getRenewalPriority(best) ? current : best
          );
        }
        
        // If only one match for this unit, use it
        if (unitMatches.length === 1) {
          return unitMatches[0];
        }
        
        // Multiple matches but no property similarity - pick highest priority
        return unitMatches.reduce((best, current) => 
          getRenewalPriority(current) > getRenewalPriority(best) ? current : best
        );
      }
      
      return null;
    };
    
    currentData.forEach(u => {
      if (u.status === 'Vacant-Unrented' || u.status === 'Vacant-Rented') return;
      
      // Get renewal info for this unit using improved matching
      const renewalInfo = findRenewalMatch(u);
      
      const baseLeaseInfo = {
        property: u.property,
        unit: u.unit,
        renewalStatus: renewalInfo?.status || 'Not sent',
        renewalSentDate: renewalInfo?.renewal_sent_date || null,
        countersignedDate: renewalInfo?.countersigned_date || null,
        tenantName: renewalInfo?.tenant_name || null,
        rent: renewalInfo?.rent || u.total_rent || null,
        previousRent: renewalInfo?.previous_rent || null,
        hasRenewalData: !!renewalInfo
      };
      
      if (u.status === 'Evict') {
        badLeasesByReason.evictions.push({
          ...baseLeaseInfo,
          reason: 'Eviction',
          daysUntilExpiration: null
        });
      } else if (!u.lease_to) {
        badLeasesByReason.monthToMonth.push({
          ...baseLeaseInfo,
          reason: 'Month-to-month',
          daysUntilExpiration: null
        });
      } else {
        const leaseEnd = new Date(u.lease_to);
        const daysUntil = Math.ceil((leaseEnd.getTime() - currentDate.getTime()) / (24 * 60 * 60 * 1000));
        
        if (leaseEnd < currentDate) {
          // Expired lease - treat as month-to-month
          badLeasesByReason.monthToMonth.push({
            ...baseLeaseInfo,
            reason: `Expired ${Math.abs(daysUntil)} days ago`,
            daysUntilExpiration: daysUntil
          });
        } else if (daysUntil <= 60) {
          badLeasesByReason.expiringWithin60Days.push({
            ...baseLeaseInfo,
            reason: `Expiring in ${daysUntil} days`,
            daysUntilExpiration: daysUntil
          });
        } else if (daysUntil <= 90) {
          upcomingExpirations.push({
            ...baseLeaseInfo,
            reason: `Expiring in ${daysUntil} days`,
            daysUntilExpiration: daysUntil
          });
        }
      }
    });
    
    // Sort by days until expiration
    badLeasesByReason.expiringWithin60Days.sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);
    upcomingExpirations.sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);
    
    const leaseHealthDetails = {
      badLeasesByReason,
      upcomingExpirations,
      rescuedLeases,
      newBadLeases
    };

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
        healthyLeaseRate: parseFloat(healthyLeaseRate.toFixed(1)),
        totalRent,
        totalPastDue,
        totalSqft
      },
      statusDistribution,
      propertyStats,
      leaseExpirations,
      occupancyTrend,
      healthyLeaseTrend,
      delinquencyStats,
      leaseHealthDetails,
      properties: uniqueProperties,
      units: currentData
    });
    
  } catch (error) {
    console.error('Error fetching rent roll stats:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
