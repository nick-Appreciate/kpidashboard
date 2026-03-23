import { requireAuth } from '../../../lib/auth';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Stage definitions
const STAGES = ['needs_contacted', 'balance_letter', 'notice', 'reservation_of_rights', 'eviction', 'current', 'file_for_collections'];

// Region definitions for notice type determination
const REGION_PROPERTIES = {
  region_kansas_city: ['hilltop', 'oakwood', 'glen oaks', 'normandy', 'maple manor'],
};
const isKCProperty = (prop) =>
  REGION_PROPERTIES.region_kansas_city.some(kc => prop?.toLowerCase().includes(kc));

export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { searchParams } = new URL(request.url);
    const property = searchParams.get('property');
    const occupancyId = searchParams.get('occupancy_id');

    // If requesting specific occupancy details (for modal)
    if (occupancyId) {
      const propertyName = searchParams.get('property_name');
      const unit = searchParams.get('unit');
      return await getOccupancyDetails(supabase, occupancyId, propertyName, unit);
    }

    const statusFilter = searchParams.get('status_filter') || null; // 'current' or 'evict'

    // Chart data: 12-month trailing outstanding by same day-of-month
    if (searchParams.get('chart') === 'true') {
      return await getChartData(supabase, property, statusFilter);
    }

    // Daily chart: trailing 12 months day-by-day
    if (searchParams.get('daily_chart') === 'true') {
      return await getDailyChartData(supabase, property, statusFilter);
    }

    // Status counts chart: daily unit counts by status type
    if (searchParams.get('status_chart') === 'true') {
      return await getStatusChartData(supabase, property);
    }
    
    // Get the latest snapshot date first
    const { data: latestSnapshot } = await supabase
      .from('af_delinquency')
      .select('snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1);
    
    const latestDate = latestSnapshot?.[0]?.snapshot_date;
    
    // Query only the latest snapshot for all items (including current/paid)
    let query = supabase
      .from('af_delinquency')
      .select('occupancy_id, property_name, unit, name, amount_receivable, rent, phone_numbers, primary_tenant_email, days_0_to_30, days_30_to_60, days_60_to_90, days_90_plus, snapshot_date')
      .order('amount_receivable', { ascending: false });
    
    if (latestDate) {
      query = query.eq('snapshot_date', latestDate);
    }
    
    if (property && property !== 'all') {
      query = query.eq('property_name', property);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Get all collection stages
    const { data: stages, error: stagesError } = await supabase
      .from('collection_stages')
      .select('*');
    
    if (stagesError) {
      console.error('Stages error:', stagesError);
    }
    
    const stagesMap = {};
    (stages || []).forEach(s => {
      stagesMap[s.occupancy_id] = s;
    });
    
    // Get tenant_id from af_lease_history for AppFolio links
    const { data: leaseData } = await supabase
      .from('af_lease_history')
      .select('occupancy_id, tenant_id, property_name, unit_name');
    
    const tenantIdMap = {};
    const leaseByUnit = {};
    (leaseData || []).forEach(l => {
      tenantIdMap[l.occupancy_id] = l.tenant_id;
      // Also create lookup by property+unit for rent_roll cards
      const key = `${l.property_name}|${l.unit_name}`;
      if (!leaseByUnit[key]) {
        leaseByUnit[key] = l;
      }
    });
    
    // Get tenant directory for phone numbers and contact info (primary source)
    const { data: tenantDirectory } = await supabase
      .from('af_tenant_directory')
      .select('property_name, unit, occupancy_id, phone_numbers, email, tenant_id, tenant_name');

    const tenantLookup = {};
    const tenantsByUnit = {}; // All tenant rows per unit for phone picker
    (tenantDirectory || []).forEach(t => {
      const key = `${t.property_name}|${t.unit}`;
      if (!tenantLookup[key]) {
        tenantLookup[key] = t;
      }
      if (!tenantsByUnit[key]) {
        tenantsByUnit[key] = [];
      }
      tenantsByUnit[key].push(t);
    });
    
    // Fallback: Get delinquency records for any missing contact info
    const { data: allDelinquency } = await supabase
      .from('af_delinquency')
      .select('property_name, unit, occupancy_id, phone_numbers, primary_tenant_email')
      .not('phone_numbers', 'is', null)
      .order('snapshot_date', { ascending: false });
    
    const delinquencyLookup = {};
    (allDelinquency || []).forEach(d => {
      const key = `${d.property_name}|${d.unit}`;
      // Keep the most recent record with phone data for each unit
      if (!delinquencyLookup[key]) {
        delinquencyLookup[key] = d;
      }
    });
    
    // Get eviction status from rent_roll_snapshots
    const { data: rentRollSnapshot } = await supabase
      .from('rent_roll_snapshots')
      .select('snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1);
    
    const rentRollDate = rentRollSnapshot?.[0]?.snapshot_date;
    
    const { data: evictionData } = await supabase
      .from('rent_roll_snapshots')
      .select('property, unit, status, tenant_name, total_rent, past_due')
      .eq('snapshot_date', rentRollDate)
      .eq('status', 'Evict');

    // Get moved-out tenants with outstanding balances (Notice-Unrented, etc.)
    // These are tenants who vacated but still owe money — "File for Collections" candidates
    const { data: movedOutData } = await supabase
      .from('rent_roll_snapshots')
      .select('property, unit, status, tenant_name, total_rent, past_due')
      .eq('snapshot_date', rentRollDate)
      .gt('past_due', 0)
      .neq('status', 'Evict')
      .neq('status', 'Current')
      .not('status', 'ilike', 'Vacant%');

    // Note: We no longer load all current tenants. The "Paid" column only shows
    // tenants who were previously delinquent and have paid down (balance <= 0 with a collection_stages record).
    
    // Create eviction lookup by property+unit
    const evictionMap = {};
    (evictionData || []).forEach(e => {
      evictionMap[`${e.property}|${e.unit}`] = e;
    });
    
    // Create a set of property+unit keys from delinquency data
    const delinquencyKeys = new Set();
    (data || []).forEach(item => {
      delinquencyKeys.add(`${item.property_name}|${item.unit}`);
    });
    
    // Helper: parse phone numbers from comma-separated string into array of individual numbers
    const parsePhoneNumbers = (phoneStr) => {
      if (!phoneStr) return [];
      // Split on comma, then extract the actual phone number from each part
      return phoneStr.split(',')
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => {
          // Extract number from formats like "Phone: (913) 449-2112" or "Mobile: (407) 874-4005"
          const match = p.match(/[\d().\-\s+]+/);
          return match ? match[0].trim() : p;
        })
        .filter(p => p.length >= 7); // Filter out non-phone strings
    };

    // Helper: build tenant_phones array for a unit
    const buildTenantPhones = (unitKey, itemName) => {
      const tenants = tenantsByUnit[unitKey] || [];
      const phones = [];
      const seen = new Set();
      tenants.forEach(t => {
        const numbers = parsePhoneNumbers(t.phone_numbers);
        const name = t.tenant_name || itemName || 'Unknown';
        numbers.forEach(num => {
          const cleaned = num.replace(/[^\d]/g, '');
          if (!seen.has(cleaned) && cleaned.length >= 7) {
            seen.add(cleaned);
            phones.push({ name, phone: num });
          }
        });
      });
      // If no tenant directory data, fall back to delinquency phone_numbers
      if (phones.length === 0) {
        const delinquencyInfo = delinquencyLookup[unitKey];
        const fallbackPhones = delinquencyInfo?.phone_numbers;
        if (fallbackPhones) {
          const numbers = parsePhoneNumbers(fallbackPhones);
          numbers.forEach(num => {
            const cleaned = num.replace(/[^\d]/g, '');
            if (!seen.has(cleaned) && cleaned.length >= 7) {
              seen.add(cleaned);
              phones.push({ name: itemName || 'Unknown', phone: num });
            }
          });
        }
      }
      return phones;
    };

    // Stage computation helpers (read-only — writes happen via POST /api/admin/collections/auto-stage)
    const now = new Date();
    const todayDate = now.getDate();

    const daysBetween = (dateStr) => {
      if (!dateStr) return 0;
      const diff = now - new Date(dateStr);
      return Math.floor(diff / (1000 * 60 * 60 * 24));
    };

    // Merge delinquency data with stages (compute display stage without writing)
    const items = (data || []).map(item => {
      const stageData = stagesMap[item.occupancy_id];
      let stage = stageData?.stage || 'needs_contacted';

      // Migrate old stages that no longer exist
      if (stage === 'contact_1' || stage === 'contact_2' || stage === 'promise_to_pay') {
        stage = 'needs_contacted';
      }

      // Get tenant_id for AppFolio links - check tenant directory first, then lease history
      const unitKey = `${item.property_name}|${item.unit}`;
      const tenantInfo = tenantLookup[unitKey];
      const tenantId = tenantInfo?.tenant_id || tenantIdMap[item.occupancy_id] || null;

      // Check if unit is in eviction status in rent roll
      const afEviction = !!evictionMap[unitKey];

      const balance = parseFloat(item.amount_receivable || 0);
      const monthlyRent = parseFloat(item.rent || 0);

      // Compute display stage based on current data
      if (afEviction) {
        stage = 'eviction';
      } else if (balance <= 0) {
        stage = 'current';
      } else if (stage === 'eviction' && !afEviction) {
        stage = 'needs_contacted';
      } else if (stage === 'reservation_of_rights' && monthlyRent > 0 && balance > 0 && balance < monthlyRent) {
        // Tenant paid enough to drop below 1x rent — move to Paid
        stage = 'current';
      } else if (stage === 'notice' && stageData?.notice_entered_at) {
        if (monthlyRent > 0 && balance > 0 && balance < monthlyRent) {
          // Balance dropped below rent while in notice — move to Paid
          stage = 'current';
        } else {
          const daysInNotice = daysBetween(stageData.notice_entered_at);
          const requiredDays = stageData.notice_type === '3-day' ? 3 : 10;
          if (daysInNotice >= requiredDays) {
            stage = 'reservation_of_rights';
          }
        }
      } else if (stage === 'needs_contacted' && monthlyRent > 0 && balance > 0) {
        if (balance > monthlyRent) {
          stage = 'notice';
        } else if (todayDate >= 9) {
          stage = 'balance_letter';
        }
      }

      // Enrich stage_data with notice_type for frontend display
      const enrichedStageData = stageData ? { ...stageData } : null;
      if (stage === 'notice' && !enrichedStageData?.notice_type) {
        const noticeType = isKCProperty(item.property_name) ? '3-day' : '10-day';
        if (enrichedStageData) {
          enrichedStageData.notice_type = noticeType;
        }
      }

      return {
        ...item,
        stage,
        stage_data: enrichedStageData,
        tenant_id: tenantId,
        af_eviction: afEviction,
        balance_over_rent: monthlyRent > 0 ? (balance / monthlyRent).toFixed(1) : 0,
        tenant_phones: buildTenantPhones(unitKey, item.name)
      };
    });
    
    // Add eviction units that aren't in delinquency data
    // These are units with status='Evict' in rent_roll but not in af_delinquency
    (evictionData || []).forEach(evict => {
      const key = `${evict.property}|${evict.unit}`;
      if (!delinquencyKeys.has(key)) {
        // Primary: tenant directory for contact info
        const tenantInfo = tenantLookup[key];
        // Fallback: delinquency lookup
        const delinquencyInfo = delinquencyLookup[key];
        // Also try lease history for occupancy_id and tenant_id
        const leaseInfo = leaseByUnit[key];
        const occupancyId = tenantInfo?.occupancy_id || delinquencyInfo?.occupancy_id || leaseInfo?.occupancy_id || null;
        const tenantId = tenantInfo?.tenant_id || leaseInfo?.tenant_id || (occupancyId ? tenantIdMap[occupancyId] : null);
        const phoneNumbers = tenantInfo?.phone_numbers || delinquencyInfo?.phone_numbers || null;
        
        // This eviction unit is not in delinquency - add it
        items.push({
          property_name: evict.property,
          unit: evict.unit,
          name: evict.tenant_name,
          amount_receivable: parseFloat(evict.past_due || 0),
          rent: parseFloat(evict.total_rent || 0),
          stage: 'eviction',
          stage_data: null,
          tenant_id: tenantId,
          af_eviction: true,
          balance_over_rent: 0,
          occupancy_id: occupancyId,
          phone_numbers: phoneNumbers,
          days_0_to_30: 0,
          days_30_to_60: 0,
          days_60_to_90: 0,
          days_90_plus: 0
        });
      }
    });

    // Add moved-out tenants with outstanding balances as "File for Collections"
    (movedOutData || []).forEach(movedOut => {
      const key = `${movedOut.property}|${movedOut.unit}`;
      if (!delinquencyKeys.has(key)) {
        const tenantInfo = tenantLookup[key];
        const delinquencyInfo = delinquencyLookup[key];
        const leaseInfo = leaseByUnit[key];
        const occupancyId = tenantInfo?.occupancy_id || delinquencyInfo?.occupancy_id || leaseInfo?.occupancy_id || null;
        const tenantId = tenantInfo?.tenant_id || leaseInfo?.tenant_id || (occupancyId ? tenantIdMap[occupancyId] : null);
        const phoneNumbers = tenantInfo?.phone_numbers || delinquencyInfo?.phone_numbers || null;

        items.push({
          property_name: movedOut.property,
          unit: movedOut.unit,
          name: movedOut.tenant_name,
          amount_receivable: parseFloat(movedOut.past_due || 0),
          rent: parseFloat(movedOut.total_rent || 0),
          stage: 'file_for_collections',
          stage_data: null,
          tenant_id: tenantId,
          af_eviction: false,
          balance_over_rent: 0,
          occupancy_id: occupancyId,
          phone_numbers: phoneNumbers,
          tenant_phones: buildTenantPhones(key, movedOut.tenant_name),
          days_0_to_30: 0,
          days_30_to_60: 0,
          days_60_to_90: 0,
          days_90_plus: parseFloat(movedOut.past_due || 0) // Assume all is 90+ for moved-out
        });
      }
    });

    // Only keep "current" (Paid) items that have a collection_stages record
    // (i.e., they were previously delinquent). Remove items with balance <= 0
    // that have no collection_stages record.
    const finalItems = items.filter(item => {
      if (item.stage === 'current') {
        return !!stagesMap[item.occupancy_id];
      }
      return true;
    });

    // Calculate summary stats
    const summary = {
      totalAccounts: finalItems.length,
      totalReceivable: finalItems.reduce((sum, item) => sum + parseFloat(item.amount_receivable || 0), 0),
      byStage: STAGES.reduce((acc, s) => {
        acc[s] = finalItems.filter(i => i.stage === s).length;
        return acc;
      }, {})
    };

    // Get unique properties for filter
    const properties = [...new Set((data || []).map(item => item.property_name))].filter(Boolean).sort();

    return NextResponse.json({
      items: finalItems,
      summary,
      properties,
      stages: STAGES
    }, { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } });

  } catch (error) {
    console.error('Error fetching collections:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Get detailed info for a specific occupancy (payment history, etc.)
async function getOccupancyDetails(supabase, occupancyId, propertyName, unit) {
  try {
    // Get delinquency info
    const { data: delinquency } = await supabase
      .from('af_delinquency')
      .select('*')
      .eq('occupancy_id', occupancyId)
      .order('snapshot_date', { ascending: false })
      .limit(1);
    
    // Get stage info
    const { data: stageData } = await supabase
      .from('collection_stages')
      .select('*')
      .eq('occupancy_id', occupancyId)
      .single();
    
    // Get outstanding balance by GL account from charge_detail
    let glBreakdown = [];
    if (propertyName && unit) {
      const { data: chargeData } = await supabase
        .from('af_charge_detail')
        .select('account_name, account_number, charge_amount, paid_amount')
        .eq('property_name', propertyName)
        .eq('unit', unit);
      
      // Aggregate by GL account
      const glMap = {};
      (chargeData || []).forEach(charge => {
        const key = charge.account_name || 'Unknown';
        if (!glMap[key]) {
          glMap[key] = { 
            account_name: charge.account_name, 
            account_number: charge.account_number,
            total_charges: 0, 
            total_paid: 0 
          };
        }
        glMap[key].total_charges += parseFloat(charge.charge_amount || 0);
        glMap[key].total_paid += parseFloat(charge.paid_amount || 0);
      });
      
      // Convert to array and calculate outstanding
      glBreakdown = Object.values(glMap)
        .map(gl => ({
          ...gl,
          outstanding: gl.total_charges - gl.total_paid
        }))
        .filter(gl => Math.abs(gl.outstanding) > 0.01)
        .sort((a, b) => b.outstanding - a.outstanding);
    }
    
    // Get transactions from last 3 months - separate rows for charges and payments
    let transactions = [];
    if (propertyName && unit) {
      // Calculate 3 months ago
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const threeMonthsAgoStr = threeMonthsAgo.toISOString().split('T')[0];
      
      const { data: chargeData } = await supabase
        .from('af_charge_detail')
        .select('charge_date, receipt_date, charge_description, account_name, charge_amount, paid_amount, received_from')
        .eq('property_name', propertyName)
        .eq('unit', unit)
        .gte('charge_date', threeMonthsAgoStr)
        .order('charge_date', { ascending: false });
      
      // Create separate rows for charges and payments
      (chargeData || []).forEach(row => {
        const chargeAmt = parseFloat(row.charge_amount || 0);
        const paidAmt = parseFloat(row.paid_amount || 0);
        
        // Add charge row if there's a charge
        if (chargeAmt > 0) {
          transactions.push({
            date: row.charge_date,
            description: row.charge_description,
            payer: null,
            type: 'charge',
            amount: chargeAmt
          });
        }
        
        // Add payment row if there's a payment
        if (paidAmt > 0) {
          transactions.push({
            date: row.receipt_date || row.charge_date,
            description: row.charge_description,
            payer: row.received_from,
            type: 'payment',
            amount: paidAmt
          });
        }
      });
      
      // Sort by date descending
      transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    
    // Get archived collection note history
    const { data: noteHistory } = await supabase
      .from('collection_note_history')
      .select('*')
      .eq('occupancy_id', occupancyId)
      .order('archived_at', { ascending: true });

    return NextResponse.json({
      delinquency: delinquency?.[0] || null,
      stage: stageData || null,
      glBreakdown,
      transactions,
      noteHistory: noteHistory || []
    });
  } catch (error) {
    console.error('Error fetching occupancy details:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Get 12-month trailing chart data
async function getChartData(supabase, property, statusFilter = null) {
  try {
    const now = new Date();
    const todayDay = now.getDate();

    // Get ALL available daily summaries via database function (avoids row limits)
    const earliestDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const startDate = earliestDate.toISOString().split('T')[0];

    const propFilter = (property && property !== 'all') ? property : null;
    const { data: allSummaries, error } = await supabase.rpc('get_rent_roll_daily_summary_030', {
      start_date: startDate,
      property_filter: propFilter,
      status_filter: statusFilter
    });

    if (error) {
      console.error('Chart RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const summaryMap = {};
    (allSummaries || []).forEach(s => {
      summaryMap[s.snapshot_date] = s;
    });
    const allDates = Object.keys(summaryMap).sort();

    // For each of the last 12 months, find the closest snapshot to the same day-of-month
    const results = [];
    for (let i = 0; i < 12; i++) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() - i, todayDay);
      const targetStr = targetDate.toISOString().split('T')[0];

      let bestDate = null;
      let bestDiff = Infinity;
      for (const d of allDates) {
        const diff = Math.abs(new Date(d) - targetDate);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestDate = d;
        }
      }

      // Only use if within 10 days of target (wider window for sparse months)
      if (bestDate && bestDiff <= 10 * 24 * 60 * 60 * 1000) {
        const s = summaryMap[bestDate];
        const totalOutstanding = parseFloat(s.total_outstanding || 0);
        const monthlyOutstanding = parseFloat(s.monthly_outstanding || 0);
        const totalRent = parseFloat(s.total_rent || 0);
        const pctOfCharges = totalRent > 0 ? (totalOutstanding / totalRent) * 100 : 0;
        const monthlyPct = totalRent > 0 ? (monthlyOutstanding / totalRent) * 100 : 0;

        results.push({
          date: bestDate,
          label: new Date(bestDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          totalOutstanding: Math.round(totalOutstanding),
          monthlyOutstanding: Math.round(monthlyOutstanding),
          totalCharges: Math.round(totalRent),
          pctOfCharges: Math.round(pctOfCharges * 10) / 10,
          monthlyPct: Math.round(monthlyPct * 10) / 10,
          accountCount: parseInt(s.account_count || 0)
        });
      }
    }

    // Reverse so oldest is first (left side of chart)
    results.reverse();

    return NextResponse.json({ chartData: results }, {
      headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=600' }
    });
  } catch (error) {
    console.error('Error fetching chart data:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Get trailing 3 months daily chart data
async function getDailyChartData(supabase, property, statusFilter = null) {
  try {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const months = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      months.push({ offset: i, monthStr, label });
    }

    const twelveMonthsAgo = new Date(currentYear, currentMonth - 11, 1);
    const startDate = twelveMonthsAgo.toISOString().split('T')[0];

    // Use 0-30 function which returns both total and monthly outstanding
    const propFilter = (property && property !== 'all') ? property : null;
    const { data, error } = await supabase.rpc('get_rent_roll_daily_summary_030', {
      start_date: startDate,
      property_filter: propFilter,
      status_filter: statusFilter
    });

    if (error) {
      console.error('Daily chart RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Build series per month, keyed by day-of-month
    // Include both total outstanding and monthly-only (0-30) outstanding
    const series = months.map(m => {
      const points = [];
      (data || []).forEach(row => {
        if (row.snapshot_date.startsWith(m.monthStr)) {
          const day = parseInt(row.snapshot_date.split('-')[2]);
          const outstanding = parseFloat(row.total_outstanding || 0);
          const monthlyOutstanding = parseFloat(row.monthly_outstanding || 0);
          const totalRent = parseFloat(row.total_rent || 0);
          const pct = totalRent > 0 ? (outstanding / totalRent) * 100 : 0;
          const monthlyPct = totalRent > 0 ? (monthlyOutstanding / totalRent) * 100 : 0;
          points.push({
            day,
            outstanding: Math.round(outstanding),
            monthlyOutstanding: Math.round(monthlyOutstanding),
            pctOfCharges: Math.round(pct * 10) / 10,
            monthlyPct: Math.round(monthlyPct * 10) / 10
          });
        }
      });
      points.sort((a, b) => a.day - b.day);
      return { ...m, points };
    });

    return NextResponse.json({
      dailyChart: series,
      todayDay: now.getDate()
    }, {
      headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=600' }
    });
  } catch (error) {
    console.error('Error fetching daily chart data:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Get daily status counts (unit counts by status type, trailing 12 months)
async function getStatusChartData(supabase, property) {
  try {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const startDate = twelveMonthsAgo.toISOString().split('T')[0];

    const propFilter = (property && property !== 'all') ? property : null;
    const { data, error } = await supabase.rpc('get_rent_roll_status_counts', {
      start_date: startDate,
      property_filter: propFilter
    });

    if (error) {
      console.error('Status chart RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Build month metadata
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const months = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      months.push({ offset: i, monthStr, label });
    }

    // Collect all statuses
    const allStatuses = [...new Set((data || []).map(r => r.status))].sort();

    // Build series per month with daily points, each point has count per status
    const series = months.map(m => {
      const dayMap = {};
      (data || []).forEach(row => {
        if (row.snapshot_date.startsWith(m.monthStr)) {
          const day = parseInt(row.snapshot_date.split('-')[2]);
          if (!dayMap[day]) dayMap[day] = {};
          dayMap[day][row.status] = parseInt(row.unit_count);
        }
      });
      const points = Object.entries(dayMap)
        .map(([day, counts]) => ({ day: parseInt(day), ...counts }))
        .sort((a, b) => a.day - b.day);
      return { ...m, points };
    });

    return NextResponse.json({
      statusChart: series.filter(m => m.points.length > 0),
      statuses: allStatuses,
      todayDay: now.getDate()
    }, {
      headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=600' }
    });
  } catch (error) {
    console.error('Error fetching status chart data:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Update collection stage
export async function PATCH(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const body = await request.json();
    const { occupancy_id, stage, notes, ...otherFields } = body;
    
    if (!occupancy_id) {
      return NextResponse.json({ error: 'occupancy_id required' }, { status: 400 });
    }
    
    // Get current delinquency info for tenant details
    const { data: delinquency } = await supabase
      .from('af_delinquency')
      .select('property_name, unit, name')
      .eq('occupancy_id', occupancy_id)
      .order('snapshot_date', { ascending: false })
      .limit(1);
    
    const tenantInfo = delinquency?.[0] || {};
    
    // Build update object
    const updateData = {
      occupancy_id,
      property_name: tenantInfo.property_name || '',
      unit: tenantInfo.unit || '',
      tenant_name: tenantInfo.name || '',
      ...otherFields
    };
    
    if (stage) {
      updateData.stage = stage;
      updateData.stage_updated_at = new Date().toISOString();
      
      // Set stage-specific timestamps
      if (stage === 'balance_letter') {
        updateData.balance_letter_entered_at = new Date().toISOString();
        if (notes) updateData.balance_letter_notes = notes;
      } else if (stage === 'notice') {
        updateData.notice_entered_at = new Date().toISOString();
        updateData.notice_type = isKCProperty(tenantInfo.property_name) ? '3-day' : '10-day';
        if (notes) updateData.notice_notes = notes;
      } else if (stage === 'reservation_of_rights') {
        updateData.reservation_of_rights_entered_at = new Date().toISOString();
        if (notes) updateData.reservation_of_rights_notes = notes;
      } else if (stage === 'eviction') {
        updateData.eviction_started_at = new Date().toISOString();
        if (notes) updateData.eviction_notes = notes;
      } else if (stage === 'current') {
        updateData.current_at = new Date().toISOString();
      }
    }
    
    // Upsert the stage record
    const { data, error } = await supabase
      .from('collection_stages')
      .upsert(updateData, { onConflict: 'occupancy_id' })
      .select()
      .single();
    
    if (error) {
      console.error('Error updating stage:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in PATCH:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
