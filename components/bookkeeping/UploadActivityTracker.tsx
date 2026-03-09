import React from "react";
import { CheckCircle2, AlertCircle, X, Upload, Loader2, RefreshCw, ExternalLink } from "lucide-react";
import type { UnifiedQueueItemV2 } from "../../types/bookkeeping";

interface UploadActivityTrackerProps {
  queue: UnifiedQueueItemV2[];
  onDismiss: (billId: number) => void;
  onRetry: (billId: number) => void;
  onClearFinished: () => void;
}

export default function UploadActivityTracker({
  queue,
  onDismiss,
  onRetry,
  onClearFinished,
}: UploadActivityTrackerProps) {
  if (queue.length === 0) return null;

  const allFinished = queue.every(q => q.status === 'success' || q.status === 'failed');

  const sourceBadge = (source: string) => (
    <span className={`px-1 py-px rounded text-[9px] font-bold uppercase ${source === 'brex' ? 'bg-violet-500/15 text-violet-400' : 'bg-blue-500/15 text-blue-400'}`}>
      {source === 'brex' ? 'Brex' : 'Invoice'}
    </span>
  );

  return (
    <div className="glass-card p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <Upload className="w-4 h-4 text-accent" />
          Upload Activity
          {!allFinished && (
            <span className="text-xs font-normal text-slate-500">
              ({queue.filter(q => q.status === 'queued').length} queued
              {queue.some(q => q.status === 'uploading') ? ', 1 uploading' : ''})
            </span>
          )}
        </h2>
        {allFinished && (
          <button onClick={onClearFinished} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Clear all</button>
        )}
      </div>
      <div className="space-y-1.5">
        {queue.filter(q => q.status === 'uploading').map(q => (
          <div key={q.billId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
              {sourceBadge(q.source)}
              <span className="text-xs text-slate-200 font-medium">{q.vendorName}</span>
              <span className="text-xs text-slate-500">${q.amount.toFixed(2)}</span>
            </div>
            <span className="text-[10px] text-cyan-400 font-medium uppercase">Uploading</span>
          </div>
        ))}

        {queue.filter(q => q.status === 'queued').map((q, idx) => (
          <div key={q.billId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] border border-[var(--glass-border)]">
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 flex items-center justify-center rounded-full bg-slate-700 text-[10px] text-slate-400 font-bold">{idx + 1}</span>
              {sourceBadge(q.source)}
              <span className="text-xs text-slate-300">{q.vendorName}</span>
              <span className="text-xs text-slate-500">${q.amount.toFixed(2)}</span>
            </div>
            <button onClick={() => onDismiss(q.billId)} className="text-slate-600 hover:text-slate-400 transition-colors" title="Cancel"><X className="w-3.5 h-3.5" /></button>
          </div>
        ))}

        {queue.filter(q => q.status === 'success').map(q => (
          <div key={q.billId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              {sourceBadge(q.source)}
              <span className="text-xs text-slate-200">{q.vendorName}</span>
              <span className="text-xs text-slate-500">${q.amount.toFixed(2)}</span>
              <span className="text-[10px] text-emerald-400">Done</span>
              {q.afBillId && (
                <a href={`https://appreciateinc.appfolio.com/accounting/payable_invoices/${q.afBillId}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[10px] text-accent hover:underline font-medium" title="View in AppFolio">
                  AF #{q.afBillId}<ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
            <button onClick={() => onDismiss(q.billId)} className="text-slate-600 hover:text-slate-400 transition-colors" title="Dismiss"><X className="w-3.5 h-3.5" /></button>
          </div>
        ))}

        {queue.filter(q => q.status === 'failed').map(q => (
          <div key={q.billId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
              {sourceBadge(q.source)}
              <span className="text-xs text-slate-200">{q.vendorName}</span>
              <span className="text-xs text-red-400/80 truncate">{q.message}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button onClick={() => onRetry(q.billId)} className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors flex items-center gap-1"><RefreshCw className="w-3 h-3" />Retry</button>
              <button onClick={() => onDismiss(q.billId)} className="text-slate-600 hover:text-slate-400 transition-colors" title="Dismiss"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
