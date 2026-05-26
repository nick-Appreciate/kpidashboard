'use client';

/**
 * UtilitiesSyncCard
 *
 * "Sync Now" button + live progress feed for the Utilities page.
 *
 * Architecture:
 *   1. POST /api/admin/utilities/sync creates a sync_runs row and triggers
 *      the BPU/COMO scrape on the VPS bot.
 *   2. The bot writes progress checkpoints back to that row (step_logs,
 *      current_step, stats) via SECURITY DEFINER RPCs.
 *   3. This component subscribes to that row over Supabase Realtime and
 *      renders the log lines as they arrive.
 *   4. A Postgres trigger flips the row to completed/partial/failed once
 *      all expected subruns (BPU + COMO) report in.
 *
 * On mount we look up the most recent 'utilities' run so a refresh in the
 * middle of a sync still shows the live progress.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '../lib/supabase-browser';
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronRight } from 'lucide-react';

type SyncStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partial';

interface StepLog {
  ts: string;
  service?: 'bpu' | 'como' | 'meta';
  level?: 'info' | 'warn' | 'error';
  message: string;
}

interface SyncRun {
  id: string;
  source: string;
  status: SyncStatus;
  started_at: string;
  ended_at: string | null;
  progress_pct: number;
  current_step: string | null;
  step_logs: StepLog[];
  stats: Record<string, any>;
  error: string | null;
  triggered_by: string | null;
}

const STATUS_PILL: Record<SyncStatus, string> = {
  pending:   'bg-slate-500/15 text-slate-300 ring-1 ring-slate-500/40',
  running:   'bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/40',
  completed: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40',
  partial:   'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/50',
  failed:    'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/40',
};

function fmtClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtElapsed(start: string, end: string | null): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function UtilitiesSyncCard({ onComplete }: { onComplete?: () => void }) {
  const [run, setRun] = useState<SyncRun | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [, forceTick] = useState(0); // re-render every 1s so elapsed timer updates
  const completionFiredRef = useRef<string | null>(null);

  // Ticker — only when there's a live run
  useEffect(() => {
    if (!run || run.status !== 'running' && run.status !== 'pending') return;
    const id = setInterval(() => forceTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [run?.status]);

  // Load latest run on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabaseBrowser
        .from('sync_runs')
        .select('*')
        .eq('source', 'utilities')
        .order('started_at', { ascending: false })
        .limit(1);
      if (cancelled) return;
      const latest = (data?.[0] as SyncRun | undefined) ?? null;
      if (latest) {
        setRun(latest);
        // Expand by default if it's still running
        if (latest.status === 'running' || latest.status === 'pending') setExpanded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Realtime subscription — re-subscribes whenever run.id changes
  useEffect(() => {
    if (!run?.id) return;
    const channel = supabaseBrowser
      .channel(`sync_runs:${run.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sync_runs', filter: `id=eq.${run.id}` },
        (payload) => {
          setRun(prev => prev && prev.id === payload.new.id ? (payload.new as SyncRun) : prev);
        },
      )
      .subscribe();
    return () => { supabaseBrowser.removeChannel(channel); };
  }, [run?.id]);

  // Refresh the underlying dashboard data once a run completes successfully.
  useEffect(() => {
    if (!run || !onComplete) return;
    if (run.status !== 'completed' && run.status !== 'partial') return;
    if (completionFiredRef.current === run.id) return;
    completionFiredRef.current = run.id;
    onComplete();
  }, [run, onComplete]);

  const startSync = useCallback(async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/utilities/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 14 }),
      });
      const json = await res.json();
      if (!res.ok && !json?.run_id) {
        alert(`Sync failed: ${json?.error || `HTTP ${res.status}`}`);
        return;
      }
      // Fetch the row we just created — Realtime will take over from here.
      const { data: row } = await supabaseBrowser
        .from('sync_runs').select('*').eq('id', json.run_id).single();
      if (row) {
        setRun(row as SyncRun);
        setExpanded(true);
      }
    } catch (e: any) {
      alert(`Sync failed: ${e?.message || e}`);
    } finally {
      setSubmitting(false);
    }
  }, []);

  const isLive = run?.status === 'running' || run?.status === 'pending';
  const statusIcon = run ? statusIconFor(run.status) : null;

  return (
    <div className="glass-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-cyan-500/10 shrink-0">
            <RefreshCw className={`w-5 h-5 text-cyan-400 ${isLive ? 'animate-spin' : ''}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">Meter sync</h3>
              {run && (
                <span className={`text-[10px] font-semibold tabular-nums uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_PILL[run.status]}`}>
                  {run.status}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 truncate">
              {run
                ? <>
                    {run.current_step || 'Idle'}
                    {' · '}
                    <span className="text-slate-500">
                      {isLive
                        ? `${fmtElapsed(run.started_at, null)} elapsed`
                        : `last ${new Date(run.started_at).toLocaleString()} · ${fmtElapsed(run.started_at, run.ended_at)}`}
                    </span>
                    {run.triggered_by && <span className="text-slate-500"> · by {run.triggered_by}</span>}
                  </>
                : 'Pulls BPU + COMO meter readings from the bot. Runs hourly automatically; click to sync now.'}
            </p>
          </div>
        </div>
        <button
          onClick={startSync}
          disabled={submitting || isLive}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-accent text-white hover:bg-accent/90 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
        >
          {submitting
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting…</>
            : isLive
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Syncing…</>
              : <><RefreshCw className="w-3.5 h-3.5" /> Sync Now</>}
        </button>
      </div>

      {run && (
        <>
          {/* Progress bar */}
          <div className="h-1 w-full rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                run.status === 'completed' ? 'bg-emerald-500'
                : run.status === 'partial' ? 'bg-amber-500'
                : run.status === 'failed'  ? 'bg-rose-500'
                : 'bg-cyan-500'
              }`}
              style={{ width: `${Math.max(2, run.progress_pct)}%` }}
            />
          </div>

          {/* Log toggle */}
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-1"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {expanded ? 'Hide' : 'Show'} log ({run.step_logs?.length || 0})
          </button>

          {expanded && (
            <div className="rounded-md bg-slate-950/60 ring-1 ring-slate-800/80 p-3 max-h-64 overflow-auto font-mono text-[11px] leading-relaxed">
              {(run.step_logs || []).length === 0 && (
                <div className="text-slate-500 italic">No log lines yet…</div>
              )}
              {(run.step_logs || []).map((l, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="text-slate-600 shrink-0">{fmtClock(l.ts)}</span>
                  <span className={`shrink-0 uppercase font-semibold w-10 ${
                    l.service === 'bpu'  ? 'text-blue-400'
                    : l.service === 'como' ? 'text-purple-400'
                    : 'text-slate-500'
                  }`}>
                    {l.service || 'meta'}
                  </span>
                  <span className={
                    l.level === 'error' ? 'text-rose-300'
                    : l.level === 'warn'  ? 'text-amber-300'
                    : 'text-slate-300'
                  }>
                    {l.message}
                  </span>
                </div>
              ))}
              {run.error && (
                <div className="mt-2 pt-2 border-t border-slate-800 text-rose-300">{run.error}</div>
              )}
            </div>
          )}

          {/* Final summary chip when done */}
          {!isLive && run.stats && (run.stats.bpu || run.stats.como) && (
            <div className="flex flex-wrap gap-2 text-[11px]">
              {run.stats.bpu && (
                <span className={`px-2 py-0.5 rounded ${run.stats.bpu.ok ? 'bg-blue-500/10 text-blue-300' : 'bg-rose-500/10 text-rose-300'}`}>
                  BPU: {run.stats.bpu.ok
                    ? `${run.stats.bpu.uploaded ?? 0} / ${run.stats.bpu.parsed ?? 0} uploaded`
                    : `failed — ${run.stats.bpu.error || 'unknown'}`}
                </span>
              )}
              {run.stats.como && (
                <span className={`px-2 py-0.5 rounded ${run.stats.como.ok ? 'bg-purple-500/10 text-purple-300' : 'bg-rose-500/10 text-rose-300'}`}>
                  COMO: {run.stats.como.ok
                    ? `${run.stats.como.uploaded ?? 0} / ${run.stats.como.parsed ?? 0} uploaded${run.stats.como.properties ? ` from ${run.stats.como.properties} properties` : ''}`
                    : `failed — ${run.stats.como.error || 'unknown'}`}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function statusIconFor(s: SyncStatus) {
  switch (s) {
    case 'completed': return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    case 'partial':   return <AlertTriangle className="w-4 h-4 text-amber-400" />;
    case 'failed':    return <XCircle className="w-4 h-4 text-rose-400" />;
    default:          return <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />;
  }
}
