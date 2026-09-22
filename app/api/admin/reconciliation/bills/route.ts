import { NextResponse } from 'next/server';
import { requirePage } from '../../../../../lib/auth';
// @ts-ignore — supabase.js is untyped JS
import { supabaseAdmin } from '../../../../../lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SINCE = '2026-01-01';

/**
 * Accept either a full AppFolio payable-invoice URL — what you get by copying
 * the address bar with the bill open — or a bare bill number.
 *   https://appreciateinc.appfolio.com/accounting/payable_invoices/26069
 * Anchored on the payable_invoices segment so a stray number in a query string
 * can't be mistaken for the bill id. Returns null rather than guessing.
 */
function parseAfBillId(input: string): string | null {
  const raw = input.trim();
  if (/^\d+$/.test(raw)) return raw;
  const m = raw.match(/payable_invoices\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * GET /api/admin/reconciliation/bills?vendor=<name>
 *   Unclaimed AppFolio bills for that vendor since 2026-01-01, for the
 *   expand-a-row picker.
 *
 * POST /api/admin/reconciliation/bills
 *   Body: { source, source_id, bill_ids: string[] }
 *   Links several bills to one charge. The selected bills must sum to the
 *   charge amount exactly — a partial match would quietly understate the
 *   outstanding balance, which is the whole thing this queue exists to
 *   measure, so it's rejected rather than rounded.
 */
export async function GET(request: Request) {
  const auth = await requirePage(request, 'bookkeeping');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const vendor = searchParams.get('vendor');
  if (!vendor) return NextResponse.json({ error: 'vendor is required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .rpc('unclaimed_bills_for_vendor', { p_vendor_name: vendor, p_since: SINCE });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ vendor, since: SINCE, bills: data ?? [] });
}

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

export async function POST(request: Request) {
  const auth = await requirePage(request, 'bookkeeping');
  if ('error' in auth) return auth.error;
  const actor = auth.user?.email || 'unknown';

  const body = await request.json();
  const { source, source_id, bill_ids } = body as {
    source?: 'brex' | 'mercury';
    source_id?: string;
    bill_ids?: string[];
  };

  if (!source || !source_id || !Array.isArray(bill_ids) || bill_ids.length === 0) {
    return NextResponse.json({ error: 'source, source_id and a non-empty bill_ids are required' }, { status: 400 });
  }

  // Entries arrive either as bare ids (checkbox picker) or as pasted AppFolio
  // URLs (manual link box, which allows several separated by commas).
  const parsed = bill_ids.map(raw => ({ raw: String(raw), id: parseAfBillId(String(raw)) }));
  const unparseable = parsed.filter(p => !p.id);
  if (unparseable.length > 0) {
    return NextResponse.json({
      error: `Not a valid AppFolio bill link or number: ${unparseable.map(p => p.raw).join(', ')}`,
      bad_bill_id: true,
    }, { status: 400 });
  }
  const ids = Array.from(new Set(parsed.map(p => p.id as string)));

  // What are we trying to cover?
  let chargeAmount: number | null = null;
  let brexExpenseId: string | null = null;
  if (source === 'brex') {
    const { data, error } = await supabaseAdmin
      .from('brex_expenses')
      .select('amount, expense_id')
      .eq('brex_id', source_id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: `No brex_expenses row for ${source_id}` }, { status: 404 });
    chargeAmount = Number(data.amount);
    brexExpenseId = data.expense_id ?? null;
  } else {
    const { data, error } = await supabaseAdmin
      .from('mercury_transactions')
      .select('amount')
      .eq('id', source_id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: `No mercury_transactions row for ${source_id}` }, { status: 404 });
    chargeAmount = Math.abs(Number(data.amount));
  }

  // Sum the selected bills from source data rather than trusting the client.
  const { data: lines, error: lErr } = await supabaseAdmin
    .from('af_bill_detail')
    .select('bill_id, amount, vendor_name')
    .in('bill_id', ids);
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });

  const foundIds = new Set((lines ?? []).map((l: { bill_id: string }) => l.bill_id));
  const missing = ids.filter(id => !foundIds.has(id));
  if (missing.length > 0) {
    return NextResponse.json({ error: `Unknown bill id(s): ${missing.join(', ')}` }, { status: 404 });
  }

  const billTotal = (lines ?? []).reduce(
    (s: number, l: { amount: number | null }) => s + Number(l.amount ?? 0), 0,
  );

  // Compare in cents so floating point can't make an exact match look off.
  const cents = (n: number) => Math.round(n * 100);
  if (cents(billTotal) !== cents(chargeAmount!)) {
    return NextResponse.json({
      error: `Selected bills total $${billTotal.toFixed(2)} but the charge is $${chargeAmount!.toFixed(2)}. They must match exactly.`,
      bill_total: billTotal,
      charge_amount: chargeAmount,
      amount_mismatch: true,
    }, { status: 409 });
  }

  // Brex memo first — if it fails we leave the row untouched and actionable.
  if (source === 'brex' && brexExpenseId) {
    const shown = ids.slice(0, 4).map(i => `#${i}`).join(', ');
    const extra = ids.length > 4 ? ` +${ids.length - 4} more` : '';
    const memo = `Billed · Property Expense · AppFolio Bill${ids.length > 1 ? 's' : ''} ${shown}${extra}`
      + ` · https://appreciateinc.appfolio.com/accounting/payable_invoices/${ids[0]}`;
    const err = await pushBrexMemo(brexExpenseId, memo);
    if (err) return NextResponse.json({ error: `Push to Brex failed — ${err}` }, { status: 502 });
  }

  const perBill = new Map<string, number>();
  for (const l of lines ?? []) {
    perBill.set(l.bill_id, (perBill.get(l.bill_id) ?? 0) + Number(l.amount ?? 0));
  }

  const { error: insErr } = await supabaseAdmin
    .from('reconciliation_bill_links')
    .insert(ids.map(id => ({
      source,
      source_id,
      bill_id: id,
      amount: perBill.get(id) ?? null,
      linked_by: actor,
    })));
  if (insErr) {
    // bill_id is UNIQUE — a race or a stale picker means someone already took it.
    if (insErr.code === '23505') {
      return NextResponse.json({
        error: 'One of those bills was just claimed by another match. Refresh and try again.',
      }, { status: 409 });
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  if (source === 'brex') {
    await supabaseAdmin
      .from('brex_expenses')
      .update({ match_status: 'matched_manual', matched_at: new Date().toISOString(), matched_by: actor, updated_at: new Date().toISOString() })
      .eq('brex_id', source_id);
  } else {
    await supabaseAdmin
      .from('mercury_transactions')
      .update({ matched_at: new Date().toISOString(), matched_by: actor })
      .eq('id', source_id);
  }

  const vendorName = (lines ?? []).map((l: { vendor_name: string | null }) => l.vendor_name).find(Boolean) ?? null;
  return NextResponse.json({
    ok: true,
    source,
    source_id,
    bill_ids: ids,
    bill_total: billTotal,
    vendor_name: vendorName,
  });
}
