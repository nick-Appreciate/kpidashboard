import React from "react";
import { ExternalLink, FileText, CheckCircle2, AlertCircle, EyeOff, Eye, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import AppFolioPanel from "./AppFolioPanel";
import type { Bill, BillDraft, BillQueueItem, GLAccount } from "../../types/bookkeeping";

const getAttachmentUrl = (attachmentsJson: any): string | null => {
  if (!attachmentsJson) return null;
  try {
    const arr = typeof attachmentsJson === "string" ? JSON.parse(attachmentsJson) : attachmentsJson;
    return arr?.[0]?.url || null;
  } catch { return null; }
};

const getDocTypeBadge = (docType: string) => {
  switch (docType) {
    case "invoice": return "bg-blue-500/15 text-blue-400";
    case "estimate": return "bg-purple-500/15 text-purple-400";
    case "receipt": return "bg-slate-500/15 text-slate-400";
    case "payment": return "bg-green-500/15 text-green-400";
    case "credit_memo": return "bg-orange-500/15 text-orange-400";
    default: return "bg-slate-500/15 text-slate-400";
  }
};

interface BillingInvoiceRowProps {
  bill: Bill;
  isExpanded: boolean;
  onToggleExpand: () => void;
  draft: BillDraft | undefined;
  prefillMap: Record<string, any>;
  uploadQueue: BillQueueItem[];
  uploadResult: Record<number, { success: boolean; message: string }>;
  hidingId: number | null;
  vendors: string[];
  glAccounts: GLAccount[];
  properties: string[];
  filter: string;
  onUpdateDraft: (billId: number, field: keyof BillDraft, value: string) => void;
  onEnqueueUpload: (bill: Bill) => void;
  onRetryUpload: (billId: number) => void;
  onSetHideModal: (modal: { bill: Bill; note: string } | null) => void;
  onUnhideBill: (billId: number) => void;
  getMissingFields: (draft: BillDraft | undefined) => string[];
  isFieldMissing: (billId: number, field: string) => boolean;
}

export default function BillingInvoiceRow({
  bill, isExpanded, onToggleExpand, draft, prefillMap,
  uploadQueue, uploadResult, hidingId,
  vendors, glAccounts, properties, filter,
  onUpdateDraft, onEnqueueUpload, onRetryUpload,
  onSetHideModal, onUnhideBill,
  getMissingFields, isFieldMissing,
}: BillingInvoiceRowProps) {
  const pdfUrl = getAttachmentUrl(bill.attachments_json);
  const isMatched = bill.af_match_status === "matched";
  const isHiddenView = filter === "hidden";
  const queueItem = uploadQueue.find(q => q.billId === bill.id);
  const result = uploadResult[bill.id];
  const missing = draft ? getMissingFields(draft) : [];
  const isManualEntry = bill.status === 'manual_entry' || bill.document_type === 'credit_memo' || bill.amount < 0;
  const prefill = prefillMap[bill.vendor_name];

  const statusColor = isMatched ? 'bg-emerald-500' : isHiddenView ? 'bg-slate-500' : 'bg-amber-500';
  const statusBorder = isMatched ? 'border-emerald-500/20' : isHiddenView ? 'border-slate-600' : queueItem?.status === 'uploading' ? 'border-cyan-500/30' : queueItem?.status === 'failed' ? 'border-red-500/30' : 'border-[var(--glass-border)]';

  // Build display fields for matched bills
  const matchedDisplayFields = isMatched ? [
    { label: 'AF Status', value: <p className={`font-semibold text-sm ${bill.af_status === "Paid" ? "text-emerald-400" : "text-amber-400"}`}>{bill.af_status}</p> },
    (bill.af_bill_id || bill.appfolio_bill_id) ? { label: 'AF Bill #', value: <a href={`https://appreciateinc.appfolio.com/accounting/payable_invoices/${bill.af_bill_id || bill.appfolio_bill_id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-mono text-sm text-accent hover:underline">{bill.af_bill_id || bill.appfolio_bill_id}<ExternalLink className="w-3 h-3" /></a> } : null,
    bill.af_property_name ? { label: 'Property', value: bill.af_property_name } : null,
    bill.af_gl_account_name ? { label: 'GL Account', value: bill.af_gl_account_name, colSpan: 2 as const } : null,
    bill.af_paid_date ? { label: 'Paid Date', value: <p className="font-mono text-sm text-slate-300">{bill.af_paid_date}</p> } : null,
    bill.af_memo ? { label: 'Memo', value: <p className="text-sm text-slate-400">{bill.af_memo}</p>, colSpan: 2 as const } : null,
  ].filter(Boolean) as { label: string; value: React.ReactNode; colSpan?: 1 | 2 }[] : undefined;

  return (
    <div className={`glass-card overflow-hidden transition-all border-l-2 border-l-blue-500/60 ${statusBorder} ${isHiddenView && !isExpanded ? "opacity-60" : ""}`}>
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
        <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-500/15 text-blue-400 uppercase tracking-wider">Invoice</span>

        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-slate-100 truncate block">{bill.vendor_name}</span>
        </div>

        <div className="flex-shrink-0">
          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${getDocTypeBadge(bill.document_type)}`}>
            {bill.document_type === 'credit_memo' ? 'credit' : bill.document_type}
          </span>
        </div>

        <div className="flex-shrink-0 w-16 text-center">
          {!isMatched && !isHiddenView && isManualEntry && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 font-medium">Manual</span>}
          {!isMatched && !isHiddenView && !isManualEntry && prefill && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-medium">Prefill</span>}
          {!isMatched && !isHiddenView && !isManualEntry && !prefill && missing.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">{missing.length} req</span>}
        </div>

        <div className="flex-shrink-0 w-24 text-right">
          <span className={`text-sm font-bold tabular-nums ${Number(bill.amount) < 0 ? 'text-orange-400' : 'text-slate-100'}`}>
            {Number(bill.amount) < 0 ? '-' : ''}${Math.abs(Number(bill.amount)).toFixed(2)}
          </span>
        </div>

        <div className="flex-shrink-0 w-24 text-right">
          <span className="text-xs text-slate-500 tabular-nums">
            {bill.invoice_date ? new Date(bill.invoice_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '\u2014'}
          </span>
        </div>

        <div className="flex-shrink-0 w-24">
          {isMatched ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-500/15 text-emerald-400"><CheckCircle2 className="w-3 h-3" />Matched</span>
           : isHiddenView ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-500/15 text-slate-400"><EyeOff className="w-3 h-3" />Hidden</span>
           : queueItem?.status === 'uploading' ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-cyan-500/15 text-cyan-400"><Loader2 className="w-3 h-3 animate-spin" />Sending</span>
           : queueItem?.status === 'queued' ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-500/15 text-slate-400">Queued</span>
           : result?.success === false ? <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-red-500/15 text-red-400"><AlertCircle className="w-3 h-3" />Failed</span>
           : <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/15 text-amber-400">Unmatched</span>}
        </div>

        <div className="flex-shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {pdfUrl && <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="p-1 text-slate-500 hover:text-accent transition-colors" title="View PDF"><FileText className="w-3.5 h-3.5" /></a>}
          {bill.front_conversation_id && (
            <a href={`https://app.frontapp.com/open/${bill.front_message_id || bill.front_conversation_id}`} target="_blank" rel="noopener noreferrer" className="p-1 text-slate-500 hover:text-accent transition-colors" title="Open in Front"><ExternalLink className="w-3.5 h-3.5" /></a>
          )}
        </div>
      </div>

      {/* ── EXPANDED CONTENT ── */}
      {isExpanded && (
        <div className="grid grid-cols-2 divide-x divide-[var(--glass-border)]">
          <div className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Front / Parsed</span>
            </div>
            <h2 className="text-base font-semibold text-slate-100 mb-0.5">{bill.vendor_name}</h2>
            <p className="text-xs text-slate-400 mb-3">{bill.front_email_from} · {new Date(bill.created_at).toLocaleDateString()}</p>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
              <div><span className="text-xs text-slate-500">Amount</span><p className={`font-bold text-base ${Number(bill.amount) < 0 ? 'text-orange-400' : 'text-slate-100'}`}>{Number(bill.amount) < 0 ? '-' : ''}${Math.abs(Number(bill.amount)).toFixed(2)}</p></div>
              <div><span className="text-xs text-slate-500">Invoice Date</span><p className="font-mono text-sm text-slate-300">{bill.invoice_date}</p></div>
              {bill.invoice_number && <div><span className="text-xs text-slate-500">Invoice #</span><p className="font-mono text-sm text-slate-300">{bill.invoice_number}</p></div>}
              {bill.due_date && <div><span className="text-xs text-slate-500">Due Date</span><p className="font-mono text-sm text-slate-300">{bill.due_date}</p></div>}
            </div>

            {bill.front_email_subject && <p className="text-xs text-slate-400 mb-2 line-clamp-1"><span className="text-slate-500">Subject: </span>{bill.front_email_subject}</p>}
            {bill.description && <p className="text-xs text-slate-400 mb-2 line-clamp-2"><span className="text-slate-500">Description: </span>{bill.description}</p>}
            {isHiddenView && bill.hidden_note && <p className="text-xs text-orange-400 mb-2 italic"><span className="text-orange-500">Hidden: </span>{bill.hidden_note}</p>}

            <div className="flex gap-1.5 mb-3 flex-wrap">
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${getDocTypeBadge(bill.document_type)}`}>{bill.document_type === 'credit_memo' ? 'credit / refund' : bill.document_type}</span>
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${bill.payment_status === "paid" ? "bg-green-500/15 text-green-400" : bill.payment_status === "unpaid" ? "bg-amber-500/15 text-amber-400" : "bg-slate-500/15 text-slate-400"}`}>{bill.payment_status}</span>
            </div>

            <div className="flex gap-2 flex-wrap">
              {pdfUrl && <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs px-2 py-1 bg-accent/15 text-accent rounded hover:bg-accent/25"><FileText className="w-3.5 h-3.5" />PDF</a>}
              {bill.front_conversation_id && <a href={`https://app.frontapp.com/open/${bill.front_message_id || bill.front_conversation_id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs px-2 py-1 bg-accent/15 text-accent rounded hover:bg-accent/25"><ExternalLink className="w-3.5 h-3.5" />Front</a>}
              {isHiddenView ? (
                <button onClick={() => onUnhideBill(bill.id)} disabled={hidingId === bill.id} className="flex items-center gap-1 text-xs px-2 py-1 bg-white/5 text-slate-400 rounded hover:bg-white/10 disabled:opacity-50">
                  <Eye className="w-3.5 h-3.5" />{hidingId === bill.id ? "..." : "Unhide"}
                </button>
              ) : (
                <button onClick={() => onSetHideModal({ bill, note: "" })} className="flex items-center gap-1 text-xs px-2 py-1 bg-white/5 text-slate-400 rounded hover:bg-white/10">
                  <EyeOff className="w-3.5 h-3.5" />Hide
                </button>
              )}
            </div>
          </div>

          <div className={`p-4 ${isMatched ? "bg-emerald-500/5" : "bg-amber-500/5"}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">AppFolio</span>
              {isMatched ? (
                <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-emerald-500/20 text-emerald-400"><CheckCircle2 className="w-3 h-3" />Matched</span>
              ) : (
                <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-amber-500/20 text-amber-400"><AlertCircle className="w-3 h-3" />Unmatched</span>
              )}
            </div>

            <AppFolioPanel
              mode={isMatched ? 'display' : 'form'}
              // Form props
              draft={draft}
              onUpdateDraft={(field, value) => onUpdateDraft(bill.id, field as keyof BillDraft, value)}
              missingFields={missing}
              isFieldMissing={(field) => isFieldMissing(bill.id, field)}
              isManualEntry={isManualEntry}
              showInvoiceNumber
              queueStatus={queueItem?.status === 'uploading' ? 'uploading' : queueItem?.status === 'queued' ? 'queued' : null}
              uploadResult={result}
              onSubmit={() => onEnqueueUpload(bill)}
              onRetry={() => onRetryUpload(bill.id)}
              previousApproval={bill.af_approved_by && bill.af_approved_at ? { by: bill.af_approved_by, at: bill.af_approved_at } : null}
              vendors={vendors}
              glAccounts={glAccounts}
              properties={properties}
              // Display props
              displayFields={matchedDisplayFields}
              displayApproval={isMatched && bill.af_approved_by ? { by: bill.af_approved_by, at: bill.af_approved_at || '' } : null}
            />
          </div>
        </div>
      )}
    </div>
  );
}
