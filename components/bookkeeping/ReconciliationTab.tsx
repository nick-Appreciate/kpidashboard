'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ExternalLink, Building2, Wallet, Check, X, Link2, Flag } from 'lucide-react';

type Row = {
  source: 'brex' | 'mercury';
  source_id: string;
  posted_date: string;
  vendor_or_merchant: string;
  amount: number;
  memo: string | null;
  suggested_af_vendor: string | null;
  suggested_af_vendor_id: string | null;
  external_link: string | null;
  brex_expense_id: string | null;
  flagged_at: string | null;
  flagged_reason: string | null;
  flagged_by: string | null;
};

type SourceFilter = 'all' | 'brex' | 'mercury';
type CategoryFilter = 'all' | 'has_vendor' | 'no_vendor';

type VendorOption = {
  vendor_id: string;
  vendor_name: string;
  /** Merchant that already owns this vendor, if any — one vendor, one merchant. */
  claimed_by: string | null;
};

type Bill = {
  bill_id: string;
  vendor_name: string | null;
  bill_date: string | null;
  paid_date: string | null;
  total: number;
  line_count: number;
  properties: string | null;
  memo: string | null;
};

/** Compare money in cents so float noise can't make an exact match look off. */
const cents = (n: number) => Math.round(n * 100);

/** Split the manual link box on commas; the server parses each entry. */
const splitManualIds = (raw: string) =>
  raw.split(',').map(s => s.trim()).filter(Boolean);

// Mirrors the server's rule — a link that misses by under $5 or under 2% of
// the charge can be forced through after confirmation. The server enforces
// it; this only decides whether the button is live.
const TOLERANCE_CENTS = 500;
const TOLERANCE_PCT = 0.02;
const withinTolerance = (deltaCents: number, chargeCents: number) => {
  const d = Math.abs(deltaCents);
  return d < TOLERANCE_CENTS || d < Math.abs(chargeCents) * TOLERANCE_PCT;
};

/** How far from the charge a bill can sit and still be offered as a suggestion. */
const SUGGEST_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;

const AF_BASE = 'https://appreciateinc.appfolio.com';

function createBillUrl(_vendorId: string | null) {
  // AppFolio's prefilled payee URL only opens the form inside an existing
  // session; deep-linking it from outside redirects to the bills list. Just
  // send the user to the New Bill page and let them pick the payee there.
  return `${AF_BASE}/accounting/bills/new`;
}

/**
 * Build a Brex expense deep-link. NF confirmed the working format is:
 *   /expenses?expenseId=<btoa("Expense:"+expense_id)>&filter=
 * with the base64 URL-encoded and a trailing empty filter param.
 *
 * If we don't have an expense_id (transaction not yet enriched), fall back
 * to searching Brex by the raw transaction ID — merchant-name search misses
 * some rows because Brex's own merchant display doesn't always match ours.
 */
function brexExpenseUrl(expenseId: string | null, brexId: string | null) {
  const base = 'https://dashboard.brex.com/expenses';
  if (expenseId) {
    const encoded = encodeURIComponent(btoa(`Expense:${expenseId}`));
    return `${base}?expenseId=${encoded}&filter=`;
  }
  if (brexId) {
    return `${base}?filter=SEARCHQUERY:${encodeURIComponent(brexId)}`;
  }
  return base;
}

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

/** Guess a corporate category from a merchant name for auto-memo. */
function corporateCategoryFor(merchant: string): string {
  const m = merchant.toUpperCase();
  if (/QT |BP#|PHILLIPS|CONOCO|CENEX|FLASH PETRO|CASEY|7-ELEVEN|SHELL|MARATHON|VALERO/.test(m)) return 'fuel';
  if (/VESTAL|TIRES PLUS|ROCK AUTO|CARQUEST|BULLET|AUTO|CONTINENTAL BATTERY/.test(m)) return 'auto';
  if (/ANTHROPIC|CLAUDE|LOOM|FIGMA|GOOGLE WORKSPACE|HALCYON|KEYCAFE|TU SMARTMOVE|PAYMENTUS|SLACK|ZOOM|GITHUB|LINEAR|BIRD APP|SPIN|LIME/.test(m)) return 'software / SaaS';
  if (/HAMPTON|HILTON|HYATT|MARRIOTT|DELTA|UNITED|AMERICANAIR|SOUTHWEST|AIRBNB|LYFT|UBER|TAXI|VILLAGECO\.WORK/.test(m)) return 'travel / lodging';
  if (/TST\*|SLAPS|PANDA|EL ALTENO|BURRITO|MCDONALD|COFFEE|PANERA|STARBUCKS|DONUTS|CAFE|PIZZA|DELIAS|BBQ|LUNCH|DINNER|RESTAURANT|KIWANIS|HUMANE/.test(m)) return 'meals';
  if (/BEST BUY|BEDFORD CAMERA|BESTBUY|APPLE\.COM|AMAZON/.test(m)) return 'electronics';
  if (/FACEBK|FACEBOOK|GOOGLE ADS|LINKEDIN/.test(m)) return 'marketing';
  return 'general corporate expense';
}

export default function ReconciliationTab({ since = '2026-01-01' }: { since?: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [removingKeys, setRemovingKeys] = useState<Set<string>>(new Set());
  const [flashKey, setFlashKey] = useState<{ key: string; text: string } | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [manualLink, setManualLink] = useState<{ key: string; billId: string } | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [billsLoading, setBillsLoading] = useState(false);
  const [billFilter, setBillFilter] = useState('');
  const [selectedBills, setSelectedBills] = useState<Set<string>>(new Set());
  const [linking, setLinking] = useState(false);
  const [feeLeakage, setFeeLeakage] = useState<{ total: number; count: number }>({ total: 0, count: 0 });

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/admin/reconciliation?since=${since}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Fetch failed');
      setRows(json.items);
      setFeeLeakage({ total: Number(json.fee_leakage ?? 0), count: Number(json.fee_leakage_count ?? 0) });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [since]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Vendor list is small (~220) and changes rarely — fetch once.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/reconciliation/vendor-map')
      .then(r => r.json())
      .then(j => { if (!cancelled && j.vendors) setVendors(j.vendors); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /** Persist a merchant -> AppFolio vendor mapping, then reload the queue. */
  const setVendorFor = async (row: Row, vendorId: string) => {
    try {
      const res = await fetch('/api/admin/reconciliation/vendor-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant: row.vendor_or_merchant,
          vendor_id: vendorId || null,
          source: row.source,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      // A remapped vendor changes which bills are on offer.
      setBills(null);
      setSelectedBills(new Set());
      await fetchData();
      // Refresh claim state so the picker greys out the right entries.
      const vr = await fetch('/api/admin/reconciliation/vendor-map').then(r => r.json()).catch(() => null);
      if (vr?.vendors) setVendors(vr.vendors);
    } catch (e) {
      alert(`Could not set vendor: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Expand a row to its vendor's unclaimed bills. */
  const toggleExpand = async (row: Row) => {
    const key = `${row.source}:${row.source_id}`;
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(key);
    setSelectedBills(new Set());
    setBillFilter('');
    setBills(null);
    if (!row.suggested_af_vendor) return;
    setBillsLoading(true);
    try {
      const res = await fetch(
        `/api/admin/reconciliation/bills?vendor=${encodeURIComponent(row.suggested_af_vendor)}`,
      );
      const j = await res.json().catch(() => ({}));
      if (res.ok) setBills(j.bills ?? []);
      else setBills([]);
    } catch {
      setBills([]);
    } finally {
      setBillsLoading(false);
    }
  };

  /**
   * Link bills to a charge. Entries may be bare ids (checkbox picker) or
   * pasted AppFolio URLs (manual box). The server re-derives the total from
   * af_bill_detail and refuses anything that doesn't cover the charge exactly,
   * so the client-side sum is only a preview.
   */
  const linkBills = async (row: Row, rawIds: string[], force = false) => {
    const key = `${row.source}:${row.source_id}`;
    setLinking(true);
    try {
      const res = await fetch('/api/admin/reconciliation/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: row.source, source_id: row.source_id, bill_ids: rawIds, force }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Close but not exact — confirm, then retry as a forced link.
        if (j.needs_confirm) {
          const v = Number(j.variance);
          const ok = window.confirm(
            `These bills total ${formatMoney(Number(j.bill_total))} but the charge is ` +
            `${formatMoney(Number(j.charge_amount))} — ${v > 0 ? 'over' : 'short'} by ` +
            `${formatMoney(Math.abs(v))}.\n\n` +
            `Link them anyway? The variance is recorded on the match and noted in the Brex memo.`,
          );
          if (!ok) return;
          await linkBills(row, rawIds, true);
          return;
        }
        // Keep the row (and any paste) in place so the user can correct it.
        if (j.amount_mismatch || j.bad_bill_id) {
          setFlashKey({
            key,
            text: j.amount_mismatch
              ? `bills ${formatMoney(Number(j.bill_total))} ≠ charge ${formatMoney(Number(j.charge_amount))}`
              : 'not a valid AF bill link',
          });
          window.setTimeout(() => setFlashKey(f => (f?.key === key ? null : f)), 4000);
          return;
        }
        throw new Error(j.error || res.statusText);
      }

      setExpandedKey(null);
      setManualLink(null);
      const v = Number(j.variance ?? 0);
      setFlashKey({
        key,
        text: `linked ${j.bill_ids.length} bill${j.bill_ids.length > 1 ? 's' : ''} — ${formatMoney(Number(j.bill_total))}`
          + (v !== 0 ? ` (${v > 0 ? '+' : '-'}${formatMoney(Math.abs(v))})` : ''),
      });
      setRemovingKeys(prev => new Set(prev).add(key));
      window.setTimeout(() => {
        setRows(prev => prev.filter(r => !(r.source === row.source && r.source_id === row.source_id)));
        setRemovingKeys(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setFlashKey(f => (f?.key === key ? null : f));
      }, 420);
    } catch (e) {
      alert(`Could not link bills: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLinking(false);
    }
  };

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
      if (categoryFilter === 'has_vendor' && !r.suggested_af_vendor) return false;
      if (categoryFilter === 'no_vendor' && r.suggested_af_vendor) return false;
      return true;
    });
  }, [rows, sourceFilter, categoryFilter]);

  const counts = useMemo(() => {
    const brex = rows.filter(r => r.source === 'brex');
    const merc = rows.filter(r => r.source === 'mercury');
    return {
      total: rows.length,
      total_amt: rows.reduce((s, r) => s + Number(r.amount), 0),
      brex_n: brex.length,
      brex_amt: brex.reduce((s, r) => s + Number(r.amount), 0),
      mercury_n: merc.length,
      mercury_amt: merc.reduce((s, r) => s + Number(r.amount), 0),
      has_vendor_n: rows.filter(r => r.suggested_af_vendor).length,
      no_vendor_n: rows.filter(r => !r.suggested_af_vendor).length,
      flagged_n: rows.filter(r => r.flagged_at).length,
    };
  }, [rows]);

  const doAction = async (row: Row, action: 'corporate' | 'flag' | 'undo', payload?: Record<string, string>) => {
    const key = `${row.source}:${row.source_id}`;
    setPendingId(key);
    try {
      const res = await fetch('/api/admin/reconciliation/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: row.source, source_id: row.source_id, action, ...payload }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      setManualLink(null);

      // Flag and unflag keep the row on the queue — it only changes
      // appearance and sorts to the top — so refetch rather than fading out.
      if (action === 'flag' || action === 'undo') {
        await fetchData();
        return;
      }

      // Corporate and match genuinely leave the queue: fade, then drop.
      setRemovingKeys(prev => new Set(prev).add(key));
      window.setTimeout(() => {
        setRows(prev => prev.filter(r => !(r.source === row.source && r.source_id === row.source_id)));
        setRemovingKeys(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setFlashKey(f => (f?.key === key ? null : f));
      }, 420);
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPendingId(null);
    }
  };

  // Pull fresh Brex + Mercury data on demand rather than waiting for the
  // cron, then re-read the queue.
  const runSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/admin/reconciliation/resync`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      await fetchData();
      const failed = (j.results || []).filter((r: { ok: boolean }) => !r.ok);
      if (failed.length > 0) {
        const detail = failed
          .map((r: { name: string; detail: unknown }) => `${r.name}: ${String(r.detail)}`)
          .join('\n');
        alert(`Some syncs failed:\n${detail}`);
      }
    } catch (e) {
      alert(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const runSweep = async () => {
    setSweeping(true);
    try {
      const res = await fetch(`/api/admin/reconciliation/sweep?since=${since}`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      // Refresh the list so newly-matched rows drop off. Show a quick summary.
      await fetchData();
      const parts = [
        `scanned ${j.scanned}`,
        `matched ${j.matched}`,
        j.brex_pushed ? `${j.brex_pushed} pushed to Brex` : null,
        j.brex_skipped_no_expense_id ? `${j.brex_skipped_no_expense_id} skipped (no expense_id)` : null,
        (j.failures?.length ?? 0) > 0 ? `${j.failures.length} failed` : null,
      ].filter(Boolean).join(' · ');
      alert(`Sweep: ${parts}`);
    } catch (e) {
      alert(`Sweep failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSweeping(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-card p-8 text-center text-slate-400">
        Loading reconciliation…
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card p-6 border border-red-500/40">
        <p className="text-red-400 text-sm">Error: {error}</p>
        <button onClick={fetchData} className="mt-3 px-3 py-1.5 text-xs bg-white/5 rounded hover:bg-white/10">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + stats */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Reconciliation</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Brex + Mercury outflows with no matching AppFolio bill (since {since}). Goal: keep this at zero.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={runSweep}
              disabled={sweeping || refreshing}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
              title="Re-check every row against AppFolio and remove any that now match"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${sweeping ? 'animate-spin' : ''}`} />
              {sweeping ? 'Sweeping…' : 'Auto-match'}
            </button>
            <button
              onClick={runSync}
              disabled={syncing || refreshing || sweeping}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 disabled:opacity-40"
              title="Pull fresh Brex + Mercury transactions now instead of waiting for the scheduled sync"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              onClick={fetchData}
              disabled={refreshing || syncing}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-40"
              title="Re-read the queue without pulling new bank data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-6 gap-3 mb-3">
          <div className="bg-white/5 rounded-lg p-3">
            <div className="text-xs text-slate-400">Total unmatched</div>
            <div className="text-lg font-semibold text-slate-100">{counts.total}</div>
            <div className="text-xs text-slate-500">{formatMoney(counts.total_amt)}</div>
          </div>
          <div className="bg-violet-500/10 rounded-lg p-3">
            <div className="text-xs text-violet-300">Brex</div>
            <div className="text-lg font-semibold text-violet-200">{counts.brex_n}</div>
            <div className="text-xs text-violet-400/70">{formatMoney(counts.brex_amt)}</div>
          </div>
          <div className="bg-cyan-500/10 rounded-lg p-3">
            <div className="text-xs text-cyan-300">Mercury</div>
            <div className="text-lg font-semibold text-cyan-200">{counts.mercury_n}</div>
            <div className="text-xs text-cyan-400/70">{formatMoney(counts.mercury_amt)}</div>
          </div>
          <div className="bg-slate-500/10 rounded-lg p-3">
            <div className="text-xs text-slate-300">No AppFolio vendor</div>
            <div className="text-lg font-semibold text-slate-200">{counts.no_vendor_n}</div>
            <div className="text-xs text-slate-400/70">need new vendor</div>
          </div>
          <div className="bg-amber-500/10 rounded-lg p-3">
            <div className="text-xs text-amber-300">Flagged</div>
            <div className="text-lg font-semibold text-amber-200">{counts.flagged_n}</div>
            <div className="text-xs text-amber-400/70">awaiting review</div>
          </div>
          <div
            className="bg-rose-500/10 rounded-lg p-3"
            title="Card and ACH convenience fees we paid that never appeared on the AppFolio bill, so they were never billed back to a property. Summed from the variance on every approximate match."
          >
            <div className="text-xs text-rose-300">Fee leakage</div>
            <div className="text-lg font-semibold text-rose-200">{formatMoney(feeLeakage.total)}</div>
            <div className="text-xs text-rose-400/70">
              across {feeLeakage.count} charge{feeLeakage.count === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {(['all', 'brex', 'mercury'] as SourceFilter[]).map(s => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  sourceFilter === s
                    ? s === 'brex' ? 'bg-violet-500/20 text-violet-300'
                      : s === 'mercury' ? 'bg-cyan-500/20 text-cyan-300'
                      : 'bg-white/15 text-slate-100'
                    : 'bg-white/5 text-slate-400 hover:bg-white/10'
                }`}
              >
                {s === 'all' ? 'All sources' : s === 'brex' ? 'Brex only' : 'Mercury only'}
              </button>
            ))}
          </div>
          <div className="flex gap-1 border-l border-[var(--glass-border)] pl-2">
            {([
              { key: 'all' as CategoryFilter, label: 'All' },
              { key: 'has_vendor' as CategoryFilter, label: `Vendor exists (${counts.has_vendor_n})` },
              { key: 'no_vendor' as CategoryFilter, label: `Need new vendor (${counts.no_vendor_n})` },
            ]).map(f => (
              <button
                key={f.key}
                onClick={() => setCategoryFilter(f.key)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  categoryFilter === f.key ? 'bg-white/15 text-slate-100' : 'bg-white/5 text-slate-400 hover:bg-white/10'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Rows */}
      {filtered.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <div className="text-4xl mb-2">🎉</div>
          <p className="text-slate-300 font-medium">All clear</p>
          <p className="text-xs text-slate-500 mt-1">No unmatched outflows for the current filter.</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5 sticky top-0 z-10">
                <tr className="text-left text-xs text-slate-400 uppercase">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Vendor / Merchant</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                  <th className="px-3 py-2 font-medium">Memo</th>
                  <th className="px-3 py-2 font-medium">Suggested AF vendor</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => {
                  const key = `${row.source}:${row.source_id}`;
                  const isPending = pendingId === key;
                  const isRemoving = removingKeys.has(key);
                  const isManual = manualLink?.key === key;
                  const isFlagged = !!row.flagged_at;
                  const flash = flashKey?.key === key ? flashKey.text : null;
                  const isExpanded = expandedKey === key;
                  return (
                  <React.Fragment key={key}>
                    <tr
                      onClick={e => {
                        // Don't hijack clicks meant for the controls in the row.
                        if ((e.target as HTMLElement).closest('button, a, select, input, label')) return;
                        toggleExpand(row);
                      }}
                      className={`border-t border-[var(--glass-border)] hover:bg-white/5 transition-all duration-400 ease-in-out cursor-pointer ${
                        isRemoving ? 'opacity-0 -translate-x-4 bg-emerald-500/5' : 'opacity-100'
                      } ${isFlagged ? 'bg-amber-500/[0.07]' : ''} ${isExpanded ? 'bg-white/5' : ''}`}
                    >
                      <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{row.posted_date}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                          row.source === 'brex' ? 'bg-violet-500/15 text-violet-300' : 'bg-cyan-500/15 text-cyan-300'
                        }`}>
                          {row.source === 'brex' ? <Wallet className="w-3 h-3" /> : <Building2 className="w-3 h-3" />}
                          {row.source}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-200">
                        {row.source === 'brex' && row.brex_expense_id ? (
                          <a
                            href={brexExpenseUrl(row.brex_expense_id, row.source_id)}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-accent inline-flex items-center gap-1"
                            title="Open in Brex dashboard"
                          >
                            {row.vendor_or_merchant}
                            <ExternalLink className="w-3 h-3 opacity-60" />
                          </a>
                        ) : row.external_link ? (
                          <a href={row.external_link} target="_blank" rel="noreferrer" className="hover:text-accent inline-flex items-center gap-1">
                            {row.vendor_or_merchant}
                            <ExternalLink className="w-3 h-3 opacity-60" />
                          </a>
                        ) : (
                          row.vendor_or_merchant
                        )}
                        {isFlagged && (
                          <div className="mt-0.5 flex items-start gap-1 text-[11px] text-amber-400/90">
                            <Flag className="w-3 h-3 mt-px shrink-0" />
                            <span>
                              {row.flagged_reason || 'flagged for review'}
                              {row.flagged_by && <span className="text-amber-400/60"> — {row.flagged_by}</span>}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-100 font-medium whitespace-nowrap">{formatMoney(Number(row.amount))}</td>
                      <td className="px-3 py-2 text-slate-400 text-xs max-w-[240px] truncate" title={row.memo || ''}>{row.memo || '—'}</td>
                      <td className="px-3 py-2 text-slate-300">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={row.suggested_af_vendor_id ?? ''}
                            onChange={e => setVendorFor(row, e.target.value)}
                            className="dark-select text-xs px-1.5 py-1 max-w-[190px]"
                            title="Map this merchant to an AppFolio vendor. Vendors already claimed by another merchant are disabled."
                          >
                            <option value="">
                              {row.suggested_af_vendor ? `${row.suggested_af_vendor} (unmapped)` : '— pick vendor —'}
                            </option>
                            {vendors.map(v => {
                              const takenByOther =
                                !!v.claimed_by &&
                                v.claimed_by.toLowerCase() !== row.vendor_or_merchant.toLowerCase();
                              return (
                                <option key={v.vendor_id} value={v.vendor_id} disabled={takenByOther}>
                                  {v.vendor_name}{takenByOther ? ` — used by ${v.claimed_by}` : ''}
                                </option>
                              );
                            })}
                          </select>
                          {row.suggested_af_vendor_id && (
                            <a
                              href={createBillUrl(row.suggested_af_vendor_id)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent hover:text-accent-strong shrink-0"
                              title="Open the New Bill form in AppFolio"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {flash && (
                          <span className={`mr-2 text-xs ${flash.startsWith('matched') || flash.startsWith('linked') ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {flash}
                          </span>
                        )}
                        {isRemoving ? null : isManual ? (
                          // Manual override: link straight to a bill_id the
                          // bookkeeper looked up in AppFolio, bypassing the
                          // date/amount matcher entirely.
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="text"
                              value={manualLink.billId}
                              onChange={e => setManualLink({ key, billId: e.target.value })}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && splitManualIds(manualLink.billId).length > 0) {
                                  linkBills(row, splitManualIds(manualLink.billId));
                                }
                                if (e.key === 'Escape') setManualLink(null);
                              }}
                              placeholder="Paste AppFolio bill link(s), comma separated"
                              title="Paste the bill's AppFolio URL (…/accounting/payable_invoices/26069). Several can be separated by commas — they must sum to the charge exactly. A bare bill number works too."
                              className="dark-input w-80 text-xs px-2 py-1"
                              autoFocus
                            />
                            <button
                              onClick={() => linkBills(row, splitManualIds(manualLink.billId))}
                              disabled={linking || splitManualIds(manualLink.billId).length === 0}
                              className="p-1 text-emerald-400 hover:bg-emerald-500/15 rounded disabled:opacity-30"
                              title="Link these bills — their total must equal the charge exactly"
                            >
                              {linking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => setManualLink(null)}
                              className="p-1 text-slate-400 hover:bg-white/10 rounded"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => setManualLink({ key, billId: '' })}
                              disabled={isPending}
                              className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/15 rounded disabled:opacity-30"
                              title="Paste the AppFolio bill link to record this match — automatic matching runs from Auto-match at the top"
                            >
                              <Link2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                const category = corporateCategoryFor(row.vendor_or_merchant);
                                const base = `Corporate — ${category} (${row.vendor_or_merchant})`;
                                const note = prompt(
                                  `Mark corporate. Add a note explaining why — it gets appended to the memo pushed to Brex.\n\nAuto memo: ${base}`,
                                  '',
                                );
                                // Cancel aborts; empty string still proceeds with just the auto memo.
                                if (note === null) return;
                                const memo = note.trim() ? `${base} — ${note.trim()}` : base;
                                doAction(row, 'corporate', { reason: memo });
                              }}
                              disabled={isPending}
                              className="p-1 text-slate-400 hover:text-slate-200 hover:bg-white/10 rounded"
                              title={`Mark as corporate: ${corporateCategoryFor(row.vendor_or_merchant)}`}
                            >
                              <Building2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                if (isFlagged) {
                                  doAction(row, 'undo');
                                  return;
                                }
                                const reason = prompt('Why is this unknown? (optional — helps whoever reviews this)') ?? '';
                                doAction(row, 'flag', reason ? { reason } : undefined);
                              }}
                              disabled={isPending}
                              className={`p-1 rounded ${
                                isFlagged
                                  ? 'text-amber-400 bg-amber-500/15 hover:bg-amber-500/25'
                                  : 'text-slate-400 hover:text-amber-400 hover:bg-amber-500/15'
                              }`}
                              title={isFlagged
                                ? 'Clear this flag and return the row to the normal queue'
                                : 'Flag as unknown — escalates for review and pins the row to the top'}
                            >
                              <Flag className={`w-4 h-4 ${isFlagged ? 'fill-current' : ''}`} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="border-t border-[var(--glass-border)] bg-surface-base/40">
                        <td colSpan={7} className="px-4 py-3">
                          {!row.suggested_af_vendor ? (
                            <p className="text-xs text-amber-400">
                              Pick an AppFolio vendor for this merchant first — bills are listed per vendor.
                            </p>
                          ) : billsLoading ? (
                            <p className="text-xs text-slate-400 flex items-center gap-2">
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              Loading unclaimed bills for {row.suggested_af_vendor}…
                            </p>
                          ) : !bills || bills.length === 0 ? (
                            <p className="text-xs text-slate-400">
                              No unclaimed {row.suggested_af_vendor} bills since 2026-01-01.
                            </p>
                          ) : (() => {
                            const selectedTotal = bills
                              .filter(b => selectedBills.has(b.bill_id))
                              .reduce((s, b) => s + Number(b.total), 0);
                            const target = Number(row.amount);
                            const deltaCents = cents(selectedTotal) - cents(target);
                            const exact = deltaCents === 0;
                            const delta = selectedTotal - target;
                            const forceable = !exact
                              && selectedBills.size > 0
                              && withinTolerance(deltaCents, cents(target));

                            // Rank single bills that could cover this charge on
                            // their own — exact first, then anything inside the
                            // $5 / 2% tolerance, closest first. Suggestions are
                            // never pre-checked; the convention varies enough by
                            // hand that the call stays with the reviewer.
                            //
                            // Amount alone is too loose: without the date guard
                            // a January bill surfaces as a "likely match" for a
                            // July charge purely because it lands within $5.
                            const chargeTime = new Date(row.posted_date).getTime();
                            const nearInTime = (b: Bill) => {
                              const d = b.paid_date || b.bill_date;
                              if (!d) return false;
                              return Math.abs(new Date(d).getTime() - chargeTime) <= SUGGEST_WINDOW_MS;
                            };
                            const scored = bills.map(b => {
                              const d = cents(Number(b.total)) - cents(target);
                              const closeEnough = d === 0 || withinTolerance(d, cents(target));
                              return { b, d, suggested: closeEnough && nearInTime(b) };
                            });
                            const ranked = scored
                              .map((s, i) => ({ ...s, i }))
                              .sort((a, z) => {
                                if (a.suggested !== z.suggested) return a.suggested ? -1 : 1;
                                if (a.suggested) return Math.abs(a.d) - Math.abs(z.d);
                                return a.i - z.i;   // otherwise keep the RPC's date ordering
                              });
                            const suggestedCount = scored.filter(s => s.suggested).length;
                            const shown = billFilter.trim()
                              ? ranked.filter(({ b }) =>
                                  `${b.bill_id} ${b.properties ?? ''} ${b.memo ?? ''} ${b.total}`
                                    .toLowerCase()
                                    .includes(billFilter.trim().toLowerCase()))
                              : ranked;
                            return (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                  <div className="text-xs text-slate-400">
                                    {bills.length} unclaimed {row.suggested_af_vendor} bill{bills.length === 1 ? '' : 's'} since 2026-01-01
                                    {' · '}select any combination that totals {formatMoney(target)}
                                    {suggestedCount > 0 && (
                                      <span className="text-cyan-300">
                                        {' · '}{suggestedCount} likely match{suggestedCount === 1 ? '' : 'es'} pinned above — verify before linking
                                      </span>
                                    )}
                                  </div>
                                  <input
                                    value={billFilter}
                                    onChange={e => setBillFilter(e.target.value)}
                                    placeholder="Filter by amount, property, memo…"
                                    className="dark-input text-xs px-2 py-1 w-56"
                                  />
                                </div>

                                <div className="max-h-72 overflow-y-auto rounded border border-[var(--glass-border)]">
                                  <table className="w-full text-xs">
                                    <thead className="bg-white/5 sticky top-0 z-10">
                                      <tr className="text-left text-slate-400">
                                        <th className="px-2 py-1.5 w-8"></th>
                                        <th className="px-2 py-1.5 font-medium">Bill #</th>
                                        <th className="px-2 py-1.5 font-medium">Date</th>
                                        <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                                        <th className="px-2 py-1.5 font-medium">Property</th>
                                        <th className="px-2 py-1.5 font-medium">Memo</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {shown.map(({ b, d, suggested }) => {
                                        const checked = selectedBills.has(b.bill_id);
                                        return (
                                          <tr
                                            key={b.bill_id}
                                            className={`border-t border-[var(--glass-border)] ${
                                              checked ? 'bg-emerald-500/10'
                                                : suggested ? 'bg-cyan-500/[0.07] hover:bg-cyan-500/10'
                                                : 'hover:bg-white/5'
                                            }`}
                                          >
                                            <td className="px-2 py-1.5">
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => setSelectedBills(prev => {
                                                  const next = new Set(prev);
                                                  if (next.has(b.bill_id)) next.delete(b.bill_id);
                                                  else next.add(b.bill_id);
                                                  return next;
                                                })}
                                              />
                                            </td>
                                            <td className="px-2 py-1.5">
                                              <a
                                                href={`${AF_BASE}/accounting/payable_invoices/${b.bill_id}`}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-accent hover:text-accent-strong inline-flex items-center gap-1"
                                              >
                                                {b.bill_id}
                                                <ExternalLink className="w-3 h-3 opacity-60" />
                                              </a>
                                            </td>
                                            <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap">
                                              {b.paid_date || b.bill_date || '—'}
                                            </td>
                                            <td className="px-2 py-1.5 text-right whitespace-nowrap">
                                              <span className="text-slate-100">{formatMoney(Number(b.total))}</span>
                                              {b.line_count > 1 && (
                                                <span className="text-slate-500"> ({b.line_count})</span>
                                              )}
                                              {suggested && (
                                                <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-cyan-500/20 text-cyan-300">
                                                  {d === 0 ? 'exact' : `${d > 0 ? '+' : '-'}${formatMoney(Math.abs(d) / 100)}`}
                                                </span>
                                              )}
                                            </td>
                                            <td className="px-2 py-1.5 text-slate-400 max-w-[200px] truncate" title={b.properties ?? ''}>
                                              {b.properties || '—'}
                                            </td>
                                            <td className="px-2 py-1.5 text-slate-500 max-w-[220px] truncate" title={b.memo ?? ''}>
                                              {b.memo || '—'}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>

                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-xs">
                                    <span className="text-slate-400">Selected </span>
                                    <span className={exact ? 'text-emerald-400 font-medium' : 'text-slate-200'}>
                                      {formatMoney(selectedTotal)}
                                    </span>
                                    <span className="text-slate-500"> / {formatMoney(target)}</span>
                                    {selectedBills.size > 0 && !exact && (
                                      <span className={forceable ? 'text-amber-400' : 'text-red-400'}>
                                        {' '}({delta > 0 ? '+' : ''}{formatMoney(delta)}
                                        {forceable ? ' — will ask to confirm' : ' — too far off to link'})
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => linkBills(row, Array.from(selectedBills))}
                                    disabled={(!exact && !forceable) || linking || selectedBills.size === 0}
                                    className={`px-3 py-1.5 text-xs rounded font-medium disabled:opacity-30 disabled:cursor-not-allowed ${
                                      forceable
                                        ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                                        : 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                                    }`}
                                    title={
                                      exact ? 'Link these bills to the charge'
                                        : forceable ? `Off by ${formatMoney(Math.abs(delta))} — you'll be asked to confirm`
                                        : 'Selected bills must total the charge (or be within $5 / 2%)'
                                    }
                                  >
                                    {linking
                                      ? 'Linking…'
                                      : forceable
                                        ? `Link anyway (${delta > 0 ? '+' : ''}${formatMoney(delta)})`
                                        : `Link ${selectedBills.size || ''} bill${selectedBills.size === 1 ? '' : 's'}`.trim()}
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
