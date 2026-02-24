import { supabase } from '../../../lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Stage definitions
const STAGES = ['needs_contacted', 'contact_1', 'contact_2', 'eviction', 'paid'];

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
    
    // Query only the latest snapshot for current items
    let query = supabase
      .from('af_delinquency')
      .select('*')
      .gt('amount_receivable', 0)
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
      .select('occupancy_id, tenant_id');
    
    const tenantIdMap = {};
    (leaseData || []).forEach(l => {
      tenantIdMap[l.occupancy_id] = l.tenant_id;
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
      .select('property, unit, status')
      .eq('snapshot_date', rentRollDate)
      .eq('status', 'Evict');
    
    // Create eviction lookup by property+unit
    const evictionMap = {};
    (evictionData || []).forEach(e => {
      evictionMap[`${e.property}|${e.unit}`] = true;
    });
    
    // Get current date info for auto-eviction logic
    const now = new Date();
    const centralTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const dayOfMonth = centralTime.getDate();
    const isAfter15th = dayOfMonth >= 15;
    
    // Merge delinquency data with stages
    const items = (data || []).map(item => {
      const stageData = stagesMap[item.occupancy_id];
      let stage = stageData?.stage || 'needs_contacted';
      
      // Get tenant_id for AppFolio links
      const tenantId = tenantIdMap[item.occupancy_id] || null;
      
      // Check if unit is in eviction status in rent roll
      const evictionKey = `${item.property_name}|${item.unit}`;
      const afEviction = evictionMap[evictionKey] === true;
      
      // Auto-move to eviction if after 15th and balance > 1 month rent
      const balance = parseFloat(item.amount_receivable || 0);
      const monthlyRent = parseFloat(item.rent || 0);
      const shouldAutoEvict = isAfter15th && balance > monthlyRent && stage !== 'eviction' && stage !== 'paid';
      
      // Auto-move to paid if balance drops below threshold
      const shouldAutoPaid = balance <= 0;
      
      if (shouldAutoPaid && stage !== 'paid') {
        stage = 'paid';
      } else if (afEviction) {
        // AppFolio eviction status takes priority - lock to eviction
        stage = 'eviction';
      } else if (shouldAutoEvict) {
        stage = 'eviction';
      }
      
      return {
        ...item,
        stage,
        stage_data: stageData || null,
        tenant_id: tenantId,
        auto_eviction: shouldAutoEvict,
        af_eviction: afEviction,
        balance_over_rent: monthlyRent > 0 ? (balance / monthlyRent).toFixed(1) : 0
      };
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
        paid: items.filter(i => i.stage === 'paid').length
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
      } else if (stage === 'paid') {
        updateData.paid_at = new Date().toISOString();
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
