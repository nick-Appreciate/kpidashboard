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
  // Simmons side
  check_image_id: string | null; deposit_id: string | null;
  deposit_date: string | null; check_type: string | null;
  simmons_payer: string | null; simmons_amount: string | null;
  money_order_number: string | null; check_number: string | null;
  account_suffix: string | null; ref_norm: string | null;
  front_image_path: string | null; back_image_path: string | null;
  // AppFolio side
  af_id: string | null; af_date: string | null; af_payer: string | null;
  af_amount: string | null; ref_raw: string | null;
  amounts_match: boolean | null;
}

interface ReconcileSummary {
  matched: number; simmons_only: number; af_only: number; amount_diffs: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const ACCOUNT_LABELS: Record<string, string> = { x5218: 'Columbia', x3505: 'Como SD', x1552: 'KC' };
const CHECK_TYPE_LABELS: Record<string, string> = {
  personal_check: 'Check', money_order: 'MO', cashiers_check: "Cashier's",
  business_check: 'Business', usps_money_order: 'USPS MO', corporate_check: 'Corp',
};

const STATUS_META = {
  matched:      { dot: 'bg-emerald-400', label: 'Matched',    text: 'text-emerald-400' },
  simmons_only: { dot: 'bg-amber-400',   label: 'Bank only',  text: 'text-amber-400'   },
  af_only:      { dot: 'bg-red-400',     label: 'AF only',    text: 'text-red-400'     },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function SimmonsDepositsDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<'deposits' | 'reconcile'>('reconcile');

  // Deposits tab state
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [total, setTotal] = useState(0);
  const [dPage, setDPage] = useState(1);
  const [dSearch, setDSearch] = useState('');
  const [dInput, setDInput] = useState('');
  const [dLoading, setDLoading] = useState(false);

  // Reconcile tab state
  const [reconcileRows, setReconcileRows] = useState<ReconcileRow[]>([]);
  const [reconcileSummary, setReconcileSummary] = useState<ReconcileSummary | null>(null);
  const [rLoading, setRLoading] = useState(false);
  const [rSearch, setRSearch] = useState('');
  const [rInput, setRInput] = useState('');
  const [rFilter, setRFilter] = useState<'all' | 'matched' | 'simmons_only' | 'af_only'>('all');
  const [rDateFrom, setRDateFrom] = useState('2025-10-01');
  const [rDateTo, setRDateTo] = useState('');

  // Shared expand/images/lightbox state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, CheckImage[]>>({});
  const [loadingImages, setLoadingImages] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Escape closes lightbox
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxUrl(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    if (!authLoading && appUser?.role !== 'admin') router.push('/');
  }, [authLoading, appUser, router]);

  // ── Deposits fetch ──────────────────────────────────────────────────────────
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

  // ── Reconcile fetch ─────────────────────────────────────────────────────────
  const fetchReconcile = useCallback(async () => {
    setRLoading(true);
    try {
      const params = new URLSearchParams({ mode: 'reconcile' });
      if (rDateFrom) params.set('date_from', rDateFrom);
      if (rDateTo)   params.set('date_to', rDateTo);
      const res = await fetch(`/api/admin/simmons?${params}`);
      const data = await res.json();
      setReconcileRows(data.rows || []);
      setReconcileSummary(data.summary || null);
    } finally { setRLoading(false); }
  }, [rDateFrom, rDateTo]);

  useEffect(() => { if (tab === 'reconcile') fetchReconcile(); }, [tab, fetchReconcile]);

  // ── Search debounce ─────────────────────────────────────────────────────────
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

  // ── Toggle expand ───────────────────────────────────────────────────────────
  const toggleExpand = async (depositId: string) => {
    if (expandedId === depositId) { setExpandedId(null); return; }
    setExpandedId(depositId);
    if (images[depositId]) return;
    setLoadingImages(depositId);
    try {
      const res = await fetch(`/api/admin/simmons?deposit_id=${depositId}`);
      const data = await res.json();
      setImages(prev => ({ ...prev, [depositId]: data.images || [] }));
    } finally { setLoadingImages(null); }
  };

  // ── Filtered reconcile rows ─────────────────────────────────────────────────
  const filteredRows = reconcileRows.filter(r => {
    if (rFilter !== 'all' && r.status !== rFilter) return false;
    if (rDateFrom) {
      const d = r.deposit_date || r.af_date || '';
      if (d && d < rDateFrom) return false;
    }
    if (rDateTo) {
      const d = r.deposit_date || r.af_date || '';
      if (d && d > rDateTo) return false;
    }
    if (rSearch) {
      const q = rSearch.toLowerCase();
      return (
        (r.simmons_payer || '').toLowerCase().includes(q) ||
        (r.af_payer     || '').toLowerCase().includes(q) ||
        (r.ref_raw      || '').toLowerCase().includes(q) ||
        (r.money_order_number || '').toLowerCase().includes(q) ||
        (r.check_number || '').toLowerCase().includes(q) ||
        (r.simmons_amount || '').includes(q) ||
        (r.af_amount    || '').includes(q)
      );
    }
    return true;
  });

  if (authLoading) return null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 max-w-6xl mx-auto">

      {/* Header + tabs */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-base font-semibold text-white">Simmons Deposits</h1>
          <div className="flex gap-0.5 mt-1.5">
            {(['reconcile', 'deposits'] as const).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setExpandedId(null); }}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  tab === t ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {t === 'reconcile' ? 'Reconcile' : 'All Deposits'}
              </button>
            ))}
          </div>
        </div>

        {tab === 'deposits' ? (
          <input
            type="text" placeholder="Search payer, amount, date, MO#…"
            value={dInput} onChange={e => handleDSearch(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white placeholder:text-slate-500 w-64 focus:outline-none focus:border-white/20"
          />
        ) : (
          <input
            type="text" placeholder="Search payer, ref#, amount…"
            value={rInput} onChange={e => handleRSearch(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white placeholder:text-slate-500 w-64 focus:outline-none focus:border-white/20"
          />
        )}
      </div>

      {/* ── Reconcile tab ─────────────────────────────────────────────────── */}
      {tab === 'reconcile' && (
        <>
          {/* Summary + filters */}
          <div className="flex items-center gap-4 mb-3 flex-wrap">
            {reconcileSummary && (
              <div className="flex gap-3">
                {[
                  { key: 'matched',      label: `${reconcileSummary.matched} matched`,    color: 'text-emerald-400' },
                  { key: 'simmons_only', label: `${reconcileSummary.simmons_only} bank only`, color: 'text-amber-400' },
                  { key: 'af_only',      label: `${reconcileSummary.af_only} AF only`,    color: 'text-red-400'    },
                ].map(({ key, label, color }) => (
                  <button
                    key={key}
                    onClick={() => setRFilter(rFilter === key as any ? 'all' : key as any)}
                    className={`text-xs font-medium transition-opacity ${color} ${rFilter !== 'all' && rFilter !== key ? 'opacity-30' : ''}`}
                  >
                    {label}
                  </button>
                ))}
                {reconcileSummary.amount_diffs > 0 && (
                  <span className="text-xs text-orange-400">{reconcileSummary.amount_diffs} amt diff</span>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <label className="text-xs text-slate-500">From</label>
              <input type="date" value={rDateFrom} onChange={e => setRDateFrom(e.target.value)}
                className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none" />
              <label className="text-xs text-slate-500">To</label>
              <input type="date" value={rDateTo} onChange={e => setRDateTo(e.target.value)}
                className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none" />
            </div>
          </div>

          {/* Reconcile table */}
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-white/10 bg-[#0f1117]">
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-400 w-6"></th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-400 w-24">Date</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-400">Payer</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-slate-400 w-24">Bank $</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-slate-400 w-24">AF $</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-400 w-36">Ref #</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-400 w-20">Type</th>
                </tr>
              </thead>
              <tbody>
                {rLoading && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500 text-xs">Loading…</td></tr>
                )}
                {!rLoading && filteredRows.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500 text-xs">No entries found</td></tr>
                )}
                {!rLoading && filteredRows.map((row, i) => {
                  const meta = STATUS_META[row.status];
                  const expandKey = row.deposit_id || row.af_id || String(i);
                  const isExpanded = expandedId === expandKey;
                  const canExpand = !!row.deposit_id;
                  const date = row.deposit_date || row.af_date || '—';
                  const refDisplay = row.ref_raw || row.money_order_number || row.check_number || '—';
                  const sAmt = row.simmons_amount ? `$${Math.abs(parseFloat(row.simmons_amount)).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—';
                  const aAmt = row.af_amount ? `$${parseFloat(row.af_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—';
                  const payer = row.simmons_payer || row.af_payer || '—';
                  const amtMismatch = row.status === 'matched' && row.amounts_match === false;

                  return (
                    <Fragment key={expandKey}>
                      <tr
                        onClick={() => canExpand && toggleExpand(expandKey)}
                        className={`border-b border-white/5 transition-colors ${canExpand ? 'cursor-pointer hover:bg-white/5' : ''} ${isExpanded ? 'bg-white/5' : ''}`}
                      >
                        {/* Status dot */}
                        <td className="px-3 py-1.5">
                          <span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} title={meta.label} />
                        </td>
                        <td className="px-3 py-1.5 text-slate-300 font-mono text-xs">{date}</td>
                        <td className="px-3 py-1.5 text-xs">
                          <span className="text-slate-200">{payer}</span>
                          {row.status === 'matched' && row.af_payer && row.simmons_payer &&
                            row.af_payer.toLowerCase() !== row.simmons_payer.toLowerCase() && (
                            <span className="text-slate-600 text-[10px] ml-1">/ {row.af_payer}</span>
                          )}
                        </td>
                        <td className={`px-3 py-1.5 text-right font-mono text-xs ${amtMismatch ? 'text-orange-400' : 'text-white'}`}>
                          {sAmt}
                        </td>
                        <td className={`px-3 py-1.5 text-right font-mono text-xs ${amtMismatch ? 'text-orange-400' : 'text-slate-400'}`}>
                          {aAmt}
                        </td>
                        <td className="px-3 py-1.5 text-xs font-mono text-slate-500 truncate max-w-[144px]" title={refDisplay}>
                          {refDisplay}
                        </td>
                        <td className="px-3 py-1.5">
                          {row.check_type && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-400">
                              {CHECK_TYPE_LABELS[row.check_type] || row.check_type}
                            </span>
                          )}
                        </td>
                      </tr>

                      {/* Expanded check images */}
                      {isExpanded && canExpand && (
                        <tr className="border-b border-white/10">
                          <td colSpan={7} className="px-4 py-3 bg-white/[0.02]">
                            <CheckImagePanel
                              depositId={row.deposit_id!}
                              images={images}
                              loadingImages={loadingImages}
                              setLightboxUrl={setLightboxUrl}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-600 mt-2">{filteredRows.length} rows · AppFolio data from {rDateFrom || 'all time'}</p>
        </>
      )}

      {/* ── Deposits tab ──────────────────────────────────────────────────── */}
      {tab === 'deposits' && (
        <>
          <p className="text-xs text-slate-400 mb-3">{total} deposits · check images with Claude extraction</p>
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
                {dLoading && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500 text-xs">Loading…</td></tr>}
                {!dLoading && deposits.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500 text-xs">No deposits found</td></tr>}
                {!dLoading && deposits.map(dep => (
                  <Fragment key={dep.id}>
                    <tr
                      onClick={() => toggleExpand(dep.id)}
                      className={`border-b border-white/5 cursor-pointer transition-colors hover:bg-white/5 ${expandedId === dep.id ? 'bg-white/5' : ''}`}
                    >
                      <td className="px-3 py-1.5 text-slate-300 font-mono text-xs">{dep.deposit_date}</td>
                      <td className="px-3 py-1.5 text-xs text-slate-400">{ACCOUNT_LABELS[dep.account_suffix] || dep.account_suffix}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-white text-xs">
                        ${Number(dep.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-400">
                        {dep.total_checks > 0 ? `${dep.total_checks} check${dep.total_checks !== 1 ? 's' : ''}` : `${dep.image_count || 0} imgs`}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1 items-center">
                          {dep.payers.slice(0, 3).map(p => <span key={p} className="text-xs text-slate-300">{p}</span>)}
                          {dep.payers.length > 3 && <span className="text-xs text-slate-500">+{dep.payers.length - 3}</span>}
                          {dep.types.map(t => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-400">
                              {CHECK_TYPE_LABELS[t] || t}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {dep.extracted_count > 0
                          ? <span className="text-[10px] text-emerald-400">{dep.extracted_count}/{dep.total_checks}</span>
                          : dep.total_checks > 0 ? <span className="text-[10px] text-slate-600">—</span> : null}
                      </td>
                    </tr>
                    {expandedId === dep.id && (
                      <tr className="border-b border-white/10">
                        <td colSpan={6} className="px-3 py-3 bg-white/[0.02]">
                          <CheckImagePanel
                            depositId={dep.id}
                            images={images}
                            loadingImages={loadingImages}
                            setLightboxUrl={setLightboxUrl}
                          />
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
                  className="px-2 py-1 text-xs rounded border border-white/10 text-slate-400 disabled:opacity-30 hover:bg-white/5">← Prev</button>
                <button onClick={() => setDPage(p => Math.min(Math.ceil(total / 100), p + 1))} disabled={dPage === Math.ceil(total / 100)}
                  className="px-2 py-1 text-xs rounded border border-white/10 text-slate-400 disabled:opacity-30 hover:bg-white/5">Next →</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="check" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightboxUrl(null)} className="absolute top-4 right-4 text-white/60 hover:text-white text-2xl leading-none">✕</button>
        </div>
      )}
    </div>
  );
}

// ── Shared check image panel ──────────────────────────────────────────────────

function CheckImagePanel({ depositId, images, loadingImages, setLightboxUrl }: {
  depositId: string;
  images: Record<string, CheckImage[]>;
  loadingImages: string | null;
  setLightboxUrl: (url: string | null) => void;
}) {
  const CHECK_TYPE_LABELS: Record<string, string> = {
    personal_check: 'Check', money_order: 'MO', cashiers_check: "Cashier's",
    business_check: 'Business', usps_money_order: 'USPS MO', corporate_check: 'Corp',
  };
  if (loadingImages === depositId) return <p className="text-xs text-slate-500">Loading images…</p>;
  const imgs = images[depositId] || [];
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
