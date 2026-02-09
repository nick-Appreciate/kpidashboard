import { supabase } from '../../../lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const contactType = searchParams.get('contactType');
    const contactId = searchParams.get('contactId');
    const limit = parseInt(searchParams.get('limit') || '50');
    
    let query = supabase
      .from('contact_notes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (contactType) {
      query = query.eq('contact_type', contactType);
    }
    if (contactId) {
      query = query.eq('contact_id', contactId);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching notes:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ notes: data || [] });
    
  } catch (error) {
    console.error('Error fetching contact notes:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { contactType, contactId, contactName, propertyName, unit, note, noteType, userEmail } = body;
    
    if (!contactType || !contactId || !note) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    // Look up user by email
    let userId = null;
    if (userEmail) {
      const { data: user } = await supabase
        .from('app_users')
        .select('id')
        .eq('email', userEmail)
        .single();
      userId = user?.id;
    }
    
    const { data, error } = await supabase
      .from('contact_notes')
      .insert({
        contact_type: contactType,
        contact_id: contactId,
        contact_name: contactName,
        property_name: propertyName,
        unit: unit,
        note: note,
        note_type: noteType || 'general',
        created_by: userId,
        created_by_email: userEmail
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating note:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ note: data });
    
  } catch (error) {
    console.error('Error creating contact note:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
