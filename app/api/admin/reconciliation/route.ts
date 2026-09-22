import { NextResponse } from 'next/server';
import { requirePage } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = await requirePage(request, 'bookkeeping');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const since = searchParams.get('since') || '2026-01-01';

  const { data, error } = await auth.supabase
    .rpc('reconciliation_unmatched', { since_date: since });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    since,
    count: data?.length ?? 0,
    total_amount: (data ?? []).reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0),
    items: data ?? [],
  });
}
