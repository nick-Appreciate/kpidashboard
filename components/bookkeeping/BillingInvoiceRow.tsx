import React from "react";
import { ExternalLink, FileText, CheckCircle2, AlertCircle, EyeOff, Eye, Upload, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import DarkSelect from "../DarkSelect";
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

const inputCls = "w-full bg-surface-base border border-[var(--glass-border)] rounded px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-accent/50";
const inputMissingCls = "w-full bg-surface-base border border-red-500/50 rounded px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-red-400";
const labelCls = "text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-0.5 block";
const reqStar = <span className="text-red-400 ml-0.5">*</span>;

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

  const vendorOptions = vendors.map((v) => ({ value: v, label: v }));
  const glOptions = glAccounts.map((gl) => ({ value: gl.id, label: `${gl.id} ${gl.name}` }));
  const propOptions = properties.map((p) => ({ value: p, label: p }));

  const renderEditablePanel = () => {
    if (!draft) return null;
    const isUploading = queueItem?.status === 'uploading';
    const isQueued = queueItem?.status === 'queued';
    const isLocked = isUploading || isQueued;
    const canSubmit = missing.length === 0 && !isManualEntry && !isLocked;

    return (
      <div className="space-y-3">
        {isManualEntry ? (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg px-3 py-2">
            <p className="text-xs text-orange-400 font-semibold flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              Credit / Refund — Manual Entry Required
            </p>
            <p className="text-[11px] text-orange-300/70 mt-1">
              Credit memos and refunds cannot be auto-uploaded. Please enter this directly in AppFolio.
            </p>
          </div>
        ) : (
          <p className="text-xs text-amber-400 font-medium">Review & approve for AppFolio upload:</p>
        )}

        {bill.af_approved_by && bill.af_approved_at && (
          <p className="text-[10px] text-slate-500">
            Approved by {bill.af_approved_by} on {new Date(bill.af_approved_at).toLocaleString()}
          </p>
        )}

        <div className="bg-surface-raised/80 border border-amber-500/20 rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className={labelCls}>Vendor {reqStar}</label>
              {/* @ts-ignore */}
              <DarkSelect value={draft.vendor_name} onChange={(val: string) => onUpdateDraft(bill.id, 'vendor_name', val)} options={vendorOptions} compact searchable className={`w-full ${isFieldMissing(bill.id, 'vendor') ? '[&_div]:!border-red-500/50' : ''}`} placeholder="Search vendor..." />
            </div>
            <div>
              <label className={labelCls}>Amount {reqStar}</label>
              <input type="number" step="0.01" className={isFieldMissing(bill.id, 'amount') ? inputMissingCls : inputCls} value={draft.amount} onChange={(e) => onUpdateDraft(bill.id, 'amount', e.target.value)} disabled={isLocked} />
            </div>
            <div>
              <label className={labelCls}>Invoice # (Reference)</label>
              <input type="text" className={inputCls} value={draft.invoice_number} onChange={(e) => onUpdateDraft(bill.id, 'invoice_number', e.target.value)} disabled={isLocked} />
            </div>
            <div>
              <label className={labelCls}>Invoice Date {reqStar}</label>
              <input type="date" className={isFieldMissing(bill.id, 'invoice_date') ? inputMissingCls : inputCls} value={draft.invoice_date} onChange={(e) => onUpdateDraft(bill.id, 'invoice_date', e.target.value)} disabled={isLocked} />
            </div>
            <div>
              <label className={labelCls}>Due Date</label>
              <input type="date" className={inputCls} value={draft.due_date} onChange={(e) => onUpdateDraft(bill.id, 'due_date', e.target.value)} disabled={isLocked} />
            </div>
          </div>

          <div className="border-t border-[var(--glass-border)] my-1" />
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Bill Details (Line Item)</p>

          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className={labelCls}>Property</label>
              {/* @ts-ignore */}
              <DarkSelect value={draft.af_property_input} onChange={(val: string) => onUpdateDraft(bill.id, 'af_property_input', val)} options={propOptions} compact searchable className="w-full" placeholder="Select property..." />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Unit</label>
              <input type="text" className={inputCls} value={draft.af_unit_input} onChange={(e) => onUpdateDraft(bill.id, 'af_unit_input', e.target.value)} placeholder="Unit #" disabled={isLocked} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>GL Account {reqStar}</label>
              {/* @ts-ignore */}
              <DarkSelect value={draft.af_gl_account_input} onChange={(val: string) => onUpdateDraft(bill.id, 'af_gl_account_input', val)} options={glOptions} compact searchable className={`w-full ${isFieldMissing(bill.id, 'gl_account') ? '[&_div]:!border-red-500/50' : ''}`} placeholder="Search GL account..." />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Description</label>
              <input type="text" className={inputCls} value={draft.description} onChange={(e) => onUpdateDraft(bill.id, 'description', e.target.value)} placeholder="Line item description" disabled={isLocked} />
            </div>
          </div>
        </div>

        {result && (
          <div className={`text-xs px-3 py-2 rounded ${result.success ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/15 text-red-400 border border-red-500/20'}`}>
            {result.message}
          </div>
        )}

        {!canSubmit && !isManualEntry && missing.length > 0 && (
          <p className="text-[11px] text-red-400">
            Required: {missing.map(f => f === 'gl_account' ? 'GL Account' : f === 'invoice_date' ? 'Invoice Date' : f.charAt(0).toUpperCase() + f.slice(1)).join(', ')}
          </p>
        )}

        {isManualEntry ? (
          <a href="https://appreciate.appfolio.com/accounting/bills/new" target="_blank" rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-orange-600 hover:bg-orange-500 text-white transition-colors">
            <ExternalLink className="w-4 h-4" />Open AppFolio to Enter Manually
          </a>
        ) : (
          <button onClick={() => onEnqueueUpload(bill)} disabled={isLocked || !canSubmit}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              isUploading ? 'bg-cyan-900/40 text-cyan-400 cursor-wait border border-cyan-500/20'
              : isQueued ? 'bg-slate-700 text-slate-400 cursor-wait'
              : !canSubmit ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}>
            {isUploading ? <><Loader2 className="w-4 h-4 animate-spin" />Uploading to AppFolio...</>
             : isQueued ? <><Loader2 className="w-4 h-4 animate-spin" />Queued...</>
             : <><Upload className="w-4 h-4" />Approve & Upload to AppFolio</>}
          </button>
        )}
      </div>
    );
  };

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
            {bill.invoice_date ? new Date(bill.invoice_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
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

            {isMatched ? (
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div><span className="text-xs text-slate-500">AF Status</span><p className={`font-semibold text-sm ${bill.af_status === "Paid" ? "text-emerald-400" : "text-amber-400"}`}>{bill.af_status}</p></div>
                  {bill.af_bill_id && <div><span className="text-xs text-slate-500">AF Bill #</span><a href={`https://appreciate.appfolio.com/accounting/bills/${bill.af_bill_id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-mono text-sm text-accent hover:underline">{bill.af_bill_id}<ExternalLink className="w-3 h-3" /></a></div>}
                  {bill.af_property_name && <div><span className="text-xs text-slate-500">Property</span><p className="font-medium text-sm text-slate-200">{bill.af_property_name}</p></div>}
                  {bill.af_gl_account_name && <div className="col-span-2"><span className="text-xs text-slate-500">GL Account</span><p className="font-medium text-sm text-slate-200">{bill.af_gl_account_name}</p></div>}
                  {bill.af_paid_date && <div><span className="text-xs text-slate-500">Paid Date</span><p className="font-mono text-sm text-slate-300">{bill.af_paid_date}</p></div>}
                  {bill.af_memo && <div className="col-span-2"><span className="text-xs text-slate-500">Memo</span><p className="text-sm text-slate-400">{bill.af_memo}</p></div>}
                </div>
                {bill.af_approved_by && (
                  <div className="mt-3 pt-2 border-t border-emerald-500/10">
                    <p className="text-[11px] text-slate-500">
                      <CheckCircle2 className="w-3 h-3 inline-block mr-1 text-emerald-500/60" />
                      Approved by <span className="text-slate-400 font-medium">{bill.af_approved_by}</span>
                      {bill.af_approved_at && <> on <span className="text-slate-400">{new Date(bill.af_approved_at).toLocaleDateString()} {new Date(bill.af_approved_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></>}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              renderEditablePanel()
            )}
          </div>
        </div>
      )}
    </div>
  );
}
