import { NextResponse } from "next/server";
import { supabaseAdmin } from '../../../../../../lib/supabase';

/**
 * POST /api/admin/bills/[id]/approve
 *
 * Saves final field values, records approval, then triggers the
 * AppFolio bot to upload the bill.
 *
 * Replaces both /api/admin/brex/approve-expense and /api/billing/approve-bill.
 *
 * Body: {
 *   approved_by: string,
 *   vendor_name?: string,
 *   amount?: number,
 *   invoice_date?: string,
 *   due_date?: string,
 *   invoice_number?: string,
 *   description?: string,
 *   af_property_input?: string,
 *   af_gl_account_input?: string,
 *   af_unit_input?: string,
 * }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const billId = parseInt(id);
    if (isNaN(billId)) {
      return NextResponse.json({ error: "Invalid bill ID" }, { status: 400 });
    }

    const body = await request.json();
    const { approved_by } = body;

    if (!approved_by) {
      return NextResponse.json({ error: "approved_by is required" }, { status: 400 });
    }

    // 1. Update the bill with final field values and approval metadata
    const updates: Record<string, unknown> = {
      approved_by,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const editableFields = [
      'vendor_name', 'amount', 'invoice_date', 'due_date',
      'invoice_number', 'description',
      'af_property_input', 'af_gl_account_input', 'af_unit_input',
    ];
    for (const key of editableFields) {
      if (key in body) {
        updates[key] = body[key] || null;
      }
    }

    const { data: bill, error: updateErr } = await supabaseAdmin
      .from('bills')
      .update(updates)
      .eq('id', billId)
      .select()
      .single();

    if (updateErr) {
      console.error("Error saving bill edits:", updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 2. Trigger the Supabase Edge Function to upload this bill
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const sbAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const uploadRes = await fetch(
      `${sbUrl}/functions/v1/upload-appfolio-bills`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sbAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: 'unified_bill',
          bill_id: billId,
          dry_run: false,
        }),
      }
    );

    const uploadResult = await uploadRes.json();

    if (!uploadRes.ok) {
      return NextResponse.json(
        {
          error: uploadResult.error || 'Bot upload failed',
          bot_status: uploadResult.bot_status,
          approved: true,
        },
        { status: uploadRes.status }
      );
    }

    // 3. After successful edge function call, update bill status
    const botResults = uploadResult.results || [];
    const thisResult = botResults.find((r: any) => r.bill_id == billId);
    const botSuccess = thisResult?.success === true;

    const syncUpdate: Record<string, unknown> = {
      appfolio_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Only mark as 'entered' when we have a confirmed appfolio_bill_id.
    // If the bot succeeded but didn't return the ID, the bill stays pending
    // and will be matched by the next af_bill_detail sync cycle.
    if (thisResult?.af_bill_id) {
      syncUpdate.appfolio_bill_id = parseInt(thisResult.af_bill_id);
      syncUpdate.status = 'entered';
    }

    await supabaseAdmin
      .from('bills')
      .update(syncUpdate)
      .eq('id', billId);

    // Also update the linked brex_expense if this is a Brex-sourced bill
    if (bill.source === 'brex' && bill.brex_expense_id) {
      const brexUpdate: Record<string, unknown> = {
        appfolio_synced: true,
        appfolio_checked_at: new Date().toISOString(),
        af_vendor_name: bill.vendor_name,
        af_property_input: bill.af_property_input,
        af_gl_account_input: bill.af_gl_account_input,
        af_unit_input: bill.af_unit_input,
        af_approved_by: approved_by,
        af_approved_at: new Date().toISOString(),
      };
      if (botSuccess) {
        brexUpdate.match_status = 'matched';
        brexUpdate.match_confidence = 'high';
      }
      if (thisResult?.af_bill_id) {
        brexUpdate.appfolio_bill_id = parseInt(thisResult.af_bill_id);
      }
      await supabaseAdmin
        .from('brex_expenses')
        .update(brexUpdate)
        .eq('id', bill.brex_expense_id);
    }

    // 4. Fire-and-forget: refresh af_bill_detail from AppFolio so the new bill appears immediately
    if (botSuccess) {
      fetch(`${sbUrl}/functions/v1/sync-appfolio`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sbAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ report: 'bill_detail' }),
      }).catch(err => console.error('Background bill_detail sync failed:', err));
    }

    return NextResponse.json({
      success: true,
      approved: true,
      bot_success: botSuccess,
      bot_error: thisResult?.error || null,
      approved_by,
      approved_at: new Date().toISOString(),
      upload: uploadResult,
    });
  } catch (error) {
    console.error("Error in approve bill:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
