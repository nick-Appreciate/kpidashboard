/**
 * GET /api/admin/time-cards?days=14
 *
 * Returns per-tracked-tech daily rollup for the requested window.
 * Pulls from v_time_card_daily (joins Rippling clocked + AppFolio billed).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/auth';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const { searchParams } = new URL(req.url);
  const days = Math.min(parseInt(searchParams.get('days') || '14', 10) || 14, 730);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Pull tracked workers + day rollup
  const [{ data: workers, error: wErr }, { data: rows, error: rErr }] = await Promise.all([
    supabase
      .from('workers_rippling')
      .select('worker_id, name, work_email, status')
      .eq('is_tracked', true)
      .order('name'),
    supabase
      .from('v_time_card_daily')
      .select('technician, day, clocked_hours, billed_hours, unbilled_hours, billed_pct, shifts, work_orders')
      .gte('day', since)
      .order('day', { ascending: false }),
  ]);

  if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 });
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  return NextResponse.json({
    days,
    since,
    workers: workers || [],
    rows: rows || [],
  });
}
