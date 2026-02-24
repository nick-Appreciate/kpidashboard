import { supabase } from '../../../lib/supabase';
import { NextResponse } from 'next/server';

// GET - Fetch all active rehabs and vacancies that need rehab tracking
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeCompleted = searchParams.get('includeCompleted') === 'true';
    const property = searchParams.get('property');

    // Fetch existing rehabs
    let rehabQuery = supabase
      .from('rehabs')
      .select('*')
      .order('created_at', { ascending: false });

    if (!includeCompleted) {
      rehabQuery = rehabQuery.in('status', ['pending_setup', 'in_progress']);
    }

    if (property && property !== 'all' && property !== 'portfolio') {
      rehabQuery = rehabQuery.eq('property', property);
    }

    const { data: rehabs, error: rehabError } = await rehabQuery;

    if (rehabError) {
      console.error('Error fetching rehabs:', rehabError);
      return NextResponse.json({ error: rehabError.message }, { status: 500 });
    }

    // Fetch current vacancies and notices from rent_roll_snapshots
    const { data: latestSnapshotData, error: snapshotError } = await supabase
      .from('rent_roll_snapshots')
      .select('snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1);

    const latestSnapshotDate = latestSnapshotData?.[0]?.snapshot_date;

    let vacancies = [];
    if (latestSnapshotDate) {
      const { data: vacantUnits, error: vacantError } = await supabase
        .from('rent_roll_snapshots')
        .select('property, unit, status, lease_to, tenant_name')
        .eq('snapshot_date', latestSnapshotDate)
        .in('status', ['Vacant-Unrented', 'Vacant-Rented', 'Notice-Unrented', 'Notice-Rented', 'Evict']);

      if (vacantError) {
        console.error('Error fetching vacancies:', vacantError);
      }
      if (vacantUnits) {
        vacancies = vacantUnits;
      }
    }

    // For each vacancy, look up when the CURRENT vacancy cycle started
    // This is important to distinguish between different vacancy cycles for the same unit
    const vacanciesWithDates = await Promise.all(vacancies.map(async (v) => {
      const sourceType = v.status.startsWith('Vacant') ? 'vacancy' : 
                         v.status === 'Evict' ? 'eviction' : 'notice';
      
      // First, find the most recent date where this unit was OCCUPIED (not vacant/notice/evict)
      // This marks the end of any previous vacancy cycle
      const { data: lastOccupiedSnapshot } = await supabase
        .from('rent_roll_snapshots')
        .select('snapshot_date')
        .eq('property', v.property)
        .eq('unit', v.unit)
        .not('status', 'in', '("Vacant-Unrented","Vacant-Rented","Notice-Unrented","Notice-Rented","Evict")')
        .order('snapshot_date', { ascending: false })
        .limit(1);
      
      const lastOccupiedDate = lastOccupiedSnapshot?.[0]?.snapshot_date;
      
      // Now find the first vacant/notice/evict snapshot AFTER the last occupied date
      // This is the start of the CURRENT vacancy cycle
      let vacancyStartQuery = supabase
        .from('rent_roll_snapshots')
        .select('snapshot_date')
        .eq('property', v.property)
        .eq('unit', v.unit)
        .in('status', ['Vacant-Unrented', 'Vacant-Rented', 'Notice-Unrented', 'Notice-Rented', 'Evict'])
        .order('snapshot_date', { ascending: true })
        .limit(1);
      
      // If we found a last occupied date, only look for vacancies after that
      if (lastOccupiedDate) {
        vacancyStartQuery = vacancyStartQuery.gt('snapshot_date', lastOccupiedDate);
      }
      
      const { data: firstVacantSnapshot } = await vacancyStartQuery;
      
      // Use the first vacant snapshot after last occupied, or fall back to today
      const vacancyStartDate = firstVacantSnapshot?.[0]?.snapshot_date || latestSnapshotDate;
      
      return {
        ...v,
        move_out_date: v.lease_to,
        vacancy_start_date: vacancyStartDate,
        source_type: sourceType
      };
    }));

    // Build a map of active rehabs by property|unit|vacancy_start_date
    // This ensures each vacancy CYCLE gets its own rehab record
    const activeRehabKeys = new Set(
      rehabs
        .filter(r => r.status !== 'completed' && r.status !== 'archived')
        .map(r => `${r.property}|${r.unit}|${r.vacancy_start_date}`)
    );

    // Find vacancies that need a new rehab (no matching rehab for this vacancy cycle)
    const newVacancies = vacanciesWithDates.filter(v => 
      !activeRehabKeys.has(`${v.property}|${v.unit}|${v.vacancy_start_date}`)
    );

    // Archive any old rehabs for units that have a NEW vacancy cycle
    // (same property/unit but different vacancy_start_date)
    for (const vacancy of newVacancies) {
      const oldRehabs = rehabs.filter(r => 
        r.property === vacancy.property && 
        r.unit === vacancy.unit && 
        r.vacancy_start_date !== vacancy.vacancy_start_date &&
        r.status !== 'completed' && 
        r.status !== 'archived'
      );
      
      for (const oldRehab of oldRehabs) {
        // Archive the old rehab - it's from a previous vacancy cycle
        await supabase
          .from('rehabs')
          .update({ status: 'archived', updated_at: new Date().toISOString() })
          .eq('id', oldRehab.id);
        console.log(`Archived old rehab for ${oldRehab.property} ${oldRehab.unit} (vacancy_start: ${oldRehab.vacancy_start_date})`);
      }
    }

    // Auto-create rehab records for new vacancies with "Not Started" status
    const createdRehabs = [];
    for (const vacancy of newVacancies) {
      // Glen Oaks doesn't need rehab key by default
      const isGlenOaks = vacancy.property?.toLowerCase().includes('glen oaks');
      
      const { data: newRehab, error: createError } = await supabase
        .from('rehabs')
        .insert({
          property: vacancy.property,
          unit: vacancy.unit,
          status: 'in_progress',
          rehab_status: 'Not Started',
          source_type: vacancy.source_type,
          vacancy_start_date: vacancy.vacancy_start_date,
          move_out_date: vacancy.move_out_date,
          vendor_key_excluded: isGlenOaks
        })
        .select()
        .single();
      
      if (createError) {
        console.error('Error creating rehab for', vacancy.property, vacancy.unit, ':', createError.message);
      }
      if (newRehab) {
        createdRehabs.push(newRehab);
      }
    }
    
    console.log(`Created ${createdRehabs.length} new rehabs from ${vacanciesWithDates.length} vacancies`);

    // Combine existing rehabs with newly created ones
    const allRehabs = [...rehabs, ...createdRehabs];

    // Get total units count from latest rent roll snapshot
    let totalUnits = 0;
    if (latestSnapshotDate) {
      const { count, error: countError } = await supabase
        .from('rent_roll_snapshots')
        .select('*', { count: 'exact', head: true })
        .eq('snapshot_date', latestSnapshotDate);
      
      if (countError) {
        console.error('Error counting total units:', countError);
      }
      totalUnits = count || 0;
      
      // If filtering by specific property, get that property's count instead
      if (property && property !== 'all' && property !== 'portfolio') {
        const { count: propCount } = await supabase
          .from('rent_roll_snapshots')
          .select('*', { count: 'exact', head: true })
          .eq('snapshot_date', latestSnapshotDate)
          .eq('property', property);
        totalUnits = propCount || 0;
      }
    }

    return NextResponse.json({
      rehabs: allRehabs,
      newVacancies: [], // No longer needed - all vacancies are now rehabs
      totalActive: allRehabs.filter(r => r.status === 'in_progress').length,
      totalPendingSetup: allRehabs.filter(r => r.rehab_status === 'Not Started').length,
      totalUnits
    });

  } catch (error) {
    console.error('Error in rehabs GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Create a new rehab record (onboarding)
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      property,
      unit,
      contractor,
      goal_completion_date,
      pest_control_needed,
      surface_restoration_needed,
      junk_removal_needed,
      source_type,
      move_out_date,
      rehab_status
    } = body;

    if (!property || !unit) {
      return NextResponse.json({ error: 'Property and unit are required' }, { status: 400 });
    }

    // Check if there's already an active rehab for this unit
    const { data: existing } = await supabase
      .from('rehabs')
      .select('id')
      .eq('property', property)
      .eq('unit', unit)
      .in('status', ['pending_setup', 'in_progress'])
      .single();

    if (existing) {
      return NextResponse.json({ error: 'An active rehab already exists for this unit' }, { status: 400 });
    }

    // Get the vacancy start date (first date unit appeared as vacant)
    const { data: vacancyData } = await supabase
      .from('rent_roll_snapshots')
      .select('snapshot_date')
      .eq('property', property)
      .eq('unit', unit)
      .in('status', ['Vacant-Unrented', 'Vacant-Rented', 'Notice-Unrented', 'Notice-Rented', 'Evict'])
      .order('snapshot_date', { ascending: true })
      .limit(1);

    const vacancy_start_date = vacancyData?.[0]?.snapshot_date || null;

    const { data, error } = await supabase
      .from('rehabs')
      .insert({
        property,
        unit,
        contractor,
        goal_completion_date,
        pest_control_needed: pest_control_needed || false,
        surface_restoration_needed: surface_restoration_needed || false,
        junk_removal_needed: junk_removal_needed || false,
        source_type,
        move_out_date,
        vacancy_start_date,
        rehab_status: rehab_status || 'Supervisor onboard',
        status: 'in_progress'
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating rehab:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log initial status to history
    await supabase.from('rehab_status_history').insert({
      rehab_id: data.id,
      property: data.property,
      unit: data.unit,
      previous_status: null,
      new_status: data.rehab_status || 'Supervisor onboard',
      checklist_completed: 0,
      checklist_total: 4 + (pest_control_needed ? 1 : 0) + (surface_restoration_needed ? 1 : 0) + (junk_removal_needed ? 1 : 0)
    });

    return NextResponse.json(data);

  } catch (error) {
    console.error('Error in rehabs POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH - Update a rehab record (checklist items, status, etc.)
export async function PATCH(request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Rehab ID is required' }, { status: 400 });
    }

    // Fetch current rehab to check for status changes
    const { data: currentRehab } = await supabase
      .from('rehabs')
      .select('*')
      .eq('id', id)
      .single();

    // Add timestamp for completed checklist items
    const timestampedUpdates = { ...updates, updated_at: new Date().toISOString() };
    
    // If a checklist item is being completed, add its timestamp
    const checklistItems = [
      'vendor_key', 'utilities', 
      'pest_control', 'surface_restoration', 'junk_removal', 'cleaned', 'tenant_key', 'leasing_signoff'
    ];
    
    for (const item of checklistItems) {
      const completedKey = `${item}_completed`;
      const excludedKey = `${item}_excluded`;
      if (updates[completedKey] === true) {
        timestampedUpdates[`${item}_completed_at`] = new Date().toISOString();
      } else if (updates[completedKey] === false) {
        timestampedUpdates[`${item}_completed_at`] = null;
      }
    }

    // If status is being set to completed, add completed_at timestamp
    if (updates.status === 'completed') {
      timestampedUpdates.completed_at = new Date().toISOString();
    }

    // If rehab_status is being set to Complete and no completion_date provided, set it to today
    if (updates.rehab_status === 'Complete' && !updates.completion_date) {
      timestampedUpdates.completion_date = new Date().toISOString().split('T')[0];
    }

    const { data, error } = await supabase
      .from('rehabs')
      .update(timestampedUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating rehab:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log status change to history if rehab_status changed
    if (updates.rehab_status && currentRehab && updates.rehab_status !== currentRehab.rehab_status) {
      const checklistFields = [
        'vendor_key_completed', 'utilities_completed', 'pest_control_completed',
        'surface_restoration_completed', 'junk_removal_completed', 'cleaned_completed',
        'tenant_key_completed', 'leasing_signoff_completed'
      ];
      const completedCount = checklistFields.filter(f => data[f]).length;
      const totalCount = checklistFields.filter(f => {
        if (f === 'pest_control_completed' && !data.pest_control_needed) return false;
        if (f === 'surface_restoration_completed' && !data.surface_restoration_needed) return false;
        if (f === 'junk_removal_completed' && !data.junk_removal_needed) return false;
        return true;
      }).length;

      await supabase.from('rehab_status_history').insert({
        rehab_id: id,
        property: data.property,
        unit: data.unit,
        previous_status: currentRehab.rehab_status,
        new_status: updates.rehab_status,
        checklist_completed: completedCount,
        checklist_total: totalCount
      });
    }

    return NextResponse.json(data);

  } catch (error) {
    console.error('Error in rehabs PATCH:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Archive a rehab record
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Rehab ID is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('rehabs')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error archiving rehab:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);

  } catch (error) {
    console.error('Error in rehabs DELETE:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
