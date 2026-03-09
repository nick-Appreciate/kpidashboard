import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Upload Bills to Appfolio
 *
 * Fetches bills from Supabase, then forwards them to the
 * Appfolio Bot server (Playwright on Hostinger) for browser-based upload.
 *
 * Supports two sources:
 *   1. unified_bill — reads from the unified bills table (default)
 *   2. expense — legacy brex_expenses path (backward compat, used for direct expense uploads)
 *
 * Invoke:
 *   curl -X POST '<SUPABASE_URL>/functions/v1/upload-appfolio-bills' \
 *     -H 'Authorization: Bearer <ANON_KEY>' \
 *     -H 'Content-Type: application/json' \
 *     -d '{"source": "unified_bill", "bill_id": 123}'
 *
 * Body options:
 *   dry_run: boolean        — log what would happen without submitting (default: false)
 *   bill_id: number         — only process a single bill ID
 *   source: string          — which source table to use (default: 'unified_bill')
 *   expense_id: number      — only process a single expense ID (for legacy expense source)
 */

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const botUrl = Deno.env.get('APPFOLIO_BOT_URL')!;
const botSecret = Deno.env.get('APPFOLIO_BOT_SECRET')!;

const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Types ──────────────────────────────────────────────────────────────────

interface BotUploadResult {
  bill_id: number;
  success: boolean;
  af_bill_id?: string;
  af_bill_url?: string;
  error?: string;
}

// ─── Health check ───────────────────────────────────────────────────────────

async function checkBotHealth(): Promise<{ ok: boolean; health: any }> {
  console.log('Checking bot server health...');
  const healthRes = await fetch(`${botUrl}/api/health`, {
    headers: { 'Authorization': `Bearer ${botSecret}` },
  });
  const health = await healthRes.json();
  return { ok: health.ok && health.logged_in, health };
}

function errorResponse(msg: string, status: number, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ success: false, error: msg, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Unified bill source (new primary path) ────────────────────────────────

async function handleUnifiedBill(billId: number, dryRun: boolean): Promise<Response> {
  console.log(`=== Appfolio Upload (unified_bill) ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}, Bill ID: #${billId}`);

  const { ok, health } = await checkBotHealth();
  if (!ok) return errorResponse('Bot server is not logged in to Appfolio.', 503, { bot_status: health });
  console.log('  Bot is healthy and logged in.');

  // Fetch from bills table
  const { data: bill, error: fetchErr } = await supabase
    .from('bills')
    .select('*')
    .eq('id', billId)
    .single();

  if (fetchErr || !bill) {
    return errorResponse(fetchErr?.message || `Bill #${billId} not found`, 404);
  }

  // Build bot payload
  let attachment_url: string | null = null;
  let attachment_filename: string | null = null;
  if (Array.isArray(bill.attachments_json) && bill.attachments_json.length > 0) {
    attachment_url = bill.attachments_json[0].url || null;
    attachment_filename = bill.attachments_json[0].filename || null;
  }

  const billPayload = {
    id: bill.id,
    vendor_name: bill.vendor_name,
    amount: Number(bill.amount),
    invoice_date: bill.invoice_date,
    invoice_number: bill.invoice_number,
    due_date: bill.due_date,
    description: bill.description,
    property: bill.af_property_input,
    unit: bill.af_unit_input,
    gl_account: bill.af_gl_account_input,
    attachment_url,
    attachment_filename,
  };

  console.log(`Sending bill #${billId} to bot (vendor: ${bill.vendor_name}, $${bill.amount})...`);
  const botRes = await fetch(`${botUrl}/api/upload-bills`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${botSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bills: [billPayload], dry_run: dryRun }),
  });

  const botResult = await botRes.json();

  // Update bills table for successful uploads
  if (!dryRun && botResult.results) {
    for (const result of botResult.results as BotUploadResult[]) {
      if (result.success) {
        const updateData: Record<string, unknown> = {
          appfolio_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        // Only mark as 'entered' when we have a confirmed af_bill_id.
        // Otherwise the bill stays pending and gets matched by the next sync.
        if (result.af_bill_id) {
          updateData.appfolio_bill_id = parseInt(result.af_bill_id);
          updateData.status = 'entered';
        }

        const { error: updateErr } = await supabase
          .from('bills')
          .update(updateData)
          .eq('id', result.bill_id);

        if (updateErr) {
          console.error(`  Failed to update bill #${result.bill_id}: ${updateErr.message}`);
        } else {
          console.log(`  Updated bill #${result.bill_id} → AF Bill ${result.af_bill_id}`);
        }
      }
    }
  }

  const results = (botResult.results || []).map((r: BotUploadResult) => ({
    bill_id: r.bill_id,
    vendor: billPayload.vendor_name,
    amount: billPayload.amount,
    success: r.success,
    error: r.error,
    af_bill_id: r.af_bill_id,
    af_bill_url: r.af_bill_url,
  }));

  const succeeded = results.filter((r: any) => r.success).length;
  const failed = results.filter((r: any) => !r.success).length;

  return new Response(JSON.stringify({
    success: failed === 0,
    dry_run: dryRun,
    source: 'unified_bill',
    summary: { total: results.length, succeeded, failed },
    results,
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Legacy expense source handler ─────────────────────────────────────────

async function handleExpenseSource(expenseId: number, dryRun: boolean): Promise<Response> {
  console.log(`=== Appfolio Expense Upload (legacy) ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}, Expense ID: #${expenseId}`);

  const { ok, health } = await checkBotHealth();
  if (!ok) return errorResponse('Bot server is not logged in to Appfolio.', 503, { bot_status: health });

  const { data: expense, error: fetchErr } = await supabase
    .from('brex_expenses')
    .select('*')
    .eq('id', expenseId)
    .single();

  if (fetchErr || !expense) {
    return errorResponse(fetchErr?.message || `Expense #${expenseId} not found`, 404);
  }

  const postedDate = expense.posted_at || expense.initiated_at || new Date().toISOString().split('T')[0];
  const dueDateObj = new Date(postedDate);
  dueDateObj.setDate(dueDateObj.getDate() + 15);
  const dueDate = dueDateObj.toISOString().split('T')[0];

  const billPayload = {
    id: expense.id,
    vendor_name: expense.af_vendor_name || expense.merchant_name,
    amount: Number(expense.amount),
    invoice_date: postedDate,
    invoice_number: null,
    due_date: dueDate,
    description: expense.af_description
      || (expense.memo ? `${expense.is_corporate ? 'Corporate' : 'Entered'} - ${expense.memo}` : null)
      || `Brex charge - ${expense.merchant_name}`,
    property: expense.af_property_input,
    unit: expense.af_unit_input,
    gl_account: expense.af_gl_account_input,
    attachment_url: null,
    attachment_filename: null,
  };

  console.log(`Sending expense #${expenseId} to bot as bill...`);
  const botRes = await fetch(`${botUrl}/api/upload-bills`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${botSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bills: [billPayload], dry_run: dryRun }),
  });

  const botResult = await botRes.json();

  if (!dryRun && botResult.results) {
    for (const result of botResult.results as BotUploadResult[]) {
      if (result.success) {
        const updateData: Record<string, unknown> = {
          appfolio_synced: true,
          appfolio_checked_at: new Date().toISOString(),
        };
        if (result.af_bill_id) {
          updateData.appfolio_bill_id = parseInt(result.af_bill_id);
        }
        const { error: updateErr } = await supabase
          .from('brex_expenses')
          .update(updateData)
          .eq('id', result.bill_id);

        if (updateErr) {
          console.error(`  Failed to update expense #${result.bill_id}: ${updateErr.message}`);
        } else {
          console.log(`  Updated expense #${result.bill_id} → AF Bill ${result.af_bill_id}`);
        }
      }
    }
  }

  const results = (botResult.results || []).map((r: BotUploadResult) => ({
    bill_id: r.bill_id,
    vendor: billPayload.vendor_name,
    amount: billPayload.amount,
    success: r.success,
    error: r.error,
    af_bill_url: r.af_bill_url,
  }));

  const succeeded = results.filter((r: any) => r.success).length;
  const failed = results.filter((r: any) => !r.success).length;

  return new Response(JSON.stringify({
    success: failed === 0,
    dry_run: dryRun,
    source: 'expense',
    summary: { total: results.length, succeeded, failed },
    results,
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  try {
    let dryRun = false;
    let billId: number | null = null;
    let source: string = 'unified_bill';
    let expenseId: number | null = null;

    if (req.method === 'POST') {
      try {
        const body = await req.json();
        dryRun = body.dry_run === true;
        billId = body.bill_id ?? null;
        source = body.source || 'unified_bill';
        expenseId = body.expense_id ?? null;
      } catch {
        // No body or invalid JSON — use defaults
      }
    }

    const url = new URL(req.url);
    if (url.searchParams.get('dry_run') === 'true') dryRun = true;
    if (url.searchParams.get('bill_id')) billId = parseInt(url.searchParams.get('bill_id')!);
    if (url.searchParams.get('source')) source = url.searchParams.get('source')!;
    if (url.searchParams.get('expense_id')) expenseId = parseInt(url.searchParams.get('expense_id')!);

    // Route to the appropriate handler
    if (source === 'expense' && expenseId) {
      return handleExpenseSource(expenseId, dryRun);
    }
    // Default: unified bills table
    if (billId) {
      return handleUnifiedBill(billId, dryRun);
    }
    return errorResponse('Missing bill_id parameter', 400);

  } catch (error: any) {
    console.error('Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
