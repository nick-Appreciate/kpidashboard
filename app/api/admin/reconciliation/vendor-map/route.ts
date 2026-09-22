import { NextResponse } from 'next/server';
import { requirePage } from '../../../../../lib/auth';
import { fetchAllRows } from '../../../../../lib/supabase-paging';
// @ts-ignore — supabase.js is untyped JS
import { supabaseAdmin } from '../../../../../lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/admin/reconciliation/vendor-map
 *   Returns every AppFolio vendor plus, for each, which merchant already
 *   claims it. The picker uses `claimed_by` to grey out vendors that belong
 *   to a different merchant — one vendor maps to one merchant.
 *   Also returns the existing mappings so the UI can show current selections.
 *
 * POST /api/admin/reconciliation/vendor-map
 *   Body: { merchant, vendor_id, source? }
 *   Upserts the mapping for that merchant. Passing vendor_id: null clears it.
 *   Re-pointing a merchant at a vendor another merchant holds is rejected —
 *   the caller should clear that one first, so the reassignment is deliberate.
 */
export async function GET(request: Request) {
  const auth = await requirePage(request, 'bookkeeping');
  if ('error' in auth) return auth.error;

  const [{ data: vendors, error: vErr }, { data: maps, error: mErr }] = await Promise.all([
    fetchAllRows<{ vendor_id: string; name: string | null; company_name: string | null }>(() =>
      supabaseAdmin
        .from('af_vendor_directory')
        .select('vendor_id, name, company_name')
        .not('vendor_id', 'is', null),
    ),
    fetchAllRows<{ merchant_key: string; merchant_example: string; vendor_id: string; vendor_name: string }>(() =>
      supabaseAdmin
        .from('merchant_vendor_map')
        .select('merchant_key, merchant_example, vendor_id, vendor_name'),
    ),
  ]);
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const claimedBy = new Map<string, string>();
  for (const m of maps ?? []) claimedBy.set(m.vendor_id, m.merchant_example);

  // Collapse to one entry per display name; AppFolio has a few near-duplicate
  // vendor rows and showing both in a picker is just noise.
  const seen = new Set<string>();
  const options = (vendors ?? [])
    .map(v => ({
      vendor_id: v.vendor_id,
      vendor_name: (v.company_name?.trim() || v.name?.trim() || '').trim(),
      claimed_by: claimedBy.get(v.vendor_id) ?? null,
    }))
    .filter(v => {
      if (!v.vendor_name) return false;
      const k = v.vendor_name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.vendor_name.localeCompare(b.vendor_name));

  return NextResponse.json({ vendors: options, mappings: maps ?? [] });
}

export async function POST(request: Request) {
  const auth = await requirePage(request, 'bookkeeping');
  if ('error' in auth) return auth.error;
  const actor = auth.user?.email || 'unknown';

  const body = await request.json();
  const { merchant, vendor_id, source } = body as {
    merchant?: string;
    vendor_id?: string | null;
    source?: string;
  };

  if (!merchant?.trim()) {
    return NextResponse.json({ error: 'merchant is required' }, { status: 400 });
  }

  // Same normalisation the RPC joins on.
  const { data: keyRows, error: keyErr } = await supabaseAdmin.rpc('_norm_v', { s: merchant });
  if (keyErr) return NextResponse.json({ error: keyErr.message }, { status: 500 });
  const merchantKey = typeof keyRows === 'string' ? keyRows : String(keyRows ?? '').trim();
  if (!merchantKey) {
    return NextResponse.json({ error: 'merchant normalised to an empty key' }, { status: 400 });
  }

  // Clearing the mapping.
  if (!vendor_id) {
    const { error } = await supabaseAdmin
      .from('merchant_vendor_map')
      .delete()
      .eq('merchant_key', merchantKey);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, merchant, vendor_id: null });
  }

  const { data: vendor, error: vErr } = await supabaseAdmin
    .from('af_vendor_directory')
    .select('vendor_id, name, company_name')
    .eq('vendor_id', vendor_id)
    .maybeSingle();
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  if (!vendor) return NextResponse.json({ error: `Unknown vendor_id ${vendor_id}` }, { status: 404 });

  // Refuse to silently steal a vendor from another merchant.
  const { data: holder, error: hErr } = await supabaseAdmin
    .from('merchant_vendor_map')
    .select('merchant_key, merchant_example')
    .eq('vendor_id', vendor_id)
    .maybeSingle();
  if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });
  if (holder && holder.merchant_key !== merchantKey) {
    return NextResponse.json({
      error: `That vendor is already mapped to "${holder.merchant_example}". Clear it there first.`,
      already_claimed: true,
    }, { status: 409 });
  }

  const vendorName = (vendor.company_name?.trim() || vendor.name?.trim() || vendor_id) as string;
  const { error } = await supabaseAdmin
    .from('merchant_vendor_map')
    .upsert({
      merchant_key: merchantKey,
      merchant_example: merchant.trim(),
      vendor_id,
      vendor_name: vendorName,
      source: source ?? null,
      mapped_by: actor,
      mapped_at: new Date().toISOString(),
    }, { onConflict: 'merchant_key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, merchant, vendor_id, vendor_name: vendorName });
}
