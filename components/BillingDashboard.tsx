'use client';

import React, { useEffect, useState, useCallback, useRef } from "react";
import { ExternalLink, FileText, CheckCircle2, AlertCircle, EyeOff, Eye, X, Upload, Loader2, RefreshCw, Save } from "lucide-react";
import { LogoLoader } from "./Logo";
import DarkSelect from "./DarkSelect";

interface Bill {
  id: number;
  vendor_name: string;
  amount: number;
  invoice_date: string;
  invoice_number: string | null;
  front_conversation_id: string | null;
  front_email_subject: string | null;
  front_email_from: string | null;
  attachments_json: any;
  created_at: string;
  due_date: string | null;
  description: string | null;
  document_type: "invoice" | "estimate" | "receipt" | "payment" | "credit_memo" | "other";
  status: string | null;
  payment_status: "paid" | "unpaid" | "unknown";
  is_hidden: boolean;
  hidden_note: string | null;
  hidden_at: string | null;
  af_bill_id: string | null;
  af_status: string | null;
  af_property_name: string | null;
  af_gl_account_name: string | null;
  af_paid_date: string | null;
  af_memo: string | null;
  af_match_status: "matched" | "unmatched";
  front_message_id: string | null;
  // Editable AF input fields
  af_property_input: string | null;
  af_gl_account_input: string | null;
  af_unit_input: string | null;
  af_approved_by: string | null;
  af_approved_at: string | null;
}

interface GLAccount {
  id: string;   // e.g. "5050.9 - Property Management Expense:Pest Control"
  name: string; // e.g. "Property Management Expense:Pest Control"
}

/** Per-bill editable draft state */
interface BillDraft {
  vendor_name: string;
  amount: string;
  invoice_date: string;
  due_date: string;
  invoice_number: string;
  description: string;
  af_property_input: string;
  af_gl_account_input: string;
  af_unit_input: string;
}

/** Upload queue item */
interface QueueItem {
  billId: number;
  vendorName: string;
  amount: number;
  status: 'queued' | 'uploading' | 'success' | 'failed';
  message?: string;
  queuedAt: Date;
  completedAt?: Date;
}

type SortOption = "unmatched_first" | "matched_first" | "date_newest" | "date_oldest";
type FilterOption = "all" | "unmatched" | "matched" | "hidden";

const POLL_INTERVAL = 10_000; // 10 seconds

function makeDraft(bill: Bill): BillDraft {
  // Calculate default due date (invoice_date + 15 days) if not set
  let defaultDue = bill.due_date || '';
  if (!defaultDue && bill.invoice_date) {
    const d = new Date(bill.invoice_date);
    d.setDate(d.getDate() + 15);
    defaultDue = d.toISOString().split('T')[0];
  }

  return {
    vendor_name: bill.vendor_name || '',
    amount: String(bill.amount || ''),
    invoice_date: bill.invoice_date || '',
    due_date: defaultDue,
    invoice_number: bill.invoice_number || '',
    description: bill.description || '',
    af_property_input: bill.af_property_input || '',
    af_gl_account_input: bill.af_gl_account_input || '',
    af_unit_input: bill.af_unit_input || '',
  };
}

export default function BillingDashboard() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [hiddenBills, setHiddenBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortOption>("unmatched_first");
  const [filter, setFilter] = useState<FilterOption>("all");
  const [hideModal, setHideModal] = useState<{ bill: Bill; note: string } | null>(null);
  const [hidingId, setHidingId] = useState<number | null>(null);

  // AF options for dropdowns
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([]);
  const [properties, setProperties] = useState<string[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);

  // Per-bill editable drafts: bill.id -> BillDraft
  const [drafts, setDrafts] = useState<Record<number, BillDraft>>({});

  // Vendor → property/GL/description pre-fill from historical af_bill_detail
  const [prefillMap, setPrefillMap] = useState<Record<string, { vendor_name: string; property: string; gl_account: string; description: string }>>({});
  const prefillFetchedRef = useRef(false);

  // Upload queue state
  const [uploadQueue, setUploadQueue] = useState<QueueItem[]>([]);
  const processingRef = useRef(false);

  // Derived values from queue (backward compat)
  const uploadingId = uploadQueue.find(q => q.status === 'uploading')?.billId ?? null;
  const uploadResult: Record<number, { success: boolean; message: string }> = {};
  for (const q of uploadQueue) {
    if (q.status === 'success') uploadResult[q.billId] = { success: true, message: q.message || 'Uploaded to AppFolio!' };
    if (q.status === 'failed') uploadResult[q.billId] = { success: false, message: q.message || 'Upload failed' };
  }

  // Last refresh timestamp
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Data fetching ──────────────────────────────────────────────────────────

  const fetchBills = useCallback(async (includeHidden = true, silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const url = includeHidden
        ? "/api/billing/get-bills?include_hidden=true"
        : "/api/billing/get-bills";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch bills");
      const data: Bill[] = await response.json();

      if (includeHidden) {
        setBills(data.filter((b) => !b.is_hidden) || []);
        setHiddenBills(data.filter((b) => b.is_hidden) || []);
      } else {
        setBills(data || []);
      }
      setLastRefresh(new Date());
    } catch (error) {
      console.error("Error fetching bills:", error);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const fetchAfOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/af-options");
      if (!res.ok) return;
      const data = await res.json();
      setGlAccounts(data.gl_accounts || []);
      setProperties(data.properties || []);
      setVendors(data.vendors || []);
    } catch (error) {
      console.error("Error fetching AF options:", error);
    }
  }, []);

  /** Fetch vendor→property/GL pre-fill suggestions from historical af_bill_detail */
  const fetchPrefill = useCallback(async (vendorNames: string[]) => {
    if (vendorNames.length === 0) return;
    try {
      const res = await fetch("/api/admin/brex/prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchants: vendorNames }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setPrefillMap(prev => ({ ...prev, ...data }));

      // Backfill any existing drafts that are missing property/GL/description
      setDrafts(prev => {
        const next = { ...prev };
        for (const bill of bills) {
          const draft = next[bill.id];
          if (!draft) continue;
          const prefill = data[bill.vendor_name];
          if (!prefill) continue;
          if (!draft.af_property_input && prefill.property) {
            draft.af_property_input = prefill.property;
          }
          if (!draft.af_gl_account_input && prefill.gl_account) {
            draft.af_gl_account_input = prefill.gl_account;
          }
          if (!draft.description && prefill.description) {
            draft.description = prefill.description;
          }
        }
        return next;
      });
    } catch (error) {
      console.error("Error fetching prefill:", error);
    }
  }, [bills]);

  useEffect(() => {
    fetchBills(true);
    fetchAfOptions();
    pollRef.current = setInterval(() => fetchBills(true, true), POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchBills, fetchAfOptions]);

  // Initialize drafts when bills change, and update empty fields from server suggestions + prefill
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const bill of bills) {
        if (bill.af_match_status === 'unmatched') {
          if (!next[bill.id]) {
            // New bill — create full draft with prefill
            const draft = makeDraft(bill);
            const prefill = prefillMap[bill.vendor_name];
            if (prefill) {
              if (!draft.af_property_input && prefill.property) draft.af_property_input = prefill.property;
              if (!draft.af_gl_account_input && prefill.gl_account) draft.af_gl_account_input = prefill.gl_account;
              if (!draft.description && prefill.description) draft.description = prefill.description;
            }
            next[bill.id] = draft;
          } else {
            // Existing draft — backfill empty fields if server now has suggestions
            const d = next[bill.id];
            const fresh = makeDraft(bill);
            if (!d.vendor_name && fresh.vendor_name) d.vendor_name = fresh.vendor_name;
            if (!d.af_gl_account_input && fresh.af_gl_account_input) d.af_gl_account_input = fresh.af_gl_account_input;
            if (!d.af_property_input && fresh.af_property_input) d.af_property_input = fresh.af_property_input;
            if (!d.af_unit_input && fresh.af_unit_input) d.af_unit_input = fresh.af_unit_input;
            // Also backfill from prefill map if still empty
            const prefill = prefillMap[bill.vendor_name];
            if (prefill) {
              if (!d.af_property_input && prefill.property) d.af_property_input = prefill.property;
              if (!d.af_gl_account_input && prefill.gl_account) d.af_gl_account_input = prefill.gl_account;
              if (!d.description && prefill.description) d.description = prefill.description;
            }
          }
        }
      }
      return next;
    });

    // Trigger prefill fetch once when we have unmatched bills
    if (!prefillFetchedRef.current && bills.length > 0) {
      const unmatchedVendors = Array.from(new Set(
        bills
          .filter(b => b.af_match_status === 'unmatched' && b.vendor_name)
          .map(b => b.vendor_name)
      ));
      if (unmatchedVendors.length > 0) {
        prefillFetchedRef.current = true;
        fetchPrefill(unmatchedVendors);
      }
    }
  }, [bills, prefillMap, fetchPrefill]);

  // ─── Queue processor ──────────────────────────────────────────────────────

  const processNextInQueue = useCallback(async () => {
    if (processingRef.current) return;

    const nextItem = uploadQueue.find(q => q.status === 'queued');
    if (!nextItem) return;

    processingRef.current = true;

    // Mark as uploading
    setUploadQueue(prev =>
      prev.map(q => q.billId === nextItem.billId ? { ...q, status: 'uploading' as const } : q)
    );

    const draft = drafts[nextItem.billId];
    if (!draft) {
      setUploadQueue(prev =>
        prev.map(q => q.billId === nextItem.billId
          ? { ...q, status: 'failed' as const, message: 'No draft data found', completedAt: new Date() }
          : q)
      );
      processingRef.current = false;
      return;
    }

    try {
      const res = await fetch("/api/billing/approve-bill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bill_id: nextItem.billId,
          approved_by: 'dashboard_user',
          vendor_name: draft.vendor_name.trim(),
          amount: Number(draft.amount),
          invoice_date: draft.invoice_date,
          due_date: draft.due_date || null,
          invoice_number: draft.invoice_number || null,
          description: draft.description || null,
          af_property_input: draft.af_property_input || null,
          af_gl_account_input: draft.af_gl_account_input || null,
          af_unit_input: draft.af_unit_input || null,
        }),
      });

      const result = await res.json();

      if (!res.ok || result.error) {
        // HTTP error or explicit error from the API
        setUploadQueue(prev =>
          prev.map(q => q.billId === nextItem.billId
            ? { ...q, status: 'failed' as const, message: result.error || 'Upload failed. Check bot status.', completedAt: new Date() }
            : q)
        );
      } else if (result.bot_success === false) {
        // Approval saved but bot upload didn't fully succeed
        setUploadQueue(prev =>
          prev.map(q => q.billId === nextItem.billId
            ? { ...q, status: 'success' as const, message: result.bot_error ? `Approved. Bot: ${result.bot_error}` : 'Approved & sent to AppFolio', completedAt: new Date() }
            : q)
        );
      } else {
        // Full success
        setUploadQueue(prev =>
          prev.map(q => q.billId === nextItem.billId
            ? { ...q, status: 'success' as const, message: 'Uploaded to AppFolio!', completedAt: new Date() }
            : q)
        );
      }

      // Refresh bills to show updated match status
      await fetchBills(true, true);
    } catch (error) {
      setUploadQueue(prev =>
        prev.map(q => q.billId === nextItem.billId
          ? { ...q, status: 'failed' as const, message: error instanceof Error ? error.message : 'Network error', completedAt: new Date() }
          : q)
      );
    }

    processingRef.current = false;
  }, [uploadQueue, drafts, fetchBills]);

  // Auto-process queue when items are added or one finishes
  useEffect(() => {
    const hasQueued = uploadQueue.some(q => q.status === 'queued');
    const isProcessing = uploadQueue.some(q => q.status === 'uploading');
    if (hasQueued && !isProcessing && !processingRef.current) {
      processNextInQueue();
    }
  }, [uploadQueue, processNextInQueue]);

  // ─── Draft helpers ──────────────────────────────────────────────────────────

  const updateDraft = (billId: number, field: keyof BillDraft, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [billId]: { ...prev[billId], [field]: value },
    }));
  };

  // ─── Validation ──────────────────────────────────────────────────────────────

  /** Returns list of missing required field names for a bill draft */
  const getMissingFields = (draft: BillDraft | undefined): string[] => {
    if (!draft) return ['all fields'];
    const missing: string[] = [];
    if (!draft.vendor_name.trim()) missing.push('vendor');
    if (!draft.amount || isNaN(Number(draft.amount))) missing.push('amount');
    if (!draft.invoice_date) missing.push('invoice_date');
    if (!draft.af_gl_account_input) missing.push('gl_account');
    return missing;
  };

  /** Check if a specific field is missing for visual highlighting */
  const isFieldMissing = (billId: number, field: string): boolean => {
    return getMissingFields(drafts[billId]).includes(field);
  };

  // ─── Actions ────────────────────────────────────────────────────────────────

  const enqueueUpload = (bill: Bill) => {
    const draft = drafts[bill.id];
    if (!draft) return;

    const missing = getMissingFields(draft);
    if (missing.length > 0) return;

    // Skip if already in queue (queued or uploading)
    if (uploadQueue.some(q => q.billId === bill.id && (q.status === 'queued' || q.status === 'uploading'))) return;

    // Remove any previous result for this bill (retry scenario)
    setUploadQueue(prev => [
      ...prev.filter(q => q.billId !== bill.id),
      {
        billId: bill.id,
        vendorName: draft.vendor_name.trim(),
        amount: Number(draft.amount),
        status: 'queued',
        queuedAt: new Date(),
      },
    ]);
  };

  const retryUpload = (billId: number) => {
    const bill = bills.find(b => b.id === billId);
    if (!bill) return;
    // Remove failed entry, then re-enqueue
    setUploadQueue(prev => prev.filter(q => q.billId !== billId));
    setTimeout(() => enqueueUpload(bill), 0);
  };

  const dismissQueueItem = (billId: number) => {
    setUploadQueue(prev => prev.filter(q => q.billId !== billId));
  };

  const clearFinished = () => {
    setUploadQueue(prev => prev.filter(q => q.status === 'queued' || q.status === 'uploading'));
  };

  const hideBill = async (billId: number, note: string) => {
    setHidingId(billId);
    try {
      const response = await fetch("/api/billing/hide-bill", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: billId, is_hidden: true, note }),
      });
      if (!response.ok) throw new Error("Failed to hide bill");

      const bill = bills.find((b) => b.id === billId);
      if (bill) {
        setBills((prev) => prev.filter((b) => b.id !== billId));
        setHiddenBills((prev) => [...prev, { ...bill, is_hidden: true, hidden_note: note, hidden_at: new Date().toISOString() }]);
      }
      setHideModal(null);
    } catch (error) {
      console.error("Error hiding bill:", error);
      alert("Failed to hide bill");
    }
    setHidingId(null);
  };

  const unhideBill = async (billId: number) => {
    setHidingId(billId);
    try {
      const response = await fetch("/api/billing/hide-bill", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: billId, is_hidden: false }),
      });
      if (!response.ok) throw new Error("Failed to unhide bill");

      const bill = hiddenBills.find((b) => b.id === billId);
      if (bill) {
        setHiddenBills((prev) => prev.filter((b) => b.id !== billId));
        setBills((prev) => [...prev, { ...bill, is_hidden: false, hidden_note: null, hidden_at: null }]);
      }
    } catch (error) {
      console.error("Error unhiding bill:", error);
      alert("Failed to unhide bill");
    }
    setHidingId(null);
  };

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const getAttachmentUrl = (attachmentsJson: any): string | null => {
    if (!attachmentsJson) return null;
    try {
      const arr = typeof attachmentsJson === "string" ? JSON.parse(attachmentsJson) : attachmentsJson;
      return arr?.[0]?.url || null;
    } catch {
      return null;
    }
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

  // ─── Filtering & Sorting ───────────────────────────────────────────────────

  const displayBills = filter === "hidden" ? hiddenBills : bills;

  const filteredBills = displayBills.filter((bill) => {
    if (filter === "hidden") return true;
    if (filter === "unmatched") return bill.af_match_status === "unmatched";
    if (filter === "matched") return bill.af_match_status === "matched";
    return true;
  });

  const sortedBills = [...filteredBills].sort((a, b) => {
    if (sort === "unmatched_first") {
      if (a.af_match_status !== b.af_match_status) return a.af_match_status === "unmatched" ? -1 : 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (sort === "matched_first") {
      if (a.af_match_status !== b.af_match_status) return a.af_match_status === "matched" ? -1 : 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (sort === "date_newest") return new Date(b.invoice_date).getTime() - new Date(a.invoice_date).getTime();
    return new Date(a.invoice_date).getTime() - new Date(b.invoice_date).getTime();
  });

  const unmatchedCount = bills.filter((b) => b.af_match_status === "unmatched").length;
  const matchedCount = bills.filter((b) => b.af_match_status === "matched").length;
  const hiddenCount = hiddenBills.length;

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const inputCls = "w-full bg-surface-base border border-[var(--glass-border)] rounded px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-accent/50";
  const inputMissingCls = "w-full bg-surface-base border border-red-500/50 rounded px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-red-400";
  const labelCls = "text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-0.5 block";
  const reqStar = <span className="text-red-400 ml-0.5">*</span>;

  const renderEditablePanel = (bill: Bill) => {
    const draft = drafts[bill.id];
    if (!draft) return null;
    const result = uploadResult[bill.id];
    const queueItem = uploadQueue.find(q => q.billId === bill.id);
    const isUploading = queueItem?.status === 'uploading';
    const isQueued = queueItem?.status === 'queued';
    const isLocked = isUploading || isQueued;
    const missing = getMissingFields(draft);
    const isManualEntry = bill.status === 'manual_entry' || bill.document_type === 'credit_memo' || bill.amount < 0;
    const canSubmit = missing.length === 0 && !isManualEntry && !isLocked;

    // Build vendor options for the select
    const vendorOptions = vendors.map((v) => ({
      value: v,
      label: v,
    }));

    // Build GL account options for the select
    const glOptions = glAccounts.map((gl) => ({
      value: gl.id,
      label: gl.id,
    }));

    // Build property options for the select
    const propOptions = properties.map((p) => ({
      value: p,
      label: p,
    }));

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
          <p className="text-xs text-amber-400 font-medium">
            Review & approve for AppFolio upload:
          </p>
        )}

        {/* Approval info if already approved but not matched */}
        {bill.af_approved_by && bill.af_approved_at && (
          <p className="text-[10px] text-slate-500">
            Approved by {bill.af_approved_by} on {new Date(bill.af_approved_at).toLocaleString()}
          </p>
        )}

        <div className="bg-surface-raised/80 border border-amber-500/20 rounded-lg p-3 space-y-2">
          {/* Top Section: Vendor, Amount, Dates */}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className={labelCls}>Vendor {reqStar}</label>
              {/* @ts-ignore — untyped JS component */}
              <DarkSelect
                value={draft.vendor_name}
                onChange={(val: string) => updateDraft(bill.id, 'vendor_name', val)}
                options={vendorOptions}
                compact
                searchable
                className={`w-full ${isFieldMissing(bill.id, 'vendor') ? '[&_div]:!border-red-500/50' : ''}`}
                placeholder="Search vendor..."
              />
            </div>
            <div>
              <label className={labelCls}>Amount {reqStar}</label>
              <input
                type="number"
                step="0.01"
                className={isFieldMissing(bill.id, 'amount') ? inputMissingCls : inputCls}
                value={draft.amount}
                onChange={(e) => updateDraft(bill.id, 'amount', e.target.value)}
                disabled={isLocked}
              />
            </div>
            <div>
              <label className={labelCls}>Invoice # (Reference)</label>
              <input
                type="text"
                className={inputCls}
                value={draft.invoice_number}
                onChange={(e) => updateDraft(bill.id, 'invoice_number', e.target.value)}
                disabled={isLocked}
              />
            </div>
            <div>
              <label className={labelCls}>Invoice Date {reqStar}</label>
              <input
                type="date"
                className={isFieldMissing(bill.id, 'invoice_date') ? inputMissingCls : inputCls}
                value={draft.invoice_date}
                onChange={(e) => updateDraft(bill.id, 'invoice_date', e.target.value)}
                disabled={isLocked}
              />
            </div>
            <div>
              <label className={labelCls}>Due Date</label>
              <input
                type="date"
                className={inputCls}
                value={draft.due_date}
                onChange={(e) => updateDraft(bill.id, 'due_date', e.target.value)}
                disabled={isLocked}
              />
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[var(--glass-border)] my-1" />

          {/* Bill Details Section */}
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Bill Details (Line Item)</p>

          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className={labelCls}>Property</label>
              {/* @ts-ignore — untyped JS component */}
              <DarkSelect
                value={draft.af_property_input}
                onChange={(val: string) => updateDraft(bill.id, 'af_property_input', val)}
                options={propOptions}
                compact
                searchable
                className="w-full"
                placeholder="Select property..."
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Unit</label>
              <input
                type="text"
                className={inputCls}
                value={draft.af_unit_input}
                onChange={(e) => updateDraft(bill.id, 'af_unit_input', e.target.value)}
                placeholder="Unit #"
                disabled={isLocked}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>GL Account {reqStar}</label>
              {/* @ts-ignore — untyped JS component */}
              <DarkSelect
                value={draft.af_gl_account_input}
                onChange={(val: string) => updateDraft(bill.id, 'af_gl_account_input', val)}
                options={glOptions}
                compact
                searchable
                className={`w-full ${isFieldMissing(bill.id, 'gl_account') ? '[&_div]:!border-red-500/50' : ''}`}
                placeholder="Search GL account..."
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Description</label>
              <input
                type="text"
                className={inputCls}
                value={draft.description}
                onChange={(e) => updateDraft(bill.id, 'description', e.target.value)}
                placeholder="Line item description"
                disabled={isLocked}
              />
            </div>
          </div>
        </div>

        {/* Upload result feedback */}
        {result && (
          <div className={`text-xs px-3 py-2 rounded ${
            result.success
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
              : 'bg-red-500/15 text-red-400 border border-red-500/20'
          }`}>
            {result.message}
          </div>
        )}

        {/* Missing fields warning */}
        {!canSubmit && !isManualEntry && missing.length > 0 && (
          <p className="text-[11px] text-red-400">
            Required: {missing.map(f => f === 'gl_account' ? 'GL Account' : f === 'invoice_date' ? 'Invoice Date' : f.charAt(0).toUpperCase() + f.slice(1)).join(', ')}
          </p>
        )}

        {/* Approve & Upload Button */}
        {isManualEntry ? (
          <a
            href="https://appreciate.appfolio.com/accounting/bills/new"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-orange-600 hover:bg-orange-500 text-white transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Open AppFolio to Enter Manually
          </a>
        ) : (
          <button
            onClick={() => enqueueUpload(bill)}
            disabled={isLocked || !canSubmit}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              isUploading
                ? 'bg-cyan-900/40 text-cyan-400 cursor-wait border border-cyan-500/20'
                : isQueued
                ? 'bg-slate-700 text-slate-400 cursor-wait'
                : !canSubmit
                ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading to AppFolio...
              </>
            ) : isQueued ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Queued...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Approve & Upload to AppFolio
              </>
            )}
          </button>
        )}
      </div>
    );
  };

  // ─── Loading state ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LogoLoader text="Loading bills..." />
      </div>
    );
  }

  // ─── Main render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-full mx-auto">
        {/* Header Card */}
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-100">Billing / AP</h1>
              <p className="text-sm text-slate-400">
                {bills.length} bills · <span className="text-amber-400">{unmatchedCount} unmatched</span> · <span className="text-emerald-400">{matchedCount} matched</span>
                {hiddenCount > 0 && <> · <span className="text-slate-500">{hiddenCount} hidden</span></>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Last refresh indicator + manual refresh */}
              <button
                onClick={() => fetchBills(true)}
                disabled={refreshing}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                title="Refresh now"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                {lastRefresh.toLocaleTimeString()}
              </button>
              {/* @ts-ignore — untyped JS component */}
              <DarkSelect
                value={sort}
                onChange={(val: string) => setSort(val as SortOption)}
                compact
                searchable={false}
                className="w-40"
                options={[
                  { value: 'unmatched_first', label: 'Unmatched first' },
                  { value: 'matched_first', label: 'Matched first' },
                  { value: 'date_newest', label: 'Date (newest)' },
                  { value: 'date_oldest', label: 'Date (oldest)' },
                ]}
              />
            </div>
          </div>

          {/* Filter Chips */}
          <div className="flex gap-1.5 mt-3 pt-3 border-t border-[var(--glass-border)]">
            {(["all", "unmatched", "matched", "hidden"] as FilterOption[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-sm rounded font-medium transition-colors ${
                  filter === f
                    ? f === "unmatched"
                      ? "bg-amber-500/15 text-amber-400"
                      : f === "matched"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : f === "hidden"
                      ? "bg-slate-500/20 text-slate-300"
                      : "bg-accent text-surface-base"
                    : "bg-white/5 text-slate-400 hover:bg-white/10"
                }`}
              >
                {f === "all"
                  ? `All (${bills.length})`
                  : f === "unmatched"
                  ? `Unmatched (${unmatchedCount})`
                  : f === "matched"
                  ? `Matched (${matchedCount})`
                  : `Hidden (${hiddenCount})`}
              </button>
            ))}
          </div>
        </div>

        {/* Upload Activity Tracker */}
        {uploadQueue.length > 0 && (
          <div className="glass-card p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <Upload className="w-4 h-4 text-accent" />
                Upload Activity
                {uploadQueue.some(q => q.status === 'uploading' || q.status === 'queued') && (
                  <span className="text-xs font-normal text-slate-500">
                    ({uploadQueue.filter(q => q.status === 'queued').length} queued
                    {uploadQueue.some(q => q.status === 'uploading') ? ', 1 uploading' : ''})
                  </span>
                )}
              </h2>
              {uploadQueue.every(q => q.status === 'success' || q.status === 'failed') && (
                <button
                  onClick={clearFinished}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              {/* Uploading (currently processing) */}
              {uploadQueue.filter(q => q.status === 'uploading').map(q => (
                <div key={q.billId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                    <span className="text-xs text-slate-200 font-medium">{q.vendorName}</span>
                    <span className="text-xs text-slate-500">${q.amount.toFixed(2)}</span>
                  </div>
                  <span className="text-[10px] text-cyan-400 font-medium uppercase">Uploading</span>
                </div>
              ))}

              {/* Queued (waiting) */}
              {uploadQueue.filter(q => q.status === 'queued').map((q, idx) => (
                <div key={q.billId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] border border-[var(--glass-border)]">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 flex items-center justify-center rounded-full bg-slate-700 text-[10px] text-slate-400 font-bold">{idx + 1}</span>
                    <span className="text-xs text-slate-300">{q.vendorName}</span>
                    <span className="text-xs text-slate-500">${q.amount.toFixed(2)}</span>
                  </div>
                  <button
                    onClick={() => dismissQueueItem(q.billId)}
                    className="text-slate-600 hover:text-slate-400 transition-colors"
                    title="Cancel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              {/* Successes */}
              {uploadQueue.filter(q => q.status === 'success').map(q => (
                <div key={q.billId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs text-slate-200">{q.vendorName}</span>
                    <span className="text-xs text-slate-500">${q.amount.toFixed(2)}</span>
                    <span className="text-[10px] text-emerald-400">Done</span>
                  </div>
                  <button
                    onClick={() => dismissQueueItem(q.billId)}
                    className="text-slate-600 hover:text-slate-400 transition-colors"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              {/* Failures */}
              {uploadQueue.filter(q => q.status === 'failed').map(q => (
                <div key={q.billId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                    <span className="text-xs text-slate-200">{q.vendorName}</span>
                    <span className="text-xs text-red-400/80 truncate">{q.message}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => retryUpload(q.billId)}
                      className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Retry
                    </button>
                    <button
                      onClick={() => dismissQueueItem(q.billId)}
                      className="text-slate-600 hover:text-slate-400 transition-colors"
                      title="Dismiss"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bill Cards */}
        {sortedBills.length === 0 ? (
          <div className="glass-card p-8 text-center text-slate-400">
            {filter === "hidden" ? "No hidden bills." : "No bills found for the current filter."}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedBills.map((bill) => {
              const pdfUrl = getAttachmentUrl(bill.attachments_json);
              const isMatched = bill.af_match_status === "matched";
              const isHiddenView = filter === "hidden";

              return (
                <div
                  key={bill.id}
                  className={`glass-card overflow-hidden ${
                    isHiddenView ? "opacity-75" : ""
                  }`}
                >
                  <div className="grid grid-cols-2 divide-x divide-[var(--glass-border)]">
                    {/* LEFT PANEL: Front / Parsed Invoice */}
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Front / Parsed</span>
                      </div>
                      <h2 className="text-base font-semibold text-slate-100 mb-0.5">{bill.vendor_name}</h2>
                      <p className="text-xs text-slate-400 mb-3">
                        {bill.front_email_from} · {new Date(bill.created_at).toLocaleDateString()}
                      </p>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
                        <div>
                          <span className="text-xs text-slate-500">Amount</span>
                          <p className={`font-bold text-base ${Number(bill.amount) < 0 ? 'text-orange-400' : 'text-slate-100'}`}>
                            {Number(bill.amount) < 0 ? '-' : ''}${Math.abs(Number(bill.amount)).toFixed(2)}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs text-slate-500">Invoice Date</span>
                          <p className="font-mono text-sm text-slate-300">{bill.invoice_date}</p>
                        </div>
                        {bill.invoice_number && (
                          <div>
                            <span className="text-xs text-slate-500">Invoice #</span>
                            <p className="font-mono text-sm text-slate-300">{bill.invoice_number}</p>
                          </div>
                        )}
                        {bill.due_date && (
                          <div>
                            <span className="text-xs text-slate-500">Due Date</span>
                            <p className="font-mono text-sm text-slate-300">{bill.due_date}</p>
                          </div>
                        )}
                      </div>

                      {bill.front_email_subject && (
                        <p className="text-xs text-slate-400 mb-2 line-clamp-1">
                          <span className="text-slate-500">Subject: </span>{bill.front_email_subject}
                        </p>
                      )}

                      {bill.description && (
                        <p className="text-xs text-slate-400 mb-2 line-clamp-2">
                          <span className="text-slate-500">Description: </span>{bill.description}
                        </p>
                      )}

                      {/* Hidden note */}
                      {isHiddenView && bill.hidden_note && (
                        <p className="text-xs text-orange-400 mb-2 italic">
                          <span className="text-orange-500">Hidden: </span>{bill.hidden_note}
                        </p>
                      )}

                      {/* Badges */}
                      <div className="flex gap-1.5 mb-3 flex-wrap">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${getDocTypeBadge(bill.document_type)}`}>
                          {bill.document_type === 'credit_memo' ? 'credit / refund' : bill.document_type}
                        </span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                          bill.payment_status === "paid" ? "bg-green-500/15 text-green-400" :
                          bill.payment_status === "unpaid" ? "bg-amber-500/15 text-amber-400" :
                          "bg-slate-500/15 text-slate-400"
                        }`}>
                          {bill.payment_status}
                        </span>
                      </div>

                      {/* Action Links */}
                      <div className="flex gap-2 flex-wrap">
                        {pdfUrl && (
                          <a
                            href={pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs px-2 py-1 bg-accent/15 text-accent rounded hover:bg-accent/25"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            PDF
                          </a>
                        )}
                        {bill.front_conversation_id && (
                          <a
                            href={`https://app.frontapp.com/open/${bill.front_message_id || bill.front_conversation_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs px-2 py-1 bg-accent/15 text-accent rounded hover:bg-accent/25"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Front
                          </a>
                        )}
                        {isHiddenView ? (
                          <button
                            onClick={() => unhideBill(bill.id)}
                            disabled={hidingId === bill.id}
                            className="flex items-center gap-1 text-xs px-2 py-1 bg-white/5 text-slate-400 rounded hover:bg-white/10 disabled:opacity-50"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            {hidingId === bill.id ? "..." : "Unhide"}
                          </button>
                        ) : (
                          <button
                            onClick={() => setHideModal({ bill, note: "" })}
                            className="flex items-center gap-1 text-xs px-2 py-1 bg-white/5 text-slate-400 rounded hover:bg-white/10"
                          >
                            <EyeOff className="w-3.5 h-3.5" />
                            Hide
                          </button>
                        )}
                      </div>
                    </div>

                    {/* RIGHT PANEL: AppFolio */}
                    <div className={`p-4 ${isMatched ? "bg-emerald-500/5" : "bg-amber-500/5"}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">AppFolio</span>
                        {isMatched ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-emerald-500/20 text-emerald-400">
                            <CheckCircle2 className="w-3 h-3" />
                            Matched
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-amber-500/20 text-amber-400">
                            <AlertCircle className="w-3 h-3" />
                            Unmatched
                          </span>
                        )}
                      </div>

                      {isMatched ? (
                        <div className="space-y-2 text-sm">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                            <div>
                              <span className="text-xs text-slate-500">AF Status</span>
                              <p className={`font-semibold text-sm ${
                                bill.af_status === "Paid" ? "text-emerald-400" : "text-amber-400"
                              }`}>{bill.af_status}</p>
                            </div>
                            {bill.af_bill_id && (
                              <div>
                                <span className="text-xs text-slate-500">AF Bill #</span>
                                <a
                                  href={`https://appreciate.appfolio.com/accounting/bills/${bill.af_bill_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 font-mono text-sm text-accent hover:underline"
                                >
                                  {bill.af_bill_id}
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            )}
                            {bill.af_property_name && (
                              <div>
                                <span className="text-xs text-slate-500">Property</span>
                                <p className="font-medium text-sm text-slate-200">{bill.af_property_name}</p>
                              </div>
                            )}
                            {bill.af_gl_account_name && (
                              <div className="col-span-2">
                                <span className="text-xs text-slate-500">GL Account</span>
                                <p className="font-medium text-sm text-slate-200">{bill.af_gl_account_name}</p>
                              </div>
                            )}
                            {bill.af_paid_date && (
                              <div>
                                <span className="text-xs text-slate-500">Paid Date</span>
                                <p className="font-mono text-sm text-slate-300">{bill.af_paid_date}</p>
                              </div>
                            )}
                            {bill.af_memo && (
                              <div className="col-span-2">
                                <span className="text-xs text-slate-500">Memo</span>
                                <p className="text-sm text-slate-400">{bill.af_memo}</p>
                              </div>
                            )}
                          </div>

                          {/* Approval audit trail */}
                          {bill.af_approved_by && (
                            <div className="mt-3 pt-2 border-t border-emerald-500/10">
                              <p className="text-[11px] text-slate-500">
                                <CheckCircle2 className="w-3 h-3 inline-block mr-1 text-emerald-500/60" />
                                Approved by <span className="text-slate-400 font-medium">{bill.af_approved_by}</span>
                                {bill.af_approved_at && (
                                  <> on <span className="text-slate-400">{new Date(bill.af_approved_at).toLocaleDateString()}{' '}
                                  {new Date(bill.af_approved_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></>
                                )}
                              </p>
                            </div>
                          )}
                        </div>
                      ) : (
                        renderEditablePanel(bill)
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hide Modal */}
      {hideModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-100">Hide Bill</h3>
              <button onClick={() => setHideModal(null)} className="text-slate-400 hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-400 mb-1">
              <span className="font-medium">{hideModal.bill.vendor_name}</span> — ${Number(hideModal.bill.amount).toFixed(2)}
            </p>
            <p className="text-xs text-slate-500 mb-4">{hideModal.bill.front_email_subject}</p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-200 mb-1">
                Why are you hiding this? <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <textarea
                value={hideModal.note}
                onChange={(e) => setHideModal((prev) => prev ? { ...prev, note: e.target.value } : null)}
                placeholder="e.g., This is a rent payment, not a bill"
                className="dark-input w-full"
                rows={2}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setHideModal(null)}
                className="flex-1 px-4 py-2 border border-[var(--glass-border)] text-slate-200 rounded-lg hover:bg-white/5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => hideBill(hideModal.bill.id, hideModal.note)}
                disabled={hidingId === hideModal.bill.id}
                className="flex-1 px-4 py-2 btn-accent rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {hidingId === hideModal.bill.id ? "Hiding..." : "Hide Bill"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
