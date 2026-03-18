import { requireAuth } from '../../../lib/auth';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Stage definitions
const STAGES = ['needs_contacted', 'balance_letter', 'notice', 'reservation_of_rights', 'eviction', 'current'];

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
      .select('property_name, unit, occupancy_id, phone_numbers, email, tenant_id');
    
    const tenantLookup = {};
    (tenantDirectory || []).forEach(t => {
      const key = `${t.property_name}|${t.unit}`;
      if (!tenantLookup[key]) {
        tenantLookup[key] = t;
      }
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
    
    // Get current tenants (past_due <= 0) from rent_roll_snapshots
    // Exclude Evict and any Vacant status (Vacant-Unrented, Vacant-Rented, etc.)
    // Include Notice tenants - they should still appear in collections
    const { data: currentTenants } = await supabase
      .from('rent_roll_snapshots')
      .select('property, unit, status, tenant_name, total_rent, past_due')
      .eq('snapshot_date', rentRollDate)
      .lte('past_due', 0)
      .neq('status', 'Evict')
      .not('status', 'ilike', 'Vacant%');
    
    // Create eviction lookup by property+unit
    const evictionMap = {};
    (evictionData || []).forEach(e => {
      evictionMap[`${e.property}|${e.unit}`] = e;
    });
    
    // Create current tenants lookup by property+unit
    const currentMap = {};
    (currentTenants || []).forEach(c => {
      currentMap[`${c.property}|${c.unit}`] = c;
    });
    
    // Create a set of property+unit keys from delinquency data
    const delinquencyKeys = new Set();
    (data || []).forEach(item => {
      delinquencyKeys.add(`${item.property_name}|${item.unit}`);
    });
    
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
      } else if (stage === 'notice' && stageData?.notice_entered_at) {
        const daysInNotice = daysBetween(stageData.notice_entered_at);
        const requiredDays = stageData.notice_type === '3-day' ? 3 : 10;
        if (daysInNotice >= requiredDays) {
          stage = 'reservation_of_rights';
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
        balance_over_rent: monthlyRent > 0 ? (balance / monthlyRent).toFixed(1) : 0
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
    
    // Add current tenants from rent_roll_snapshots that aren't in delinquency data
    // These are tenants with past_due <= 0 who never appeared in delinquency report
    (currentTenants || []).forEach(current => {
      const key = `${current.property}|${current.unit}`;
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
        
        // This current tenant is not in delinquency - add it
        items.push({
          property_name: current.property,
          unit: current.unit,
          name: current.tenant_name,
          amount_receivable: parseFloat(current.past_due || 0),
          rent: parseFloat(current.total_rent || 0),
          stage: 'current',
          stage_data: null,
          tenant_id: tenantId,
          af_eviction: false,
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
    
    // Calculate summary stats
    const summary = {
      totalAccounts: items.length,
      totalReceivable: items.reduce((sum, item) => sum + parseFloat(item.amount_receivable || 0), 0),
      byStage: STAGES.reduce((acc, s) => {
        acc[s] = items.filter(i => i.stage === s).length;
        return acc;
      }, {})
    };
    
    // Get unique properties for filter
    const properties = [...new Set((data || []).map(item => item.property_name))].filter(Boolean).sort();
    
    return NextResponse.json({
      items,
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
    
    return NextResponse.json({
      delinquency: delinquency?.[0] || null,
      stage: stageData || null,
      glBreakdown,
      transactions
    });
  } catch (error) {
    console.error('Error fetching occupancy details:', error);
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
