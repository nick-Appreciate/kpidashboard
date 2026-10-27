import { NextResponse } from 'next/server';
import { requirePage } from '../../../lib/auth';
import { computeMonth, fromRun, loadPlanAndPayees, type CommissionMonth } from '../../../lib/commissions';

export const dynamic = 'force-dynamic';

// Monthly commission runs, newest first: approved months come frozen from
// commission_runs, the rest are computed live from AppFolio.
export async function GET(request: Request) {
  const auth = await requirePage(request, 'commissions');
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { searchParams } = new URL(request.url);
    const count = Math.min(Math.max(parseInt(searchParams.get('months') || '12', 10) || 12, 1), 24);

    const ctx = await loadPlanAndPayees(supabase);
    const earliest = ctx.plans[0]?.effective_from?.slice(0, 7);
    const now = new Date();
    const months: string[] = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const m = d.toISOString().slice(0, 7);
      if (earliest && m < earliest) break;
      months.push(m);
    }

    const { data: runs, error } = await supabase
      .from('commission_runs')
      .select('month, gross, occupancy_pct, multiplier, net, lines, items, status, approved_by, approved_at')
      .in('month', months.map((m) => `${m}-01`));
    if (error) throw new Error(error.message);
    const frozen = new Map((runs || []).map((r: any) => [String(r.month).slice(0, 7), r]));

    const result: CommissionMonth[] = await Promise.all(
      months.map((m) => (frozen.has(m) ? fromRun(frozen.get(m)) : computeMonth(supabase, m, ctx))),
    );

    return NextResponse.json(
      { months: result, payees: ctx.payees, isAdmin: auth.appUser.role === 'admin' },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err: any) {
    console.error('commissions:', err);
    return NextResponse.json({ error: err?.message || 'Failed to load commissions' }, { status: 500 });
  }
}
