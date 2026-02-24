import { supabase } from '../../../lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const property = searchParams.get('property');

    if (!property) {
      return NextResponse.json({ units: [] });
    }

    // Get latest snapshot date
    const { data: latestSnapshot } = await supabase
      .from('rent_roll_snapshots')
      .select('snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1);

    const latestDate = latestSnapshot?.[0]?.snapshot_date;

    if (!latestDate) {
      return NextResponse.json({ units: [] });
    }

    // Get distinct units for the property
    const { data: units, error } = await supabase
      .from('rent_roll_snapshots')
      .select('unit')
      .eq('snapshot_date', latestDate)
      .eq('property', property)
      .order('unit');

    if (error) {
      console.error('Error fetching units:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Extract unique unit names
    const uniqueUnits = [...new Set(units.map(u => u.unit))].sort();

    return NextResponse.json({ units: uniqueUnits });

  } catch (error) {
    console.error('Error in units GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
