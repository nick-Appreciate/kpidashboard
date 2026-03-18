import { NextResponse } from "next/server";
import { requireAdmin } from '../../../../../../lib/auth';

/**
 * POST /api/admin/bills/[id]/duplicate
 *
 * Resolve a duplicate detection:
 *   - confirm_duplicate: marks bill as duplicate, hides it
 *   - mark_unique: clears duplicate flag
 *
 * Body: {
 *   action: 'confirm_duplicate' | 'mark_unique',
 *   duplicate_of_id?: number  (required for confirm_duplicate)
 * }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;
    const supabase = auth.supabase;

    const { id } = await params;
    const billId = parseInt(id);
    if (isNaN(billId)) {
      return NextResponse.json({ error: "Invalid bill ID" }, { status: 400 });
    }

    const body = await request.json();
    const { action, duplicate_of_id } = body;

    if (!action || !['confirm_duplicate', 'mark_unique'].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'confirm_duplicate' or 'mark_unique'" },
        { status: 400 }
      );
    }

    let updates: Record<string, unknown>;

    if (action === 'confirm_duplicate') {
      updates = {
        is_duplicate: true,
        duplicate_of_id: duplicate_of_id || null,
        status: 'duplicate',
        is_hidden: true,
        hidden_note: 'Confirmed as duplicate',
        hidden_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    } else {
      // mark_unique
      updates = {
        is_duplicate: false,
        duplicate_of_id: null,
        updated_at: new Date().toISOString(),
      };
    }

    const { data, error } = await supabase
      .from('bills')
      .update(updates)
      .eq('id', billId)
      .select()
      .single();

    if (error) {
      console.error("Error resolving duplicate:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, bill: data });
  } catch (error) {
    console.error("Error in duplicate resolution:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
