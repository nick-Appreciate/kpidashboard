import React from "react";
import { CheckCircle2, AlertCircle, Upload, Loader2, ExternalLink } from "lucide-react";
import DarkSelect from "../DarkSelect";
import type { GLAccount } from "../../types/bookkeeping";

const inputCls = "w-full bg-surface-base border border-[var(--glass-border)] rounded px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-accent/50";
const inputMissingCls = "w-full bg-surface-base border border-red-500/50 rounded px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-red-400";
const labelCls = "text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-0.5 block";
const reqStar = <span className="text-red-400 ml-0.5">*</span>;

// ─── Shared draft shape for the upload form ────────────────────────────────
export interface AppFolioPanelDraft {
  vendor_name: string;
  amount: string;
  invoice_date: string;
  due_date: string;
  invoice_number?: string;
  description: string;
  af_property_input: string;
  af_gl_account_input: string;
  af_unit_input: string;
}

// ─── Display-mode field descriptor ─────────────────────────────────────────
export interface AppFolioDisplayField {
  label: string;
  value: React.ReactNode;
  colSpan?: 1 | 2;
}

// ─── Component Props ───────────────────────────────────────────────────────
interface AppFolioPanelProps {
  /** 'form' = upload form (unmatched/pending), 'display' = matched/entered read-only view */
  mode: 'form' | 'display';

  // ═══ FORM MODE ═══════════════════════════════════════════════════════════
  draft?: AppFolioPanelDraft;
  onUpdateDraft?: (field: string, value: string) => void;
  missingFields?: string[];
  isFieldMissing?: (field: string) => boolean;

  /** Credit memos / refunds that need manual entry */
  isManualEntry?: boolean;
  manualEntryTitle?: string;
  manualEntryDescription?: string;

  /** Show the Invoice # field (Billing invoices have this, Brex does not) */
  showInvoiceNumber?: boolean;

  /** Current upload queue status for this item */
  queueStatus?: 'queued' | 'uploading' | null;
  /** Result from the upload (success/fail message) */
  uploadResult?: { success: boolean; message: string } | null;
  /** Called when the user clicks "Approve & Upload" */
  onSubmit?: () => void;
  /** Called when the user clicks "Retry" after a failure */
  onRetry?: () => void;

  /** Info about a previous approval attempt */
  previousApproval?: { by: string; at: string } | null;

  /** Dropdown data */
  vendors: string[];
  glAccounts: GLAccount[];
  properties: string[];
  unitsByProperty?: Record<string, string[]>;

  /** Slot for content above the form (e.g. Brex potential-matches panel) */
  beforeForm?: React.ReactNode;
  /** Custom prompt text above the form */
  formPrompt?: string;

  // ═══ DISPLAY MODE ════════════════════════════════════════════════════════
  /** Fields to render in the 2-col grid */
  displayFields?: AppFolioDisplayField[];
  /** Approval info shown below the grid */
  displayApproval?: { by: string; at: string } | null;
  /** Slot for content after the display (e.g. unlink button) */
  afterDisplay?: React.ReactNode;
}

// ═══════════════════════════════════════════════════════════════════════════
export default function AppFolioPanel({
  mode,
  // Form
  draft, onUpdateDraft, missingFields = [], isFieldMissing: isFieldMissingProp,
  isManualEntry, manualEntryTitle, manualEntryDescription,
  showInvoiceNumber,
  queueStatus, uploadResult, onSubmit, onRetry,
  previousApproval,
  vendors, glAccounts, properties, unitsByProperty,
  beforeForm, formPrompt,
  // Display
  displayFields, displayApproval, afterDisplay,
}: AppFolioPanelProps) {

  if (mode === 'display') return <DisplayView />;
  return <FormView />;

  // ─── DISPLAY MODE ──────────────────────────────────────────────────────
  function DisplayView() {
    return (
      <div className="space-y-2 text-sm">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {(displayFields || []).map((field, idx) => (
            <div key={idx} className={field.colSpan === 2 ? 'col-span-2' : ''}>
              <span className="text-xs text-slate-500">{field.label}</span>
              {typeof field.value === 'string' ? (
                <p className="font-medium text-sm text-slate-200">{field.value}</p>
              ) : (
                field.value
              )}
            </div>
          ))}
        </div>
        {displayApproval && (
          <div className="mt-3 pt-2 border-t border-emerald-500/10">
            <p className="text-[11px] text-slate-500">
              <CheckCircle2 className="w-3 h-3 inline-block mr-1 text-emerald-500/60" />
              Approved by <span className="text-slate-400 font-medium">{displayApproval.by}</span>
              {displayApproval.at && (
                <> on <span className="text-slate-400">
                  {new Date(displayApproval.at).toLocaleDateString()}{' '}
                  {new Date(displayApproval.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span></>
              )}
            </p>
          </div>
        )}
        {afterDisplay}
      </div>
    );
  }

  // ─── FORM MODE ─────────────────────────────────────────────────────────
  function FormView() {
    if (!draft) return null;

    const isMissing = isFieldMissingProp || ((f: string) => missingFields.includes(f));
    const isUploading = queueStatus === 'uploading';
    const isQueued = queueStatus === 'queued';
    const isLocked = isUploading || isQueued;
    const canSubmit = missingFields.length === 0 && !isManualEntry && !isLocked;

    const vendorOptions = vendors.map(v => ({ value: v, label: v }));
    const glOptions = glAccounts.map(gl => ({ value: gl.id, label: `${gl.id} ${gl.name}` }));
    const propOptions = properties.map(p => ({ value: p, label: p }));
    const unitOptions = (unitsByProperty?.[draft.af_property_input] || []).map(u => ({ value: u, label: u }));

    const handlePropertyChange = (val: string) => {
      onUpdateDraft?.('af_property_input', val);
      // Clear unit if it's no longer valid for the new property
      const newUnits = unitsByProperty?.[val] || [];
      if (draft.af_unit_input && !newUnits.includes(draft.af_unit_input)) {
        onUpdateDraft?.('af_unit_input', '');
      }
    };

    return (
      <div className="space-y-3">
        {beforeForm}

        {isManualEntry ? (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg px-3 py-2">
            <p className="text-xs text-orange-400 font-semibold flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              {manualEntryTitle || 'Credit / Refund \u2014 Manual Entry Required'}
            </p>
            <p className="text-[11px] text-orange-300/70 mt-1">
              {manualEntryDescription || 'Credit memos and refunds cannot be auto-uploaded. Please enter this directly in AppFolio.'}
            </p>
          </div>
        ) : (
          <p className="text-xs text-amber-400 font-medium">{formPrompt || 'Review & approve for AppFolio upload:'}</p>
        )}

        {previousApproval && (
          <p className="text-[10px] text-slate-500">
            Previously approved by {previousApproval.by} on {new Date(previousApproval.at).toLocaleString()}
          </p>
        )}

        <div className="bg-surface-raised/80 border border-amber-500/20 rounded-lg p-3 space-y-2">
          {/* ── Header fields ── */}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className={labelCls}>Vendor {reqStar}</label>
              {/* @ts-ignore */}
              <DarkSelect
                value={draft.vendor_name}
                onChange={(val: string) => onUpdateDraft?.('vendor_name', val)}
                options={vendorOptions}
                compact searchable
                className={`w-full ${isMissing('vendor') ? '[&_div]:!border-red-500/50' : ''}`}
                placeholder="Search vendor..."
              />
            </div>
            <div>
              <label className={labelCls}>Amount {reqStar}</label>
              <input
                type="number" step="0.01"
                className={isMissing('amount') ? inputMissingCls : inputCls}
                value={draft.amount}
                onChange={(e) => onUpdateDraft?.('amount', e.target.value)}
                disabled={isLocked}
              />
            </div>
            {showInvoiceNumber && (
              <div>
                <label className={labelCls}>Invoice # (Reference)</label>
                <input
                  type="text"
                  className={inputCls}
                  value={draft.invoice_number || ''}
                  onChange={(e) => onUpdateDraft?.('invoice_number', e.target.value)}
                  disabled={isLocked}
                />
              </div>
            )}
            <div>
              <label className={labelCls}>Invoice Date {reqStar}</label>
              <input
                type="date"
                className={isMissing('invoice_date') ? inputMissingCls : inputCls}
                value={draft.invoice_date}
                onChange={(e) => onUpdateDraft?.('invoice_date', e.target.value)}
                disabled={isLocked}
              />
            </div>
            <div>
              <label className={labelCls}>Due Date</label>
              <input
                type="date"
                className={inputCls}
                value={draft.due_date}
                onChange={(e) => onUpdateDraft?.('due_date', e.target.value)}
                disabled={isLocked}
              />
            </div>
          </div>

          {/* ── Line-item details ── */}
          <div className="border-t border-[var(--glass-border)] my-1" />
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Bill Details (Line Item)</p>

          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className={labelCls}>Property</label>
              {/* @ts-ignore */}
              <DarkSelect
                value={draft.af_property_input}
                onChange={(val: string) => handlePropertyChange(val)}
                options={propOptions}
                compact searchable
                className="w-full"
                placeholder="Select property..."
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Unit</label>
              {/* @ts-ignore */}
              <DarkSelect
                value={draft.af_unit_input}
                onChange={(val: string) => onUpdateDraft?.('af_unit_input', val)}
                options={unitOptions}
                compact searchable
                className="w-full"
                placeholder={draft.af_property_input ? "Select unit..." : "Select property first"}
                disabled={isLocked || !draft.af_property_input}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>GL Account {reqStar}</label>
              {/* @ts-ignore */}
              <DarkSelect
                value={draft.af_gl_account_input}
                onChange={(val: string) => onUpdateDraft?.('af_gl_account_input', val)}
                options={glOptions}
                compact searchable
                className={`w-full ${isMissing('gl_account') ? '[&_div]:!border-red-500/50' : ''}`}
                placeholder="Search GL account..."
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Description</label>
              <input
                type="text"
                className={inputCls}
                value={draft.description}
                onChange={(e) => onUpdateDraft?.('description', e.target.value)}
                placeholder="Line item description"
                disabled={isLocked}
              />
            </div>
          </div>
        </div>

        {/* ── Upload result banner ── */}
        {uploadResult && (
          <div className={`text-xs px-3 py-2 rounded ${uploadResult.success ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/15 text-red-400 border border-red-500/20'}`}>
            {uploadResult.message}
            {!uploadResult.success && onRetry && <button onClick={onRetry} className="ml-2 underline font-medium">Retry</button>}
          </div>
        )}

        {/* ── Missing-fields warning ── */}
        {!canSubmit && !isManualEntry && missingFields.length > 0 && !isLocked && (
          <p className="text-[11px] text-red-400">
            Required: {missingFields.map(f =>
              f === 'gl_account' ? 'GL Account' : f === 'invoice_date' ? 'Invoice Date' : f.charAt(0).toUpperCase() + f.slice(1)
            ).join(', ')}
          </p>
        )}

        {/* ── Submit / Manual-entry button ── */}
        {isManualEntry ? (
          <a
            href="https://appreciateinc.appfolio.com/accounting/payable_invoices/new"
            target="_blank" rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-orange-600 hover:bg-orange-500 text-white transition-colors"
          >
            <ExternalLink className="w-4 h-4" />Open AppFolio to Enter Manually
          </a>
        ) : (
          <button
            onClick={onSubmit}
            disabled={isLocked || !canSubmit}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              isUploading ? 'bg-cyan-900/40 text-cyan-400 cursor-wait border border-cyan-500/20'
              : isQueued ? 'bg-slate-700 text-slate-400 cursor-wait'
              : !canSubmit ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {isUploading ? <><Loader2 className="w-4 h-4 animate-spin" />Uploading to AppFolio...</>
             : isQueued ? <><Loader2 className="w-4 h-4 animate-spin" />Queued...</>
             : <><Upload className="w-4 h-4" />Approve & Upload to AppFolio</>}
          </button>
        )}
      </div>
    );
  }
}
