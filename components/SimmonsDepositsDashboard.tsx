'use client';

import { Fragment, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';

// ── Types ────────────────────────────────────────────────────────────────────

interface CheckImage {
  id: string; image_index: number; image_type: string;
  amount: string | null; check_type: string | null; payer_name: string | null;
  payer_address: string | null; issuer: string | null; money_order_number: string | null;
  check_number: string | null; check_date: string | null; memo: string | null;
  routing_number: string | null; front_url: string | null; back_url: string | null;
  extracted_at: string | null;
}

interface Deposit {
  id: string; account_suffix: string; deposit_date: string; amount: number;
  image_count: number; transaction_id: string | null;
  extracted_count: number; total_checks: number; payers: string[]; types: string[];
}

interface ReconcileRow {
  status: 'matched' | 'simmons_only' | 'af_only';
  check_image_id: string | null; deposit_id: string | null;
  deposit_date: string | null; check_type: string | null;
  simmons_payer: string | null; simmons_amount: string | null;
  money_order_number: string | null; check_number: string | null;
  account_suffix: string | null; ref_norm: string | null;
  front_image_path: string | null; back_image_path: string | null;
  af_id: string | null; af_date: string | null; af_payer: string | null;
  af_amount: string | null; ref_raw: string | null;
  amounts_match: boolean | null;
  duplicate_ref: boolean | null;
  af_property: string | null;
  af_unit: string | null;
  af_tenant_id: number | null;
  af_receipt_id: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const ACCOUNT_LABELS: Record<string, string> = { x5218: 'Columbia', x3505: 'Como SD', x1552: 'KC' };
const CHECK_TYPE_LABELS: Record<string, string> = {
  personal_check: 'Check', money_order: 'MO', cashiers_check: "Cashier's",
  business_check: 'Business', usps_money_order: 'USPS MO', corporate_check: 'Corp',
};

type ReconcileView = 'bank_only' | 'af_only' | 'matched' | 'duplicates';

// ── Component ────────────────────────────────────────────────────────────────

export default function SimmonsDepositsDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const router = useRouter();

  // Persist view in URL hash so refresh stays on the same tab
  const getInitialView = (): ReconcileView => {
    if (typeof window === 'undefined') return 'bank_only';
    const hash = window.location.hash.replace('#', '');
    if (['bank_only', 'af_only', 'matched', 'duplicates'].includes(hash)) return hash as ReconcileView;
    return 'bank_only';
  };
  const getInitialTab = (): 'reconcile' | 'deposits' => {
    if (typeof window === 'undefined') return 'reconcile';
    return window.location.hash === '#deposits' ? 'deposits' : 'reconcile';
  };

  const [tab, setTab] = useState<'reconcile' | 'deposits'>(getInitialTab);
  const [reconcileView, setReconcileView] = useState<ReconcileView>(getInitialView);

  const updateTab = (t: 'reconcile' | 'deposits') => {
    setTab(t);
    setExpandedId(null);
    window.location.hash = t === 'deposits' ? 'deposits' : reconcileView;
  };
  const updateView = (v: ReconcileView) => {
    setReconcileView(v);
    setExpandedId(null);
    window.scrollTo({ top: 0 });
    window.location.hash = v;
  };

  // Deposits tab state
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [total, setTotal] = useState(0);
  const [dPage, setDPage] = useState(1);
  const [dSearch, setDSearch] = useState('');
  const [dInput, setDInput] = useState('');
  const [dLoading, setDLoading] = useState(false);

  // Reconcile data
  const [allRows, setAllRows] = useState<ReconcileRow[]>([]);
  const [rLoading, setRLoading] = useState(false);
  const [rSearch, setRSearch] = useState('');
  const [rInput, setRInput] = useState('');

  // Shared state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandMode, setExpandMode] = useState<'check' | 'deposit'>('check');
  const [images, setImages] = useState<Record<string, CheckImage[]>>({});
  const [loadingImages, setLoadingImages] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxUrl(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    if (!authLoading && appUser && appUser.role !== 'admin') router.push('/');
  }, [authLoading, appUser, router]);

  // ── Fetch deposits ────────────────────────────────────────────────────────
  const fetchDeposits = useCallback(async () => {
    setDLoading(true);
    try {
      const res = await fetch(`/api/admin/simmons?${new URLSearchParams({ page: String(dPage), search: dSearch })}`);
      const data = await res.json();
      setDeposits(data.deposits || []);
      setTotal(data.total || 0);
    } finally { setDLoading(false); }
  }, [dPage, dSearch]);

  useEffect(() => { if (tab === 'deposits') fetchDeposits(); }, [tab, fetchDeposits]);

  // ── Fetch reconcile data (once) ───────────────────────────────────────────
  const fetchReconcile = useCallback(async () => {
    setRLoading(true);
    try {
      const res = await fetch('/api/admin/simmons?mode=reconcile');
      const data = await res.json();
      setAllRows(data.rows || []);
    } finally { setRLoading(false); }
  }, []);

  useEffect(() => { if (tab === 'reconcile') fetchReconcile(); }, [tab, fetchReconcile]);

  // ── Search ────────────────────────────────────────────────────────────────
  const handleDSearch = (val: string) => {
    setDInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDSearch(val); setDPage(1); }, 400);
  };
  const handleRSearch = (val: string) => {
    setRInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setRSearch(val), 300);
  };

  // ── Expand: single check image ─────────────────────────────────────────────
  const expandCheck = async (checkImageId: string) => {
    if (expandedId === `check:${checkImageId}`) { setExpandedId(null); return; }
    const key = `check:${checkImageId}`;
    setExpandedId(key);
    setExpandMode('check');
    if (images[key]) return;
    setLoadingImages(key);
    try {
      const res = await fetch(`/api/admin/simmons?check_image_id=${checkImageId}`);
      if (!res.ok) { setImages(prev => ({ ...prev, [key]: [] })); return; }
      const data = await res.json();
      setImages(prev => ({ ...prev, [key]: data.images || [] }));
    } catch { setImages(prev => ({ ...prev, [key]: [] })); }
    finally { setLoadingImages(null); }
  };

  // ── Expand: full deposit ──────────────────────────────────────────────────
  const expandDeposit = async (depositId: string) => {
    const key = `deposit:${depositId}`;
    if (expandedId === key) { setExpandedId(null); return; }
    setExpandedId(key);
    setExpandMode('deposit');
    if (images[key]) return;
    setLoadingImages(key);
    try {
      const res = await fetch(`/api/admin/simmons?deposit_id=${depositId}`);
      if (!res.ok) { setImages(prev => ({ ...prev, [key]: [] })); return; }
      const data = await res.json();
      setImages(prev => ({ ...prev, [key]: data.images || [] }));
    } catch { setImages(prev => ({ ...prev, [key]: [] })); }
    finally { setLoadingImages(null); }
  };

  // ── Legacy expand for deposits tab ────────────────────────────────────────
  const toggleExpand = async (depositId: string) => {
    if (expandedId === depositId) { setExpandedId(null); return; }
    setExpandedId(depositId);
    if (images[depositId]) return;
    setLoadingImages(depositId);
    try {
      const res = await fetch(`/api/admin/simmons?deposit_id=${depositId}`);
      if (!res.ok) { setImages(prev => ({ ...prev, [depositId]: [] })); return; }
      const data = await res.json();
      setImages(prev => ({ ...prev, [depositId]: data.images || [] }));
    } catch { setImages(prev => ({ ...prev, [depositId]: [] })); }
    finally { setLoadingImages(null); }
  };

  // ── Derived data (sorted by date descending) ───────────────────────────────
  const byDateDesc = (a: ReconcileRow, b: ReconcileRow) => {
    const da = a.deposit_date || a.af_date || '';
    const db = b.deposit_date || b.af_date || '';
    return db.localeCompare(da);
  };
  const bankOnly = allRows.filter(r => r.status === 'simmons_only').sort(byDateDesc);
  const afOnly = allRows.filter(r => r.status === 'af_only').sort(byDateDesc);
  const matched = allRows.filter(r => r.status === 'matched').sort(byDateDesc);
  const duplicates = allRows.filter(r => r.duplicate_ref).sort(byDateDesc);

  const searchFilter = (r: ReconcileRow) => {
    if (!rSearch) return true;
    // Strip $, commas from search to match raw amounts
    const q = rSearch.toLowerCase().replace(/[$,]/g, '');
    const fmtAmt = (n: number | null) => n != null ? [String(n), n.toFixed(2), n.toLocaleString('en-US', { minimumFractionDigits: 2 })] : [];
    const amounts = [...fmtAmt(r.simmons_amount != null ? Number(r.simmons_amount) : null), ...fmtAmt(r.af_amount != null ? Number(r.af_amount) : null)];
    return (
      (r.simmons_payer || '').toLowerCase().includes(q) ||
      (r.af_payer || '').toLowerCase().includes(q) ||
      (r.ref_raw || '').toLowerCase().includes(q) ||
      (r.money_order_number || '').toLowerCase().includes(q) ||
      (r.check_number || '').toLowerCase().includes(q) ||
      (r.af_property || '').toLowerCase().includes(q) ||
      (r.af_unit || '').toLowerCase().includes(q) ||
      amounts.some(a => a.includes(q))
    );
  };

  const visibleRows = (
    reconcileView === 'bank_only' ? bankOnly :
    reconcileView === 'af_only' ? afOnly :
    reconcileView === 'matched' ? matched :
    duplicates
  ).filter(searchFilter);

  if (authLoading) return null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-base font-semibold text-white">Simmons Check Reconciliation</h1>
          <div className="flex gap-0.5 mt-1.5">
            {(['reconcile', 'deposits'] as const).map(t => (
              <button key={t}
                onClick={() => updateTab(t)}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  tab === t ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {t === 'reconcile' ? 'Reconcile' : 'All Deposits'}
              </button>
            ))}
          </div>
        </div>
        <input
          type="text"
          placeholder="Search payer, ref#, amount..."
          value={tab === 'deposits' ? dInput : rInput}
          onChange={e => tab === 'deposits' ? handleDSearch(e.target.value) : handleRSearch(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white placeholder:text-slate-500 w-56 focus:outline-none focus:border-white/20"
        />
      </div>

      {/* ── Reconcile ──────────────────────────────────────────────────────── */}
      {tab === 'reconcile' && (
        <>
          {/* View selector tabs */}
          {!rLoading && (
            <div className="flex gap-2 mb-4">
              {([
                { key: 'bank_only' as const, label: 'Bank Only', count: bankOnly.length, color: 'amber' },
                { key: 'af_only' as const, label: 'AF Only', count: afOnly.length, color: 'red' },
                { key: 'matched' as const, label: 'Matched', count: matched.length, color: 'emerald' },
                ...(duplicates.length > 0 ? [{ key: 'duplicates' as const, label: 'Dup Refs', count: duplicates.length, color: 'orange' }] : []),
              ] as { key: ReconcileView; label: string; count: number; color: string }[]).map(v => {
                const isActive = reconcileView === v.key;
                const colorMap: Record<string, { activeBg: string; activeBorder: string; activeText: string }> = {
                  amber:   { activeBg: 'bg-amber-500/10',   activeBorder: 'border-amber-500',   activeText: 'text-amber-400'   },
                  red:     { activeBg: 'bg-red-500/10',     activeBorder: 'border-red-500',     activeText: 'text-red-400'     },
                  emerald: { activeBg: 'bg-emerald-500/10', activeBorder: 'border-emerald-500', activeText: 'text-emerald-400' },
                  orange:  { activeBg: 'bg-orange-500/10',  activeBorder: 'border-orange-500',  activeText: 'text-orange-400'  },
                };
                const cm = colorMap[v.color] || colorMap.amber;
                return (
                  <button
                    key={v.key}
                    onClick={() => updateView(v.key)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                      isActive
                        ? `${cm.activeBg} ${cm.activeBorder} ${cm.activeText}`
                        : 'border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20'
                    }`}
                  >
                    {v.label}
                    <span className={`ml-2 text-xs ${isActive ? 'opacity-100' : 'opacity-50'}`}>{v.count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Table */}
          {rLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
            </div>
          ) : (
            <>
              {reconcileView === 'bank_only' && <BankOnlyTable rows={visibleRows} expandedId={expandedId} expandCheck={expandCheck} expandDeposit={expandDeposit} images={images} loadingImages={loadingImages} setLightboxUrl={setLightboxUrl} />}
              {reconcileView === 'af_only' && <AFOnlyTable rows={visibleRows} />}
              {reconcileView === 'matched' && <MatchedTable rows={visibleRows} expandedId={expandedId} expandCheck={expandCheck} expandDeposit={expandDeposit} images={images} loadingImages={loadingImages} setLightboxUrl={setLightboxUrl} />}
              {reconcileView === 'duplicates' && <BankOnlyTable rows={visibleRows} expandedId={expandedId} expandCheck={expandCheck} expandDeposit={expandDeposit} images={images} loadingImages={loadingImages} setLightboxUrl={setLightboxUrl} />}
              <p className="text-xs text-slate-600 mt-2">{visibleRows.length} rows</p>
            </>
          )}
        </>
      )}

      {/* ── Deposits tab ──────────────────────────────────────────────────── */}
      {tab === 'deposits' && (
        <>
          <p className="text-xs text-slate-400 mb-3">{total} deposits</p>
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-white/10 bg-[#0f1117]">
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-400 w-24">Date</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-400 w-20">Account</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-slate-400 w-24">Amount</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-400 w-20">Items</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-400">Payers / Types</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-slate-400 w-16">Parsed</th>
                </tr>
              </thead>
              <tbody>
                {dLoading && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500 text-xs">Loading...</td></tr>}
                {!dLoading && deposits.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500 text-xs">No deposits found</td></tr>}
                {!dLoading && deposits.map(dep => (
                  <Fragment key={dep.id}>
                    <tr onClick={() => toggleExpand(dep.id)}
                      className={`border-b border-white/5 cursor-pointer transition-colors hover:bg-white/5 ${expandedId === dep.id ? 'bg-white/5' : ''}`}>
                      <td className="px-3 py-1.5 text-slate-300 font-mono text-xs">{dep.deposit_date}</td>
                      <td className="px-3 py-1.5 text-xs text-slate-400">{ACCOUNT_LABELS[dep.account_suffix] || dep.account_suffix}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-white text-xs">${Number(dep.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                      <td className="px-3 py-1.5 text-xs text-slate-400">{dep.total_checks > 0 ? `${dep.total_checks} check${dep.total_checks !== 1 ? 's' : ''}` : `${dep.image_count || 0} imgs`}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1 items-center">
                          {dep.payers.slice(0, 3).map(p => <span key={p} className="text-xs text-slate-300">{p}</span>)}
                          {dep.payers.length > 3 && <span className="text-xs text-slate-500">+{dep.payers.length - 3}</span>}
                          {dep.types.map(t => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-400">{CHECK_TYPE_LABELS[t] || t}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {dep.extracted_count > 0
                          ? <span className="text-[10px] text-emerald-400">{dep.extracted_count}/{dep.total_checks}</span>
                          : dep.total_checks > 0 ? <span className="text-[10px] text-slate-600">{'\u2014'}</span> : null}
                      </td>
                    </tr>
                    {expandedId === dep.id && (
                      <tr className="border-b border-white/10">
                        <td colSpan={6} className="px-3 py-3 bg-white/[0.02]">
                          <CheckImagePanel cacheKey={dep.id} images={images} loadingImages={loadingImages} setLightboxUrl={setLightboxUrl} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {Math.ceil(total / 100) > 1 && (
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-slate-500">Page {dPage} of {Math.ceil(total / 100)}</span>
              <div className="flex gap-1">
                <button onClick={() => setDPage(p => Math.max(1, p - 1))} disabled={dPage === 1}
                  className="px-2 py-1 text-xs rounded border border-white/10 text-slate-400 disabled:opacity-30 hover:bg-white/5">{'\u2190'} Prev</button>
                <button onClick={() => setDPage(p => Math.min(Math.ceil(total / 100), p + 1))} disabled={dPage === Math.ceil(total / 100)}
                  className="px-2 py-1 text-xs rounded border border-white/10 text-slate-400 disabled:opacity-30 hover:bg-white/5">Next {'\u2192'}</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="check" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightboxUrl(null)} className="absolute top-4 right-4 text-white/60 hover:text-white text-2xl leading-none">{'\u2715'}</button>
        </div>
      )}
    </div>
  );
}

// ── Bank Only Table ─────────────────────────────────────────────────────────

function BankOnlyTable({ rows, expandedId, expandCheck, expandDeposit, images, loadingImages, setLightboxUrl }: {
  rows: ReconcileRow[]; expandedId: string | null;
  expandCheck: (id: string) => void; expandDeposit: (id: string) => void;
  images: Record<string, CheckImage[]>; loadingImages: string | null; setLightboxUrl: (u: string | null) => void;
}) {
  return (
    <div className="rounded-lg border border-amber-500/20 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-amber-500/20 bg-amber-500/[0.03]">
            <th className="text-left px-3 py-2 text-xs font-medium text-amber-400 w-24">Deposit Date</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-amber-400">Payer (OCR)</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-amber-400 w-24">Amount</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-amber-400 w-36">Ref #</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-amber-400 w-20">Type</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-amber-400 w-20"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500 text-sm">No unmatched bank checks</td></tr>}
          {rows.map((row, i) => {
            const checkKey = `check:${row.check_image_id}`;
            const depositKey = `deposit:${row.deposit_id}`;
            const isCheckExpanded = expandedId === checkKey;
            const isDepositExpanded = expandedId === depositKey;
            const isExpanded = isCheckExpanded || isDepositExpanded;
            return (
              <Fragment key={row.check_image_id || String(i)}>
                <tr onClick={() => row.check_image_id && expandCheck(row.check_image_id)}
                  className={`border-b border-white/5 ${row.check_image_id ? 'cursor-pointer hover:bg-amber-500/[0.03]' : ''} ${isExpanded ? 'bg-amber-500/[0.05]' : ''}`}>
                  <td className="px-3 py-1.5 text-slate-300 font-mono text-xs">{row.deposit_date || '\u2014'}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-200">
                    {row.simmons_payer || '\u2014'}
                    {row.duplicate_ref && <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">DUP</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-white text-xs">
                    {row.simmons_amount ? `$${Math.abs(parseFloat(row.simmons_amount)).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '\u2014'}
                  </td>
                  <td className="px-3 py-1.5 text-xs font-mono text-slate-500">{row.money_order_number || row.check_number || '\u2014'}</td>
                  <td className="px-3 py-1.5">
                    {row.check_type && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-400">{CHECK_TYPE_LABELS[row.check_type] || row.check_type}</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    {row.deposit_id && (
                      <button onClick={e => { e.stopPropagation(); expandDeposit(row.deposit_id!); }}
                        className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${isDepositExpanded ? 'bg-amber-500/20 text-amber-400' : 'bg-white/5 text-slate-500 hover:text-slate-300'}`}>
                        All checks
                      </button>
                    )}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-b border-white/10">
                    <td colSpan={6} className="px-4 py-3 bg-white/[0.02]">
                      {isDepositExpanded ? (
                        <>
                          <p className="text-[10px] text-slate-500 mb-2">All checks in this deposit:</p>
                          <CheckImagePanel cacheKey={depositKey} images={images} loadingImages={loadingImages} setLightboxUrl={setLightboxUrl} />
                        </>
                      ) : (
                        <CheckImagePanel cacheKey={checkKey} images={images} loadingImages={loadingImages} setLightboxUrl={setLightboxUrl} />
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── AF Only Table ───────────────────────────────────────────────────────────

function AFOnlyTable({ rows }: { rows: ReconcileRow[] }) {
  return (
    <div className="rounded-lg border border-red-500/20 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-red-500/20 bg-red-500/[0.03]">
            <th className="text-left px-3 py-2 text-xs font-medium text-red-400 w-24">AF Date</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-red-400">Payer</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-red-400">Property</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-red-400 w-16">Unit</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-red-400 w-24">Amount</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-red-400 w-36">Reference</th>
            <th className="text-center px-3 py-2 text-xs font-medium text-red-400 w-20">Payment</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500 text-sm">No unmatched AF entries</td></tr>}
          {rows.map((row, i) => (
            <tr key={row.af_id || String(i)} className="border-b border-white/5 hover:bg-white/[0.02]">
              <td className="px-3 py-1.5 text-slate-300 font-mono text-xs">{row.af_date || '\u2014'}</td>
              <td className="px-3 py-1.5 text-xs text-slate-200">{row.af_payer || '\u2014'}</td>
              <td className="px-3 py-1.5 text-xs text-slate-400">{row.af_property || '\u2014'}</td>
              <td className="px-3 py-1.5 text-xs text-slate-400">{row.af_unit || '\u2014'}</td>
              <td className="px-3 py-1.5 text-right font-mono text-white text-xs">
                {row.af_amount ? `$${parseFloat(row.af_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '\u2014'}
              </td>
              <td className="px-3 py-1.5 text-xs font-mono text-slate-500">{row.ref_raw || '\u2014'}</td>
              <td className="px-3 py-1.5 text-center">
                {row.af_receipt_id ? (
                  <a
                    href={`https://appreciateinc.appfolio.com/accounting/receivable_payments/${row.af_receipt_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 text-xs underline"
                  >
                    View
                  </a>
                ) : (
                  <span className="text-slate-600 text-xs">\u2014</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Matched Table ───────────────────────────────────────────────────────────

function MatchedTable({ rows, expandedId, expandCheck, expandDeposit, images, loadingImages, setLightboxUrl }: {
  rows: ReconcileRow[]; expandedId: string | null;
  expandCheck: (id: string) => void; expandDeposit: (id: string) => void;
  images: Record<string, CheckImage[]>; loadingImages: string | null; setLightboxUrl: (u: string | null) => void;
}) {
  return (
    <div className="rounded-lg border border-emerald-500/20 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-emerald-500/20 bg-emerald-500/[0.03]">
            <th className="text-left px-3 py-2 text-xs font-medium text-emerald-400 w-24">Date</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-emerald-400">Bank Payer</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-emerald-400">AF Payer</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-emerald-400 w-20">Bank $</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-emerald-400 w-20">AF $</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-emerald-400 w-32">Ref #</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-emerald-400 w-20"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500 text-sm">No matched entries</td></tr>}
          {rows.map((row, i) => {
            const checkKey = `check:${row.check_image_id}`;
            const depositKey = `deposit:${row.deposit_id}`;
            const isCheckExpanded = expandedId === checkKey;
            const isDepositExpanded = expandedId === depositKey;
            const isExpanded = isCheckExpanded || isDepositExpanded;
            const amtMismatch = row.amounts_match === false;
            return (
              <Fragment key={row.check_image_id || row.af_id || String(i)}>
                <tr onClick={() => row.check_image_id && expandCheck(row.check_image_id)}
                  className={`border-b border-white/5 ${row.check_image_id ? 'cursor-pointer hover:bg-emerald-500/[0.03]' : ''} ${isExpanded ? 'bg-emerald-500/[0.05]' : ''}`}>
                  <td className="px-3 py-1.5 text-slate-300 font-mono text-xs">{row.deposit_date || row.af_date || '\u2014'}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-200">{row.simmons_payer || '\u2014'}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-400">{row.af_payer || '\u2014'}</td>
                  <td className={`px-3 py-1.5 text-right font-mono text-xs ${amtMismatch ? 'text-orange-400' : 'text-white'}`}>
                    {row.simmons_amount ? `$${Math.abs(parseFloat(row.simmons_amount)).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '\u2014'}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono text-xs ${amtMismatch ? 'text-orange-400' : 'text-slate-400'}`}>
                    {row.af_amount ? `$${parseFloat(row.af_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '\u2014'}
                  </td>
                  <td className="px-3 py-1.5 text-xs font-mono text-slate-500">{row.ref_raw || row.money_order_number || '\u2014'}</td>
                  <td className="px-3 py-1.5">
                    {row.deposit_id && (
                      <button onClick={e => { e.stopPropagation(); expandDeposit(row.deposit_id!); }}
                        className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${isDepositExpanded ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-slate-500 hover:text-slate-300'}`}>
                        All checks
                      </button>
                    )}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-b border-white/10">
                    <td colSpan={7} className="px-4 py-3 bg-white/[0.02]">
                      {isDepositExpanded ? (
                        <>
                          <p className="text-[10px] text-slate-500 mb-2">All checks in this deposit:</p>
                          <CheckImagePanel cacheKey={depositKey} images={images} loadingImages={loadingImages} setLightboxUrl={setLightboxUrl} />
                        </>
                      ) : (
                        <CheckImagePanel cacheKey={checkKey} images={images} loadingImages={loadingImages} setLightboxUrl={setLightboxUrl} />
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Check image panel ───────────────────────────────────────────────────────

function CheckImagePanel({ cacheKey, images, loadingImages, setLightboxUrl }: {
  cacheKey: string; images: Record<string, CheckImage[]>;
  loadingImages: string | null; setLightboxUrl: (u: string | null) => void;
}) {
  if (loadingImages === cacheKey) return <p className="text-xs text-slate-500">Loading images...</p>;
  const imgs = images[cacheKey] || [];
  if (imgs.length === 0) return <p className="text-xs text-slate-500">No extractable check images.</p>;
  return (
    <div className="space-y-2">
      {imgs.map(img => (
        <div key={img.id} className="flex gap-3 items-start">
          <div className="flex gap-1.5 flex-shrink-0">
            {img.front_url && (
              <img src={img.front_url} alt="front"
                className="h-14 w-auto rounded border border-white/10 cursor-zoom-in object-cover"
                onClick={e => { e.stopPropagation(); setLightboxUrl(img.front_url); }} />
            )}
            {img.back_url && (
              <img src={img.back_url} alt="back"
                className="h-14 w-auto rounded border border-white/10 cursor-zoom-in object-cover opacity-60"
                onClick={e => { e.stopPropagation(); setLightboxUrl(img.back_url); }} />
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
            {img.amount && <span className="text-white font-mono">${Math.abs(parseFloat(img.amount)).toFixed(2)}</span>}
            {img.check_type && <span className="text-slate-400">{CHECK_TYPE_LABELS[img.check_type] || img.check_type}</span>}
            {img.payer_name && <span className="text-slate-200">{img.payer_name}</span>}
            {img.payer_address && <span className="text-slate-500">{img.payer_address}</span>}
            {img.issuer && <span className="text-slate-400">via {img.issuer}</span>}
            {img.money_order_number && <span className="text-slate-400 font-mono">MO#{img.money_order_number}</span>}
            {img.check_number && <span className="text-slate-400 font-mono">#{img.check_number}</span>}
            {img.check_date && <span className="text-slate-500">{img.check_date}</span>}
            {img.memo && <span className="text-slate-500 italic">"{img.memo}"</span>}
            {img.routing_number && <span className="text-slate-600 font-mono">RTG:{img.routing_number}</span>}
            {!img.extracted_at && <span className="text-slate-600 italic">not yet extracted</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
