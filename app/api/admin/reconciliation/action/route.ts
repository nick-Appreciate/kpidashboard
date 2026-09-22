import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const body = await request.json();
  const { source, source_id, action, matched_af_bill_id, reason } = body as {
    source: 'brex' | 'mercury';
    source_id: string;
    action: 'corporate' | 'match' | 'dismiss' | 'undo';
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

  switch (action) {
    case 'corporate':
      brexUpdates.is_corporate = true;
      brexUpdates.corporate_at = nowIso;
      brexUpdates.corporate_note = reason || 'Marked corporate from reconciliation';
      brexUpdates.match_status = 'corporate';
      mercuryUpdates.is_corporate = true;
      mercuryUpdates.corporate_at = nowIso;
      mercuryUpdates.corporate_note = reason || 'Marked corporate from reconciliation';
      break;
    case 'match':
      if (!matched_af_bill_id) {
        return NextResponse.json({ error: 'matched_af_bill_id required for match action' }, { status: 400 });
      }
      // brex_expenses.matched_bill_id is integer; only accept numeric AF bill_ids for Brex
      if (source === 'brex') {
        const n = Number(matched_af_bill_id);
        if (!Number.isFinite(n)) {
          return NextResponse.json({ error: 'matched_af_bill_id must be numeric for Brex' }, { status: 400 });
        }
        brexUpdates.matched_bill_id = n;
        brexUpdates.matched_at = nowIso;
        brexUpdates.matched_by = actor;
        brexUpdates.match_status = 'matched_manual';
      } else {
        mercuryUpdates.matched_bill_id = matched_af_bill_id;
        mercuryUpdates.matched_at = nowIso;
        mercuryUpdates.matched_by = actor;
      }
      break;
    case 'dismiss':
      // Both sides: use dismissed_at + reason (Brex has corporate flags we reuse loosely
      // via corporate_note; Mercury has its own columns)
      brexUpdates.is_corporate = true;
      brexUpdates.corporate_at = nowIso;
      brexUpdates.corporate_note = `[DISMISSED] ${reason || 'no reason'}`;
      brexUpdates.match_status = 'dismissed';
      mercuryUpdates.dismissed_at = nowIso;
      mercuryUpdates.dismissed_reason = reason || 'no reason';
      break;
    case 'undo':
      brexUpdates.is_corporate = false;
      brexUpdates.corporate_at = null;
      brexUpdates.corporate_note = null;
      brexUpdates.matched_bill_id = null;
      brexUpdates.matched_at = null;
      brexUpdates.matched_by = null;
      brexUpdates.match_status = 'unmatched';
      mercuryUpdates.is_corporate = false;
      mercuryUpdates.corporate_at = null;
      mercuryUpdates.corporate_note = null;
      mercuryUpdates.matched_bill_id = null;
      mercuryUpdates.matched_at = null;
      mercuryUpdates.matched_by = null;
      mercuryUpdates.dismissed_at = null;
      mercuryUpdates.dismissed_reason = null;
      break;
    default:
      return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  }

  if (source === 'brex') {
    const { error } = await supabase
      .from('brex_expenses')
      .update(brexUpdates)
      .eq('brex_id', source_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from('mercury_transactions')
      .update(mercuryUpdates)
      .eq('id', Number(source_id));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, source, source_id, action });
}
