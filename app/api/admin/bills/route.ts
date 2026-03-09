import { NextResponse } from "next/server";
import { supabase, supabaseAdmin } from '../../../../lib/supabase';

/**
 * GET /api/admin/bills
 *
 * Fetches all unified bills via the get_unified_bills RPC.
 * Query params:
 *   include_hidden=true   – include hidden bills
 *   include_corporate=true – include corporate-archived bills
 *   source=brex|front      – filter by source
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeHidden = searchParams.get('include_hidden') === 'true';
    const includeCorporate = searchParams.get('include_corporate') === 'true';
    const sourceFilter = searchParams.get('source') || null;

    const { data, error } = await supabase.rpc('get_unified_bills', {
      p_include_hidden: includeHidden,
      p_include_corporate: includeCorporate,
      p_source_filter: sourceFilter,
    });

    if (error) {
      console.error("Error fetching unified bills:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (error) {
    console.error("Error in GET /api/admin/bills:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/bills
 *
 * Creates a new bill record. Used when:
 *   - Manually creating a bill (source='manual')
 *   - (Future) creating from a new source
 *
 * Body: {
 *   source: 'manual',
 *   vendor_name, amount, invoice_date, due_date?, invoice_number?,
 *   description?, af_property_input?, af_gl_account_input?, af_unit_input?,
 *   document_type?, attachments_json?
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      source = 'manual',
      vendor_name,
      amount,
      invoice_date,
      due_date,
      invoice_number,
      description,
      af_property_input,
      af_gl_account_input,
      af_unit_input,
      document_type = 'invoice',
      attachments_json,
    } = body;

    if (!vendor_name || amount === undefined || !invoice_date) {
      return NextResponse.json(
        { error: "vendor_name, amount, and invoice_date are required" },
        { status: 400 }
      );
    }

    const { data: bill, error } = await supabaseAdmin
      .from('bills')
      .insert({
        source,
        vendor_name,
        amount,
        invoice_date,
        due_date: due_date || null,
        invoice_number: invoice_number || null,
        description: description || null,
        af_property_input: af_property_input || null,
        af_gl_account_input: af_gl_account_input || null,
        af_unit_input: af_unit_input || null,
        document_type,
        attachments_json: attachments_json || null,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating bill:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Check for duplicates after insert
    const { data: dupes } = await supabase
      .from('bills')
      .select('id, vendor_name, amount, source, status')
      .eq('dedup_key', bill.dedup_key)
      .neq('id', bill.id)
      .not('status', 'in', '("hidden","duplicate")');

    if (dupes && dupes.length > 0) {
      // Mark as potential duplicate
      await supabaseAdmin
        .from('bills')
        .update({ is_duplicate: true, duplicate_of_id: dupes[0].id })
        .eq('id', bill.id);

      bill.is_duplicate = true;
      bill.duplicate_of_id = dupes[0].id;
    }

    return NextResponse.json({ success: true, bill, duplicates: dupes || [] });
  } catch (error) {
    console.error("Error in POST /api/admin/bills:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
