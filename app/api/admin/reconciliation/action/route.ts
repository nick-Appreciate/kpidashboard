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

export async function POST(request: Request) {
  const auth = await requirePage(request, 'bookkeeping');
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const body = await request.json();
  const { source, source_id, action, reason } = body as {
    source: 'brex' | 'mercury';
    source_id: string;
    action: 'corporate' | 'flag' | 'dismiss' | 'undo';
    reason?: string;
  };

  if (!source || !source_id || !action) {
    return NextResponse.json({ error: 'source, source_id, and action are required' }, { status: 400 });
  }

  // Dismiss buries a charge without either billing it back or classifying it,
  // so it's the one action that needs more than bookkeeping access.
  if (action === 'dismiss' && auth.appUser?.role !== 'admin') {
    return NextResponse.json({ error: 'Dismiss requires an admin role.' }, { status: 403 });
  }

  const actor = auth.user?.email || 'unknown';
  const nowIso = new Date().toISOString();

  const brexUpdates: Record<string, unknown> = { updated_at: nowIso };
  const mercuryUpdates: Record<string, unknown> = {};
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
    case 'dismiss':
      brexUpdates.dismissed_at = nowIso;
      brexUpdates.dismissed_reason = reason || 'No reason given';
      brexUpdates.dismissed_by = actor;
      brexUpdates.match_status = 'dismissed';
      // The Brex memo push below reads corporate_note as its source; reuse it
      // rather than adding a parallel code path. is_corporate stays false —
      // a dismissal is not a corporate classification.
      brexUpdates.corporate_note = `[DISMISSED by ${actor}] ${reason || 'no reason'}`;
      mercuryUpdates.dismissed_at = nowIso;
      mercuryUpdates.dismissed_reason = reason || 'No reason given';
      mercuryUpdates.dismissed_by = actor;
      break;
    case 'flag':
      // "I don't know what this is — escalate." Pushes a FLAGGED memo to
      // Brex so a reviewer can see it in-app.
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
      brexUpdates.dismissed_at = null;
      brexUpdates.dismissed_reason = null;
      brexUpdates.dismissed_by = null;
      mercuryUpdates.is_corporate = false;
      mercuryUpdates.corporate_at = null;
      mercuryUpdates.corporate_note = null;
      mercuryUpdates.corporate_by = null;
      mercuryUpdates.matched_bill_id = null;
      mercuryUpdates.matched_at = null;
      mercuryUpdates.matched_by = null;
      mercuryUpdates.flagged_at = null;
      mercuryUpdates.flagged_reason = null;
      mercuryUpdates.flagged_by = null;
      mercuryUpdates.dismissed_at = null;
      mercuryUpdates.dismissed_reason = null;
      mercuryUpdates.dismissed_by = null;
      break;
    default:
      return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  }

  if (source === 'brex') {
    // Corporate and flag both surface a memo inside Brex. Push it first — if
    // the API call fails we don't mutate our DB, so the row stays actionable.
    const memoToPush = (action === 'corporate' || action === 'flag' || action === 'dismiss')
      ? ((brexUpdates.corporate_note as string | undefined) ?? '')
      : '';

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

  return NextResponse.json({ ok: true, source, source_id, action });
}
