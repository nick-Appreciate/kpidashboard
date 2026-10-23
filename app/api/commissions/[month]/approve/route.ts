import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';
import { computeMonth, loadPlanAndPayees } from '../../../../../lib/commissions';

export const dynamic = 'force-dynamic';

// Approve a finished month: freeze the computed run (bills, occupancy,
// multiplier, per-person lines) so later AppFolio edits can't change it.
export async function POST(request: Request, { params }: { params: { month: string } }) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;
  const month = params.month;
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'Month must be YYYY-MM' }, { status: 400 });

  try {
    const { data: existing } = await supabase.from('commission_runs').select('month').eq('month', `${month}-01`).maybeSingle();
    if (existing) return NextResponse.json({ error: `${month} is already approved` }, { status: 409 });

    const run = await computeMonth(supabase, month, await loadPlanAndPayees(supabase));
    if (run.status !== 'ready') return NextResponse.json({ error: `${month} hasn't ended yet` }, { status: 400 });

    const { error } = await supabase.from('commission_runs').insert({
      month: `${month}-01`,
      gross: run.gross,
      occupancy_pct: run.occupancy_pct ?? 0,
      multiplier: run.multiplier,
      net: run.net,
      lines: run.lines,
      items: run.items,
      status: 'approved',
      approved_by: auth.appUser.name || auth.appUser.email,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, month, net: run.net, lines: run.lines });
  } catch (err: any) {
    console.error('commissions approve:', err);
    return NextResponse.json({ error: err?.message || 'Approval failed' }, { status: 500 });
  }
}
