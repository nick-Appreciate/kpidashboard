import { NextResponse } from "next/server";
import { requireAdmin } from '../../../../../lib/auth';

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;
  try {
    const body = await request.json();
    const { id, is_corporate, note } = body;

    if (!id) {
      return NextResponse.json({ error: "Expense ID is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {
      is_corporate: is_corporate ?? true,
      corporate_note: note || null,
      corporate_at: is_corporate !== false ? new Date().toISOString() : null,
      match_status: is_corporate !== false ? 'corporate' : 'unmatched',
      updated_at: new Date().toISOString(),
    };

    // If un-archiving, clear corporate metadata
    if (is_corporate === false) {
      updates.corporate_note = null;
      updates.corporate_at = null;
    }

    const { data, error } = await supabase
      .from('brex_expenses')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error("Error updating brex expense:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in corporate PATCH:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
