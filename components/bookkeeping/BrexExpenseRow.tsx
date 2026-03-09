import React from "react";
import { CheckCircle2, AlertCircle, Archive, ArchiveRestore, X, ExternalLink, Loader2, Image as ImageIcon, XCircle, ChevronDown, ChevronRight, Link2 } from "lucide-react";
import AppFolioPanel from "./AppFolioPanel";
import type { BrexExpense, ExpenseDraft, PotentialMatch, BrexQueueItem, GLAccount } from "../../types/bookkeeping";

// Clean up raw card descriptors for display
export const formatMerchantName = (name: string): string => {
  let clean = name
    .replace(/\s*#\d+\*?\s*/g, '')
    .replace(/\s*\*\s*/g, ' ')
    .replace(/\s+\d{5,}$/g, '')
    .replace(/\s+[A-Z]{2}\s*$/g, '')
    .trim();
  if (clean === clean.toUpperCase()) {
    clean = clean.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
    clean = clean.replace(/'S\b/g, "'s");
  }
  return clean || name;
};

const brexExpenseUrl = (expenseId: string | null, merchantName?: string | null) => {
  if (expenseId) {
    const encoded = btoa(`Expense:${expenseId}`);
    const params = new URLSearchParams({ expenseId: encoded });
    if (merchantName) params.set('filter', `SEARCHQUERY:${merchantName}`);
    return `https://dashboard.brex.com/expenses?${params.toString()}`;
  }
  return `https://dashboard.brex.com/expenses`;
};

const appfolioBillUrl = (billId: number) =>
  `https://appreciateinc.appfolio.com/accounting/payable_invoices/${billId}`;

interface BrexExpenseRowProps {
  expense: BrexExpense;
  isExpanded: boolean;
  onToggleExpand: () => void;
  draft: ExpenseDraft | undefined;
  prefillMap: Record<string, any>;
  potentialMatches: { loading: boolean; matches: PotentialMatch[] } | undefined;
  linkingId: number | null;
  actionId: number | null;
  uploadQueue: BrexQueueItem[];
  uploadResult: Record<number, { success: boolean; message: string }>;
  vendors: string[];
  glAccounts: GLAccount[];
  properties: string[];
  filter: string;
  onUpdateDraft: (expenseId: number, field: keyof ExpenseDraft, value: string) => void;
  onEnqueueUpload: (expense: BrexExpense) => void;
  onRetryUpload: (expenseId: number) => void;
  onLinkExpenseToBill: (expenseId: number, billId: number) => void;
  onUnlinkExpense: (expenseId: number) => void;
  onArchiveCorporate: (expenseId: number) => void;
  onUnarchiveCorporate: (expenseId: number) => void;
  getMissingFields: (draft: ExpenseDraft | undefined) => string[];
  isFieldMissing: (expenseId: number, field: string) => boolean;
}

export default function BrexExpenseRow({
  expense, isExpanded, onToggleExpand, draft, prefillMap,
  potentialMatches: matchData, linkingId, actionId, uploadQueue, uploadResult,
  vendors, glAccounts, properties, filter,
  onUpdateDraft, onEnqueueUpload, onRetryUpload,
  onLinkExpenseToBill, onUnlinkExpense,
  onArchiveCorporate, onUnarchiveCorporate,
  getMissingFields, isFieldMissing,
}: BrexExpenseRowProps) {
  const isPayment = expense.transaction_type === 'COLLECTION';
  const isEntered = expense.appfolio_synced;
  const isMatchedToBill = expense.match_status === 'matched' && !isEntered;
  const isCorporateView = filter === "corporate" || expense.is_corporate;
  const isPending = !isEntered && !expense.is_corporate && !isMatchedToBill && !isPayment;

  const queueItem = uploadQueue.find(q => q.expenseId === expense.id);
  const result = uploadResult[expense.id];
  const missing = draft ? getMissingFields(draft) : [];
  const hasPrefill = !!prefillMap[expense.merchant_name];

  const statusColor = isPayment ? 'bg-purple-500' : isEntered ? 'bg-emerald-500' : isMatchedToBill ? 'bg-cyan-500' : isCorporateView ? 'bg-slate-500' : 'bg-amber-500';
  const statusBorder = isPayment ? 'border-purple-500/20' : isEntered ? 'border-emerald-500/20' : isMatchedToBill ? 'border-cyan-500/20' : isCorporateView ? 'border-slate-600' : queueItem?.status === 'uploading' ? 'border-cyan-500/30' : queueItem?.status === 'failed' ? 'border-red-500/30' : 'border-[var(--glass-border)]';

  // ─── Potential matches (Brex-specific: link to existing bills) ────────
  const renderPotentialMatches = () => {
    if (!matchData) return null;
    if (matchData.loading) {
      return (
        <div className="bg-cyan-500/5 border border-cyan-500/15 rounded-lg p-3">
          <div className="flex items-center gap-2 text-xs text-cyan-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Searching for existing bills...
          </div>
        </div>
      );
    }
    if (matchData.matches.length === 0) return null;

    const amountMatches = matchData.matches.filter(m => Math.abs(m.amount - Number(expense.amount)) < 0.01);
    const vendorOnlyMatches = matchData.matches.filter(m => Math.abs(m.amount - Number(expense.amount)) >= 0.01);

    return (
      <div className="bg-cyan-500/5 border border-cyan-500/15 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-cyan-400 font-semibold flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" />
            Potential Matches ({matchData.matches.length})
          </p>
          <p className="text-[10px] text-slate-500">Bills already entered that may match this expense</p>
        </div>

        {amountMatches.length > 0 && (
          <div className="space-y-1">
            {amountMatches.length > 0 && vendorOnlyMatches.length > 0 && (
              <p className="text-[10px] text-cyan-500 font-medium uppercase tracking-wide mt-1">Exact Amount Matches</p>
            )}
            {amountMatches.map(match => (
              <div key={match.id} className="flex items-center gap-2 px-2.5 py-2 rounded bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/15 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-cyan-300 truncate">{match.vendor_name}</span>
                    <span className="text-xs font-bold text-cyan-200 tabular-nums">${match.amount.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5 flex-wrap">
                    {match.invoice_date && <span>{new Date(match.invoice_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                    {match.invoice_number && <span>#{match.invoice_number}</span>}
                    {match.property_name && <span className="text-slate-400">{match.property_name}</span>}
                    {match.payment_status && (
                      <span className={match.payment_status === 'paid' ? 'text-emerald-500' : 'text-amber-500'}>{match.payment_status}</span>
                    )}
                    <span className={`px-1 py-px rounded text-[9px] font-medium ${match.source === 'af_bill_detail' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'}`}>
                      {match.source === 'af_bill_detail' ? 'AppFolio' : 'Pending'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => onLinkExpenseToBill(expense.id, typeof match.id === 'string' ? parseInt(match.id) || 0 : match.id)}
                  disabled={linkingId === expense.id}
                  className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-50"
                >
                  {linkingId === expense.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                  Link
                </button>
              </div>
            ))}
          </div>
        )}

        {vendorOnlyMatches.length > 0 && (
          <div className="space-y-1">
            {amountMatches.length > 0 && (
              <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide mt-1">Same Vendor (Different Amount)</p>
            )}
            {vendorOnlyMatches.slice(0, 5).map(match => (
              <div key={match.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-white/[0.03] border border-[var(--glass-border)] hover:bg-white/[0.06] transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-300 truncate">{match.vendor_name}</span>
                    <span className="text-xs text-slate-400 tabular-nums">${match.amount.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-600 mt-0.5 flex-wrap">
                    {match.invoice_date && <span>{new Date(match.invoice_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                    {match.invoice_number && <span>#{match.invoice_number}</span>}
                    {match.property_name && <span className="text-slate-400">{match.property_name}</span>}
                    {match.payment_status && (
                      <span className={match.payment_status === 'paid' ? 'text-emerald-600' : 'text-amber-600'}>{match.payment_status}</span>
                    )}
                    <span className={`px-1 py-px rounded text-[9px] font-medium ${match.source === 'af_bill_detail' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'}`}>
                      {match.source === 'af_bill_detail' ? 'AppFolio' : 'Pending'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => onLinkExpenseToBill(expense.id, typeof match.id === 'string' ? parseInt(match.id) || 0 : match.id)}
                  disabled={linkingId === expense.id}
                  className="flex-shrink-0 flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors border border-[var(--glass-border)] disabled:opacity-50"
                >
                  {linkingId === expense.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                  Link
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ─── Matched-to-bill panel (Brex-specific: linked to existing bill) ──
  const renderMatchedPanel = () => (
    <div className="space-y-3">
      <p className="text-xs text-cyan-400 font-medium">Matched to existing bill in system:</p>
      <div className="bg-cyan-500/5 border border-cyan-500/15 rounded-lg p-3 space-y-2">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {expense.bill_vendor_name && <div><span className="text-[10px] text-slate-500 uppercase tracking-wide">Bill Vendor</span><p className="font-semibold text-sm text-cyan-300">{expense.bill_vendor_name}</p></div>}
          {expense.bill_amount != null && <div><span className="text-[10px] text-slate-500 uppercase tracking-wide">Bill Amount</span><p className="font-semibold text-sm text-cyan-300">${Number(expense.bill_amount).toFixed(2)}</p></div>}
          {expense.bill_invoice_date && <div><span className="text-[10px] text-slate-500 uppercase tracking-wide">Invoice Date</span><p className="font-mono text-sm text-slate-300">{expense.bill_invoice_date}</p></div>}
          {expense.bill_invoice_number && <div><span className="text-[10px] text-slate-500 uppercase tracking-wide">Invoice #</span><p className="font-mono text-sm text-slate-300">{expense.bill_invoice_number}</p></div>}
          {expense.bill_status && <div><span className="text-[10px] text-slate-500 uppercase tracking-wide">Bill Status</span><p className="text-sm text-slate-300">{expense.bill_status}</p></div>}
          {expense.bill_payment_status && <div><span className="text-[10px] text-slate-500 uppercase tracking-wide">Payment</span><p className={`text-sm font-medium ${expense.bill_payment_status === 'paid' ? 'text-emerald-400' : expense.bill_payment_status === 'unpaid' ? 'text-amber-400' : 'text-slate-400'}`}>{expense.bill_payment_status}</p></div>}
          {expense.bill_appfolio_bill_id && <div className="col-span-2"><span className="text-[10px] text-slate-500 uppercase tracking-wide">AppFolio Bill</span><a href={appfolioBillUrl(expense.bill_appfolio_bill_id)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-mono text-sm text-accent hover:underline">#{expense.bill_appfolio_bill_id}<ExternalLink className="w-3 h-3" /></a></div>}
        </div>
      </div>
      <div className="pt-2 border-t border-cyan-500/15 flex items-center justify-between">
        <div className="text-[10px] text-cyan-500/70">
          {expense.matched_at && <p>Matched {new Date(expense.matched_at).toLocaleString()}</p>}
          {expense.match_confidence && <p className="capitalize">{expense.match_confidence} confidence · {expense.matched_by || 'auto'}</p>}
        </div>
        <button onClick={() => onUnlinkExpense(expense.id)} disabled={linkingId === expense.id} className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-white/5 hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors border border-[var(--glass-border)] disabled:opacity-50">
          {linkingId === expense.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
          Unlink
        </button>
      </div>
    </div>
  );

  // ─── Corporate panel (Brex-specific) ─────────────────────────────────
  const renderCorporatePanel = () => (
    <div className="space-y-2">
      <p className="text-sm text-slate-400">This expense was marked as a corporate expense — not entered in AppFolio.</p>
      {expense.corporate_at && <p className="text-[10px] text-slate-600">Archived {new Date(expense.corporate_at).toLocaleDateString()}</p>}
    </div>
  );

  // ─── Build display fields for entered (synced) expenses ──────────────
  const enteredDisplayFields = isEntered ? [
    expense.af_vendor_name ? { label: 'AF Vendor', value: <p className="font-semibold text-sm text-emerald-400">{expense.af_vendor_name}</p> } : null,
    { label: 'Amount', value: <p className="font-semibold text-sm text-emerald-400">${Number(expense.amount).toFixed(2)}</p> },
    expense.af_property_input ? { label: 'Property', value: <p className="text-sm text-emerald-300/80">{expense.af_property_input}</p> } : null,
    expense.af_gl_account_input ? { label: 'GL Account', value: <p className="text-sm text-emerald-300/80 truncate" title={expense.af_gl_account_input}>{expense.af_gl_account_input}</p> } : null,
    expense.af_unit_input ? { label: 'Unit', value: <p className="text-sm text-emerald-300/80">{expense.af_unit_input}</p> } : null,
    expense.appfolio_bill_id ? { label: 'AF Bill', value: <a href={appfolioBillUrl(expense.appfolio_bill_id)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-mono text-sm text-accent hover:underline">#{expense.appfolio_bill_id}<ExternalLink className="w-3 h-3" /></a> } : null,
  ].filter(Boolean) as { label: string; value: React.ReactNode; colSpan?: 1 | 2 }[] : undefined;

  return (
    <div className={`glass-card overflow-hidden transition-all border-l-2 border-l-violet-500/60 ${statusBorder} ${isCorporateView && !isExpanded ? 'opacity-60' : ''}`}>
      {/* ── SLIM PREVIEW ROW ── */}
      <div
        className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.03] transition-colors select-none ${isExpanded ? 'border-b border-[var(--glass-border)]' : ''}`}
        onClick={onToggleExpand}
      >
        <div className="flex-shrink-0 text-slate-500">
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />

        {/* Type badge */}
        <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold rounded bg-violet-500/15 text-violet-400 uppercase tracking-wider">Brex</span>

        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-slate-100 truncate block">{formatMerchantName(expense.merchant_name)}</span>
        </div>

        <div className="hidden md:block min-w-0 flex-1 max-w-[200px]">
          {expense.memo && <span className="text-xs text-slate-500 truncate block">{expense.memo}</span>}
        </div>

        <div className="flex-shrink-0 w-20 text-center">
          {isMatchedToBill && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-medium">Linked</span>}
          {isPending && (() => {
            const pm = matchData;
            const hasAmountMatch = pm && !pm.loading && pm.matches.some(m => Math.abs(m.amount - Number(expense.amount)) < 0.01);
            if (hasAmountMatch) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 font-medium animate-pulse">Match!</span>;
            if (hasPrefill) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-medium">Prefill</span>;
            if (missing.length > 0) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">{missing.length} req</span>;
            return null;
          })()}
        </div>

        <div className="flex-shrink-0 w-24 text-right">
          <span className="text-sm font-bold text-slate-100 tabular-nums">${Number(expense.amount).toFixed(2)}</span>
        </div>

        <div className="flex-shrink-0 w-24 text-right">
          <span className="text-xs text-slate-500 tabular-nums">
            {expense.posted_at ? new Date(expense.posted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
             : expense.initiated_at ? new Date(expense.initiated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
             : '\u2014'}
          </span>
        </div>

        <div className="flex-shrink-0 w-24">
          {isPayment ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-purple-500/15 text-purple-400">Payment</span>
           : isEntered ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-500/15 text-emerald-400"><CheckCircle2 className="w-3 h-3" />Entered</span>
           : isMatchedToBill ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-cyan-500/15 text-cyan-400"><Link2 className="w-3 h-3" />Matched</span>
           : isCorporateView ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-500/15 text-slate-400"><Archive className="w-3 h-3" />Corp</span>
           : queueItem?.status === 'uploading' ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-cyan-500/15 text-cyan-400"><Loader2 className="w-3 h-3 animate-spin" />Sending</span>
           : queueItem?.status === 'queued' ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-500/15 text-slate-400">Queued</span>
           : result?.success === false ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-red-500/15 text-red-400"><XCircle className="w-3 h-3" />Failed</span>
           : <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/15 text-amber-400">Pending</span>}
        </div>

        <div className="flex-shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <a href={brexExpenseUrl(expense.expense_id, expense.merchant_name)} target="_blank" rel="noopener noreferrer" className="p-1 text-slate-500 hover:text-accent transition-colors" title="Open in Brex"><ExternalLink className="w-3.5 h-3.5" /></a>
          {(expense.bill_appfolio_bill_id || expense.appfolio_bill_id) && (
            <a href={appfolioBillUrl(expense.bill_appfolio_bill_id || expense.appfolio_bill_id!)} target="_blank" rel="noopener noreferrer" className="p-1 text-emerald-600 hover:text-emerald-400 transition-colors" title="Open in AppFolio"><Link2 className="w-3.5 h-3.5" /></a>
          )}
          {expense.receipt_ids && expense.receipt_ids.length > 0 && (
            <a href={`/api/admin/brex/receipt?receipt_id=${expense.receipt_ids[0]}`} target="_blank" rel="noopener noreferrer" className="p-1 text-slate-500 hover:text-accent transition-colors" title="View receipt"><ImageIcon className="w-3.5 h-3.5" /></a>
          )}
          {!expense.is_corporate && !expense.appfolio_synced && (
            <button onClick={() => onArchiveCorporate(expense.id)} disabled={actionId === expense.id} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:text-amber-400 hover:bg-white/5 rounded transition-colors disabled:opacity-50" title="Archive as corporate">
              <Archive className="w-3 h-3" />
              {actionId === expense.id ? "..." : "Corp"}
            </button>
          )}
        </div>
      </div>

      {/* ── EXPANDED CONTENT ── */}
      {isExpanded && (
        <div className="grid grid-cols-2 divide-x divide-[var(--glass-border)]">
          <div className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Brex Transaction</span>
              <a href={brexExpenseUrl(expense.expense_id, expense.merchant_name)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors font-medium" title="Open in Brex Dashboard"><ExternalLink className="w-3 h-3" />Open in Brex</a>
            </div>
            <h2 className="text-base font-semibold text-slate-100 mb-0.5">{formatMerchantName(expense.merchant_name)}</h2>
            <p className="text-xs text-slate-500 mb-3">
              {expense.merchant_raw_descriptor && expense.merchant_raw_descriptor !== expense.merchant_name ? `${expense.merchant_raw_descriptor} \u00B7 ` : ""}
              {expense.posted_at ? new Date(expense.posted_at).toLocaleDateString() : expense.initiated_at ? new Date(expense.initiated_at).toLocaleDateString() : "No date"}
            </p>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
              <div><span className="text-xs text-slate-500">Amount</span><p className="font-bold text-slate-100 text-base">${Number(expense.amount).toFixed(2)}</p></div>
              <div><span className="text-xs text-slate-500">Posted Date</span><p className="font-mono text-sm text-slate-300">{expense.posted_at || "Pending"}</p></div>
              {expense.transaction_type && <div><span className="text-xs text-slate-500">Type</span><p className="text-sm text-slate-300">{expense.transaction_type}</p></div>}
            </div>

            {expense.memo && <p className="text-xs text-slate-400 mb-2 line-clamp-2"><span className="text-slate-500">Memo: </span>{expense.memo}</p>}

            {expense.receipt_ids && expense.receipt_ids.length > 0 && (
              <div className="flex gap-1.5 mb-2">
                {expense.receipt_ids.map((receiptId, idx) => (
                  <a key={receiptId} href={`/api/admin/brex/receipt?receipt_id=${receiptId}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-2 py-1 bg-white/5 text-slate-400 rounded text-[10px] hover:bg-white/10 transition-colors" title={`View receipt ${idx + 1}`}>
                    <ImageIcon className="w-3 h-3" />Receipt {idx + 1}
                  </a>
                ))}
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              {expense.is_corporate ? (
                <button onClick={() => onUnarchiveCorporate(expense.id)} disabled={actionId === expense.id} className="flex items-center gap-1 text-xs px-2 py-1 bg-white/5 text-slate-400 rounded hover:bg-white/10 disabled:opacity-50">
                  <ArchiveRestore className="w-3.5 h-3.5" />{actionId === expense.id ? "..." : "Unarchive"}
                </button>
              ) : !isEntered ? (
                <button onClick={() => onArchiveCorporate(expense.id)} disabled={actionId === expense.id} className="flex items-center gap-1 text-xs px-2 py-1 bg-white/5 text-slate-400 rounded hover:bg-white/10 disabled:opacity-50">
                  <Archive className="w-3.5 h-3.5" />{actionId === expense.id ? "Archiving..." : "Archive as Corporate"}
                </button>
              ) : null}
            </div>
          </div>

          <div className={`p-4 ${isPayment ? "bg-purple-500/5" : isEntered ? "bg-emerald-500/5" : isMatchedToBill ? "bg-cyan-500/5" : isCorporateView ? "bg-white/[0.02]" : "bg-amber-500/5"}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {isPayment ? 'Payment Record' : isMatchedToBill ? 'Matched Bill' : 'AppFolio'}
              </span>
              {isPayment ? <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-purple-500/20 text-purple-400">Payment</span>
               : isEntered ? <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-emerald-500/20 text-emerald-400"><CheckCircle2 className="w-3 h-3" />Entered</span>
               : isMatchedToBill ? <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-cyan-500/20 text-cyan-400"><Link2 className="w-3 h-3" />Matched</span>
               : isCorporateView ? <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-slate-500/20 text-slate-400"><Archive className="w-3 h-3" />Corporate</span>
               : <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-amber-500/20 text-amber-400"><AlertCircle className="w-3 h-3" />Pending</span>}
            </div>

            {isPayment && (
              <div className="space-y-2">
                <p className="text-sm text-slate-400">Card payment / collection — for internal records only, not entered in AppFolio.</p>
                {expense.memo && <p className="text-xs text-purple-300"><span className="text-slate-500">Memo: </span>{expense.memo}</p>}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div><span className="text-[10px] text-slate-500 uppercase tracking-wide">Amount</span><p className="font-semibold text-purple-300">${Number(expense.amount).toFixed(2)}</p></div>
                  <div><span className="text-[10px] text-slate-500 uppercase tracking-wide">Posted</span><p className="text-sm text-slate-300">{expense.posted_at || '\u2014'}</p></div>
                </div>
              </div>
            )}

            {isPending && (
              <AppFolioPanel
                mode="form"
                draft={draft}
                onUpdateDraft={(field, value) => onUpdateDraft(expense.id, field as keyof ExpenseDraft, value)}
                missingFields={missing}
                isFieldMissing={(field) => isFieldMissing(expense.id, field)}
                queueStatus={queueItem?.status === 'uploading' ? 'uploading' : queueItem?.status === 'queued' ? 'queued' : null}
                uploadResult={result}
                onSubmit={() => onEnqueueUpload(expense)}
                onRetry={() => onRetryUpload(expense.id)}
                previousApproval={expense.af_approved_by && expense.af_approved_at ? { by: expense.af_approved_by, at: expense.af_approved_at } : null}
                vendors={vendors}
                glAccounts={glAccounts}
                properties={properties}
                beforeForm={renderPotentialMatches()}
              />
            )}

            {isMatchedToBill && renderMatchedPanel()}

            {isEntered && (
              <AppFolioPanel
                mode="display"
                displayFields={enteredDisplayFields}
                displayApproval={expense.af_approved_by ? { by: expense.af_approved_by, at: expense.af_approved_at || '' } : null}
                vendors={vendors}
                glAccounts={glAccounts}
                properties={properties}
              />
            )}

            {isCorporateView && !isEntered && !isMatchedToBill && !isPayment && renderCorporatePanel()}
          </div>
        </div>
      )}
    </div>
  );
}
