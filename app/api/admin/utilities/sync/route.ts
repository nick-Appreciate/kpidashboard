/**
 * POST /api/admin/utilities/sync
 *
 * Manually trigger a Utilities sync (BPU + COMO meter scrape) and return a
 * sync_runs row id the UI can subscribe to via Supabase Realtime for live
 * progress.
 *
 * Flow:
 *   1. Insert a `sync_runs` row (status=pending, source='utilities',
 *      stats._expected listing which services we plan to trigger).
 *   2. Call the sync-bpu edge function with run_id.
 *   3. Update the row with which services were actually triggered (so the
 *      finalize trigger knows what to wait for).
 *   4. Return { run_id }. The bot writes progress + final stats per service;
 *      the DB trigger flips status → completed/partial/failed when all
 *      expected services have reported in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../../../../lib/auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey   = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  // Utilities is in the "Administrative" sidebar group — open to any
  // authenticated app user. Only "Private" tabs are admin-only.
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;

  // We use the service-role client to write sync_runs and call sync-bpu so
  // it works regardless of the caller's role.
  const sbAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  // Optional body: { days?: number, dry_run?: boolean }
  let days = 14;
  let dryRun = false;
  try {
    const body = await req.json();
    if (typeof body?.days === 'number' && body.days > 0) days = body.days;
    if (typeof body?.dry_run === 'boolean') dryRun = body.dry_run;
  } catch { /* no body */ }

  // 1) Create the sync_runs row. We'll fill in _expected once we know which
  //    services the bot will accept (health check happens in sync-bpu).
  const { data: run, error: insErr } = await sbAdmin
    .from('sync_runs')
    .insert({
      source: 'utilities',
      status: 'pending',
      current_step: 'Triggering bot…',
      triggered_by: auth.appUser.email,
      stats: {},
    })
    .select('id')
    .single();

  if (insErr || !run) {
    return NextResponse.json({ error: insErr?.message || 'failed to create sync run' }, { status: 500 });
  }

  const runId = run.id as string;

  // 2) Call sync-bpu with run_id. sync-bpu does its own health check and
  //    only fires the services that are logged in — we mirror that decision
  //    into _expected below based on its response.
  let bpuTrigger: any = null;
  let comoTrigger: any = null;
  let edgeError: string | null = null;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/sync-bpu`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ days, dry_run: dryRun, run_id: runId }),
    });
    const j = await res.json();
    bpuTrigger  = j?.bpu  ?? null;
    comoTrigger = j?.como ?? null;
    if (!res.ok) edgeError = j?.error || `sync-bpu HTTP ${res.status}`;
  } catch (e: any) {
    edgeError = e?.message || String(e);
  }

  const expected: string[] = [];
  if (bpuTrigger?.triggered)  expected.push('bpu');
  if (comoTrigger?.triggered) expected.push('como');

  // 3) Update the run with triggered services + log entries. If neither
  //    service got triggered we mark the run failed right here so the UI
  //    doesn't hang forever waiting on subruns that never happen.
  if (expected.length === 0) {
    const errMsg = edgeError
      || `Nothing triggered. BPU: ${bpuTrigger?.error || 'n/a'} | COMO: ${comoTrigger?.error || 'n/a'}`;
    await sbAdmin.rpc('append_sync_log', {
      p_run_id: runId,
      p_service: 'meta',
      p_level: 'error',
      p_message: errMsg,
      p_progress_pct: 100,
      p_current_step: 'Bot trigger failed',
    });
    await sbAdmin.from('sync_runs').update({
      status: 'failed',
      ended_at: new Date().toISOString(),
      error: errMsg,
    }).eq('id', runId);
    return NextResponse.json({ run_id: runId, error: errMsg }, { status: 502 });
  }

  // Bot is now scraping in the background. Log what was triggered + record
  // which services the finalize trigger should wait for. Use append_sync_log
  // (atomic) so we don't clobber log lines the bot has already written —
  // the bot's background work may start *before* this update lands.
  await sbAdmin.rpc('set_sync_run_expected', {
    p_run_id: runId,
    p_expected: expected,
  });
  await sbAdmin.rpc('append_sync_log', {
    p_run_id: runId,
    p_service: 'meta',
    p_level: 'info',
    p_message: `Triggered: ${expected.map(s => s.toUpperCase()).join(' + ')}`,
    p_progress_pct: 5,
    p_current_step: `Scraping ${expected.map(s => s.toUpperCase()).join(' + ')}…`,
  });
  if (bpuTrigger && !bpuTrigger.triggered) {
    await sbAdmin.rpc('append_sync_log', {
      p_run_id: runId, p_service: 'bpu', p_level: 'warn',
      p_message: `BPU skipped — ${bpuTrigger.error || 'unknown reason'}`,
      p_progress_pct: null, p_current_step: null,
    });
  }
  if (comoTrigger && !comoTrigger.triggered) {
    await sbAdmin.rpc('append_sync_log', {
      p_run_id: runId, p_service: 'como', p_level: 'warn',
      p_message: `COMO skipped — ${comoTrigger.error || 'unknown reason'}`,
      p_progress_pct: null, p_current_step: null,
    });
  }

  return NextResponse.json({
    run_id: runId,
    expected,
    bpu:  bpuTrigger,
    como: comoTrigger,
  });
}
