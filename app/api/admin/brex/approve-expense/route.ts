import { NextResponse } from "next/server";
import { supabaseAdmin } from '../../../../../lib/supabase';

/**
 * POST /api/admin/brex/approve-expense
 *
 * Saves user-edited expense fields, records approval (who + when),
 * then triggers the Appfolio bot to upload the bill.
 *
 * Mirrors the approve-bill API pattern.
 *
 * Body: {
 *   expense_id: number,
 *   approved_by: string,
 *   vendor_name: string,
 *   amount: number,
 *   invoice_date: string,
 *   due_date: string | null,
 *   description: string | null,
 *   af_property_input: string | null,
 *   af_gl_account_input: string | null,
 *   af_unit_input: string | null,
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      expense_id,
      approved_by,
      vendor_name,
      amount,
      invoice_date,
      due_date,
      description,
      af_property_input,
      af_gl_account_input,
      af_unit_input,
    } = body;

    if (!expense_id) {
      return NextResponse.json({ error: "expense_id is required" }, { status: 400 });
    }

    // 1. Save the edited fields + record approval on brex_expenses
    const { error: updateErr } = await supabaseAdmin
      .from('brex_expenses')
      .update({
        af_vendor_name: vendor_name || null,
        af_description: description || null,
        af_property_input: af_property_input || null,
        af_gl_account_input: af_gl_account_input || null,
        af_unit_input: af_unit_input || null,
        af_approved_by: approved_by || 'unknown',
        af_approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', expense_id);

    if (updateErr) {
      console.error("Error saving expense edits:", updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 2. Trigger the Supabase Edge Function to upload this expense as a bill
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
          source: 'expense',
          expense_id,
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

    // 3. After successful edge function call, mark the expense as synced
    const botResults = uploadResult.results || [];
    // Match by expense_id (the edge function will use expense_id as the bill_id for expense source)
    const thisResult = botResults.find((r: any) => r.bill_id == expense_id);

    const botSuccess = thisResult?.success === true;

    // Always set appfolio_synced when the edge function returned 200
    const syncUpdate: Record<string, unknown> = {
      appfolio_synced: true,
      appfolio_checked_at: new Date().toISOString(),
    };
    if (botSuccess) {
      syncUpdate.match_status = 'matched';
      syncUpdate.match_confidence = 'high';
    }
    if (thisResult?.af_bill_id) {
      syncUpdate.appfolio_bill_id = parseInt(thisResult.af_bill_id);
    }

    await supabaseAdmin
      .from('brex_expenses')
      .update(syncUpdate)
      .eq('id', expense_id);

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
    console.error("Error in approve-expense:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/brex/approve-expense
 *
 * Save edited fields WITHOUT triggering bot upload.
 * Used for inline editing / saving draft changes.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { expense_id, ...fields } = body;

    if (!expense_id) {
      return NextResponse.json({ error: "expense_id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    const allowedFields = [
      'af_vendor_name', 'af_description', 'af_property_input', 'af_gl_account_input', 'af_unit_input',
    ];
    for (const key of allowedFields) {
      if (key in fields) {
        updates[key] = fields[key] || null;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('brex_expenses')
      .update(updates)
      .eq('id', expense_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, expense: data });
  } catch (error) {
    console.error("Error saving expense edits:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
