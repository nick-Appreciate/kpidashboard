import { NextResponse } from 'next/server';
import { requirePage } from '../../../../../lib/auth';
// @ts-ignore — supabase.js is untyped JS
import { supabaseAdmin } from '../../../../../lib/supabase';

/**
 * Update a Brex card expense's memo. Returns null on success, error string
 * on failure. Brex's expenses-card endpoint takes PUT (not PATCH — confirmed
 * against the live API on 2026-09-22), and needs a token with expenses.card
 * write scope.
 */
async function pushBrexMemo(expenseId: string, memo: string): Promise<string | null> {
  const token = process.env.BREX_API_KEY;
  if (!token) return 'BREX_API_KEY not configured on server';

  const res = await fetch(`https://platform.brexapis.com/v1/expenses/card/${expenseId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ memo }),
  });
  if (res.ok) return null;
  const text = await res.text().catch(() => '');
  return `Brex API ${res.status}: ${text.slice(0, 300)}`;
}

/**
 * Standardized memo we push to Brex when a Brex expense is matched to an
 * AppFolio bill. Fits on one line so it renders cleanly in the Brex
 * dashboard's memo column, and carries the AF link so employees can jump
 * straight to the bill.
 */
function billedToAfMemo(billId: string | number): string {
  const url = `https://appreciateinc.appfolio.com/accounting/payable_invoices/${billId}`;
  return `Billed · Property Expense · AppFolio Bill #${billId} · ${url}`;
}

export async function POST(request: Request) {
  const auth = await requirePage(request, 'bookkeeping');
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const body = await request.json();
  const { source, source_id, action, matched_af_bill_id, reason } = body as {
    source: 'brex' | 'mercury';
    source_id: string;
    action: 'corporate' | 'match' | 'dismiss' | 'flag' | 'undo';
    matched_af_bill_id?: string;
    reason?: string;
  };

  if (!source || !source_id || !action) {
    return NextResponse.json({ error: 'source, source_id, and action are required' }, { status: 400 });
  }

  const actor = auth.user?.email || 'unknown';
  const nowIso = new Date().toISOString();

  const brexUpdates: Record<string, unknown> = { updated_at: nowIso };
  const mercuryUpdates: Record<string, unknown> = {};
  // Populated when the user supplies a bill_id by hand, so the response can
  // echo back which AppFolio bill they actually linked to.
  let linkedBill: { vendor_name: string | null; total: number; lines: number } | null = null;

  switch (action) {
    case 'corporate': {
      // The approver is stamped server-side from the authenticated session,
      // not taken from the request body, so it can't be spoofed.
      const note = `${reason || 'Marked corporate from reconciliation'} · approved by ${actor}`;
      brexUpdates.is_corporate = true;
      brexUpdates.corporate_at = nowIso;
      brexUpdates.corporate_note = note;
      brexUpdates.corporate_by = actor;
      brexUpdates.match_status = 'corporate';
      mercuryUpdates.is_corporate = true;
      mercuryUpdates.corporate_at = nowIso;
      mercuryUpdates.corporate_note = note;
      mercuryUpdates.corporate_by = actor;
      break;
    }
    case 'match': {
      // If the client didn't pass an explicit bill_id, re-query AppFolio
      // (our synced af_bill_detail table) at click time to auto-resolve
      // the match. Returns 409 if there's still no AF bill covering this
      // Brex/Mercury row — the UI can leave it on the queue and try again
      // after the next AppFolio sync.
      let resolvedBillId = matched_af_bill_id;

      if (resolvedBillId) {
        // Manual override. Verify the bill actually exists before recording
        // the link — otherwise a typo'd id silently clears the row off the
        // queue and points at nothing. The bill's vendor/total go back to the
        // client so the user can see what they just linked to.
        const { data: lines, error: billErr } = await supabaseAdmin
          .from('af_bill_detail')
          .select('vendor_name, amount, bill_date, paid_date')
          .eq('bill_id', String(resolvedBillId));
        if (billErr) return NextResponse.json({ error: billErr.message }, { status: 500 });
        if (!lines || lines.length === 0) {
          return NextResponse.json({
            error: `No AppFolio bill #${resolvedBillId} exists in our synced bill data. Double-check the bill id, or wait for the next AppFolio sync if it was just entered.`,
            bad_bill_id: true,
          }, { status: 404 });
        }
        linkedBill = {
          vendor_name: lines[0].vendor_name ?? null,
          total: lines.reduce((s: number, l: { amount: number | null }) => s + Number(l.amount ?? 0), 0),
          lines: lines.length,
        };
      } else {
        const { data: found, error: findErr } = await supabaseAdmin
          .rpc('find_af_match', { p_source: source, p_source_id: source_id });
        if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
        const hit = Array.isArray(found) ? found[0] : found;
        if (!hit?.matched_bill_id) {
          return NextResponse.json({
            error: 'No AppFolio bill covers this transaction yet. It will drop off automatically the next time an AF bill lands that matches.',
            no_match: true,
          }, { status: 409 });
        }
        resolvedBillId = hit.matched_bill_id;
      }

      if (source === 'brex') {
        const n = Number(resolvedBillId);
        if (!Number.isFinite(n)) {
          return NextResponse.json({ error: 'AF bill_id is non-numeric — cannot store on brex_expenses.matched_bill_id (int)' }, { status: 400 });
        }
        brexUpdates.matched_bill_id = n;
        brexUpdates.matched_at = nowIso;
        brexUpdates.matched_by = actor;
        brexUpdates.match_status = matched_af_bill_id ? 'matched_manual' : 'matched_auto';
      } else {
        mercuryUpdates.matched_bill_id = resolvedBillId;
        mercuryUpdates.matched_at = nowIso;
        mercuryUpdates.matched_by = actor;
      }
      break;
    }
    case 'dismiss':
      // Both sides: use dismissed_at + reason (Brex has corporate flags we reuse loosely
      // via corporate_note; Mercury has its own columns)
      brexUpdates.is_corporate = true;
      brexUpdates.corporate_at = nowIso;
      brexUpdates.corporate_note = `[DISMISSED by ${actor}] ${reason || 'no reason'}`;
      brexUpdates.match_status = 'dismissed';
      mercuryUpdates.dismissed_at = nowIso;
      mercuryUpdates.dismissed_reason = reason || 'no reason';
      break;
    case 'flag':
      // "I don't know what this is — escalate." Distinct from dismiss.
      // Pushes a FLAGGED memo to Brex so a reviewer can see it in-app.
      brexUpdates.flagged_at = nowIso;
      brexUpdates.flagged_reason = reason || 'Unknown — needs review';
      brexUpdates.flagged_by = actor;
      brexUpdates.match_status = 'flagged';
      // The BREX memo push branch below reads corporate_note as its source;
      // reuse that here so we don't need a second push code path.
      brexUpdates.corporate_note = `[FLAGGED by ${actor}] ${reason || 'unknown — please review'}`;
      mercuryUpdates.flagged_at = nowIso;
      mercuryUpdates.flagged_reason = reason || 'Unknown — needs review';
      mercuryUpdates.flagged_by = actor;
      break;
    case 'undo':
      brexUpdates.is_corporate = false;
      brexUpdates.corporate_at = null;
      brexUpdates.corporate_note = null;
      brexUpdates.corporate_by = null;
      brexUpdates.matched_bill_id = null;
      brexUpdates.matched_at = null;
      brexUpdates.matched_by = null;
      brexUpdates.match_status = 'unmatched';
      brexUpdates.flagged_at = null;
      brexUpdates.flagged_reason = null;
      brexUpdates.flagged_by = null;
      mercuryUpdates.is_corporate = false;
      mercuryUpdates.corporate_at = null;
      mercuryUpdates.corporate_note = null;
      mercuryUpdates.corporate_by = null;
      mercuryUpdates.matched_bill_id = null;
      mercuryUpdates.matched_at = null;
      mercuryUpdates.matched_by = null;
      mercuryUpdates.dismissed_at = null;
      mercuryUpdates.dismissed_reason = null;
      mercuryUpdates.flagged_at = null;
      mercuryUpdates.flagged_reason = null;
      mercuryUpdates.flagged_by = null;
      break;
    default:
      return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  }

  if (source === 'brex') {
    // For every action that surfaces a memo inside Brex (corporate, dismiss,
    // match), push to Brex first — if the API call fails we don't mutate our
    // DB, so the row stays actionable in the UI.
    let memoToPush = '';
    if (action === 'corporate' || action === 'dismiss' || action === 'flag') {
      memoToPush = (brexUpdates.corporate_note as string | undefined) ?? '';
    } else if (action === 'match') {
      memoToPush = billedToAfMemo(brexUpdates.matched_bill_id as number);
    }

    if (memoToPush) {
      // Need the expense_id (not the raw brex_id) to PUT.
      const { data: exp, error: expErr } = await supabase
        .from('brex_expenses')
        .select('expense_id')
        .eq('brex_id', source_id)
        .maybeSingle();
      if (expErr) return NextResponse.json({ error: expErr.message }, { status: 500 });
      if (!exp?.expense_id) {
        return NextResponse.json({
          error: 'No enriched expense_id for this transaction — cannot push to Brex. Run sync-brex enrichment or mark it inside Brex directly.',
        }, { status: 409 });
      }
      const brexErr = await pushBrexMemo(exp.expense_id, memoToPush);
      if (brexErr) return NextResponse.json({ error: `Push to Brex failed — ${brexErr}` }, { status: 502 });
    }

    // brex_expenses has SELECT-only RLS — use the service-role client so
    // the row actually updates. Also verify a row was hit so we don't
    // silently no-op when the brex_id doesn't match anything.
    const { data: updated, error } = await supabaseAdmin
      .from('brex_expenses')
      .update(brexUpdates)
      .eq('brex_id', source_id)
      .select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: `No brex_expenses row for source_id=${source_id}` }, { status: 404 });
    }
  } else {
    // mercury_transactions also has SELECT-only RLS.
    const { data: updated, error } = await supabaseAdmin
      .from('mercury_transactions')
      .update(mercuryUpdates)
      .eq('id', source_id)
      .select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: `No mercury_transactions row for source_id=${source_id}` }, { status: 404 });
    }
  }

  const matchedBillId = (brexUpdates.matched_bill_id ?? mercuryUpdates.matched_bill_id) as string | number | null | undefined;
  return NextResponse.json({
    ok: true,
    source,
    source_id,
    action,
    matched_bill_id: matchedBillId ?? null,
    af_link: matchedBillId ? `https://appreciateinc.appfolio.com/accounting/payable_invoices/${matchedBillId}` : null,
    linked_bill: linkedBill,
  });
}
