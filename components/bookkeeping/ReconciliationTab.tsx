'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ExternalLink, Building2, Wallet, Check, X, Undo2, Link2, Flag } from 'lucide-react';

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
};

type SourceFilter = 'all' | 'brex' | 'mercury';
type CategoryFilter = 'all' | 'has_vendor' | 'no_vendor';

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

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/admin/reconciliation?since=${since}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Fetch failed');
      setRows(json.items);
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
    };
  }, [rows]);

  const doAction = async (row: Row, action: 'corporate' | 'match' | 'dismiss' | 'flag', payload?: Record<string, string>) => {
    const key = `${row.source}:${row.source_id}`;
    setPendingId(key);
    try {
      const res = await fetch('/api/admin/reconciliation/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: row.source, source_id: row.source_id, action, ...payload }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Explicit "no AF bill matches this yet" — don't scare the user
        // with an alert, just flash it inline.
        if (res.status === 409 && j.no_match) {
          setFlashKey({ key, text: 'no AF match yet — try after next sync' });
          window.setTimeout(() => setFlashKey(f => (f?.key === key ? null : f)), 3200);
          return;
        }
        throw new Error(j.error || res.statusText);
      }

      if (action === 'match' && j.matched_bill_id) {
        setFlashKey({ key, text: `matched AF #${j.matched_bill_id}` });
      }

      // Fade out, then drop from the list.
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
              onClick={fetchData}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-4 gap-3 mb-3">
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
          <div className="bg-amber-500/10 rounded-lg p-3">
            <div className="text-xs text-amber-300">No AppFolio vendor</div>
            <div className="text-lg font-semibold text-amber-200">{counts.no_vendor_n}</div>
            <div className="text-xs text-amber-400/70">need new vendor</div>
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
                  const flash = flashKey?.key === key ? flashKey.text : null;
                  return (
                    <tr
                      key={key}
                      className={`border-t border-[var(--glass-border)] hover:bg-white/5 transition-all duration-400 ease-in-out ${
                        isRemoving ? 'opacity-0 -translate-x-4 bg-emerald-500/5' : 'opacity-100'
                      }`}
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
                      </td>
                      <td className="px-3 py-2 text-right text-slate-100 font-medium whitespace-nowrap">{formatMoney(Number(row.amount))}</td>
                      <td className="px-3 py-2 text-slate-400 text-xs max-w-[240px] truncate" title={row.memo || ''}>{row.memo || '—'}</td>
                      <td className="px-3 py-2 text-slate-300">
                        {row.suggested_af_vendor ? (
                          <a
                            href={createBillUrl(row.suggested_af_vendor_id)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:text-accent-strong inline-flex items-center gap-1"
                            title="Open New Bill form in AppFolio with this vendor pre-selected"
                          >
                            {row.suggested_af_vendor}
                            <ExternalLink className="w-3 h-3 opacity-60" />
                          </a>
                        ) : (
                          <span className="text-amber-400 text-xs">no match — needs new vendor</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {flash && (
                          <span className={`mr-2 text-xs ${flash.startsWith('matched') ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {flash}
                          </span>
                        )}
                        {isRemoving ? null : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => doAction(row, 'match')}
                              disabled={isPending}
                              className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/15 rounded disabled:opacity-30"
                              title="Check AppFolio for a matching bill and auto-resolve"
                            >
                              {isPending ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                              ) : (
                                <Link2 className="w-4 h-4" />
                              )}
                            </button>
                            <button
                              onClick={() => {
                                const category = corporateCategoryFor(row.vendor_or_merchant);
                                const memo = `Corporate — ${category} (${row.vendor_or_merchant})`;
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
                                const reason = prompt('Why is this unknown? (optional — helps whoever reviews this)') ?? '';
                                doAction(row, 'flag', reason ? { reason } : undefined);
                              }}
                              disabled={isPending}
                              className="p-1 text-slate-400 hover:text-amber-400 hover:bg-amber-500/15 rounded"
                              title="Flag as unknown — escalates for review, drops off the queue with a note"
                            >
                              <Flag className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                const reason = prompt('Dismiss reason (optional):') ?? '';
                                doAction(row, 'dismiss', reason ? { reason } : undefined);
                              }}
                              disabled={isPending}
                              className="p-1 text-slate-400 hover:text-red-400 hover:bg-red-500/15 rounded"
                              title="Dismiss"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
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
