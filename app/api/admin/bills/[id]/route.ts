import { NextResponse } from "next/server";
import { requireAdmin } from '../../../../../lib/auth';

/**
 * PATCH /api/admin/bills/[id]
 *
 * Updates bill fields. Used for:
 *   - Saving draft edits (vendor, property, GL account, etc.)
 *   - Hiding/unhiding a bill
 *   - Marking as corporate
 *
 * Body: any subset of editable bill fields
 */
export async function PATCH(
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
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // Allowed editable fields
    const editableFields = [
      'vendor_name', 'amount', 'invoice_date', 'due_date',
      'invoice_number', 'description',
      'af_property_input', 'af_gl_account_input', 'af_unit_input',
      'document_type', 'payment_status',
    ];
    for (const key of editableFields) {
      if (key in body) {
        updates[key] = body[key] || null;
      }
    }

    // Handle hide/unhide
    if ('is_hidden' in body) {
      updates.is_hidden = body.is_hidden;
      if (body.is_hidden) {
        updates.status = 'hidden';
        updates.hidden_at = new Date().toISOString();
        updates.hidden_note = body.hidden_note || null;
      } else {
        updates.status = 'pending';
        updates.hidden_at = null;
        updates.hidden_note = null;
      }
    }

    // Handle corporate marking
    if ('status' in body && body.status === 'corporate') {
      updates.status = 'corporate';
    }
    if ('status' in body && body.status === 'pending' && !('is_hidden' in body)) {
      updates.status = 'pending';
    }

    const { data, error } = await supabase
      .from('bills')
      .update(updates)
      .eq('id', billId)
      .select()
      .single();

    if (error) {
      console.error("Error updating bill:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Sync corporate status to brex_expenses if this is a brex-sourced bill
    if (data.source === 'brex' && data.brex_expense_id && 'status' in body) {
      const isCorporate = body.status === 'corporate';
      const brexUpdate: Record<string, unknown> = {
        is_corporate: isCorporate,
        updated_at: new Date().toISOString(),
      };
      if (isCorporate) {
        brexUpdate.match_status = 'corporate';
        brexUpdate.corporate_at = new Date().toISOString();
        brexUpdate.corporate_note = body.corporate_note || 'Marked via unified dashboard';
      } else {
        brexUpdate.match_status = 'unmatched';
        brexUpdate.corporate_at = null;
        brexUpdate.corporate_note = null;
      }
      await supabase
        .from('brex_expenses')
        .update(brexUpdate)
        .eq('id', data.brex_expense_id);
    }

    return NextResponse.json({ success: true, bill: data });
  } catch (error) {
    console.error("Error in PATCH /api/admin/bills/[id]:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
