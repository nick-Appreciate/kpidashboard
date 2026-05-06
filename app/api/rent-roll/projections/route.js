import { requireAuth } from '../../../../lib/auth';
import { NextResponse } from 'next/server';

// Region definitions - exact property name matches (case-insensitive)
const REGION_PROPERTIES = {
  region_kansas_city: ['hilltop', 'oakwood', 'glen oaks', 'normandy', 'maple manor'],
  region_columbia: null // Columbia is everything NOT in Kansas City
};

export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { searchParams } = new URL(request.url);
    const property = searchParams.get('property');
    const region = searchParams.get('region');
    const startDateParam = searchParams.get('startDate');

    // Helper: apply property/region filter to a list of unit-shaped rows.
    // Mirrors the inline filtering used elsewhere in this route.
    const filterByPropertyRegion = (rows) => {
      let out = rows || [];
      if (property && property !== 'all') {
        out = out.filter(u => u.property === property);
      }
      if (region) {
        const kcProperties = REGION_PROPERTIES.region_kansas_city;
        if (region === 'region_kansas_city') {
          out = out.filter(u => kcProperties.some(kc => u.property?.toLowerCase().includes(kc)));
        } else if (region === 'region_columbia') {
          out = out.filter(u => !kcProperties.some(kc => u.property?.toLowerCase().includes(kc)));
        } else if (region === 'farquhar') {
          const hilltopGone = new Date() >= new Date('2026-04-22T00:00:00');
          out = out.filter(u => u.property !== 'Glen Oaks' && !(hilltopGone && u.property === 'Hilltop Townhomes'));
        }
      }
      return out;
    };

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
      .select('property, unit, status, tenant_name, lease_to')
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
      } else if (region === 'farquhar') {
        const hilltopGone = new Date() >= new Date('2026-04-22T00:00:00');
        currentUnits = currentUnits?.filter(u =>
          u.property !== 'Glen Oaks' &&
          !(hilltopGone && u.property === 'Hilltop Townhomes')
        ) || [];
      }
    }
    
    const totalUnits = currentUnits?.length || 0;
    const currentOccupied = currentUnits?.filter(u =>
      u.status === 'Current' || u.status === 'Evict' || u.status === 'Notice-Unrented'
    ).length || 0;

    // Get move-out dates from af_tenant_directory (authoritative source from AppFolio)
    const { data: tenantDirData } = await supabase
      .from('af_tenant_directory')
      .select('property_name, unit, move_out')
      .not('move_out', 'is', null);

    const moveOutDateMap = new Map();
    (tenantDirData || []).forEach(d => {
      const key = `${d.property_name}-${d.unit}`.toLowerCase();
      if (!moveOutDateMap.has(key)) moveOutDateMap.set(key, d.move_out);
    });

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
    
    // Fetch events including recent past (so we can snap past move-ins to today)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    let eventsQuery = supabase
      .from('tenant_events')
      .select('event_date, event_type, property, unit, tenant_name, rent, lease_to')
      .gte('event_date', thirtyDaysAgo)
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
      } else if (region === 'farquhar') {
        const hilltopGone = new Date() >= new Date('2026-04-22T00:00:00');
        rawFutureEvents = rawFutureEvents?.filter(e =>
          e.property !== 'Glen Oaks' &&
          !(hilltopGone && e.property === 'Hilltop Townhomes')
        ) || [];
      }
    }
    
    // Build occupied unit keys early (for deduplication of move-ins)
    const occupiedUnitKeys = new Set(
      (currentUnits || [])
        .filter(u => u.status === 'Current' || u.status === 'Evict' || u.status === 'Notice-Unrented')
        .map(u => `${u.property}||${u.unit}`.toLowerCase())
    );

    // Only allow move-ins for units with approved applications (Vacant-Rented or Notice-Rented)
    const approvedMoveInKeys = new Set(
      (currentUnits || [])
        .filter(u => u.status === 'Vacant-Rented' || u.status === 'Notice-Rented')
        .map(u => `${u.property}||${u.unit}`.toLowerCase())
    );

    // Build lookup map for move-out dates: prefer af_tenant_directory move_out, fallback to lease_to
    const unitMoveOutMap = new Map();
    (currentUnits || []).forEach(u => {
      const key = `${u.property}-${u.unit}`.toLowerCase();
      const moveOut = moveOutDateMap.get(key);
      if (moveOut) {
        unitMoveOutMap.set(key, moveOut);
      } else if (u.lease_to) {
        unitMoveOutMap.set(key, u.lease_to);
      }
    });

    // Collect trailing events (past events that already happened) before dedup/filter
    // For Notice events, use move-out date from af_tenant_directory (most accurate) instead of event_date
    const trailingEvents = [];
    const seenTrailing = new Map();
    rawFutureEvents?.forEach(event => {
      if (event.event_date < today) {
        const key = `${event.property}-${event.unit}-${event.event_type}`;
        if (!seenTrailing.has(key)) {
          seenTrailing.set(key, true);
          const trailingEvent = { ...event };
          // For Notice/Move-out events, show the actual move-out date (lease end) not the notice date
          if (event.event_type === 'Notice' || event.event_type === 'Move-out') {
            const unitKey = `${event.property}-${event.unit}`.toLowerCase();
            const snapshotLeaseTo = unitMoveOutMap.get(unitKey);
            // Prefer rent_roll_snapshots lease_to, fall back to tenant_events lease_to
            if (snapshotLeaseTo) {
              trailingEvent.event_date = snapshotLeaseTo;
            } else if (event.lease_to) {
              trailingEvent.event_date = event.lease_to;
            }
          }
          trailingEvents.push(trailingEvent);
        }
      }
    });

    // Deduplicate events by property+unit+event_type (keep only one per unit per event type)
    const seenEvents = new Map();
    const futureEvents = [];

    rawFutureEvents?.forEach(event => {
      const key = `${event.property}-${event.unit}-${event.event_type}`;
      if (!seenEvents.has(key)) {
        seenEvents.set(key, event);
        // Skip move-ins for units already occupied or without approved applications
        if (event.event_type === 'Move-in') {
          const unitKey = `${event.property}||${event.unit}`.toLowerCase();
          if (occupiedUnitKeys.has(unitKey)) return;
          // Only show move-ins for Vacant-Rented or Notice-Rented (approved application)
          if (!approvedMoveInKeys.has(unitKey)) return;
        }
        // For Notice/Move-out events, use authoritative lease_to from rent_roll_snapshots
        if (event.event_type === 'Notice' || event.event_type === 'Move-out') {
          const unitKey = `${event.property}-${event.unit}`.toLowerCase();
          const snapshotLeaseTo = unitMoveOutMap.get(unitKey);
          if (snapshotLeaseTo) {
            event.event_date = snapshotLeaseTo;
          } else if (event.lease_to) {
            event.event_date = event.lease_to;
          }
        }
        // Past move-ins: snap to today (they haven't moved in yet)
        if (event.event_type === 'Move-in' && event.event_date < today) {
          event.event_date = today;
        }
        // Past move-outs: skip (already happened)
        if (event.event_type !== 'Move-in' && event.event_date < today) {
          return;
        }
        futureEvents.push(event);
      }
    });
    
    // Get current evictions from latest snapshot
    const currentEvictions = currentUnits?.filter(u => u.status === 'Evict') || [];

    // Fetch eviction filed dates from collection_stages
    const { data: evictionStages } = await supabase
      .from('collection_stages')
      .select('property_name, unit, eviction_started_at')
      .not('eviction_started_at', 'is', null);

    const evictionDateMap = {};
    (evictionStages || []).forEach(e => {
      evictionDateMap[`${e.property_name}||${e.unit}`.toLowerCase()] = e.eviction_started_at;
    });

    // Create projected eviction move-outs (45 days from eviction filed date)
    // If 45-day projection is already past, use today + 7 days (still in eviction status)
    const sevenDaysOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const evictionMoveOuts = currentEvictions.map(evict => {
      const unitKey = `${evict.property}||${evict.unit}`.toLowerCase();
      const filedDate = evictionDateMap[unitKey];
      let eventDate;
      if (filedDate) {
        const projectedMoveOut = new Date(new Date(filedDate).getTime() + 45 * 24 * 60 * 60 * 1000);
        eventDate = projectedMoveOut.toISOString().split('T')[0];
        // If 45-day projection is past, tenant is still in eviction — project 7 days out
        if (eventDate < today) eventDate = sevenDaysOut;
      } else {
        // No filed date — project 45 days from today
        eventDate = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      }
      return {
        event_date: eventDate,
        event_type: 'Eviction',
        property: evict.property,
        unit: evict.unit,
        tenant_name: evict.tenant_name || null,
        rent: null
      };
    }).filter(e => e.event_date <= ninetyDaysOut);

    // Get Notice-Unrented units and project move-outs 30 days from today
    const noticeUnits = currentUnits?.filter(u => u.status === 'Notice-Unrented') || [];

    // Only create notice move-outs for units that don't already have a Move-out or Notice event in tenant_events
    const existingMoveOutKeys = new Set(
      (futureEvents || [])
        .filter(e => e.event_type === 'Move-out' || e.event_type === 'Notice')
        .map(e => `${e.property}||${e.unit}`.toLowerCase())
    );

    const noticeMoveOuts = noticeUnits
      .filter(n => !existingMoveOutKeys.has(`${n.property}||${n.unit}`.toLowerCase()))
      .map(notice => {
        // Use move-out date from af_delinquency (AppFolio), fallback to lease_to, then 30 days
        const unitKey = `${notice.property}-${notice.unit}`.toLowerCase();
        const afMoveOut = moveOutDateMap.get(unitKey);
        let moveOutDate = afMoveOut
          || notice.lease_to
          || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        // Snap past dates to today (tenant hasn't moved out yet)
        if (moveOutDate < today) moveOutDate = today;
        return {
          event_date: moveOutDate,
          event_type: 'Notice',
          property: notice.property,
          unit: notice.unit,
          tenant_name: notice.tenant_name || null,
          rent: null
        };
      })
      .filter(e => e.event_date <= ninetyDaysOut);

    // --- Applications as Projected Move-Ins ---
    // Fetch approved apps and pipeline apps, but filter by unit status (Vacant-Rented = approved)
    const { data: allApps } = await supabase
      .from('rental_applications')
      .select('applicants, unit, approved_at, desired_move_in, move_in_date, lease_start_date, application_status')
      .or('application_status.eq.Approved,application_status.is.null');

    let pipelineApps = (allApps || []).filter(app => {
      // Exclude apps that already have a completed move-in or signed lease in the past
      if (app.move_in_date && new Date(app.move_in_date) < new Date()) return false;
      if (app.lease_start_date && new Date(app.lease_start_date) < new Date()) return false;
      return true;
    });

    // Parse property and unit from the rental_applications.unit field ("Property - Unit - Address")
    const parseAppUnit = (unitField) => {
      if (!unitField) return { property: null, unit: null };
      const parts = unitField.split(' - ');
      return {
        property: parts[0]?.trim() || null,
        unit: parts[1]?.trim() || null
      };
    };

    // Apply property/region filter
    pipelineApps = pipelineApps.filter(app => {
      const parsed = parseAppUnit(app.unit);
      if (!parsed.property) return false;

      if (property && property !== 'all') {
        if (parsed.property.toLowerCase() !== property.toLowerCase()) return false;
      }
      if (region) {
        const kcProperties = REGION_PROPERTIES.region_kansas_city;
        if (region === 'region_kansas_city') {
          if (!kcProperties.some(kc => parsed.property.toLowerCase().includes(kc))) return false;
        } else if (region === 'region_columbia') {
          if (kcProperties.some(kc => parsed.property.toLowerCase().includes(kc))) return false;
        } else if (region === 'farquhar') {
          const hilltopGone = new Date() >= new Date('2026-04-22T00:00:00');
          if (parsed.property === 'Glen Oaks') return false;
          if (hilltopGone && parsed.property === 'Hilltop Townhomes') return false;
        }
      }
      return true;
    });

    // Deduplicate: remove apps where a Move-in event already exists in tenant_events for this unit
    const existingMoveInKeys = new Set(
      (futureEvents || [])
        .filter(e => e.event_type === 'Move-in')
        .map(e => `${e.property}||${e.unit}`.toLowerCase())
    );

    // Deduplicate by unit (keep one per unit — most recent app wins)
    const seenAppUnits = new Set();
    const appMoveIns = [];

    for (const app of pipelineApps) {
      const parsed = parseAppUnit(app.unit);
      if (!parsed.property || !parsed.unit) continue;

      const unitKey = `${parsed.property}||${parsed.unit}`.toLowerCase();

      // Skip if unit already occupied, not approved (Vacant-Rented), has a tenant_events move-in, or already seen
      if (occupiedUnitKeys.has(unitKey)) continue;
      if (!approvedMoveInKeys.has(unitKey)) continue;
      if (existingMoveInKeys.has(unitKey)) continue;
      if (seenAppUnits.has(unitKey)) continue;
      seenAppUnits.add(unitKey);

      // Use desired_move_in if available, otherwise 2 weeks from approval date, otherwise 2 weeks from today
      let moveInDateStr;
      if (app.desired_move_in) {
        moveInDateStr = app.desired_move_in;
      } else if (app.approved_at) {
        const projectedMoveIn = new Date(new Date(app.approved_at).getTime() + 14 * 24 * 60 * 60 * 1000);
        moveInDateStr = projectedMoveIn.toISOString().split('T')[0];
      } else {
        moveInDateStr = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      }

      // Past move-in dates: project 1 week out (they haven't moved in yet)
      if (moveInDateStr < today) {
        moveInDateStr = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      }

      // Only include if within our projection window
      if (moveInDateStr > ninetyDaysOut) continue;

      appMoveIns.push({
        event_date: moveInDateStr,
        event_type: 'Move-in',
        property: parsed.property,
        unit: parsed.unit,
        tenant_name: app.applicants || null,
        rent: null,
        _source: 'application'
      });
    }

    // Combine all events
    const allFutureEvents = [...(futureEvents || []), ...evictionMoveOuts, ...noticeMoveOuts, ...appMoveIns];
    
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
    for (let i = 0; i < 13; i++) {
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
    
    // ── Trailing window driven by the dashboard date selector ──────────────
    // The page-level dropdown (Today / Last 7 / 30 / 90 Days / Last Year /
    // All Time / Custom Range) sets startDateParam. Use it to size the
    // trailing portion of the chart. Cap at 52 weeks so very long ranges
    // stay readable. Without a startDate (All Time), default to 52 weeks.
    let requestedTrailingWeeks = 52;
    if (startDateParam) {
      const startMs = new Date(startDateParam + 'T12:00:00').getTime();
      const days = Math.floor((Date.now() - startMs) / 86400000);
      requestedTrailingWeeks = Math.max(0, Math.min(52, Math.ceil(days / 7)));
    }

    // Hard-cap by the earliest available snapshot — pre-snapshot weeks would
    // otherwise render as 0% (which clamps to the chart's y-axis floor).
    let earliestSnapshotDate = null;
    if (requestedTrailingWeeks > 0) {
      const { data: earliestRows } = await supabase
        .from('rent_roll_snapshots')
        .select('snapshot_date')
        .order('snapshot_date', { ascending: true })
        .limit(1);
      earliestSnapshotDate = earliestRows?.[0]?.snapshot_date || null;
    }
    let trailingWeeksCount = requestedTrailingWeeks;
    if (earliestSnapshotDate) {
      const earliestMs = new Date(earliestSnapshotDate + 'T12:00:00').getTime();
      const weeksAvailable = Math.floor((Date.now() - earliestMs) / (7 * 86400000));
      trailingWeeksCount = Math.min(trailingWeeksCount, weeksAvailable);
    } else {
      trailingWeeksCount = 0;
    }

    // Build trailing week boundaries — each entry is a target date for which
    // we want the occupancy snapshot. weekTargets[0] is the oldest.
    const weekTargets = [];
    for (let i = trailingWeeksCount; i >= 1; i--) {
      weekTargets.push(new Date(Date.now() - i * 7 * 86400000));
    }
    const weekTargetStrs = weekTargets.map(d => d.toISOString().split('T')[0]);

    let trailingProjections = [];
    let trailingNetChangeByWeek = [];
    if (trailingWeeksCount > 0 && weekTargets.length > 0) {
      const earliestStr = weekTargetStrs[0];
      const newestStr = latestDate;

      const { data: dateRows } = await supabase
        .from('rent_roll_snapshots')
        .select('snapshot_date')
        .gte('snapshot_date', earliestStr)
        .lt('snapshot_date', newestStr)
        .order('snapshot_date', { ascending: true })
        .range(0, 99999);

      const availableDates = Array.from(new Set((dateRows || []).map(r => r.snapshot_date))).sort();

      // For each weekly target, pick the closest available date <= target.
      const targetToSnapshot = weekTargetStrs.map(target => {
        let chosen = null;
        for (const d of availableDates) {
          if (d <= target) chosen = d;
          else break;
        }
        return { target, snapshot: chosen };
      });

      const neededSnapshots = Array.from(
        new Set(targetToSnapshot.map(t => t.snapshot).filter(Boolean))
      );

      // Fetch snapshot rows for the dates we need. Supabase silently caps at
      // 1000 rows per query, so paginate explicitly — 52 weeks × hundreds of
      // units easily exceeds that and the truncation produces phantom
      // move-outs at the boundary between full and partial snapshots.
      const occupiedByDate = new Map(); // snapshot_date → { total, occupied: Map<unitKey, tenant> }
      if (neededSnapshots.length > 0) {
        const PAGE = 1000;
        let from = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { data: snapRows, error: snapErr } = await supabase
            .from('rent_roll_snapshots')
            .select('snapshot_date, property, unit, status, tenant_name')
            .in('snapshot_date', neededSnapshots)
            .range(from, from + PAGE - 1);
          if (snapErr) throw snapErr;
          const filtered = filterByPropertyRegion(snapRows);
          for (const row of filtered) {
            let bucket = occupiedByDate.get(row.snapshot_date);
            if (!bucket) {
              bucket = { total: 0, occupied: new Map() };
              occupiedByDate.set(row.snapshot_date, bucket);
            }
            bucket.total++;
            if (row.status === 'Current' || row.status === 'Evict' || row.status === 'Notice-Unrented') {
              bucket.occupied.set(`${row.property}||${row.unit}`.toLowerCase(), row.tenant_name || null);
            }
          }
          if (!snapRows || snapRows.length < PAGE) break;
          from += PAGE;
        }
      }

      // Build the line + bars from snapshot deltas. Each week's bar diffs the
      // current snapshot's occupied set against the previous week's; the first
      // week has no previous data, so its bar is 0 (correct edge behavior).
      let prevBucket = null;
      for (let i = 0; i < targetToSnapshot.length; i++) {
        const { target, snapshot } = targetToSnapshot[i];
        const bucket = snapshot ? occupiedByDate.get(snapshot) : null;
        if (bucket && bucket.total > 0) {
          trailingProjections.push({
            date: target,
            occupied: bucket.occupied.size,
            occupancyRate: ((bucket.occupied.size / bucket.total) * 100).toFixed(1)
          });
        } else {
          // No snapshot for this week — emit null so the line draws a gap.
          trailingProjections.push({ date: target, occupied: null, occupancyRate: null });
        }

        let moveIns = 0;
        let moveOuts = 0;
        const moveInDetails = [];
        const moveOutDetails = [];
        if (prevBucket && bucket) {
          bucket.occupied.forEach((tenant, key) => {
            if (!prevBucket.occupied.has(key)) {
              moveIns++;
              const [prop, unit] = key.split('||');
              moveInDetails.push({ tenant: tenant || 'Unknown', unit, property: prop, date: target, type: 'Move-in' });
            }
          });
          prevBucket.occupied.forEach((tenant, key) => {
            if (!bucket.occupied.has(key)) {
              moveOuts++;
              const [prop, unit] = key.split('||');
              moveOutDetails.push({ tenant: tenant || 'Unknown', unit, property: prop, date: target, type: 'Move-out' });
            }
          });
        }
        const d = new Date(target + 'T12:00:00');
        trailingNetChangeByWeek.push({
          weekStart: target,
          weekLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          moveIns,
          moveOuts,
          netChange: moveIns - moveOuts,
          moveInDetails,
          moveOutDetails,
          isTrailing: true
        });
        if (bucket) prevBucket = bucket;
      }
    }

    // Trailing summary (past 30 days)
    const trailingSummary = {
      moveIns: trailingNetChangeByWeek.reduce((sum, w) => sum + w.moveIns, 0),
      moveOuts: trailingNetChangeByWeek.reduce((sum, w) => sum + w.moveOuts, 0),
      netChange: trailingNetChangeByWeek.reduce((sum, w) => sum + w.netChange, 0),
      moveInDetails: trailingNetChangeByWeek.flatMap(w => w.moveInDetails),
      moveOutDetails: trailingNetChangeByWeek.flatMap(w => w.moveOutDetails)
    };

    // Summary stats — discrete buckets (0-30, 30-60, 60-90 days)
    const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysOut = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const ninetyDaysOutDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const moveIns0_30 = upcomingMoveIns.filter(e => new Date(e.event_date) <= thirtyDaysOut).length;
    const moveOuts0_30 = upcomingMoveOuts.filter(e => new Date(e.event_date) <= thirtyDaysOut).length;

    const moveIns30_60 = upcomingMoveIns.filter(e => {
      const d = new Date(e.event_date);
      return d > thirtyDaysOut && d <= sixtyDaysOut;
    }).length;
    const moveOuts30_60 = upcomingMoveOuts.filter(e => {
      const d = new Date(e.event_date);
      return d > thirtyDaysOut && d <= sixtyDaysOut;
    }).length;

    const moveIns60_90 = upcomingMoveIns.filter(e => {
      const d = new Date(e.event_date);
      return d > sixtyDaysOut && d <= ninetyDaysOutDate;
    }).length;
    const moveOuts60_90 = upcomingMoveOuts.filter(e => {
      const d = new Date(e.event_date);
      return d > sixtyDaysOut && d <= ninetyDaysOutDate;
    }).length;
    
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
        days0_30: {
          moveIns: moveIns0_30,
          moveOuts: moveOuts0_30,
          netChange: moveIns0_30 - moveOuts0_30
        },
        days30_60: {
          moveIns: moveIns30_60,
          moveOuts: moveOuts30_60,
          netChange: moveIns30_60 - moveOuts30_60
        },
        days60_90: {
          moveIns: moveIns60_90,
          moveOuts: moveOuts60_90,
          netChange: moveIns60_90 - moveOuts60_90
        }
      },
      trailingNetChangeByWeek,
      trailingProjections,
      trailingSummary,
      upcomingMoveIns: upcomingMoveIns.slice(0, 20),
      upcomingMoveOuts: upcomingMoveOuts.slice(0, 20)
    }, { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' } });

  } catch (error) {
    console.error('Error fetching projections:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
