import { NextResponse } from 'next/server';
import { requirePage } from '../../../../lib/auth';
import { fetchAllRows } from '../../../../lib/supabase-paging';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = await requirePage(request, 'bookkeeping');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const since = searchParams.get('since') || '2026-01-01';

  const [{ data, error }, { data: variances, error: vErr }] = await Promise.all([
    auth.supabase.rpc('reconciliation_unmatched', { since_date: since }),
    // Every link recorded with a non-zero variance is money we paid that the
    // AppFolio bill never carried — card/ACH convenience fees, almost always.
    // Summed here so the queue can show the running leakage.
    fetchAllRows<{ source: string; source_id: string; variance: number }>(() =>
      auth.supabase
        .from('reconciliation_bill_links')
        .select('source, source_id, variance')
        .neq('variance', 0),
    ),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // variance is stored per link row but is a property of the match group, so
  // collapse to one value per charge before summing.
  const perCharge = new Map<string, number>();
  for (const v of variances ?? []) {
    perCharge.set(`${v.source}:${v.source_id}`, Number(v.variance));
  }
  const feeLeakage = Array.from(perCharge.values()).reduce((s, v) => s + Math.abs(v), 0);

  return NextResponse.json({
    since,
    count: data?.length ?? 0,
    total_amount: (data ?? []).reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0),
    fee_leakage: feeLeakage,
    fee_leakage_count: perCharge.size,
    fee_leakage_error: vErr ? String(vErr.message ?? vErr) : null,
    items: data ?? [],
  });
}
