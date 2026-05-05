import { requireAuth } from '../../../lib/auth';
import { NextResponse } from 'next/server';

// GET - Fetch all active rehabs and vacancies that need rehab tracking
export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { searchParams } = new URL(request.url);
    const includeCompleted = searchParams.get('includeCompleted') === 'true';
    const property = searchParams.get('property');
    const region = searchParams.get('region');

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
    if (region === 'farquhar') {
      rehabQuery = rehabQuery.neq('property', 'Glen Oaks');
      // Hilltop sold to another group on 2026-04-22 — exclude it from
      // Farquhar after that date. (We still manage Hilltop, so it stays
      // in Portfolio / individual filters elsewhere.)
      if (new Date() >= new Date('2026-04-22T00:00:00')) {
        rehabQuery = rehabQuery.neq('property', 'Hilltop Townhomes');
      }
    }

    const { data: rehabsData, error: rehabError } = await rehabQuery;

    if (rehabError) {
      console.error('Error fetching rehabs:', rehabError);
      return NextResponse.json({ error: rehabError.message }, { status: 500 });
    }

    let rehabs = rehabsData || [];

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

    // Build a map of currently vacant/notice/evict units from AppFolio
    const currentVacancyMap = new Map();
    for (const v of vacanciesWithDates) {
      currentVacancyMap.set(`${v.property}|${v.unit}`, v);
    }

    // Archive rehabs for units that are no longer vacant/notice/evict in AppFolio
    // This handles: (1) units that got leased, (2) evictions where tenant paid
    // Note: if an eviction unit transitions to notice, it stays in the vacancy list
    const rehabsToArchive = rehabs.filter(r =>
      r.status !== 'completed' &&
      r.status !== 'archived' &&
      !currentVacancyMap.has(`${r.property}|${r.unit}`)
    );

    for (const rehab of rehabsToArchive) {
      await supabase
        .from('rehabs')
        .update({ status: 'archived', updated_at: new Date().toISOString() })
        .eq('id', rehab.id);
      console.log(`Archived rehab for ${rehab.property} ${rehab.unit} - unit no longer vacant/notice/evict`);
    }

    // Remove archived rehabs from local array
    if (rehabsToArchive.length > 0) {
      const archivedIds = new Set(rehabsToArchive.map(r => r.id));
      rehabs = rehabs.filter(r => !archivedIds.has(r.id));
    }

    // Update source_type if vacancy status changed (e.g., eviction → notice)
    for (const rehab of rehabs.filter(r => r.status !== 'completed' && r.status !== 'archived')) {
      const currentVacancy = currentVacancyMap.get(`${rehab.property}|${rehab.unit}`);
      if (currentVacancy && currentVacancy.source_type !== rehab.source_type) {
        const updateFields = {
          source_type: currentVacancy.source_type,
          updated_at: new Date().toISOString()
        };

        // When transitioning from eviction to vacancy, reset vacancy_start_date
        // so the day counter starts from when the unit actually became vacant
        if (rehab.source_type === 'eviction' && currentVacancy.source_type === 'vacancy') {
          // Find the first Vacant snapshot after the last Evict snapshot
          const { data: lastEvictSnapshot } = await supabase
            .from('rent_roll_snapshots')
            .select('snapshot_date')
            .eq('property', rehab.property)
            .eq('unit', rehab.unit)
            .eq('status', 'Evict')
            .order('snapshot_date', { ascending: false })
            .limit(1);

          if (lastEvictSnapshot?.length > 0) {
            const { data: firstVacantSnapshot } = await supabase
              .from('rent_roll_snapshots')
              .select('snapshot_date')
              .eq('property', rehab.property)
              .eq('unit', rehab.unit)
              .in('status', ['Vacant-Unrented', 'Vacant-Rented'])
              .gt('snapshot_date', lastEvictSnapshot[0].snapshot_date)
              .order('snapshot_date', { ascending: true })
              .limit(1);

            if (firstVacantSnapshot?.length > 0) {
              updateFields.vacancy_start_date = firstVacantSnapshot[0].snapshot_date;
            } else {
              // No Vacant snapshot found yet, use today's date
              updateFields.vacancy_start_date = latestSnapshotDate;
            }
          } else {
            // No evict snapshot found, use today's date
            updateFields.vacancy_start_date = latestSnapshotDate;
          }

          if (updateFields.vacancy_start_date) {
            rehab.vacancy_start_date = updateFields.vacancy_start_date;
            // Also update the vacancy entry so key matching stays consistent
            currentVacancy.vacancy_start_date = updateFields.vacancy_start_date;
            console.log(`Reset vacancy_start_date for ${rehab.property} ${rehab.unit} → ${updateFields.vacancy_start_date} (eviction → vacancy)`);
          }
        }

        await supabase
          .from('rehabs')
          .update(updateFields)
          .eq('id', rehab.id);
        rehab.source_type = currentVacancy.source_type;
        console.log(`Updated source_type for ${rehab.property} ${rehab.unit} → ${currentVacancy.source_type}`);
      }

      // Sync "Rented" status: auto-set when AppFolio shows Vacant-Rented, unlock when it doesn't
      const isVacantRented = currentVacancy && currentVacancy.status === 'Vacant-Rented';
      if (isVacantRented && rehab.rehab_status !== 'Rented') {
        await supabase
          .from('rehabs')
          .update({ rehab_status: 'Rented', updated_at: new Date().toISOString() })
          .eq('id', rehab.id);
        rehab.rehab_status = 'Rented';
        console.log(`Set rehab_status to Rented for ${rehab.property} ${rehab.unit} (Vacant-Rented in AppFolio)`);
      } else if (!isVacantRented && rehab.rehab_status === 'Rented') {
        // Unit is no longer Vacant-Rented, unlock status back to Not Started
        await supabase
          .from('rehabs')
          .update({ rehab_status: 'Not Started', updated_at: new Date().toISOString() })
          .eq('id', rehab.id);
        rehab.rehab_status = 'Not Started';
        console.log(`Unlocked rehab_status for ${rehab.property} ${rehab.unit} (no longer Vacant-Rented)`);
      }
    }

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
    // Units with "Vacant-Rented" AppFolio status get locked "Rented" rehab status
    const createdRehabs = [];
    for (const vacancy of newVacancies) {
      const isVacantRented = vacancy.status === 'Vacant-Rented';
      const { data: newRehab, error: createError } = await supabase
        .from('rehabs')
        .insert({
          property: vacancy.property,
          unit: vacancy.unit,
          status: 'in_progress',
          rehab_status: isVacantRented ? 'Rented' : 'Not Started',
          source_type: vacancy.source_type,
          vacancy_start_date: vacancy.vacancy_start_date,
          move_out_date: vacancy.move_out_date,
          // Recurring items (rehab key, utilities, clean, final walkthrough, tenant key)
          // default to "needs done" (not excluded)
          // Non-recurring items default to "ignored" (excluded)
          junk_removal_excluded: true,
          pest_control_excluded: true,
          surface_restoration_excluded: true,
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
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const body = await request.json();
    const {
      property,
      unit,
      contractor,
      goal_completion_date,
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
        source_type,
        move_out_date,
        vacancy_start_date,
        rehab_status: rehab_status || 'Supervisor onboard',
        status: 'in_progress',
        // Non-recurring items default to "ignored" (excluded)
        junk_removal_excluded: true,
        pest_control_excluded: true,
        surface_restoration_excluded: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating rehab:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log initial status to history
    // Count non-excluded items as the total
    const excludedFields = [
      'vendor_key_excluded', 'utilities_excluded', 'pest_control_excluded',
      'surface_restoration_excluded', 'junk_removal_excluded', 'cleaned_excluded',
      'tenant_key_excluded', 'leasing_signoff_excluded', 'mail_key_excluded'
    ];
    const initialTotal = excludedFields.filter(f => !data[f]).length;

    await supabase.from('rehab_status_history').insert({
      rehab_id: data.id,
      property: data.property,
      unit: data.unit,
      previous_status: null,
      new_status: data.rehab_status || 'Supervisor onboard',
      checklist_completed: 0,
      checklist_total: initialTotal
    });

    return NextResponse.json(data);

  } catch (error) {
    console.error('Error in rehabs POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH - Update a rehab record (checklist items, status, etc.)
export async function PATCH(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

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

    // Prevent users from changing off "Rented" status — this is auto-managed by AppFolio sync
    if (currentRehab?.rehab_status === 'Rented' && updates.rehab_status && updates.rehab_status !== 'Rented') {
      return NextResponse.json({ error: 'Cannot change status from Rented — this is automatically set by AppFolio' }, { status: 400 });
    }

    // Add timestamp for completed checklist items
    const timestampedUpdates = { ...updates, updated_at: new Date().toISOString() };
    
    // If a checklist item is being completed, add its timestamp
    const checklistItems = [
      'vendor_key', 'utilities',
      'pest_control', 'surface_restoration', 'junk_removal', 'cleaned', 'tenant_key', 'leasing_signoff', 'mail_key'
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
        'vendor_key', 'utilities', 'pest_control',
        'surface_restoration', 'junk_removal', 'cleaned',
        'tenant_key', 'leasing_signoff', 'mail_key'
      ];
      // Count non-excluded items as total, completed among those as completed
      const activeFields = checklistFields.filter(f => !data[`${f}_excluded`]);
      const completedCount = activeFields.filter(f => data[`${f}_completed`]).length;
      const totalCount = activeFields.length;

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
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

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
