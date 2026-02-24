import { supabase } from '../../../lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Stage definitions
const STAGES = ['needs_contacted', 'contact_1', 'contact_2', 'eviction', 'current'];

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const property = searchParams.get('property');
    const occupancyId = searchParams.get('occupancy_id');
    
    // If requesting specific occupancy details (for modal)
    if (occupancyId) {
      return await getOccupancyDetails(occupancyId);
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
      .select('*')
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
    
    // Merge delinquency data with stages
    const items = (data || []).map(item => {
      const stageData = stagesMap[item.occupancy_id];
      let stage = stageData?.stage || 'needs_contacted';
      
      // Get tenant_id for AppFolio links - check tenant directory first, then lease history
      const unitKey = `${item.property_name}|${item.unit}`;
      const tenantInfo = tenantLookup[unitKey];
      const tenantId = tenantInfo?.tenant_id || tenantIdMap[item.occupancy_id] || null;
      
      // Check if unit is in eviction status in rent roll
      const evictionKey = `${item.property_name}|${item.unit}`;
      const afEviction = !!evictionMap[evictionKey];
      
      const balance = parseFloat(item.amount_receivable || 0);
      const monthlyRent = parseFloat(item.rent || 0);
      
      // Auto-move to current if balance drops to zero or negative
      const shouldAutoCurrent = balance <= 0;
      
      // LOCKED STAGES: Eviction and Current are programmatically controlled
      // Priority: Eviction > Current > Manual stage
      // - Eviction: ONLY units with status='Evict' in rent_roll_snapshots (highest priority)
      // - Current: ONLY units with balance <= 0 (if not in eviction)
      if (afEviction) {
        // AppFolio eviction status takes highest priority
        stage = 'eviction';
      } else if (shouldAutoCurrent) {
        stage = 'current';
      } else if (stage === 'eviction' && !afEviction) {
        // If card was in eviction but no longer has eviction status, move back to needs_contacted
        stage = 'needs_contacted';
      }
      
      return {
        ...item,
        stage,
        stage_data: stageData || null,
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
      byStage: {
        needs_contacted: items.filter(i => i.stage === 'needs_contacted').length,
        contact_1: items.filter(i => i.stage === 'contact_1').length,
        contact_2: items.filter(i => i.stage === 'contact_2').length,
        eviction: items.filter(i => i.stage === 'eviction').length,
        current: items.filter(i => i.stage === 'current').length
      }
    };
    
    // Get unique properties for filter
    const properties = [...new Set((data || []).map(item => item.property_name))].filter(Boolean).sort();
    
    return NextResponse.json({
      items,
      summary,
      properties,
      stages: STAGES
    });
    
  } catch (error) {
    console.error('Error fetching collections:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Get detailed info for a specific occupancy (payment history, etc.)
async function getOccupancyDetails(occupancyId) {
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
    
    // Get tenant ledger (payment history) - match by tenant name
    const tenantName = delinquency?.[0]?.name;
    let ledger = [];
    if (tenantName) {
      const { data: ledgerData } = await supabase
        .from('af_tenant_ledger')
        .select('*')
        .ilike('payer', `%${tenantName.split(',')[0]}%`)
        .order('date', { ascending: false })
        .limit(20);
      ledger = ledgerData || [];
    }
    
    return NextResponse.json({
      delinquency: delinquency?.[0] || null,
      stage: stageData || null,
      ledger
    });
  } catch (error) {
    console.error('Error fetching occupancy details:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Update collection stage
export async function PATCH(request) {
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
      if (stage === 'contact_1') {
        updateData.contact_1_date = new Date().toISOString();
        if (notes) updateData.contact_1_notes = notes;
      } else if (stage === 'contact_2') {
        updateData.contact_2_date = new Date().toISOString();
        if (notes) updateData.contact_2_notes = notes;
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
