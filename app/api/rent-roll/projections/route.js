import { supabase } from '../../../../lib/supabase';
import { NextResponse } from 'next/server';

// Region definitions - exact property name matches (case-insensitive)
const REGION_PROPERTIES = {
  region_kansas_city: ['hilltop', 'oakwood', 'glen oaks', 'normandy', 'maple manor'],
  region_columbia: null // Columbia is everything NOT in Kansas City
};

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const property = searchParams.get('property');
    const region = searchParams.get('region');
    
    // Get current occupancy from rent_roll_snapshots (source of truth)
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
    
    // Get current unit statuses (include tenant_name for evictions)
    let currentQuery = supabase
      .from('rent_roll_snapshots')
      .select('property, unit, status, tenant_name')
      .eq('snapshot_date', latestDate);
    
    if (property && property !== 'all') {
      currentQuery = currentQuery.eq('property', property);
    }
    
    let { data: currentUnits } = await currentQuery;
    
    // Apply region filter if specified
    if (region) {
      const kcProperties = REGION_PROPERTIES.region_kansas_city;
      if (region === 'region_kansas_city') {
        currentUnits = currentUnits?.filter(u => 
          kcProperties.some(kc => u.property?.toLowerCase().includes(kc))
        ) || [];
      } else if (region === 'region_columbia') {
        currentUnits = currentUnits?.filter(u => 
          !kcProperties.some(kc => u.property?.toLowerCase().includes(kc))
        ) || [];
      }
    }
    
    const totalUnits = currentUnits?.length || 0;
    const currentOccupied = currentUnits?.filter(u => 
      u.status === 'Current' || u.status === 'Evict' || u.status === 'Notice-Unrented'
    ).length || 0;
    
    // Get future events from tenant_events (only for projections)
    const today = new Date().toISOString().split('T')[0];
    const ninetyDaysOut = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Get the latest snapshot_date from tenant_events to avoid duplicates across daily files
    const { data: latestEventSnapshot } = await supabase
      .from('tenant_events')
      .select('snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1);
    
    const latestEventDate = latestEventSnapshot?.[0]?.snapshot_date;
    
    let eventsQuery = supabase
      .from('tenant_events')
      .select('event_date, event_type, property, unit, tenant_name, rent')
      .gte('event_date', today)
      .lte('event_date', ninetyDaysOut)
      .order('event_date', { ascending: true });
    
    // Filter by latest snapshot to avoid duplicates from multiple daily files
    if (latestEventDate) {
      eventsQuery = eventsQuery.eq('snapshot_date', latestEventDate);
    }
    
    if (property && property !== 'all') {
      eventsQuery = eventsQuery.eq('property', property);
    }
    
    let { data: rawFutureEvents } = await eventsQuery;
    
    // Apply region filter to events if specified
    if (region) {
      const kcProperties = REGION_PROPERTIES.region_kansas_city;
      if (region === 'region_kansas_city') {
        rawFutureEvents = rawFutureEvents?.filter(e => 
          kcProperties.some(kc => e.property?.toLowerCase().includes(kc))
        ) || [];
      } else if (region === 'region_columbia') {
        rawFutureEvents = rawFutureEvents?.filter(e => 
          !kcProperties.some(kc => e.property?.toLowerCase().includes(kc))
        ) || [];
      }
    }
    
    // Deduplicate events by property+unit+event_type (keep only one per unit per event type)
    const seenEvents = new Map();
    const futureEvents = [];
    
    rawFutureEvents?.forEach(event => {
      const key = `${event.property}-${event.unit}-${event.event_type}`;
      if (!seenEvents.has(key)) {
        seenEvents.set(key, event);
        futureEvents.push(event);
      }
    });
    
    // Get current evictions from latest snapshot
    // For units still in Evict status, project move-out 30 days from today
    const currentEvictions = currentUnits?.filter(u => u.status === 'Evict') || [];
    
    // Create projected eviction move-outs (30 days from today for ongoing evictions)
    // Use tenant_name from rent_roll_snapshots
    const evictionMoveOuts = currentEvictions.map(evict => {
      const projectedMoveOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      return {
        event_date: projectedMoveOut.toISOString().split('T')[0],
        event_type: 'Eviction',
        property: evict.property,
        unit: evict.unit,
        tenant_name: evict.tenant_name || null,
        rent: null
      };
    }).filter(e => e.event_date >= today && e.event_date <= ninetyDaysOut);
    
    // Combine all events
    const allFutureEvents = [...(futureEvents || []), ...evictionMoveOuts];
    
    // Separate move-ins and move-outs
    const upcomingMoveIns = allFutureEvents.filter(e => e.event_type === 'Move-in') || [];
    const upcomingMoveOuts = allFutureEvents.filter(e => 
      e.event_type === 'Move-out' || e.event_type === 'Notice' || e.event_type === 'Eviction'
    ) || [];
    
    // Calculate projected occupancy over time
    // Start with current occupancy and apply future events
    const projectionDays = [];
    let runningOccupied = currentOccupied;
    
    // Create daily projections for next 90 days
    const eventsByDate = {};
    allFutureEvents?.forEach(event => {
      if (!eventsByDate[event.event_date]) {
        eventsByDate[event.event_date] = { moveIns: 0, moveOuts: 0 };
      }
      if (event.event_type === 'Move-in') {
        eventsByDate[event.event_date].moveIns++;
      } else {
        eventsByDate[event.event_date].moveOuts++;
      }
    });
    
    // Generate weekly projections
    for (let i = 0; i <= 12; i++) {
      const weekDate = new Date(Date.now() + i * 7 * 24 * 60 * 60 * 1000);
      const weekDateStr = weekDate.toISOString().split('T')[0];
      
      // Apply all events up to this date
      let weekOccupied = currentOccupied;
      Object.entries(eventsByDate).forEach(([date, changes]) => {
        if (date <= weekDateStr) {
          weekOccupied += changes.moveIns - changes.moveOuts;
        }
      });
      
      // Ensure we don't go below 0 or above total
      weekOccupied = Math.max(0, Math.min(totalUnits, weekOccupied));
      
      projectionDays.push({
        date: weekDateStr,
        occupied: weekOccupied,
        occupancyRate: totalUnits > 0 ? ((weekOccupied / totalUnits) * 100).toFixed(1) : 0
      });
    }
    
    // Calculate net change by week
    const netChangeByWeek = [];
    for (let i = 0; i < 12; i++) {
      const weekStart = new Date(Date.now() + i * 7 * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(Date.now() + (i + 1) * 7 * 24 * 60 * 60 * 1000);
      const weekStartStr = weekStart.toISOString().split('T')[0];
      const weekEndStr = weekEnd.toISOString().split('T')[0];
      
      let weekMoveIns = 0;
      let weekMoveOuts = 0;
      const weekMoveInDetails = [];
      const weekMoveOutDetails = [];
      
      allFutureEvents?.forEach(event => {
        if (event.event_date >= weekStartStr && event.event_date < weekEndStr) {
          const detail = {
            tenant: event.tenant_name || 'Unknown',
            unit: event.unit,
            property: event.property,
            date: event.event_date,
            type: event.event_type
          };
          if (event.event_type === 'Move-in') {
            weekMoveIns++;
            weekMoveInDetails.push(detail);
          } else {
            weekMoveOuts++;
            weekMoveOutDetails.push(detail);
          }
        }
      });
      
      netChangeByWeek.push({
        weekStart: weekStartStr,
        weekLabel: `Week ${i + 1}`,
        moveIns: weekMoveIns,
        moveOuts: weekMoveOuts,
        netChange: weekMoveIns - weekMoveOuts,
        moveInDetails: weekMoveInDetails,
        moveOutDetails: weekMoveOutDetails
      });
    }
    
    // Summary stats
    const totalMoveIns30 = upcomingMoveIns.filter(e => {
      const eventDate = new Date(e.event_date);
      return eventDate <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }).length;
    
    const totalMoveOuts30 = upcomingMoveOuts.filter(e => {
      const eventDate = new Date(e.event_date);
      return eventDate <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }).length;
    
    const totalMoveIns60 = upcomingMoveIns.filter(e => {
      const eventDate = new Date(e.event_date);
      return eventDate <= new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    }).length;
    
    const totalMoveOuts60 = upcomingMoveOuts.filter(e => {
      const eventDate = new Date(e.event_date);
      return eventDate <= new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    }).length;
    
    const totalMoveIns90 = upcomingMoveIns.length;
    const totalMoveOuts90 = upcomingMoveOuts.length;
    
    return NextResponse.json({
      hasData: true,
      currentDate: latestDate,
      currentOccupancy: {
        totalUnits,
        occupied: currentOccupied,
        occupancyRate: totalUnits > 0 ? ((currentOccupied / totalUnits) * 100).toFixed(1) : 0
      },
      projections: projectionDays,
      netChangeByWeek,
      summary: {
        next30Days: {
          moveIns: totalMoveIns30,
          moveOuts: totalMoveOuts30,
          netChange: totalMoveIns30 - totalMoveOuts30
        },
        next60Days: {
          moveIns: totalMoveIns60,
          moveOuts: totalMoveOuts60,
          netChange: totalMoveIns60 - totalMoveOuts60
        },
        next90Days: {
          moveIns: totalMoveIns90,
          moveOuts: totalMoveOuts90,
          netChange: totalMoveIns90 - totalMoveOuts90
        }
      },
      upcomingMoveIns: upcomingMoveIns.slice(0, 20),
      upcomingMoveOuts: upcomingMoveOuts.slice(0, 20)
    });
    
  } catch (error) {
    console.error('Error fetching projections:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
