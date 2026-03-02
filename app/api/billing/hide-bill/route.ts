import { NextResponse } from "next/server";
import { supabase } from '../../../../lib/supabase';

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, is_hidden, note } = body;

    if (!id) {
      return NextResponse.json({ error: "Bill ID is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {
      is_hidden: is_hidden ?? true,
      hidden_note: note || null,
      hidden_at: is_hidden !== false ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    // If unhiding, clear the hide metadata
    if (is_hidden === false) {
      updates.hidden_note = null;
      updates.hidden_at = null;
    }

    const { data, error } = await supabase
      .from('ops_bills')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error("Error updating bill:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in hide-bill PATCH:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
