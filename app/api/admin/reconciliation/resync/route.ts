import { NextResponse } from 'next/server';
import { requirePage } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// sync-brex paginates the Brex API; give it room rather than relying on the
// platform default (Vercel clamps this down if the plan allows less).
export const maxDuration = 60;

/**
 * POST /api/admin/reconciliation/resync
 *
 * Pulls fresh data on demand instead of waiting for the cron. Invokes the
 * sync-brex and sync-mercury edge functions in parallel and reports each
 * one's outcome independently — a failure in one doesn't block the other,
 * so a Brex token problem still lets Mercury refresh.
 *
 * The client calls this before re-reading reconciliation_unmatched, so the
 * queue reflects transactions that landed since the last scheduled sync.
 */
async function invokeEdgeFunction(name: string): Promise<{ name: string; ok: boolean; detail: unknown }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { name, ok: false, detail: 'Supabase URL or service role key not configured' };
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
    });
    const body = await res.json().catch(() => ({}));
    return { name, ok: res.ok, detail: res.ok ? body : (body?.error ?? `HTTP ${res.status}`) };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function POST(request: Request) {
  const auth = await requirePage(request, 'bookkeeping');
  if ('error' in auth) return auth.error;

  const results = await Promise.all([
    invokeEdgeFunction('sync-brex'),
    invokeEdgeFunction('sync-mercury'),
  ]);

  const failed = results.filter(r => !r.ok);
  return NextResponse.json({
    ok: failed.length === 0,
    results,
  }, { status: failed.length === results.length ? 502 : 200 });
}
