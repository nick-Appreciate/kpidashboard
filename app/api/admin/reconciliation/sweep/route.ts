import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';
// @ts-ignore — supabase.js is untyped JS
import { supabaseAdmin } from '../../../../../lib/supabase';

/**
 * POST /api/admin/reconciliation/sweep
 *
 * Iterates every outstanding row in reconciliation_unmatched() and re-runs
 * find_af_match against the (freshly synced) af_bill_detail table. Any row
 * that now resolves to a bill gets:
 *   - matched_bill_id + matched_at + matched_by='auto-sweep' written to
 *     brex_expenses / mercury_transactions
 *   - a "Billed · Property Expense · AppFolio Bill #… · <url>" memo pushed
 *     to Brex via PUT /v1/expenses/card/<id> (Brex source only; skipped
 *     when the row has no enriched expense_id)
 *
 * Intended to be triggered from the UI's manual refresh AND on a cron
 * after sync-appfolio. Serial (not batched) so we can attribute each
 * result and stay under Brex's rate limits.
 */

async function pushBrexMemo(expenseId: string, memo: string): Promise<string | null> {
  const token = process.env.BREX_API_KEY;
  if (!token) return 'BREX_API_KEY not configured';
  const res = await fetch(`https://platform.brexapis.com/v1/expenses/card/${expenseId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ memo }),
  });
  if (res.ok) return null;
  const text = await res.text().catch(() => '');
  return `Brex ${res.status}: ${text.slice(0, 200)}`;
}

function billedMemo(billId: string | number): string {
  return `Billed · Property Expense · AppFolio Bill #${billId} · https://appreciateinc.appfolio.com/accounting/payable_invoices/${billId}`;
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const since = searchParams.get('since') || '2026-01-01';
  const actor = 'auto-sweep';
  const nowIso = new Date().toISOString();

  // 1. Pull the current outstanding list (RPC already filters corp/matched/dismissed).
  const { data: outstanding, error: rpcErr } = await supabaseAdmin
    .rpc('reconciliation_unmatched', { since_date: since });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const rows = (outstanding || []) as Array<{
    source: 'brex' | 'mercury';
    source_id: string;
    brex_expense_id: string | null;
  }>;

  let matched = 0;
  let brexPushed = 0;
  let brexSkipped = 0;
  const failures: Array<{ source_id: string; reason: string }> = [];

  for (const row of rows) {
    const { data: found, error: findErr } = await supabaseAdmin
      .rpc('find_af_match', { p_source: row.source, p_source_id: row.source_id });
    if (findErr) { failures.push({ source_id: row.source_id, reason: findErr.message }); continue; }
    const hit = Array.isArray(found) ? found[0] : found;
    if (!hit?.matched_bill_id) continue; // still unmatched — leave on queue

    if (row.source === 'brex') {
      const n = Number(hit.matched_bill_id);
      if (!Number.isFinite(n)) { failures.push({ source_id: row.source_id, reason: 'non-numeric bill_id' }); continue; }
      if (row.brex_expense_id) {
        const err = await pushBrexMemo(row.brex_expense_id, billedMemo(n));
        if (err) { failures.push({ source_id: row.source_id, reason: err }); continue; }
        brexPushed += 1;
      } else {
        brexSkipped += 1;
      }
      const { error: uErr } = await supabaseAdmin
        .from('brex_expenses')
        .update({
          matched_bill_id: n,
          matched_at: nowIso,
          matched_by: actor,
          match_status: 'matched_auto',
          updated_at: nowIso,
        })
        .eq('brex_id', row.source_id);
      if (uErr) { failures.push({ source_id: row.source_id, reason: uErr.message }); continue; }
    } else {
      const { error: uErr } = await supabaseAdmin
        .from('mercury_transactions')
        .update({
          matched_bill_id: String(hit.matched_bill_id),
          matched_at: nowIso,
          matched_by: actor,
        })
        .eq('id', row.source_id);
      if (uErr) { failures.push({ source_id: row.source_id, reason: uErr.message }); continue; }
    }
    matched += 1;
  }

  return NextResponse.json({
    ok: true,
    scanned: rows.length,
    matched,
    brex_pushed: brexPushed,
    brex_skipped_no_expense_id: brexSkipped,
    failures,
  });
}
