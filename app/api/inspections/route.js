import { supabase } from '../../../lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get('includeArchived') === 'true';
    const property = searchParams.get('property');

    let query = supabase
      .from('inspections')
      .select('*')
      .order('date', { ascending: true });

    if (!includeArchived) {
      query = query.eq('archived', false);
    }

    if (property && property !== 'all') {
      query = query.eq('property_name', property);
    }

    const { data: inspections, error } = await query;

    if (error) {
      console.error('Error fetching inspections:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ inspections: inspections || [] });

  } catch (error) {
    console.error('Error in inspections GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      type,
      date,
      time,
      property_name,
      unit_name,
      duration = 60,
      notes,
      parent_inspection_id
    } = body;

    const { data: inspection, error } = await supabase
      .from('inspections')
      .insert({
        type,
        date,
        time,
        property_name,
        unit_name,
        duration,
        notes,
        parent_inspection_id: parent_inspection_id || null,
        status: 'pending',
        archived: false
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating inspection:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(inspection);

  } catch (error) {
    console.error('Error in inspections POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Inspection ID is required' }, { status: 400 });
    }

    const { data: inspection, error } = await supabase
      .from('inspections')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating inspection:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(inspection);

  } catch (error) {
    console.error('Error in inspections PATCH:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Inspection ID is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('inspections')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting inspection:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error in inspections DELETE:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
