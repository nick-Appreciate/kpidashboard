import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';
import { fromRun, ripplingCsv } from '../../../../../lib/commissions';

export const dynamic = 'force-dynamic';

// One-time "Commission" earnings for an approved month, for Rippling's
// payroll import. Only approved (frozen) runs can be exported.
export async function GET(request: Request, { params }: { params: { month: string } }) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const { data: run, error } = await auth.supabase
    .from('commission_runs')
    .select('month, gross, occupancy_pct, multiplier, net, lines, items, status, approved_by, approved_at')
    .eq('month', `${params.month}-01`)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!run) return NextResponse.json({ error: `${params.month} hasn't been approved` }, { status: 404 });

  return new NextResponse(ripplingCsv(fromRun(run)), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="commissions-${params.month}-rippling.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
