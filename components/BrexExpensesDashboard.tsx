'use client';

import React, { useEffect, useState, useCallback, useRef } from "react";
import { CheckCircle2, AlertCircle, Archive, ArchiveRestore, X, ExternalLink, Upload, Loader2, RefreshCw, Image as ImageIcon, XCircle } from "lucide-react";
import { LogoLoader } from "./Logo";
import DarkSelect from "./DarkSelect";
import { useAuth } from "../contexts/AuthContext";
import { useRouter } from "next/navigation";

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface BrexExpense {
  id: number;
  brex_id: string;
  amount: number;
  currency: string;
  merchant_name: string;
  merchant_raw_descriptor: string;
  initiated_at: string | null;
  posted_at: string | null;
  transaction_type: string | null;
  memo: string | null;
  receipt_ids: string[] | null;
  receipt_urls: string[] | null;
  match_status: "unmatched" | "matched" | "corporate";
  match_confidence: "high" | "low" | null;
  matched_bill_id: number | null;
  matched_at: string | null;
  matched_by: string | null;
  is_corporate: boolean;
  corporate_note: string | null;
  corporate_at: string | null;
  synced_at: string;
  af_vendor_name: string | null;
  af_property_input: string | null;
  af_gl_account_input: string | null;
  af_unit_input: string | null;
  af_approved_by: string | null;
  af_approved_at: string | null;
  appfolio_synced: boolean;
  appfolio_checked_at: string | null;
  appfolio_bill_id: number | null;
  bill_vendor_name: string | null;
  bill_amount: number | null;
  bill_invoice_date: string | null;
  bill_invoice_number: string | null;
  bill_status: string | null;
  bill_payment_status: string | null;
}

interface GLAccount {
  id: string;
  name: string;
}

/** Per-expense editable draft state */
interface ExpenseDraft {
  vendor_name: string;
  amount: string;
  invoice_date: string;
  due_date: string;
  description: string;
  af_property_input: string;
  af_gl_account_input: string;
  af_unit_input: string;
}

/** Upload queue item */
interface QueueItem {
  expenseId: number;
  vendorName: string;
  amount: number;
  status: 'queued' | 'uploading' | 'success' | 'failed';
  message?: string;
  queuedAt: Date;
  completedAt?: Date;
}

const brexExpenseUrl = (brexId: string) => {
  const encoded = btoa(`Expense:${brexId}`);
  return `https://dashboard.brex.com/expenses?expenseId=${encodeURIComponent(encoded)}`;
};

type SortOption = "pending_first" | "date_newest" | "date_oldest" | "amount_high" | "amount_low";
type FilterOption = "all" | "pending" | "entered" | "corporate";

const POLL_INTERVAL = 15_000;

function makeDraft(expense: BrexExpense, prefill?: { vendor_name: string; property: string; gl_account: string } | null): ExpenseDraft {
  const postedDate = expense.posted_at || expense.initiated_at || '';
  let defaultDue = '';
  if (postedDate) {
    const d = new Date(postedDate);
    d.setDate(d.getDate() + 15);
    defaultDue = d.toISOString().split('T')[0];
  }

  const memoPrefix = expense.is_corporate ? 'Corporate - ' : 'Entered - ';
  const description = expense.memo ? `${memoPrefix}${expense.memo}` : '';

  return {
    vendor_name: expense.af_vendor_name || prefill?.vendor_name || '',
    amount: String(expense.amount || ''),
    invoice_date: postedDate,
    due_date: defaultDue,
    description,
    af_property_input: expense.af_property_input || prefill?.property || '',
    af_gl_account_input: expense.af_gl_account_input || prefill?.gl_account || '',
    af_unit_input: expense.af_unit_input || '',
  };
}

export default function BrexExpensesDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const router = useRouter();

  const [expenses, setExpenses] = useState<BrexExpense[]>([]);
  const [corporateExpenses, setCorporateExpenses] = useState<BrexExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortOption>("pending_first");
  const [filter, setFilter] = useState<FilterOption>("all");
  const [archiveModal, setArchiveModal] = useState<{ expense: BrexExpense; note: string } | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);

  // AF options for dropdowns
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([]);
  const [properties, setProperties] = useState<string[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);

  // Per-expense editable drafts: expense.id -> ExpenseDraft
  const [drafts, setDrafts] = useState<Record<number, ExpenseDraft>>({});
  const [prefillMap, setPrefillMap] = useState<Record<string, { vendor_name: string; property: string; gl_account: string } | null>>({});
  const prefillFetchedRef = useRef<Set<string>>(new Set());

  // Upload queue state
  const [uploadQueue, setUploadQueue] = useState<QueueItem[]>([]);
  const processingRef = useRef(false);

  // Derived values from queue
  const uploadResult: Record<number, { success: boolean; message: string }> = {};
  for (const q of uploadQueue) {
    if (q.status === 'success') uploadResult[q.expenseId] = { success: true, message: q.message || 'Uploaded to AppFolio!' };
    if (q.status === 'failed') uploadResult[q.expenseId] = { success: false, message: q.message || 'Upload failed' };
  }

  // Last refresh
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Admin guard
  useEffect(() => {
    if (!authLoading && appUser?.role !== 'admin') {
      router.push('/');
    }
  }, [authLoading, appUser, router]);

  // ─── Data fetching ──────────────────────────────────────────────────────────

  const fetchExpenses = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch("/api/admin/brex/expenses?include_corporate=true");
      if (!response.ok) throw new Error("Failed to fetch expenses");
      const data: BrexExpense[] = await response.json();

      setExpenses(data.filter((e) => !e.is_corporate) || []);
      setCorporateExpenses(data.filter((e) => e.is_corporate) || []);
      setLastRefresh(new Date());
    } catch (error) {
      console.error("Error fetching expenses:", error);
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

  const fetchPrefill = useCallback(async (merchantNames: string[]) => {
    // Only fetch for merchants we haven't fetched yet
    const newMerchants = merchantNames.filter(m => !prefillFetchedRef.current.has(m));
    if (newMerchants.length === 0) return;

    newMerchants.forEach(m => prefillFetchedRef.current.add(m));

    try {
      const res = await fetch("/api/admin/brex/prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchants: newMerchants }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setPrefillMap(prev => ({ ...prev, ...data }));
    } catch (error) {
      console.error("Error fetching prefill:", error);
    }
  }, []);

  useEffect(() => {
    if (appUser?.role === 'admin') {
      fetchExpenses();
      fetchAfOptions();
      pollRef.current = setInterval(() => fetchExpenses(true), POLL_INTERVAL);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [appUser, fetchExpenses, fetchAfOptions]);

  // Fetch prefill data when expenses change
  useEffect(() => {
    const pendingExpenses = expenses.filter(e => !e.appfolio_synced && !e.is_corporate);
    const uniqueMerchants = Array.from(new Set(pendingExpenses.map(e => e.merchant_name)));
    if (uniqueMerchants.length > 0) {
      fetchPrefill(uniqueMerchants);
    }
  }, [expenses, fetchPrefill]);

  // Initialize drafts when expenses or prefill data changes
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const expense of expenses) {
        // Only create/update drafts for pending (non-synced) expenses
        if (!expense.appfolio_synced && !expense.is_corporate) {
          const prefill = prefillMap[expense.merchant_name] || null;
          if (!next[expense.id]) {
            next[expense.id] = makeDraft(expense, prefill);
          } else {
            // Backfill empty fields if server now has prefill suggestions
            const d = next[expense.id];
            if (!d.vendor_name && (expense.af_vendor_name || prefill?.vendor_name)) {
              d.vendor_name = expense.af_vendor_name || prefill?.vendor_name || '';
            }
            if (!d.af_property_input && (expense.af_property_input || prefill?.property)) {
              d.af_property_input = expense.af_property_input || prefill?.property || '';
            }
            if (!d.af_gl_account_input && (expense.af_gl_account_input || prefill?.gl_account)) {
              d.af_gl_account_input = expense.af_gl_account_input || prefill?.gl_account || '';
            }
          }
        }
      }
      return next;
    });
  }, [expenses, prefillMap]);

  // ─── Queue processor ──────────────────────────────────────────────────────

  const processNextInQueue = useCallback(async () => {
    if (processingRef.current) return;

    const nextItem = uploadQueue.find(q => q.status === 'queued');
    if (!nextItem) return;

    processingRef.current = true;

    // Mark as uploading
    setUploadQueue(prev =>
      prev.map(q => q.expenseId === nextItem.expenseId ? { ...q, status: 'uploading' as const } : q)
    );

    const draft = drafts[nextItem.expenseId];
    if (!draft) {
      setUploadQueue(prev =>
        prev.map(q => q.expenseId === nextItem.expenseId
          ? { ...q, status: 'failed' as const, message: 'No draft data found', completedAt: new Date() }
          : q)
      );
      processingRef.current = false;
      return;
    }

    try {
      const res = await fetch("/api/admin/brex/approve-expense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expense_id: nextItem.expenseId,
          approved_by: 'dashboard_user',
          vendor_name: draft.vendor_name.trim(),
          amount: Number(draft.amount),
          invoice_date: draft.invoice_date,
          due_date: draft.due_date || null,
          description: draft.description || null,
          af_property_input: draft.af_property_input || null,
          af_gl_account_input: draft.af_gl_account_input || null,
          af_unit_input: draft.af_unit_input || null,
        }),
      });

      const result = await res.json();

      if (!res.ok || result.error) {
        setUploadQueue(prev =>
          prev.map(q => q.expenseId === nextItem.expenseId
            ? { ...q, status: 'failed' as const, message: result.error || 'Upload failed. Check bot status.', completedAt: new Date() }
            : q)
        );
      } else if (result.bot_success === false) {
        setUploadQueue(prev =>
          prev.map(q => q.expenseId === nextItem.expenseId
            ? { ...q, status: 'success' as const, message: result.bot_error ? `Approved. Bot: ${result.bot_error}` : 'Approved & sent to AppFolio', completedAt: new Date() }
            : q)
        );
      } else {
        setUploadQueue(prev =>
          prev.map(q => q.expenseId === nextItem.expenseId
            ? { ...q, status: 'success' as const, message: 'Uploaded to AppFolio!', completedAt: new Date() }
            : q)
        );
      }

      // Refresh expenses to show updated status
      await fetchExpenses(true);
    } catch (error) {
      setUploadQueue(prev =>
        prev.map(q => q.expenseId === nextItem.expenseId
          ? { ...q, status: 'failed' as const, message: error instanceof Error ? error.message : 'Network error', completedAt: new Date() }
          : q)
      );
    }

    processingRef.current = false;
  }, [uploadQueue, drafts, fetchExpenses]);

  // Auto-process queue
  useEffect(() => {
    const hasQueued = uploadQueue.some(q => q.status === 'queued');
    const isProcessing = uploadQueue.some(q => q.status === 'uploading');
    if (hasQueued && !isProcessing && !processingRef.current) {
      processNextInQueue();
    }
  }, [uploadQueue, processNextInQueue]);

  // ─── Draft helpers ──────────────────────────────────────────────────────────

  const updateDraft = (expenseId: number, field: keyof ExpenseDraft, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [expenseId]: { ...prev[expenseId], [field]: value },
    }));
  };

  // ─── Validation ─────────────────────────────────────────────────────────────

  const getMissingFields = (draft: ExpenseDraft | undefined): string[] => {
    if (!draft) return ['all fields'];
    const missing: string[] = [];
    if (!draft.vendor_name.trim()) missing.push('vendor');
    if (!draft.amount || isNaN(Number(draft.amount))) missing.push('amount');
    if (!draft.invoice_date) missing.push('invoice_date');
    if (!draft.af_gl_account_input) missing.push('gl_account');
    return missing;
  };

  const isFieldMissing = (expenseId: number, field: string): boolean => {
    return getMissingFields(drafts[expenseId]).includes(field);
  };

  // ─── Actions ────────────────────────────────────────────────────────────────

  const enqueueUpload = (expense: BrexExpense) => {
    const draft = drafts[expense.id];
    if (!draft) return;

    const missing = getMissingFields(draft);
    if (missing.length > 0) return;

    // Skip if already in queue
    if (uploadQueue.some(q => q.expenseId === expense.id && (q.status === 'queued' || q.status === 'uploading'))) return;

    setUploadQueue(prev => [
      ...prev.filter(q => q.expenseId !== expense.id),
      {
        expenseId: expense.id,
        vendorName: draft.vendor_name.trim(),
        amount: Number(draft.amount),
        status: 'queued',
        queuedAt: new Date(),
      },
    ]);
  };

  const retryUpload = (expenseId: number) => {
    const expense = expenses.find(e => e.id === expenseId);
    if (!expense) return;
    setUploadQueue(prev => prev.filter(q => q.expenseId !== expenseId));
    setTimeout(() => enqueueUpload(expense), 0);
  };

  const dismissQueueItem = (expenseId: number) => {
    setUploadQueue(prev => prev.filter(q => q.expenseId !== expenseId));
  };

  const clearFinished = () => {
    setUploadQueue(prev => prev.filter(q => q.status === 'queued' || q.status === 'uploading'));
  };

  const archiveCorporate = async (expenseId: number, note: string) => {
    setActionId(expenseId);
    try {
      const response = await fetch("/api/admin/brex/corporate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: expenseId, is_corporate: true, note }),
      });
      if (!response.ok) throw new Error("Failed to archive expense");

      const expense = expenses.find((e) => e.id === expenseId);
      if (expense) {
        setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
        setCorporateExpenses((prev) => [...prev, { ...expense, is_corporate: true, corporate_note: note, corporate_at: new Date().toISOString(), match_status: "corporate" }]);
      }
      setArchiveModal(null);
    } catch (error) {
      console.error("Error archiving expense:", error);
      alert("Failed to archive expense");
    }
    setActionId(null);
  };

  const unarchiveCorporate = async (expenseId: number) => {
    setActionId(expenseId);
    try {
      const response = await fetch("/api/admin/brex/corporate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: expenseId, is_corporate: false }),
      });
      if (!response.ok) throw new Error("Failed to unarchive expense");

      const expense = corporateExpenses.find((e) => e.id === expenseId);
      if (expense) {
        setCorporateExpenses((prev) => prev.filter((e) => e.id !== expenseId));
        setExpenses((prev) => [...prev, { ...expense, is_corporate: false, corporate_note: null, corporate_at: null, match_status: "unmatched" }]);
      }
    } catch (error) {
      console.error("Error unarchiving expense:", error);
      alert("Failed to unarchive expense");
    }
    setActionId(null);
  };

  // ─── Filtering & Sorting ────────────────────────────────────────────────────

  const allNonCorporate = expenses;
  const pendingList = allNonCorporate.filter(e => !e.appfolio_synced);
  const enteredList = allNonCorporate.filter(e => e.appfolio_synced);

  const displayExpenses = filter === "corporate" ? corporateExpenses : allNonCorporate;

  const filteredExpenses = displayExpenses.filter((expense) => {
    if (filter === "corporate") return true;
    if (filter === "pending") return !expense.appfolio_synced;
    if (filter === "entered") return expense.appfolio_synced;
    return true; // "all"
  });

  const sortedExpenses = [...filteredExpenses].sort((a, b) => {
    if (sort === "pending_first") {
      const aIsPending = !a.appfolio_synced ? 0 : 1;
      const bIsPending = !b.appfolio_synced ? 0 : 1;
      if (aIsPending !== bIsPending) return aIsPending - bIsPending;
      return new Date(b.posted_at || b.synced_at).getTime() - new Date(a.posted_at || a.synced_at).getTime();
    }
    if (sort === "date_newest") {
      return new Date(b.posted_at || b.synced_at).getTime() - new Date(a.posted_at || a.synced_at).getTime();
    }
    if (sort === "date_oldest") {
      return new Date(a.posted_at || a.synced_at).getTime() - new Date(b.posted_at || b.synced_at).getTime();
    }
    if (sort === "amount_high") return Number(b.amount) - Number(a.amount);
    if (sort === "amount_low") return Number(a.amount) - Number(b.amount);
    return 0;
  });

  // Counts
  const pendingCount = pendingList.length;
  const enteredCount = enteredList.length;
  const corporateCount = corporateExpenses.length;

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const inputCls = "w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30";
  const inputMissingCls = "w-full bg-white border border-red-400 rounded px-2 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400/30";
  const labelCls = "text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-0.5 block";
  const reqStar = <span className="text-red-500 ml-0.5">*</span>;

  const renderPendingPanel = (expense: BrexExpense) => {
    const draft = drafts[expense.id];
    if (!draft) return null;
    const result = uploadResult[expense.id];
    const queueItem = uploadQueue.find(q => q.expenseId === expense.id);
    const isUploading = queueItem?.status === 'uploading';
    const isQueued = queueItem?.status === 'queued';
    const isLocked = isUploading || isQueued;
    const missing = getMissingFields(draft);
    const canSubmit = missing.length === 0 && !isLocked;

    const vendorOptions = vendors.map((v) => ({ value: v, label: v }));
    const glOptions = glAccounts.map((gl) => ({ value: gl.id, label: gl.id }));
    const propOptions = properties.map((p) => ({ value: p, label: p }));

    return (
      <div className="space-y-3">
        <p className="text-xs text-amber-700 font-medium">
          Review & approve for AppFolio upload:
        </p>

        {expense.af_approved_by && expense.af_approved_at && (
          <p className="text-[10px] text-slate-400">
            Previously approved by {expense.af_approved_by} on {new Date(expense.af_approved_at).toLocaleString()}
          </p>
        )}

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className={labelCls}>Vendor {reqStar}</label>
              {/* @ts-ignore — untyped JS component */}
              <DarkSelect
                value={draft.vendor_name}
                onChange={(val: string) => updateDraft(expense.id, 'vendor_name', val)}
                options={vendorOptions}
                compact
                searchable
                className={`w-full ${isFieldMissing(expense.id, 'vendor') ? '[&_div]:!border-red-400' : ''}`}
                placeholder="Search vendor..."
              />
            </div>
            <div>
              <label className={labelCls}>Amount {reqStar}</label>
              <input
                type="number"
                step="0.01"
                className={isFieldMissing(expense.id, 'amount') ? inputMissingCls : inputCls}
                value={draft.amount}
                onChange={(e) => updateDraft(expense.id, 'amount', e.target.value)}
                disabled={isLocked}
              />
            </div>
            <div>
              <label className={labelCls}>Invoice Date {reqStar}</label>
              <input
                type="date"
                className={isFieldMissing(expense.id, 'invoice_date') ? inputMissingCls : inputCls}
                value={draft.invoice_date}
                onChange={(e) => updateDraft(expense.id, 'invoice_date', e.target.value)}
                disabled={isLocked}
              />
            </div>
            <div>
              <label className={labelCls}>Due Date</label>
              <input
                type="date"
                className={inputCls}
                value={draft.due_date}
                onChange={(e) => updateDraft(expense.id, 'due_date', e.target.value)}
                disabled={isLocked}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>GL Account {reqStar}</label>
            {/* @ts-ignore — untyped JS component */}
            <DarkSelect
              value={draft.af_gl_account_input}
              onChange={(val: string) => updateDraft(expense.id, 'af_gl_account_input', val)}
              options={glOptions}
              compact
              searchable
              className={`w-full ${isFieldMissing(expense.id, 'gl_account') ? '[&_div]:!border-red-400' : ''}`}
              placeholder="Search GL account..."
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Property</label>
              {/* @ts-ignore — untyped JS component */}
              <DarkSelect
                value={draft.af_property_input}
                onChange={(val: string) => updateDraft(expense.id, 'af_property_input', val)}
                options={propOptions}
                compact
                searchable
                className="w-full"
                placeholder="Property..."
              />
            </div>
            <div>
              <label className={labelCls}>Unit</label>
              <input
                type="text"
                className={inputCls}
                value={draft.af_unit_input}
                onChange={(e) => updateDraft(expense.id, 'af_unit_input', e.target.value)}
                placeholder="Unit..."
                disabled={isLocked}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Description (Memo)</label>
            <input
              type="text"
              className={inputCls}
              value={draft.description}
              onChange={(e) => updateDraft(expense.id, 'description', e.target.value)}
              placeholder="Entered - ..."
              disabled={isLocked}
            />
          </div>
        </div>

        {result && (
          <div className={`text-xs px-3 py-1.5 rounded ${result.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {result.message}
            {!result.success && (
              <button onClick={() => retryUpload(expense.id)} className="ml-2 underline font-medium">
                Retry
              </button>
            )}
          </div>
        )}

        <button
          onClick={() => enqueueUpload(expense)}
          disabled={!canSubmit}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            canSubmit
              ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Uploading...
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

        {missing.length > 0 && !isLocked && (
          <p className="text-[10px] text-red-500">
            Missing: {missing.join(', ')}
          </p>
        )}
      </div>
    );
  };

  const renderEnteredPanel = (expense: BrexExpense) => {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {expense.af_vendor_name && (
            <div>
              <span className="text-xs text-slate-400">AF Vendor</span>
              <p className="font-semibold text-sm text-green-800">{expense.af_vendor_name}</p>
            </div>
          )}
          <div>
            <span className="text-xs text-slate-400">Amount</span>
            <p className="font-semibold text-sm text-green-800">${Number(expense.amount).toFixed(2)}</p>
          </div>
          {expense.af_property_input && (
            <div>
              <span className="text-xs text-slate-400">Property</span>
              <p className="text-sm text-green-700">{expense.af_property_input}</p>
            </div>
          )}
          {expense.af_gl_account_input && (
            <div>
              <span className="text-xs text-slate-400">GL Account</span>
              <p className="text-sm text-green-700 truncate" title={expense.af_gl_account_input}>{expense.af_gl_account_input}</p>
            </div>
          )}
          {expense.af_unit_input && (
            <div>
              <span className="text-xs text-slate-400">Unit</span>
              <p className="text-sm text-green-700">{expense.af_unit_input}</p>
            </div>
          )}
          {expense.appfolio_bill_id && (
            <div>
              <span className="text-xs text-slate-400">AF Bill ID</span>
              <p className="text-sm text-green-700 font-mono">{expense.appfolio_bill_id}</p>
            </div>
          )}
        </div>

        {expense.af_approved_by && (
          <div className="pt-2 border-t border-green-200 text-[10px] text-green-600">
            <p>Approved by <span className="font-medium">{expense.af_approved_by}</span></p>
            {expense.af_approved_at && (
              <p>{new Date(expense.af_approved_at).toLocaleString()}</p>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderCorporatePanel = (expense: BrexExpense) => {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">
          This expense was marked as a corporate expense — not entered in AppFolio.
        </p>
        {expense.corporate_note && (
          <p className="text-xs text-slate-500 italic">
            Note: {expense.corporate_note}
          </p>
        )}
        {expense.corporate_at && (
          <p className="text-[10px] text-slate-400">
            Archived {new Date(expense.corporate_at).toLocaleDateString()}
          </p>
        )}
      </div>
    );
  };

  // ─── Loading state ──────────────────────────────────────────────────────────

  if (authLoading || loading || appUser?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <LogoLoader text="Loading Brex expenses..." />
      </div>
    );
  }

  const finishedCount = uploadQueue.filter(q => q.status === 'success' || q.status === 'failed').length;

  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="max-w-full mx-auto">
        {/* Header Card */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">Brex Expenses</h1>
              <p className="text-sm text-slate-500">
                {allNonCorporate.length} expenses · <span className="text-amber-600">{pendingCount} pending</span> · <span className="text-green-600">{enteredCount} entered</span>
                {corporateCount > 0 && <> · <span className="text-slate-400">{corporateCount} corporate</span></>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => fetchExpenses()}
                disabled={refreshing}
                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-700 transition-colors"
                title={`Last refresh: ${lastRefresh.toLocaleTimeString()}`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
              {/* @ts-ignore — untyped JS component */}
              <DarkSelect
                value={sort}
                onChange={(val: string) => setSort(val as SortOption)}
                compact
                searchable={false}
                className="w-40"
                options={[
                  { value: 'pending_first', label: 'Pending first' },
                  { value: 'date_newest', label: 'Date (newest)' },
                  { value: 'date_oldest', label: 'Date (oldest)' },
                  { value: 'amount_high', label: 'Amount (high)' },
                  { value: 'amount_low', label: 'Amount (low)' },
                ]}
              />
            </div>
          </div>

          {/* Filter Chips */}
          <div className="flex gap-1.5 mt-3 pt-3 border-t border-slate-100">
            {(["all", "pending", "entered", "corporate"] as FilterOption[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-sm rounded font-medium transition-colors ${
                  filter === f
                    ? f === "pending"
                      ? "bg-amber-100 text-amber-800"
                      : f === "entered"
                      ? "bg-green-100 text-green-800"
                      : f === "corporate"
                      ? "bg-slate-300 text-slate-800"
                      : "bg-slate-800 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {f === "all"
                  ? `All (${allNonCorporate.length})`
                  : f === "pending"
                  ? `Pending (${pendingCount})`
                  : f === "entered"
                  ? `Entered (${enteredCount})`
                  : `Corporate (${corporateCount})`}
              </button>
            ))}
          </div>
        </div>

        {/* Activity Tracker */}
        {uploadQueue.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Upload Activity
                {uploadQueue.some(q => q.status === 'uploading') && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                )}
              </h3>
              {finishedCount > 0 && (
                <button
                  onClick={clearFinished}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Clear finished
                </button>
              )}
            </div>
            <div className="space-y-1">
              {uploadQueue.map((item) => (
                <div
                  key={item.expenseId}
                  className={`flex items-center justify-between px-2 py-1.5 rounded text-xs ${
                    item.status === 'uploading' ? 'bg-blue-50 text-blue-700' :
                    item.status === 'queued' ? 'bg-slate-50 text-slate-500' :
                    item.status === 'success' ? 'bg-green-50 text-green-700' :
                    'bg-red-50 text-red-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {item.status === 'uploading' && <Loader2 className="w-3 h-3 animate-spin" />}
                    {item.status === 'queued' && <span className="w-3 h-3 rounded-full border-2 border-slate-300" />}
                    {item.status === 'success' && <CheckCircle2 className="w-3 h-3" />}
                    {item.status === 'failed' && <XCircle className="w-3 h-3" />}
                    <span className="font-medium">{item.vendorName}</span>
                    <span className="text-slate-400">${item.amount.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.message && <span className="text-[10px] max-w-[200px] truncate">{item.message}</span>}
                    {item.status === 'failed' && (
                      <button onClick={() => retryUpload(item.expenseId)} className="text-red-600 hover:text-red-800 underline text-[10px]">
                        Retry
                      </button>
                    )}
                    {(item.status === 'success' || item.status === 'failed') && (
                      <button onClick={() => dismissQueueItem(item.expenseId)} className="text-slate-400 hover:text-slate-600">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Expense Cards */}
        {sortedExpenses.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8 text-center text-slate-500">
            {filter === "corporate" ? "No corporate expenses." : "No expenses found for the current filter."}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedExpenses.map((expense) => {
              const isEntered = expense.appfolio_synced;
              const isCorporateView = filter === "corporate" || expense.is_corporate;
              const isPending = !isEntered && !expense.is_corporate;

              return (
                <div
                  key={expense.id}
                  className={`bg-white rounded-lg shadow-sm border overflow-hidden ${
                    isCorporateView ? "border-slate-300 opacity-75" : isEntered ? "border-green-200" : "border-slate-200"
                  }`}
                >
                  <div className="grid grid-cols-2 divide-x divide-slate-200">
                    {/* LEFT PANEL: Brex Transaction */}
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Brex Transaction</span>
                        <a
                          href={brexExpenseUrl(expense.brex_id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition-colors font-medium"
                          title="Open in Brex Dashboard"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open in Brex
                        </a>
                      </div>
                      <h2 className="text-base font-semibold text-slate-800 mb-0.5">{expense.merchant_name}</h2>
                      <p className="text-xs text-slate-500 mb-3">
                        {expense.merchant_raw_descriptor && expense.merchant_raw_descriptor !== expense.merchant_name
                          ? `${expense.merchant_raw_descriptor} · `
                          : ""}
                        {expense.posted_at
                          ? new Date(expense.posted_at).toLocaleDateString()
                          : expense.initiated_at
                          ? new Date(expense.initiated_at).toLocaleDateString()
                          : "No date"}
                      </p>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
                        <div>
                          <span className="text-xs text-slate-400">Amount</span>
                          <p className="font-bold text-slate-900 text-base">${Number(expense.amount).toFixed(2)}</p>
                        </div>
                        <div>
                          <span className="text-xs text-slate-400">Posted Date</span>
                          <p className="font-mono text-sm text-slate-700">
                            {expense.posted_at || "Pending"}
                          </p>
                        </div>
                        {expense.transaction_type && (
                          <div>
                            <span className="text-xs text-slate-400">Type</span>
                            <p className="text-sm text-slate-700">{expense.transaction_type}</p>
                          </div>
                        )}
                      </div>

                      {expense.memo && (
                        <p className="text-xs text-slate-500 mb-2 line-clamp-2">
                          <span className="text-slate-400">Memo: </span>{expense.memo}
                        </p>
                      )}

                      {/* Receipt Thumbnails */}
                      {expense.receipt_ids && expense.receipt_ids.length > 0 && (
                        <div className="flex gap-1.5 mb-2">
                          {expense.receipt_ids.map((receiptId, idx) => (
                            <a
                              key={receiptId}
                              href={`/api/admin/brex/receipt?receipt_id=${receiptId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-500 rounded text-[10px] hover:bg-slate-200 transition-colors"
                              title={`View receipt ${idx + 1}`}
                            >
                              <ImageIcon className="w-3 h-3" />
                              Receipt {idx + 1}
                            </a>
                          ))}
                        </div>
                      )}

                      {/* Corporate note */}
                      {isCorporateView && expense.corporate_note && (
                        <p className="text-xs text-orange-600 mb-2 italic">
                          <span className="text-orange-400">Corporate: </span>{expense.corporate_note}
                        </p>
                      )}

                      {/* Action Buttons */}
                      <div className="flex gap-2 flex-wrap">
                        {expense.is_corporate ? (
                          <button
                            onClick={() => unarchiveCorporate(expense.id)}
                            disabled={actionId === expense.id}
                            className="flex items-center gap-1 text-xs px-2 py-1 bg-slate-100 text-slate-700 rounded hover:bg-slate-200 disabled:opacity-50"
                          >
                            <ArchiveRestore className="w-3.5 h-3.5" />
                            {actionId === expense.id ? "..." : "Unarchive"}
                          </button>
                        ) : !isEntered ? (
                          <button
                            onClick={() => setArchiveModal({ expense, note: "" })}
                            className="flex items-center gap-1 text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200"
                          >
                            <Archive className="w-3.5 h-3.5" />
                            Archive as Corporate
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {/* RIGHT PANEL: AppFolio */}
                    <div className={`p-4 ${
                      isEntered ? "bg-green-50" :
                      isCorporateView ? "bg-slate-50" :
                      "bg-amber-50/50"
                    }`}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">AppFolio</span>
                        {isEntered ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-green-200 text-green-800">
                            <CheckCircle2 className="w-3 h-3" />
                            Entered
                          </span>
                        ) : isCorporateView ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-slate-200 text-slate-700">
                            <Archive className="w-3 h-3" />
                            Corporate
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-amber-200 text-amber-800">
                            <AlertCircle className="w-3 h-3" />
                            Pending
                          </span>
                        )}
                      </div>

                      {isPending && renderPendingPanel(expense)}
                      {isEntered && renderEnteredPanel(expense)}
                      {isCorporateView && !isEntered && renderCorporatePanel(expense)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Archive Corporate Modal */}
      {archiveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Archive as Corporate</h3>
              <button onClick={() => setArchiveModal(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-1">
              <span className="font-medium">{archiveModal.expense.merchant_name}</span> — ${Number(archiveModal.expense.amount).toFixed(2)}
            </p>
            <p className="text-xs text-gray-400 mb-4">
              {archiveModal.expense.posted_at
                ? `Posted ${new Date(archiveModal.expense.posted_at).toLocaleDateString()}`
                : ""}
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Note <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={archiveModal.note}
                onChange={(e) => setArchiveModal((prev) => prev ? { ...prev, note: e.target.value } : null)}
                placeholder="e.g., Office supplies, team dinner, software subscription"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-slate-500 focus:border-slate-500"
                rows={2}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setArchiveModal(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => archiveCorporate(archiveModal.expense.id, archiveModal.note)}
                disabled={actionId === archiveModal.expense.id}
                className="flex-1 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 text-sm font-medium disabled:opacity-50"
              >
                {actionId === archiveModal.expense.id ? "Archiving..." : "Archive"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
