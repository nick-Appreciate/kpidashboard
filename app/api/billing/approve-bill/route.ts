import { NextResponse } from "next/server";
import { supabase } from '../../../../lib/supabase';

/**
 * POST /api/billing/approve-bill
 *
 * Saves the user-edited bill fields, records approval (who + when),
 * then triggers the Appfolio bot to upload the bill.
 *
 * Body: {
 *   bill_id: number,
 *   approved_by: string,          // user name or email
 *   vendor_name: string,
 *   amount: number,
 *   invoice_date: string,
 *   due_date: string | null,
 *   invoice_number: string | null,
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
      bill_id,
      approved_by,
      vendor_name,
      amount,
      invoice_date,
      due_date,
      invoice_number,
      description,
      af_property_input,
      af_gl_account_input,
      af_unit_input,
    } = body;

    if (!bill_id) {
      return NextResponse.json({ error: "bill_id is required" }, { status: 400 });
    }

    // 1. Save the edited fields + record approval
    const { error: updateErr } = await supabase
      .from('ops_bills')
      .update({
        vendor_name,
        amount,
        invoice_date,
        due_date: due_date || null,
        invoice_number: invoice_number || null,
        description: description || null,
        af_property_input: af_property_input || null,
        af_gl_account_input: af_gl_account_input || null,
        af_unit_input: af_unit_input || null,
        af_approved_by: approved_by || 'unknown',
        af_approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', bill_id);

    if (updateErr) {
      console.error("Error saving bill edits:", updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 2. Trigger the Supabase Edge Function to upload this single bill
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const uploadRes = await fetch(
      `${supabaseUrl}/functions/v1/upload-appfolio-bills`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bill_id, dry_run: false }),
      }
    );

    const uploadResult = await uploadRes.json();

    if (!uploadRes.ok) {
      return NextResponse.json(
        {
          error: uploadResult.error || 'Bot upload failed',
          bot_status: uploadResult.bot_status,
          approved: true, // approval was saved even if bot failed
        },
        { status: uploadRes.status }
      );
    }

    // 3. After successful edge function call, mark the bill as synced.
    // Use loose comparison (==) for bill_id in case of string/number mismatch.
    const botResults = uploadResult.results || [];
    const thisBillResult = botResults.find((r: any) => r.bill_id == bill_id);

    const botSuccess = thisBillResult?.success === true;

    // Always set appfolio_synced when the edge function returned 200
    // so the bill transitions to "matched" view immediately.
    // Even if the bot didn't fully succeed, the approval is recorded.
    const syncUpdate: Record<string, unknown> = {
      appfolio_synced: true,
      appfolio_checked_at: new Date().toISOString(),
    };
    // Only set status to 'entered' if the bot confirmed success
    if (botSuccess) {
      syncUpdate.status = 'entered';
    }
    // If the bot returned an AF bill ID, store it
    if (thisBillResult?.af_bill_id) {
      syncUpdate.appfolio_bill_id = parseInt(thisBillResult.af_bill_id);
    }

    await supabase
      .from('ops_bills')
      .update(syncUpdate)
      .eq('id', bill_id);

    return NextResponse.json({
      success: true,
      approved: true,
      bot_success: botSuccess,
      bot_error: thisBillResult?.error || null,
      approved_by,
      approved_at: new Date().toISOString(),
      upload: uploadResult,
    });
  } catch (error) {
    console.error("Error in approve-bill:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/billing/approve-bill
 *
 * Save edited fields WITHOUT triggering bot upload.
 * Used for inline editing / saving draft changes.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { bill_id, ...fields } = body;

    if (!bill_id) {
      return NextResponse.json({ error: "bill_id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // Only include provided fields
    const allowedFields = [
      'vendor_name', 'amount', 'invoice_date', 'due_date',
      'invoice_number', 'description',
      'af_property_input', 'af_gl_account_input', 'af_unit_input',
    ];
    for (const key of allowedFields) {
      if (key in fields) {
        updates[key] = fields[key] || null;
      }
    }

    const { data, error } = await supabase
      .from('ops_bills')
      .update(updates)
      .eq('id', bill_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, bill: data });
  } catch (error) {
    console.error("Error saving bill edits:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
