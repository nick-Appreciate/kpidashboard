import React from "react";
import { CheckCircle2, AlertCircle, Archive, ArchiveRestore, ExternalLink, Loader2, Image as ImageIcon, XCircle, ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import AppFolioPanel from "./AppFolioPanel";
import type { UnifiedBill, UnifiedBillDraft, UnifiedQueueItemV2, GLAccount } from "../../types/bookkeeping";

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

interface BillRowProps {
  bill: UnifiedBill;
  isExpanded: boolean;
  onToggleExpand: () => void;
  draft: UnifiedBillDraft | undefined;
  uploadQueue: UnifiedQueueItemV2[];
  uploadResult: Record<number, { success: boolean; message: string }>;
  vendors: string[];
  glAccounts: GLAccount[];
  properties: string[];
  filter: string;
  actionId: number | null;
  onUpdateDraft: (billId: number, field: keyof UnifiedBillDraft, value: string) => void;
  onEnqueueUpload: (bill: UnifiedBill) => void;
  onRetryUpload: (billId: number) => void;
  onHide: (bill: UnifiedBill) => void;
  onUnhide: (billId: number) => void;
  onMarkCorporate: (billId: number) => void;
  onUnmarkCorporate: (billId: number) => void;
  getMissingFields: (draft: UnifiedBillDraft | undefined) => string[];
  isFieldMissing: (billId: number, field: string) => boolean;
  unitsByProperty: Record<string, string[]>;
}

export default function BillRow({
  bill, isExpanded, onToggleExpand, draft,
  uploadQueue, uploadResult: uploadResultMap,
  vendors, glAccounts, properties, filter, actionId,
  onUpdateDraft, onEnqueueUpload, onRetryUpload,
  onHide, onUnhide, onMarkCorporate, onUnmarkCorporate,
  getMissingFields, isFieldMissing, unitsByProperty,
}: BillRowProps) {
  const isBrex = bill.source === 'brex';
  const isFront = bill.source === 'front';
  const isPayment = bill.status === 'payment';
  const isEntered = bill.status === 'entered';
  const isCorporate = bill.status === 'corporate';
  const isHidden = bill.is_hidden;
  const isPending = bill.status === 'pending';

  const queueItem = uploadQueue.find(q => q.billId === bill.id);
  const result = uploadResultMap[bill.id];
  const missing = draft ? getMissingFields(draft) : [];
  const isManualEntry = bill.document_type === 'credit_memo' || Number(bill.amount) < 0;

  // Status colors
  const statusColor = isPayment ? 'bg-purple-500' : isEntered ? 'bg-emerald-500' : isCorporate ? 'bg-slate-500' : isHidden ? 'bg-slate-500' : 'bg-amber-500';
  const statusBorder = isPayment ? 'border-purple-500/20' : isEntered ? 'border-emerald-500/20' : isCorporate ? 'border-slate-600' : isHidden ? 'border-slate-600' : queueItem?.status === 'uploading' ? 'border-cyan-500/30' : queueItem?.status === 'failed' ? 'border-red-500/30' : 'border-[var(--glass-border)]';
  const sourceBorderColor = isBrex ? 'border-l-violet-500/60' : 'border-l-blue-500/60';

  // Source badge
  const sourceBadge = isBrex
    ? <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold rounded bg-violet-500/15 text-violet-400 uppercase tracking-wider">Brex</span>
    : <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-500/15 text-blue-400 uppercase tracking-wider">Invoice</span>;

  // Display name
  const displayName = isBrex ? formatMerchantName(bill.brex_merchant_name || bill.vendor_name) : bill.vendor_name;

  // Date for display
  const displayDate = isBrex
    ? (bill.brex_posted_at || bill.brex_initiated_at || bill.invoice_date)
    : (bill.invoice_date || bill.created_at);

  // Entered display fields — prefer AF match data over bill's own input fields
  const afPropertyDisplay = bill.af_property_name || bill.af_property_input;
  const afGlAccountDisplay = bill.af_gl_account_name || bill.af_gl_account_input;
  const afUnitDisplay = bill.af_unit || bill.af_unit_input;
  const afVendorDisplay = bill.af_vendor_name || bill.vendor_name;

  const enteredDisplayFields = isEntered ? [
    { label: 'Vendor', value: <p className="font-semibold text-sm text-emerald-400">{afVendorDisplay}</p> },
    { label: 'Amount', value: <p className="font-semibold text-sm text-emerald-400">${Number(bill.amount).toFixed(2)}</p> },
    afPropertyDisplay ? { label: 'Property', value: <p className="text-sm text-emerald-300/80">{afPropertyDisplay}</p> } : null,
    afGlAccountDisplay ? { label: 'GL Account', value: <p className="text-sm text-emerald-300/80 truncate" title={afGlAccountDisplay}>{afGlAccountDisplay}</p> } : null,
    afUnitDisplay ? { label: 'Unit', value: <p className="text-sm text-emerald-300/80">{afUnitDisplay}</p> } : null,
    bill.af_status ? { label: 'Status', value: <p className={`text-sm font-medium ${bill.af_status === 'Paid' ? 'text-emerald-400' : bill.af_status === 'Unpaid' ? 'text-amber-400' : 'text-slate-300'}`}>{bill.af_status}{bill.af_paid_date ? ` · ${new Date(bill.af_paid_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</p> } : null,
    bill.appfolio_bill_id ? { label: 'AF Bill', value: <a href={appfolioBillUrl(bill.appfolio_bill_id)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-mono text-sm text-accent hover:underline">#{bill.appfolio_bill_id}<ExternalLink className="w-3 h-3" /></a> } : null,
  ].filter(Boolean) as { label: string; value: React.ReactNode; colSpan?: 1 | 2 }[] : undefined;

  return (
    <div className={`glass-card overflow-hidden transition-all border-l-2 ${sourceBorderColor} ${statusBorder} ${(isCorporate || isHidden) && !isExpanded ? 'opacity-60' : ''}`}>
      {/* ── SLIM PREVIEW ROW ── */}
      <div
        className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.03] transition-colors select-none ${isExpanded ? 'border-b border-[var(--glass-border)]' : ''}`}
        onClick={onToggleExpand}
      >
        <div className="flex-shrink-0 text-slate-500">
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />

        {sourceBadge}

        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-slate-100 truncate block">{displayName}</span>
        </div>

        <div className="hidden md:block min-w-0 flex-1 max-w-[200px]">
          {(bill.description || bill.brex_memo || bill.front_email_subject) && (
            <span className="text-xs text-slate-500 truncate block">
              {bill.description || bill.brex_memo || bill.front_email_subject}
            </span>
          )}
        </div>

        {/* Status indicator in center */}
        <div className="flex-shrink-0 w-20 text-center">
          {isPending && missing.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">{missing.length} req</span>}
        </div>

        <div className="flex-shrink-0 w-24 text-right">
          <span className="text-sm font-bold text-slate-100 tabular-nums">${Number(bill.amount).toFixed(2)}</span>
        </div>

        <div className="flex-shrink-0 w-24 text-right">
          <span className="text-xs text-slate-500 tabular-nums">
            {displayDate ? new Date(displayDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '\u2014'}
          </span>
        </div>

        <div className="flex-shrink-0 w-24">
          {isPayment ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-purple-500/15 text-purple-400">Payment</span>
           : isEntered ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-500/15 text-emerald-400"><CheckCircle2 className="w-3 h-3" />Entered</span>
           : isCorporate ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-500/15 text-slate-400"><Archive className="w-3 h-3" />Corp</span>
           : isHidden ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-500/15 text-slate-400"><EyeOff className="w-3 h-3" />Hidden</span>
           : queueItem?.status === 'uploading' ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-cyan-500/15 text-cyan-400"><Loader2 className="w-3 h-3 animate-spin" />Sending</span>
           : queueItem?.status === 'queued' ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-500/15 text-slate-400">Queued</span>
           : result?.success === false ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-red-500/15 text-red-400"><XCircle className="w-3 h-3" />Failed</span>
           : <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/15 text-amber-400">Pending</span>}
        </div>

        <div className="flex-shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {isBrex && (
            <a href={brexExpenseUrl(bill.brex_expense_id_str, bill.brex_merchant_name)} target="_blank" rel="noopener noreferrer" className="p-1 text-slate-500 hover:text-accent transition-colors" title="Open in Brex"><ExternalLink className="w-3.5 h-3.5" /></a>
          )}
          {bill.appfolio_bill_id && (
            <a href={appfolioBillUrl(bill.appfolio_bill_id)} target="_blank" rel="noopener noreferrer" className="p-1 text-emerald-600 hover:text-emerald-400 transition-colors" title="Open in AppFolio"><ExternalLink className="w-3.5 h-3.5" /></a>
          )}
          {isBrex && bill.brex_receipt_ids && bill.brex_receipt_ids.length > 0 && (
            <a href={`/api/admin/brex/receipt?receipt_id=${bill.brex_receipt_ids[0]}`} target="_blank" rel="noopener noreferrer" className="p-1 text-slate-500 hover:text-accent transition-colors" title="View receipt"><ImageIcon className="w-3.5 h-3.5" /></a>
          )}
          {isPending && isBrex && (
            <button onClick={() => onMarkCorporate(bill.id)} disabled={actionId === bill.id} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:text-amber-400 hover:bg-white/5 rounded transition-colors disabled:opacity-50" title="Archive as corporate">
              <Archive className="w-3 h-3" />
              {actionId === bill.id ? "..." : "Corp"}
            </button>
          )}
          {isPending && !isBrex && (
            <button onClick={() => onHide(bill)} disabled={actionId === bill.id} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:text-amber-400 hover:bg-white/5 rounded transition-colors disabled:opacity-50" title="Hide bill">
              <EyeOff className="w-3 h-3" />
              {actionId === bill.id ? "..." : "Hide"}
            </button>
          )}
        </div>
      </div>

      {/* ── EXPANDED CONTENT ── */}
      {isExpanded && (
        <div className="grid grid-cols-2 divide-x divide-[var(--glass-border)]">
          {/* LEFT: Source details */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {isBrex ? 'Brex Transaction' : 'Invoice Details'}
              </span>
              {isBrex && (
                <a href={brexExpenseUrl(bill.brex_expense_id_str, bill.brex_merchant_name)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors font-medium"><ExternalLink className="w-3 h-3" />Open in Brex</a>
              )}
              {isFront && bill.front_conversation_id && (
                <a href={`https://app.frontapp.com/open/${bill.front_conversation_id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors font-medium"><ExternalLink className="w-3 h-3" />Open in Front</a>
              )}
            </div>

            <h2 className="text-base font-semibold text-slate-100 mb-0.5">{displayName}</h2>

            {isBrex && (
              <>
                <p className="text-xs text-slate-500 mb-3">
                  {bill.brex_merchant_raw && bill.brex_merchant_raw !== bill.brex_merchant_name ? `${bill.brex_merchant_raw} \u00B7 ` : ""}
                  {bill.brex_posted_at ? new Date(bill.brex_posted_at).toLocaleDateString() : bill.brex_initiated_at ? new Date(bill.brex_initiated_at).toLocaleDateString() : "No date"}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
                  <div><span className="text-xs text-slate-500">Amount</span><p className="font-bold text-slate-100 text-base">${Number(bill.amount).toFixed(2)}</p></div>
                  <div><span className="text-xs text-slate-500">Posted Date</span><p className="font-mono text-sm text-slate-300">{bill.brex_posted_at || "Pending"}</p></div>
                  {bill.brex_transaction_type && <div><span className="text-xs text-slate-500">Type</span><p className="text-sm text-slate-300">{bill.brex_transaction_type}</p></div>}
                </div>
                {bill.brex_memo && <p className="text-xs text-slate-400 mb-2 line-clamp-2"><span className="text-slate-500">Memo: </span>{bill.brex_memo}</p>}
                {bill.brex_receipt_ids && bill.brex_receipt_ids.length > 0 && (
                  <div className="flex gap-1.5 mb-2">
                    {bill.brex_receipt_ids.map((receiptId, idx) => (
                      <a key={receiptId} href={`/api/admin/brex/receipt?receipt_id=${receiptId}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-2 py-1 bg-white/5 text-slate-400 rounded text-[10px] hover:bg-white/10 transition-colors">
                        <ImageIcon className="w-3 h-3" />Receipt {idx + 1}
                      </a>
                    ))}
                  </div>
                )}
              </>
            )}

            {isFront && (
              <>
                <p className="text-xs text-slate-500 mb-3">
                  {bill.front_email_from && <>{bill.front_email_from} &middot; </>}
                  {bill.invoice_date ? new Date(bill.invoice_date + 'T00:00:00').toLocaleDateString() : "No date"}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
                  <div><span className="text-xs text-slate-500">Amount</span><p className="font-bold text-slate-100 text-base">${Number(bill.amount).toFixed(2)}</p></div>
                  <div><span className="text-xs text-slate-500">Invoice Date</span><p className="font-mono text-sm text-slate-300">{bill.invoice_date || '\u2014'}</p></div>
                  {bill.invoice_number && <div><span className="text-xs text-slate-500">Invoice #</span><p className="font-mono text-sm text-slate-300">{bill.invoice_number}</p></div>}
                  {bill.document_type && bill.document_type !== 'invoice' && <div><span className="text-xs text-slate-500">Type</span><p className="text-sm text-slate-300 capitalize">{bill.document_type.replace('_', ' ')}</p></div>}
                  {bill.payment_status && bill.payment_status !== 'unknown' && <div><span className="text-xs text-slate-500">Payment</span><p className={`text-sm font-medium ${bill.payment_status === 'paid' ? 'text-emerald-400' : 'text-amber-400'}`}>{bill.payment_status}</p></div>}
                </div>
                {bill.front_email_subject && <p className="text-xs text-slate-400 mb-2 line-clamp-2"><span className="text-slate-500">Subject: </span>{bill.front_email_subject}</p>}
                {bill.description && <p className="text-xs text-slate-400 mb-2 line-clamp-2"><span className="text-slate-500">Description: </span>{bill.description}</p>}
              </>
            )}

            {/* Actions */}
            <div className="flex gap-2 flex-wrap mt-2">
              {isCorporate && (
                <button onClick={() => onUnmarkCorporate(bill.id)} disabled={actionId === bill.id} className="flex items-center gap-1 text-xs px-2 py-1 bg-white/5 text-slate-400 rounded hover:bg-white/10 disabled:opacity-50">
                  <ArchiveRestore className="w-3.5 h-3.5" />{actionId === bill.id ? "..." : "Unarchive"}
                </button>
              )}
              {isPending && isBrex && !isCorporate && (
                <button onClick={() => onMarkCorporate(bill.id)} disabled={actionId === bill.id} className="flex items-center gap-1 text-xs px-2 py-1 bg-white/5 text-slate-400 rounded hover:bg-white/10 disabled:opacity-50">
                  <Archive className="w-3.5 h-3.5" />{actionId === bill.id ? "Archiving..." : "Archive as Corporate"}
                </button>
              )}
              {isHidden && (
                <button onClick={() => onUnhide(bill.id)} disabled={actionId === bill.id} className="flex items-center gap-1 text-xs px-2 py-1 bg-white/5 text-slate-400 rounded hover:bg-white/10 disabled:opacity-50">
                  <Eye className="w-3.5 h-3.5" />{actionId === bill.id ? "..." : "Unhide"}
                </button>
              )}
              {isPending && !isBrex && (
                <button onClick={() => onHide(bill)} disabled={actionId === bill.id} className="flex items-center gap-1 text-xs px-2 py-1 bg-white/5 text-slate-400 rounded hover:bg-white/10 disabled:opacity-50">
                  <EyeOff className="w-3.5 h-3.5" />{actionId === bill.id ? "Hiding..." : "Hide Bill"}
                </button>
              )}
            </div>
          </div>

          {/* RIGHT: AppFolio panel */}
          <div className={`p-4 ${isPayment ? "bg-purple-500/5" : isEntered ? "bg-emerald-500/5" : isCorporate ? "bg-white/[0.02]" : isHidden ? "bg-white/[0.02]" : "bg-amber-500/5"}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {isPayment ? 'Payment Record' : 'AppFolio'}
              </span>
              {isPayment ? <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-purple-500/20 text-purple-400">Payment</span>
               : isEntered ? <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-emerald-500/20 text-emerald-400"><CheckCircle2 className="w-3 h-3" />Entered</span>
               : isCorporate ? <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-slate-500/20 text-slate-400"><Archive className="w-3 h-3" />Corporate</span>
               : isHidden ? <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-slate-500/20 text-slate-400"><EyeOff className="w-3 h-3" />Hidden</span>
               : <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-amber-500/20 text-amber-400"><AlertCircle className="w-3 h-3" />Pending</span>}
            </div>

            {isPayment && (
              <div className="space-y-2">
                <p className="text-sm text-slate-400">Card payment / collection — for internal records only, not entered in AppFolio.</p>
                {bill.brex_memo && <p className="text-xs text-purple-300"><span className="text-slate-500">Memo: </span>{bill.brex_memo}</p>}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div><span className="text-[10px] text-slate-500 uppercase tracking-wide">Amount</span><p className="font-semibold text-purple-300">${Number(bill.amount).toFixed(2)}</p></div>
                  <div><span className="text-[10px] text-slate-500 uppercase tracking-wide">Posted</span><p className="text-sm text-slate-300">{bill.brex_posted_at || '\u2014'}</p></div>
                </div>
              </div>
            )}

            {isPending && (
              <AppFolioPanel
                mode="form"
                draft={draft}
                onUpdateDraft={(field, value) => onUpdateDraft(bill.id, field as keyof UnifiedBillDraft, value)}
                missingFields={missing}
                isFieldMissing={(field) => isFieldMissing(bill.id, field)}
                isManualEntry={isManualEntry}
                showInvoiceNumber={isFront}
                queueStatus={queueItem?.status === 'uploading' ? 'uploading' : queueItem?.status === 'queued' ? 'queued' : null}
                uploadResult={result}
                onSubmit={() => onEnqueueUpload(bill)}
                onRetry={() => onRetryUpload(bill.id)}
                previousApproval={bill.approved_by && bill.approved_at ? { by: bill.approved_by, at: bill.approved_at } : null}
                vendors={vendors}
                glAccounts={glAccounts}
                properties={properties}
                unitsByProperty={unitsByProperty}
              />
            )}

            {isEntered && (
              <AppFolioPanel
                mode="display"
                displayFields={enteredDisplayFields}
                displayApproval={bill.approved_by ? { by: bill.approved_by, at: bill.approved_at || '' } : null}
                vendors={vendors}
                glAccounts={glAccounts}
                properties={properties}
              />
            )}

            {(isCorporate || isHidden) && !isEntered && !isPayment && (
              <div className="space-y-2">
                <p className="text-sm text-slate-400">
                  {isCorporate ? 'This expense was marked as a corporate expense — not entered in AppFolio.' : 'This bill was hidden — not entered in AppFolio.'}
                </p>
                {bill.hidden_note && <p className="text-xs text-slate-500">Note: {bill.hidden_note}</p>}
                {bill.hidden_at && <p className="text-[10px] text-slate-600">Hidden {new Date(bill.hidden_at).toLocaleDateString()}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
