import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Upload Bills to Appfolio
 *
 * Fetches unmatched bills from Supabase, then forwards them to the
 * Appfolio Bot server (Playwright on Hostinger) for browser-based upload.
 *
 * Invoke:
 *   curl -X POST '<SUPABASE_URL>/functions/v1/upload-appfolio-bills' \
 *     -H 'Authorization: Bearer <ANON_KEY>' \
 *     -H 'Content-Type: application/json' \
 *     -d '{"dry_run": true}'
 *
 * Body options:
 *   dry_run: boolean  — log what would happen without submitting (default: false)
 *   bill_id: number   — only process a single bill ID
 */

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const botUrl = Deno.env.get('APPFOLIO_BOT_URL')!;     // e.g. https://your-hostinger-server.com
const botSecret = Deno.env.get('APPFOLIO_BOT_SECRET')!; // API_SECRET on the bot server

const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Types ──────────────────────────────────────────────────────────────────

interface Bill {
  id: number;
  vendor_name: string;
  amount: number;
  invoice_date: string;
  invoice_number: string | null;
  due_date: string | null;
  description: string | null;
  document_type: string;
  payment_status: string;
  status: string | null;
  attachments_json: any;
  af_match_status: string;
  af_bill_id: string | null;
  af_property_input: string | null;
  af_gl_account_input: string | null;
  af_unit_input: string | null;
}

interface BotUploadResult {
  bill_id: number;
  success: boolean;
  af_bill_id?: string;
  af_bill_url?: string;
  error?: string;
}

// ─── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  try {
    // Parse options from request body
    let dryRun = false;
    let billId: number | null = null;

    if (req.method === 'POST') {
      try {
        const body = await req.json();
        dryRun = body.dry_run === true;
        billId = body.bill_id ?? null;
      } catch {
        // No body or invalid JSON — use defaults
      }
    }

    // Also check query params
    const url = new URL(req.url);
    if (url.searchParams.get('dry_run') === 'true') dryRun = true;
    if (url.searchParams.get('bill_id')) billId = parseInt(url.searchParams.get('bill_id')!);

    console.log(`=== Appfolio Bill Upload ===`);
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
    if (billId) console.log(`Single bill: #${billId}`);

    // 1. Check bot health first
    console.log('Checking bot server health...');
    const healthRes = await fetch(`${botUrl}/api/health`, {
      headers: { 'Authorization': `Bearer ${botSecret}` },
    });
    const health = await healthRes.json();

    if (!health.ok || !health.logged_in) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Bot server is not logged in to Appfolio. Log in first via POST /api/login on the bot.',
        bot_status: health,
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('  Bot is healthy and logged in.');

    // 2. Fetch unmatched bills from Supabase
    console.log('Fetching unmatched bills...');
    const { data: bills, error: fetchErr } = await supabase
      .rpc('get_bills_with_af_match', { include_hidden: false });

    if (fetchErr) throw new Error(`Supabase error: ${fetchErr.message}`);

    const toProcess = (bills as Bill[]).filter(b =>
      b.af_match_status !== 'matched' &&
      b.document_type === 'invoice' &&
      b.payment_status !== 'paid' &&
      b.status !== 'manual_entry' &&
      (billId ? b.id === billId : true)
    );

    console.log(`  Found ${toProcess.length} bill(s) to process.`);

    if (toProcess.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No unmatched bills to process.',
        results: [],
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 3. Send bills to bot for upload
    const billPayloads = toProcess.map(b => {
      // Extract first PDF attachment URL if available
      let attachment_url: string | null = null;
      let attachment_filename: string | null = null;
      if (Array.isArray(b.attachments_json) && b.attachments_json.length > 0) {
        attachment_url = b.attachments_json[0].url || null;
        attachment_filename = b.attachments_json[0].filename || null;
      }

      return {
        id: b.id,
        vendor_name: b.vendor_name,
        amount: b.amount,
        invoice_date: b.invoice_date,
        invoice_number: b.invoice_number,
        due_date: b.due_date,
        description: b.description,
        property: b.af_property_input,
        unit: b.af_unit_input,
        gl_account: b.af_gl_account_input,
        attachment_url,
        attachment_filename,
      };
    });

    console.log(`Sending ${billPayloads.length} bills to bot...`);
    const botRes = await fetch(`${botUrl}/api/upload-bills`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${botSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bills: billPayloads,
        dry_run: dryRun,
      }),
    });

    const botResult = await botRes.json();

    // 4. Update Supabase for successful uploads
    if (!dryRun && botResult.results) {
      for (const result of botResult.results as BotUploadResult[]) {
        if (result.success && result.af_bill_id) {
          // Mark the bill as synced with Appfolio
          // (af_match_status is computed from af_bill_detail JOIN, so just update ops_bills status)
          const { error: updateErr } = await supabase
            .from('ops_bills')
            .update({
              appfolio_bill_id: parseInt(result.af_bill_id || '0'),
              appfolio_synced: true,
              appfolio_checked_at: new Date().toISOString(),
              status: 'entered',
            })
            .eq('id', result.bill_id);

          if (updateErr) {
            console.error(`  Failed to update bill #${result.bill_id} in Supabase: ${updateErr.message}`);
          } else {
            console.log(`  Updated bill #${result.bill_id} → AF Bill ${result.af_bill_id}`);
          }
        }
      }
    }

    // 5. Build response
    const results = (botResult.results || []).map((r: BotUploadResult) => ({
      bill_id: r.bill_id,
      vendor: toProcess.find(b => b.id === r.bill_id)?.vendor_name || 'unknown',
      amount: toProcess.find(b => b.id === r.bill_id)?.amount || 0,
      success: r.success,
      error: r.error,
      af_bill_url: r.af_bill_url,
    }));

    const succeeded = results.filter((r: any) => r.success).length;
    const failed = results.filter((r: any) => !r.success).length;

    return new Response(JSON.stringify({
      success: failed === 0,
      dry_run: dryRun,
      summary: {
        total: results.length,
        succeeded,
        failed,
      },
      results,
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });

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
