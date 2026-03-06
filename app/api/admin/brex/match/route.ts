import { NextResponse } from "next/server";
import { supabaseAdmin } from '../../../../../lib/supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { expense_id, bill_id, action } = body;

    if (!expense_id) {
      return NextResponse.json({ error: "Expense ID is required" }, { status: 400 });
    }

    if (!action || !['confirm', 'reject', 'link'].includes(action)) {
      return NextResponse.json({ error: "Action must be confirm, reject, or link" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (action === 'confirm') {
      updates.match_confidence = 'high';
      updates.matched_by = 'manual';
    } else if (action === 'reject') {
      updates.match_status = 'unmatched';
      updates.match_confidence = null;
      updates.matched_bill_id = null;
      updates.matched_at = null;
      updates.matched_by = null;
    } else if (action === 'link' && bill_id) {
      updates.match_status = 'matched';
      updates.match_confidence = 'high';
      updates.matched_bill_id = typeof bill_id === 'string' ? parseInt(bill_id) : bill_id;
      updates.matched_at = new Date().toISOString();
      updates.matched_by = 'manual';
    }

    // Use admin client to bypass RLS for server-side mutation
    const { data, error } = await supabaseAdmin
      .from('brex_expenses')
      .update(updates)
      .eq('id', expense_id)
      .select()
      .single();

    if (error) {
      console.error("Error updating match:", error, { expense_id, bill_id, action, updates });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in match POST:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
