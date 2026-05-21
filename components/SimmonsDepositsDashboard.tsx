'use client';

/**
 * SimmonsDepositsDashboard
 * Focused reconciliation UI: surface only the EXCEPTIONS.
 *   • Checks deposited at Simmons but missing from AppFolio (need recording)
 *   • AppFolio payments with no matching Simmons check (deposit might be missing)
 *
 * Matched rows and AppFolio digital payments (hex-dash refs like 16DC-D360) are
 * filtered out upstream by v_simmons_reconcile — we only show what needs attention.
 */

import { Fragment, useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';

// ── Types ────────────────────────────────────────────────────────────────────

interface ReconcileRow {
  status: 'matched' | 'simmons_only' | 'af_only';
  check_image_id: string | null;
  deposit_id: string | null;
  deposit_date: string | null;
  check_type: string | null;
  simmons_payer: string | null;
  simmons_amount: string | null;
  money_order_number: string | null;
  check_number: string | null;
  account_suffix: string | null;
  front_image_path: string | null;
  back_image_path: string | null;
  af_id: string | null;
  af_date: string | null;
  af_payer: string | null;
  af_amount: string | null;
  ref_raw: string | null;
  af_property: string | null;
  af_unit: string | null;
  af_tenant_id: number | null;
  af_receipt_id: string | null;
  duplicate_ref: boolean | null;
  amounts_match: boolean | null;
  resolution: ResolutionInfo | null;
}

interface ResolutionInfo {
  id: string;
  resolved_by: string;
  resolved_at: string;
  notes: string | null;
}

interface AfDetail {
  receipt: {
    id: string;
    receipt_date: string;
    receipt_amount: string;
    payer: string | null;
    reference: string | null;
    description: string | null;
    property_name: string | null;
    unit: string | null;
  };
  tenant: {
    tenant_id: number | null;
    occupancy_id: number | null;
    tenant_name: string | null;
    status: string | null;
    move_in: string | null;
    move_out: string | null;
    lease_start: string | null;
    lease_end: string | null;
    email: string | null;
    phone_numbers: string | null;
  } | null;
}

interface JobState {
  id: string;
  script: 'capture' | 'extract';
  status: 'running' | 'done' | 'failed';
  exitCode: number | null;
  startedAt: string;
  endedAt: string | null;
  totalLines: number;
  lines: string[];
}

interface CheckImageDetail {
  id: string;
  front_url: string | null;
  back_url: string | null;
  payer_name: string | null;
  payer_address: string | null;
  issuer: string | null;
  check_date: string | null;
  memo: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const ACCOUNT_LABELS: Record<string, string> = {
  x5218: 'Columbia',
  x3505: 'Como SD',
  x1552: 'KC',
};

const CHECK_TYPE_LABELS: Record<string, string> = {
  personal_check: 'Personal',
  money_order: 'MO',
  cashiers_check: 'Cashier\'s',
  business_check: 'Business',
  usps_money_order: 'USPS MO',
  corporate_check: 'Corp',
};

const DATE_RANGES = [
  { key: '30',  label: 'Last 30d' },
  { key: '90',  label: 'Last 90d' },
  { key: 'ytd', label: 'YTD' },
  { key: 'all', label: 'All time' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number | string | null): string {
  if (n == null) return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '—';
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function dateFloor(rangeKey: string): string | null {
  const now = new Date();
  if (rangeKey === 'all') return null;
  if (rangeKey === 'ytd') return `${now.getFullYear()}-01-01`;
  const days = parseInt(rangeKey, 10);
  if (isNaN(days)) return null;
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function SimmonsDepositsDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const router = useRouter();

  const [rows, setRows] = useState<ReconcileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState<string>('x5218');
  const [range, setRange] = useState<string>('90');
  const [search, setSearch] = useState<string>('');
  const [tab, setTab] = useState<'open' | 'resolved' | 'all'>('open');
  const [launchingChrome, setLaunchingChrome] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const [jobsExpanded, setJobsExpanded] = useState(false);
  const [totp, setTotp] = useState<{ code: string; secondsLeft: number } | null>(null);
  const [totpCopied, setTotpCopied] = useState(false);
  // Multi-select for bulk resolve
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkResolveOpen, setBulkResolveOpen] = useState(false);
  // AF row expansion (tenant ledger panel)
  const [expandedAfId, setExpandedAfId] = useState<string | null>(null);
  const [afDetailCache, setAfDetailCache] = useState<Record<string, AfDetail | 'loading' | 'error'>>({});
  const [lightbox, setLightbox] = useState<{ rowId: string; detail: CheckImageDetail | null } | null>(null);
  const [resolveTarget, setResolveTarget] = useState<ReconcileRow | null>(null);

  useEffect(() => {
    if (!authLoading && appUser && appUser.role !== 'admin') router.push('/');
  }, [authLoading, appUser, router]);

  // ── Fetch reconcile data ───────────────────────────────────────────────────
  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/simmons?mode=reconcile');
      const json = await res.json();
      setRows(json.rows || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && appUser?.role === 'admin') fetchRows();
  }, [authLoading, appUser, fetchRows]);

  // Clear selection when account changes (different deposits)
  useEffect(() => { setSelectedIds(new Set()); }, [account]);

  // ── Apply filters in-memory ────────────────────────────────────────────────
  const { missingInAf, missingChecks, resolved, all } = useMemo(() => {
    const floor = dateFloor(range);
    const q = search.trim().toLowerCase();

    function inRange(row: ReconcileRow): boolean {
      const d = row.deposit_date || row.af_date;
      if (!d) return false;
      if (floor && d < floor) return false;
      return true;
    }

    function matchesSearch(row: ReconcileRow): boolean {
      if (!q) return true;
      const haystack = [
        row.simmons_payer, row.af_payer, row.money_order_number, row.check_number,
        row.ref_raw, row.af_property, row.af_unit, row.simmons_amount, row.af_amount,
        row.resolution?.resolved_by, row.resolution?.notes,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    }

    function matchesAccount(row: ReconcileRow): boolean {
      if (row.status === 'af_only') return true;
      return row.account_suffix === account;
    }

    return {
      missingInAf: rows.filter(r =>
        r.status === 'simmons_only' && !r.resolution &&
        inRange(r) && matchesSearch(r) && matchesAccount(r)
      ).sort((a, b) => (b.deposit_date || '').localeCompare(a.deposit_date || '')),
      missingChecks: rows.filter(r =>
        r.status === 'af_only' && !r.resolution &&
        inRange(r) && matchesSearch(r) && matchesAccount(r)
      ).sort((a, b) => (b.af_date || '').localeCompare(a.af_date || '')),
      resolved: rows.filter(r =>
        !!r.resolution &&
        (r.status === 'simmons_only' || r.status === 'af_only') &&
        inRange(r) && matchesSearch(r) && matchesAccount(r)
      ).sort((a, b) => (b.resolution!.resolved_at).localeCompare(a.resolution!.resolved_at)),
      all: rows.filter(r => inRange(r) && matchesSearch(r) && matchesAccount(r))
        .sort((a, b) => {
          const da = a.deposit_date || a.af_date || '';
          const db = b.deposit_date || b.af_date || '';
          return db.localeCompare(da);
        }),
    };
  }, [rows, range, search, account]);

  // ── Run capture / extract scripts server-side ─────────────────────────────
  // syncPhase tracks which step of a "sync" sequence we're on (capture → extract)
  const [syncPhase, setSyncPhase] = useState<'idle' | 'capture' | 'extract'>('idle');

  const pollJob = useCallback(async (jobId: string) => {
    const res = await fetch(`/api/admin/simmons/run-script?id=${jobId}`);
    if (!res.ok) return null;
    const data: JobState = await res.json();
    setJob(data);
    return data;
  }, []);

  const startScript = useCallback(async (script: 'capture' | 'extract', args: string[] = []) => {
    const res = await fetch('/api/admin/simmons/run-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script, args }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return await pollJob(data.id);
  }, [pollJob]);

  // Single "Sync" button — captures pending deposits, then extracts new images
  const runSync = useCallback(async () => {
    if (syncPhase !== 'idle') return;
    setJobsExpanded(true);
    try {
      setSyncPhase('capture');
      await startScript('capture');
      // capture polls itself via useEffect → when it finishes,
      // the syncPhase-watching effect below kicks off extract
    } catch (e: any) {
      alert(`Sync failed: ${e?.message || String(e)}`);
      setSyncPhase('idle');
    }
  }, [syncPhase, startScript]);

  // Poll the active job every 2s while running; advance the sync state machine
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const t = setInterval(() => { pollJob(job.id); }, 2000);
    return () => clearInterval(t);
  }, [job, pollJob]);

  // When a job finishes, refresh data + advance the sync sequence
  useEffect(() => {
    if (!job || job.status === 'running') return;

    // Always refresh the dashboard data when a job completes
    fetchRows();

    // If we were syncing and capture just finished successfully, kick off extract
    if (syncPhase === 'capture' && job.script === 'capture' && job.status === 'done') {
      setSyncPhase('extract');
      startScript('extract', ['--since', '2025-01-01']).catch((e) => {
        alert(`Extract step failed: ${e?.message || String(e)}`);
        setSyncPhase('idle');
      });
      return;
    }

    // Either non-sync run finished, or both sync phases done, or capture failed
    if (syncPhase !== 'idle' &&
        (job.status === 'failed' ||
         (syncPhase === 'extract' && job.script === 'extract'))) {
      setSyncPhase('idle');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, job?.script]);

  const stopJob = useCallback(async () => {
    if (!job || job.status !== 'running') return;
    if (!confirm('Stop the running job?')) return;
    await fetch(`/api/admin/simmons/run-script?id=${job.id}`, { method: 'DELETE' });
    await pollJob(job.id);
    setSyncPhase('idle');
  }, [job, pollJob]);

  // ── TOTP fetch + local-countdown ─────────────────────────────────────────
  const refreshTotp = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/simmons/totp');
      if (!res.ok) { setTotp(null); return; }
      const json = await res.json();
      if (json.code) setTotp({ code: json.code, secondsLeft: json.secondsLeft });
    } catch { setTotp(null); }
  }, []);

  useEffect(() => {
    if (!appUser || appUser.role !== 'admin') return;
    refreshTotp();
    // Tick locally each second; refresh from server when window expires
    const t = setInterval(() => {
      setTotp(prev => {
        if (!prev) return prev;
        const next = prev.secondsLeft - 1;
        if (next <= 0) { refreshTotp(); return prev; }
        return { ...prev, secondsLeft: next };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [appUser, refreshTotp]);

  const copyTotp = useCallback(async () => {
    if (!totp) return;
    try {
      await navigator.clipboard.writeText(totp.code);
      setTotpCopied(true);
      setTimeout(() => setTotpCopied(false), 1500);
    } catch {
      // Clipboard API can fail on http://; fall back to old technique
      const ta = document.createElement('textarea');
      ta.value = totp.code;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setTotpCopied(true); setTimeout(() => setTotpCopied(false), 1500); } catch {}
      document.body.removeChild(ta);
    }
  }, [totp]);

  // ── Launch CDP Chrome (local-dev only) ────────────────────────────────────
  const launchChrome = useCallback(async () => {
    setLaunchingChrome(true);
    try {
      const res = await fetch('/api/admin/simmons/launch-chrome', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        alert(`Launch failed: ${json.error || res.statusText}`);
        return;
      }
      alert('Fresh Chrome window launched on the Simmons login page.\n\nLog in, then return here and click "Sync Deposits".');
    } catch (e: any) {
      alert('Launch failed: ' + (e?.message || String(e)));
    } finally {
      setLaunchingChrome(false);
    }
  }, []);

  // ── Resolve / unresolve actions ────────────────────────────────────────────
  const submitResolution = useCallback(async (row: ReconcileRow, notes: string) => {
    const body = row.check_image_id
      ? { action: 'resolve', check_image_id: row.check_image_id, notes }
      : { action: 'resolve', af_id: row.af_id, notes };
    const res = await fetch('/api/admin/simmons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`Resolve failed: ${j.error || res.statusText}`);
      return;
    }
    setResolveTarget(null);
    await fetchRows();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Selection helpers
  const toggleRow = useCallback((row: ReconcileRow) => {
    const key = rowKey(row);
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback((visible: ReconcileRow[], select: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const r of visible) {
        const k = rowKey(r);
        if (select) next.add(k); else next.delete(k);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Resolve everything currently selected with the same notes
  const submitBulkResolution = useCallback(async (notes: string) => {
    // Map selected ids back to row objects (across both lists)
    const allOpen = [...missingInAf, ...missingChecks];
    const targets = allOpen.filter(r => selectedIds.has(rowKey(r)));
    if (targets.length === 0) { setBulkResolveOpen(false); return; }

    // Fire requests in parallel, but cap concurrency to avoid hammering
    const errors: string[] = [];
    const BATCH = 5;
    for (let i = 0; i < targets.length; i += BATCH) {
      const slice = targets.slice(i, i + BATCH);
      await Promise.all(slice.map(async row => {
        const body = row.check_image_id
          ? { action: 'resolve', check_image_id: row.check_image_id, notes }
          : { action: 'resolve', af_id: row.af_id, notes };
        const res = await fetch('/api/admin/simmons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          errors.push(`${rowKey(row).slice(0, 8)}: ${j.error || res.statusText}`);
        }
      }));
    }
    setBulkResolveOpen(false);
    setSelectedIds(new Set());
    await fetchRows();
    if (errors.length) {
      alert(`${targets.length - errors.length} resolved, ${errors.length} failed:\n${errors.join('\n')}`);
    }
  }, [missingInAf, missingChecks, selectedIds]);  // eslint-disable-line react-hooks/exhaustive-deps

  const undoResolution = useCallback(async (row: ReconcileRow) => {
    if (!confirm('Re-open this item?')) return;
    const body = row.check_image_id
      ? { action: 'unresolve', check_image_id: row.check_image_id }
      : { action: 'unresolve', af_id: row.af_id };
    const res = await fetch('/api/admin/simmons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`Undo failed: ${j.error || res.statusText}`);
      return;
    }
    await fetchRows();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Expand an AF row to show tenant + ledger ──────────────────────────────
  const toggleAfExpansion = useCallback(async (afId: string) => {
    if (expandedAfId === afId) {
      setExpandedAfId(null);
      return;
    }
    setExpandedAfId(afId);
    if (afDetailCache[afId] && afDetailCache[afId] !== 'error') return;
    setAfDetailCache(prev => ({ ...prev, [afId]: 'loading' }));
    try {
      const res = await fetch(`/api/admin/simmons/af-detail?af_id=${afId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AfDetail = await res.json();
      setAfDetailCache(prev => ({ ...prev, [afId]: data }));
    } catch {
      setAfDetailCache(prev => ({ ...prev, [afId]: 'error' }));
    }
  }, [expandedAfId, afDetailCache]);

  // ── Image lightbox ─────────────────────────────────────────────────────────
  const openLightbox = useCallback(async (row: ReconcileRow) => {
    if (!row.check_image_id) return;
    setLightbox({ rowId: row.check_image_id, detail: null });
    try {
      const res = await fetch(`/api/admin/simmons?check_image_id=${row.check_image_id}`);
      const json = await res.json();
      const img = json.images?.[0];
      if (img) {
        setLightbox({
          rowId: row.check_image_id,
          detail: {
            id: img.id,
            front_url: img.front_url,
            back_url: img.back_url,
            payer_name: img.payer_name,
            payer_address: img.payer_address,
            issuer: img.issuer,
            check_date: img.check_date,
            memo: img.memo,
          },
        });
      }
    } catch {
      // swallow — lightbox stays open with no image; user can close
    }
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (authLoading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (!appUser || appUser.role !== 'admin') return null;

  // ── Render ─────────────────────────────────────────────────────────────────
  const totals = {
    missingInAf: missingInAf.length,
    missingInAfAmount: missingInAf.reduce((s, r) => s + (parseFloat(r.simmons_amount || '0') || 0), 0),
    missingChecks: missingChecks.length,
    missingChecksAmount: missingChecks.reduce((s, r) => s + (parseFloat(r.af_amount || '0') || 0), 0),
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <header className="flex items-baseline justify-between mb-4 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Simmons Reconciliation</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Checks deposited at the bank without a matching AppFolio receipt — and AppFolio payments missing a deposit.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {totp && (
              <TotpBadge code={totp.code} secondsLeft={totp.secondsLeft} copied={totpCopied} onCopy={copyTotp} />
            )}
            <button
              onClick={launchChrome}
              disabled={launchingChrome}
              title="Open the dedicated debug-profile Chrome window for logging into Simmons"
              className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded border border-indigo-500 text-white"
            >
              {launchingChrome ? 'Launching…' : '🚀 Launch Chrome'}
            </button>
            <button
              onClick={runSync}
              disabled={syncPhase !== 'idle' || (!!job && job.status === 'running')}
              title="Capture any new deposits from the logged-in Simmons session, then Claude-extract the new check images"
              className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded border border-emerald-500 text-white font-medium"
            >
              {syncPhase === 'capture'   ? 'Capturing…' :
               syncPhase === 'extract'   ? 'Extracting…' :
               '▶ Sync Deposits'}
            </button>
            <button
              onClick={fetchRows}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded border border-slate-700"
            >
              {loading ? 'Loading…' : '↻ Refresh'}
            </button>
          </div>
        </header>

        {/* Job log panel */}
        {job && (
          <JobLogPanel
            job={job}
            expanded={jobsExpanded}
            onToggle={() => setJobsExpanded(v => !v)}
            onStop={stopJob}
            onDismiss={() => setJob(null)}
          />
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6 items-center">
          <select
            value={account}
            onChange={e => setAccount(e.target.value)}
            className="px-3 py-1.5 text-sm bg-slate-900 border border-slate-700 rounded text-slate-100"
          >
            {Object.entries(ACCOUNT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v} ({k})</option>
            ))}
          </select>

          <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded p-0.5">
            {DATE_RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  range === r.key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search payer, ref, amount…"
            className="px-3 py-1.5 text-sm bg-slate-900 border border-slate-700 rounded text-slate-100 placeholder-slate-500 flex-1 min-w-[200px] max-w-md"
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-800 mb-4">
          {[
            { key: 'open' as const,     label: 'Open',     count: missingInAf.length + missingChecks.length },
            { key: 'resolved' as const, label: 'Resolved', count: resolved.length },
            { key: 'all' as const,      label: 'All',      count: all.length },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.key
                  ? 'border-indigo-500 text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
              <span className="ml-2 text-xs text-slate-500">{t.count}</span>
            </button>
          ))}
        </div>

        {tab === 'open' && (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
              <StatCard
                color="amber"
                count={totals.missingInAf}
                total={totals.missingInAfAmount}
                title="Checks need recording in AppFolio"
                sub="Deposited at the bank but no AppFolio receipt"
              />
              <StatCard
                color="rose"
                count={totals.missingChecks}
                total={totals.missingChecksAmount}
                title="Payments missing a deposit"
                sub="AppFolio receipt with check/MO ref but no Simmons image"
              />
            </div>

            {/* Section 1 */}
            <SectionTable
              title={`Checks Without AppFolio Entries (${missingInAf.length})`}
              emptyText="No unrecorded checks in this date range — all caught up."
              rows={missingInAf}
              loading={loading}
              selectable
              selectedIds={selectedIds}
              onToggleRow={toggleRow}
              onToggleAll={toggleAllVisible}
              columns={[
                { header: 'Deposited', cell: r => fmtDate(r.deposit_date), sortValue: r => r.deposit_date },
                { header: 'Amount',    cell: r => <span className="font-semibold text-emerald-300">{fmtMoney(r.simmons_amount)}</span>, align: 'right', sortValue: r => parseFloat(r.simmons_amount || '0') },
                { header: 'Payer',     cell: r => r.simmons_payer || <span className="text-slate-500">unknown</span>, sortValue: r => (r.simmons_payer || '').toLowerCase() },
                { header: 'Type',      cell: r => CHECK_TYPE_LABELS[r.check_type || ''] || r.check_type || '—', sortValue: r => r.check_type },
                { header: 'Reference', cell: r => <code className="font-mono text-xs text-slate-400">{r.money_order_number || r.check_number || '—'}</code>, sortValue: r => r.money_order_number || r.check_number },
                { header: '', cell: r => (
                  <div className="flex gap-3 justify-end">
                    {r.check_image_id && (
                      <button onClick={() => openLightbox(r)} className="text-indigo-400 hover:text-indigo-300 text-xs">View image</button>
                    )}
                    <button onClick={() => setResolveTarget(r)} className="text-emerald-400 hover:text-emerald-300 text-xs font-medium">Resolve →</button>
                  </div>
                ), align: 'right' },
              ]}
            />

            {/* Section 2 */}
            <SectionTable
              title={`AppFolio Payments Without Checks (${missingChecks.length})`}
              emptyText="Every AppFolio payment in this range has a matching check — looks good."
              rows={missingChecks}
              loading={loading}
              selectable
              selectedIds={selectedIds}
              onToggleRow={toggleRow}
              onToggleAll={toggleAllVisible}
              expandedKey={expandedAfId}
              onRowClick={(r) => r.af_id && toggleAfExpansion(r.af_id)}
              renderExpansion={(r) => r.af_id ? (
                <AfDetailPanel
                  state={afDetailCache[r.af_id]}
                  onClose={() => setExpandedAfId(null)}
                />
              ) : null}
              columns={[
                { header: '', cell: r => (
                  <span className="text-slate-500 text-xs font-mono">{expandedAfId === r.af_id ? '▾' : '▸'}</span>
                ) },
                { header: 'AF Date', cell: r => fmtDate(r.af_date), sortValue: r => r.af_date },
                { header: 'Amount',  cell: r => <span className="font-semibold text-rose-300">{fmtMoney(r.af_amount)}</span>, align: 'right', sortValue: r => parseFloat(r.af_amount || '0') },
                { header: 'Payer',   cell: r => r.af_payer || '—', sortValue: r => (r.af_payer || '').toLowerCase() },
                { header: 'Property / Unit', cell: r => (
                  <span className="text-slate-300">
                    {r.af_property || '—'}{r.af_unit ? ` · ${r.af_unit}` : ''}
                  </span>
                ), sortValue: r => `${r.af_property || ''} ${r.af_unit || ''}`.toLowerCase().trim() },
                { header: 'Reference', cell: r => <code className="font-mono text-xs text-slate-400">{r.ref_raw || '—'}</code>, sortValue: r => r.ref_raw },
                { header: '', cell: r => (
                  <button onClick={() => setResolveTarget(r)} className="text-emerald-400 hover:text-emerald-300 text-xs font-medium">Resolve →</button>
                ), align: 'right' },
              ]}
            />
          </>
        )}

        {tab === 'resolved' && (
          <SectionTable
            title={`Resolved (${resolved.length})`}
            emptyText="No resolved items in this date range yet."
            rows={resolved}
            loading={loading}
            columns={[
              { header: 'When', cell: r => (
                <span className="text-xs text-slate-300" title={new Date(r.resolution!.resolved_at).toLocaleString()}>
                  {new Date(r.resolution!.resolved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              ), sortValue: r => r.resolution?.resolved_at },
              { header: 'Source', cell: r => (
                <span className="text-xs">
                  {r.status === 'simmons_only' ? (
                    <span className="text-amber-300">Check ({r.account_suffix})</span>
                  ) : (
                    <span className="text-rose-300">AF Receipt</span>
                  )}
                </span>
              ), sortValue: r => r.status },
              { header: 'Date', cell: r => fmtDate(r.deposit_date || r.af_date), sortValue: r => r.deposit_date || r.af_date },
              { header: 'Amount', cell: r => <span className="font-semibold text-slate-200">{fmtMoney(r.simmons_amount || r.af_amount)}</span>, align: 'right', sortValue: r => parseFloat(r.simmons_amount || r.af_amount || '0') },
              { header: 'Payer', cell: r => r.simmons_payer || r.af_payer || '—', sortValue: r => (r.simmons_payer || r.af_payer || '').toLowerCase() },
              { header: 'Reference', cell: r => <code className="font-mono text-xs text-slate-400">{r.money_order_number || r.check_number || r.ref_raw || '—'}</code>, sortValue: r => r.money_order_number || r.check_number || r.ref_raw },
              { header: 'Resolved by', cell: r => <span className="text-xs text-slate-400">{r.resolution!.resolved_by}</span>, sortValue: r => r.resolution?.resolved_by },
              { header: 'Notes', cell: r => (
                <span className="text-xs text-slate-300 whitespace-pre-wrap">{r.resolution!.notes || <span className="text-slate-600">—</span>}</span>
              ), sortValue: r => r.resolution?.notes },
              { header: '', cell: r => (
                <div className="flex gap-3 justify-end">
                  {r.check_image_id && (
                    <button onClick={() => openLightbox(r)} className="text-indigo-400 hover:text-indigo-300 text-xs">Image</button>
                  )}
                  <button onClick={() => undoResolution(r)} className="text-slate-400 hover:text-slate-200 text-xs">Undo</button>
                </div>
              ), align: 'right' },
            ]}
          />
        )}

        {tab === 'all' && (
          <SectionTable
            title={`All Deposits & AppFolio Entries (${all.length})`}
            emptyText="No rows match the current filters."
            rows={all}
            loading={loading}
            columns={[
              { header: 'Status', cell: r => <StatusPill row={r} />, sortValue: r => r.resolution ? 'a-resolved' : r.status },
              { header: 'Date', cell: r => fmtDate(r.deposit_date || r.af_date), sortValue: r => r.deposit_date || r.af_date },
              { header: 'Simmons $', cell: r => r.simmons_amount ? (
                <span className="text-emerald-300 font-semibold">{fmtMoney(r.simmons_amount)}</span>
              ) : <span className="text-slate-600">—</span>, align: 'right', sortValue: r => parseFloat(r.simmons_amount || '0') },
              { header: 'AF $', cell: r => r.af_amount ? (
                <span className="text-rose-300 font-semibold">{fmtMoney(r.af_amount)}</span>
              ) : <span className="text-slate-600">—</span>, align: 'right', sortValue: r => parseFloat(r.af_amount || '0') },
              { header: 'Payer', cell: r => (
                <span className="text-slate-200">{r.simmons_payer || r.af_payer || <span className="text-slate-500">—</span>}</span>
              ), sortValue: r => (r.simmons_payer || r.af_payer || '').toLowerCase() },
              { header: 'Reference', cell: r => (
                <code className="font-mono text-xs text-slate-400">{r.money_order_number || r.check_number || r.ref_raw || '—'}</code>
              ), sortValue: r => r.money_order_number || r.check_number || r.ref_raw },
              { header: 'Property / Unit', cell: r => r.af_property ? (
                <span className="text-xs text-slate-400">{r.af_property}{r.af_unit ? ` · ${r.af_unit}` : ''}</span>
              ) : <span className="text-slate-700">—</span>, sortValue: r => `${r.af_property || ''} ${r.af_unit || ''}`.toLowerCase().trim() },
              { header: '', cell: r => r.check_image_id ? (
                <button onClick={() => openLightbox(r)} className="text-indigo-400 hover:text-indigo-300 text-xs">Image →</button>
              ) : null, align: 'right' },
            ]}
          />
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <Lightbox
          detail={lightbox.detail}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* Resolve dialog (single) */}
      {resolveTarget && (
        <ResolveDialog
          row={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onSubmit={(notes) => submitResolution(resolveTarget, notes)}
        />
      )}

      {/* Bulk resolve dialog */}
      {bulkResolveOpen && (
        <BulkResolveDialog
          rows={[...missingInAf, ...missingChecks].filter(r => selectedIds.has(rowKey(r)))}
          onClose={() => setBulkResolveOpen(false)}
          onSubmit={submitBulkResolution}
        />
      )}

      {/* Floating selection bar */}
      {tab === 'open' && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 shadow-lg shadow-black/40">
          <span className="text-sm text-slate-200">
            <strong className="text-emerald-300">{selectedIds.size}</strong> selected
          </span>
          <button
            onClick={() => setBulkResolveOpen(true)}
            className="px-3 py-1.5 text-sm rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
          >
            Resolve all
          </button>
          <button onClick={clearSelection} className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200">
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function StatCard({ color, count, total, title, sub }: {
  color: 'amber' | 'rose';
  count: number;
  total: number;
  title: string;
  sub: string;
}) {
  const palette = color === 'amber'
    ? { bg: 'from-amber-900/30 to-amber-950/20', text: 'text-amber-300', border: 'border-amber-800/50' }
    : { bg: 'from-rose-900/30 to-rose-950/20', text: 'text-rose-300', border: 'border-rose-800/50' };
  return (
    <div className={`rounded-lg border ${palette.border} bg-gradient-to-br ${palette.bg} p-4`}>
      <div className="flex items-baseline justify-between">
        <span className={`text-3xl font-bold ${palette.text}`}>{count}</span>
        <span className={`text-sm ${palette.text}`}>{total > 0 ? `${fmtMoney(total)} total` : ''}</span>
      </div>
      <div className="text-sm font-medium text-slate-200 mt-1">{title}</div>
      <div className="text-xs text-slate-400">{sub}</div>
    </div>
  );
}

interface ColumnDef {
  header: string;
  cell: (row: ReconcileRow) => React.ReactNode;
  align?: 'left' | 'right';
  /** If provided, header becomes clickable for sorting. Returns the value used for ordering (null sorts last). */
  sortValue?: (row: ReconcileRow) => string | number | null | undefined;
}

type SortState = { col: number; dir: 'asc' | 'desc' } | null;

function rowKey(r: ReconcileRow): string {
  return r.check_image_id || r.af_id || '';
}

function SectionTable({
  title, rows, columns, emptyText, loading,
  selectable = false, selectedIds, onToggleRow, onToggleAll,
  expandedKey, renderExpansion, onRowClick,
}: {
  title: string;
  rows: ReconcileRow[];
  columns: ColumnDef[];
  emptyText: string;
  loading: boolean;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleRow?: (row: ReconcileRow) => void;
  onToggleAll?: (rows: ReconcileRow[], select: boolean) => void;
  expandedKey?: string | null;
  renderExpansion?: (row: ReconcileRow) => React.ReactNode;
  onRowClick?: (row: ReconcileRow) => void;
}) {
  const [sort, setSort] = useState<SortState>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns[sort.col];
    if (!col?.sortValue) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      // Nulls/undefined sort last regardless of dir
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sort, columns]);

  const onHeaderClick = (i: number, col: ColumnDef) => {
    if (!col.sortValue) return;
    setSort(prev => {
      if (!prev || prev.col !== i) return { col: i, dir: 'asc' };
      if (prev.dir === 'asc') return { col: i, dir: 'desc' };
      return null; // third click clears
    });
  };

  const visibleSelected = selectable && selectedIds
    ? sortedRows.filter(r => selectedIds.has(rowKey(r))).length
    : 0;
  const allVisibleSelected = selectable && sortedRows.length > 0 && visibleSelected === sortedRows.length;

  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-2">{title}</h2>
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 overflow-hidden">
        {loading && rows.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">{emptyText}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800">
                <tr>
                  {selectable && (
                    <th className="px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        ref={(el) => { if (el) el.indeterminate = visibleSelected > 0 && !allVisibleSelected; }}
                        onChange={(e) => onToggleAll?.(sortedRows, e.target.checked)}
                        className="accent-emerald-500 cursor-pointer"
                        aria-label="Select all visible rows"
                      />
                    </th>
                  )}
                  {columns.map((c, i) => {
                    const isActive = sort?.col === i;
                    const sortable = !!c.sortValue;
                    return (
                      <th
                        key={i}
                        onClick={() => onHeaderClick(i, c)}
                        className={`px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide ${
                          c.align === 'right' ? 'text-right' : 'text-left'
                        } ${sortable ? 'cursor-pointer hover:text-slate-200 select-none' : ''}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {c.header}
                          {sortable && (
                            <span className={`text-[10px] ${isActive ? 'text-indigo-400' : 'text-slate-600'}`}>
                              {isActive ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                            </span>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {sortedRows.map((row, i) => {
                  const key = rowKey(row);
                  const isSelected = selectable && selectedIds?.has(key);
                  const isExpanded = renderExpansion && expandedKey === key;
                  const totalCols = columns.length + (selectable ? 1 : 0);
                  return (
                    <Fragment key={key + i}>
                      <tr
                        className={`${onRowClick ? 'cursor-pointer' : ''} hover:bg-slate-800/40 ${isSelected ? 'bg-emerald-950/30' : ''} ${isExpanded ? 'bg-slate-800/50' : ''}`}
                        onClick={(e) => {
                          // Don't toggle expansion when clicking checkbox, link, or button
                          const tag = (e.target as HTMLElement).tagName.toLowerCase();
                          if (tag === 'input' || tag === 'button' || tag === 'a') return;
                          onRowClick?.(row);
                        }}
                      >
                        {selectable && (
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={!!isSelected}
                              onChange={() => onToggleRow?.(row)}
                              onClick={(e) => e.stopPropagation()}
                              className="accent-emerald-500 cursor-pointer"
                              aria-label="Select row"
                            />
                          </td>
                        )}
                        {columns.map((c, ci) => (
                          <td key={ci} className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                            {c.cell(row)}
                          </td>
                        ))}
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-950">
                          <td colSpan={totalCols} className="p-0 border-t border-slate-800">
                            {renderExpansion!(row)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function TotpBadge({ code, secondsLeft, copied, onCopy }: {
  code: string;
  secondsLeft: number;
  copied: boolean;
  onCopy: () => void;
}) {
  const formatted = code.slice(0, 3) + ' ' + code.slice(3);
  const lowTime = secondsLeft <= 5;
  return (
    <button
      onClick={onCopy}
      title="Click to copy current Simmons TOTP code"
      className={`group flex items-center gap-2 px-2 py-1.5 rounded border text-xs font-medium transition-colors ${
        copied
          ? 'bg-emerald-900/40 border-emerald-700 text-emerald-200'
          : lowTime
            ? 'bg-rose-900/40 border-rose-800 text-rose-200 hover:bg-rose-900/60'
            : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
      }`}
    >
      <span className="text-[10px] uppercase tracking-wide text-slate-400 group-hover:text-slate-300">TOTP</span>
      <span className="font-mono text-base tracking-wider tabular-nums">{formatted}</span>
      <span className={`text-[10px] tabular-nums ${lowTime ? 'text-rose-300' : 'text-slate-400'}`}>
        {secondsLeft}s
      </span>
      <span className={`text-[10px] ${copied ? 'text-emerald-300' : 'text-slate-500 group-hover:text-slate-300'}`}>
        {copied ? '✓ copied' : '📋'}
      </span>
    </button>
  );
}

function JobLogPanel({ job, expanded, onToggle, onStop, onDismiss }: {
  job: JobState;
  expanded: boolean;
  onToggle: () => void;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const color = job.status === 'running' ? 'amber'
              : job.status === 'done'    ? 'emerald'
              :                            'rose';
  const palette = {
    amber:   { bar: 'border-amber-700/60 bg-amber-950/40',     icon: 'text-amber-300',   label: 'Running' },
    emerald: { bar: 'border-emerald-700/60 bg-emerald-950/40', icon: 'text-emerald-300', label: 'Done' },
    rose:    { bar: 'border-rose-700/60 bg-rose-950/40',       icon: 'text-rose-300',    label: 'Failed' },
  }[color];

  // Recent / summary stats from the log lines
  const lastNonEmpty = [...job.lines].reverse().find(l => /[A-Za-z]/.test(l)) || '';
  const summaryLine = job.lines.find(l => /^\d{2}:\d{2}:\d{2}.*Deposits processed|Extracted:/.test(l));

  return (
    <div className={`mb-4 rounded-lg border ${palette.bar}`}>
      <div className="flex items-center gap-3 p-3">
        <span className={`text-base ${palette.icon}`}>
          {job.status === 'running' ? '⏳' : job.status === 'done' ? '✅' : '❌'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-200">
            {job.script === 'capture' ? 'capture.mjs' : 'extract.mjs'}{' '}
            <span className={palette.icon}>{palette.label}</span>
            {job.status !== 'running' && job.exitCode !== null && (
              <span className="text-xs text-slate-500 ml-1">(exit {job.exitCode})</span>
            )}
          </div>
          <div className="text-xs text-slate-400 truncate font-mono">{lastNonEmpty}</div>
        </div>
        <div className="flex gap-2 shrink-0">
          {job.status === 'running' && (
            <button onClick={onStop} className="px-2 py-1 text-xs rounded bg-rose-700/50 hover:bg-rose-700 text-rose-100 border border-rose-700">
              Stop
            </button>
          )}
          <button onClick={onToggle} className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700">
            {expanded ? 'Hide log' : 'Show log'}
          </button>
          {job.status !== 'running' && (
            <button onClick={onDismiss} className="px-2 py-1 text-xs rounded text-slate-500 hover:text-slate-300">
              ✕
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-slate-800 bg-slate-950 max-h-72 overflow-y-auto">
          <pre className="text-[11px] font-mono text-slate-300 leading-snug p-2 whitespace-pre-wrap">
            {job.lines.slice(-200).join('\n') || '(no output yet)'}
          </pre>
        </div>
      )}
      {summaryLine && !expanded && (
        <div className="px-3 pb-2 text-xs text-slate-400 font-mono">{summaryLine.replace(/^\d{2}:\d{2}:\d{2}  /, '')}</div>
      )}
    </div>
  );
}

function AfDetailPanel({ state, onClose }: {
  state: AfDetail | 'loading' | 'error' | undefined;
  onClose: () => void;
}) {
  if (!state || state === 'loading') {
    return <div className="p-4 text-sm text-slate-500">Loading tenant info…</div>;
  }
  if (state === 'error') {
    return <div className="p-4 text-sm text-rose-400">Failed to load detail.</div>;
  }
  const { receipt, tenant } = state;
  const occupancyLedgerUrl = tenant?.occupancy_id && tenant?.tenant_id
    ? `https://appreciateinc.appfolio.com/occupancies/${tenant.occupancy_id}/selected_tenant/${tenant.tenant_id}/ledger`
    : tenant?.occupancy_id
      ? `https://appreciateinc.appfolio.com/occupancies/${tenant.occupancy_id}`
      : null;

  return (
    <div className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
        {tenant?.tenant_name && (
          <div><span className="text-slate-500">Tenant</span> <strong className="text-slate-100">{tenant.tenant_name}</strong></div>
        )}
        {tenant?.status && (
          <div>
            <span className="text-slate-500">Status</span>{' '}
            <span className={
              tenant.status === 'Current' ? 'text-emerald-300' :
              tenant.status === 'Past' ? 'text-slate-400' : 'text-amber-300'
            }>{tenant.status}</span>
          </div>
        )}
        {tenant?.lease_start && tenant?.lease_end && (
          <div><span className="text-slate-500">Lease</span> {fmtDate(tenant.lease_start)} – {fmtDate(tenant.lease_end)}</div>
        )}
        {tenant?.email && <div><span className="text-slate-500">Email</span> <span className="text-slate-300">{tenant.email}</span></div>}
        {tenant?.phone_numbers && <div><span className="text-slate-500">Phone</span> <span className="text-slate-300">{tenant.phone_numbers}</span></div>}
        {!tenant && (
          <div className="text-slate-500 italic">
            No tenant directory match for {receipt.property_name || '?'}{receipt.unit ? ` · ${receipt.unit}` : ''}
          </div>
        )}
        <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-300 text-xs">collapse ▴</button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {occupancyLedgerUrl ? (
          <a
            href={occupancyLedgerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 hover:bg-indigo-500 text-white"
          >
            Open tenant ledger in AppFolio
            <span className="text-[10px]">↗</span>
          </a>
        ) : (
          <span className="text-xs text-slate-500 italic">No occupancy_id on file — can't deep-link to AppFolio.</span>
        )}
      </div>
    </div>
  );
}

function StatusPill({ row }: { row: ReconcileRow }) {
  if (row.resolution) {
    return <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-slate-700/50 text-slate-300 border border-slate-600">Resolved</span>;
  }
  if (row.status === 'matched') {
    return (
      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
        row.amounts_match === false
          ? 'bg-yellow-900/40 text-yellow-300 border border-yellow-700/50'
          : 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'
      }`}>
        {row.amounts_match === false ? 'Amount diff' : 'Matched'}
      </span>
    );
  }
  if (row.status === 'simmons_only') {
    return <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-900/40 text-amber-300 border border-amber-700/50">Missing in AF</span>;
  }
  return <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-rose-900/40 text-rose-300 border border-rose-700/50">Missing check</span>;
}

function ResolveDialog({ row, onClose, onSubmit }: {
  row: ReconcileRow;
  onClose: () => void;
  onSubmit: (notes: string) => void | Promise<void>;
}) {
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try { await onSubmit(notes); } finally { setSubmitting(false); }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const isCheck = row.status === 'simmons_only';
  const amount = isCheck ? row.simmons_amount : row.af_amount;
  const payer = isCheck ? row.simmons_payer : row.af_payer;
  const date = isCheck ? row.deposit_date : row.af_date;
  const ref = row.money_order_number || row.check_number || row.ref_raw;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-800">
          <h3 className="text-base font-semibold text-slate-100">
            Resolve {isCheck ? 'check' : 'AppFolio receipt'}
          </h3>
          <div className="mt-2 grid grid-cols-2 gap-y-1 gap-x-3 text-xs">
            <span className="text-slate-500">Date</span>
            <span className="text-slate-200">{fmtDate(date)}</span>
            <span className="text-slate-500">Amount</span>
            <span className="text-slate-200 font-semibold">{fmtMoney(amount)}</span>
            <span className="text-slate-500">Payer</span>
            <span className="text-slate-200">{payer || '—'}</span>
            {ref && <><span className="text-slate-500">Reference</span><span className="text-slate-200 font-mono">{ref}</span></>}
            {!isCheck && row.af_property && <><span className="text-slate-500">Property</span><span className="text-slate-200">{row.af_property}{row.af_unit ? ` · ${row.af_unit}` : ''}</span></>}
          </div>
        </div>
        <div className="p-4">
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Notes <span className="text-slate-500 font-normal">(why is this resolved? recorded in AppFolio under… / matched to receipt # …)</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={4}
            placeholder="Recorded in AppFolio for Tenant X · 2026-05-01 rent payment, lease 1234"
            className="w-full px-2 py-1.5 text-sm bg-slate-950 border border-slate-700 rounded text-slate-100 placeholder-slate-600 resize-y"
            autoFocus
          />
          <div className="text-[10px] text-slate-500 mt-1">Cmd/Ctrl + Enter to submit</div>
        </div>
        <div className="px-4 pb-4 flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} className="px-3 py-1.5 text-sm rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium">
            {submitting ? 'Saving…' : 'Mark resolved'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkResolveDialog({ rows, onClose, onSubmit }: {
  rows: ReconcileRow[];
  onClose: () => void;
  onSubmit: (notes: string) => void | Promise<void>;
}) {
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try { await onSubmit(notes); } finally { setSubmitting(false); }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const totalSimmons = rows.filter(r => r.status === 'simmons_only').length;
  const totalAf = rows.filter(r => r.status === 'af_only').length;
  const totalAmount = rows.reduce((s, r) => s + (parseFloat(r.simmons_amount || r.af_amount || '0') || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-800">
          <h3 className="text-base font-semibold text-slate-100">
            Resolve {rows.length} {rows.length === 1 ? 'item' : 'items'}
          </h3>
          <div className="text-xs text-slate-400 mt-1">
            {totalSimmons > 0 && <span>{totalSimmons} check{totalSimmons === 1 ? '' : 's'}</span>}
            {totalSimmons > 0 && totalAf > 0 && ' · '}
            {totalAf > 0 && <span>{totalAf} AF receipt{totalAf === 1 ? '' : 's'}</span>}
            {' · '}
            <span className="text-slate-300 font-medium">{fmtMoney(totalAmount)}</span> total
          </div>
        </div>

        <div className="overflow-y-auto px-4 py-2 border-b border-slate-800 max-h-48">
          <ul className="text-xs space-y-1">
            {rows.slice(0, 25).map(r => (
              <li key={rowKey(r)} className="flex items-center gap-2 text-slate-400">
                <span className={r.status === 'simmons_only' ? 'text-amber-400' : 'text-rose-400'}>●</span>
                <span className="font-mono text-slate-500 shrink-0">{fmtDate(r.deposit_date || r.af_date)}</span>
                <span className="font-semibold text-slate-200 shrink-0">{fmtMoney(r.simmons_amount || r.af_amount)}</span>
                <span className="truncate">{r.simmons_payer || r.af_payer || '—'}</span>
                <span className="font-mono text-slate-600 shrink-0">{r.money_order_number || r.check_number || r.ref_raw || ''}</span>
              </li>
            ))}
            {rows.length > 25 && (
              <li className="text-slate-500 italic">…and {rows.length - 25} more</li>
            )}
          </ul>
        </div>

        <div className="p-4">
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Notes <span className="text-slate-500 font-normal">(applied to every selected item)</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={4}
            placeholder={`e.g. "Batch-recorded in AppFolio for Apr/May rent" — saved as the resolution note on all ${rows.length} items.`}
            className="w-full px-2 py-1.5 text-sm bg-slate-950 border border-slate-700 rounded text-slate-100 placeholder-slate-600 resize-y"
            autoFocus
          />
          <div className="text-[10px] text-slate-500 mt-1">Cmd/Ctrl + Enter to submit</div>
        </div>

        <div className="px-4 pb-4 flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} className="px-3 py-1.5 text-sm rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium">
            {submitting ? 'Saving…' : `Mark ${rows.length} resolved`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Lightbox({ detail, onClose }: { detail: CheckImageDetail | null; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg max-w-5xl w-full max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-slate-800">
          <div className="text-sm text-slate-300">
            {detail?.payer_name && (
              <span><span className="text-slate-500">From</span> <strong>{detail.payer_name}</strong></span>
            )}
            {detail?.issuer && <span className="ml-3 text-slate-500">via {detail.issuer}</span>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
        {!detail ? (
          <div className="p-8 text-center text-slate-500">Loading image…</div>
        ) : (
          <div className="p-4 space-y-3">
            {detail.front_url && (
              <div>
                <div className="text-xs text-slate-500 mb-1">Front</div>
                <img src={detail.front_url} alt="Front" className="w-full rounded border border-slate-700 bg-white" />
              </div>
            )}
            {detail.back_url && (
              <div>
                <div className="text-xs text-slate-500 mb-1">Back</div>
                <img src={detail.back_url} alt="Back" className="w-full rounded border border-slate-700 bg-white" />
              </div>
            )}
            {(detail.payer_address || detail.check_date || detail.memo) && (
              <div className="text-xs text-slate-400 grid grid-cols-2 gap-x-4 gap-y-1 pt-2 border-t border-slate-800">
                {detail.check_date && <><span className="text-slate-500">Date</span><span>{fmtDate(detail.check_date)}</span></>}
                {detail.memo && <><span className="text-slate-500">Memo</span><span>{detail.memo}</span></>}
                {detail.payer_address && <><span className="text-slate-500 col-span-2">Address</span><span className="col-span-2 text-slate-300">{detail.payer_address}</span></>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
