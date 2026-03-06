'use client';

import React, { useEffect, useState, useCallback, useRef } from "react";
import { CheckCircle2, AlertCircle, Archive, ArchiveRestore, X, ExternalLink, Upload, Loader2, RefreshCw, Image as ImageIcon, XCircle, ChevronDown, ChevronRight, Link2 } from "lucide-react";
import { LogoLoader } from "./Logo";
import DarkSelect from "./DarkSelect";
import { useAuth } from "../contexts/AuthContext";
import { useRouter } from "next/navigation";

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface BrexExpense {
  id: number;
  brex_id: string;
  expense_id: string | null;
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

/** A potential bill match from ops_bills */
interface PotentialMatch {
  id: number;
  vendor_name: string;
  amount: number;
  invoice_date: string | null;
  invoice_number: string | null;
  status: string | null;
  payment_status: string | null;
  score: number;
  match_reason: string;
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

const brexExpenseUrl = (expenseId: string | null, brexId: string) => {
  // Use expense_id (expense_...) if available; fall back to brex_id (pste_...)
  const id = expenseId || brexId;
  const encoded = btoa(`Expense:${id}`);
  return `https://dashboard.brex.com/expenses?expenseId=${encodeURIComponent(encoded)}`;
};

type SortOption = "pending_first" | "date_newest" | "date_oldest" | "amount_high" | "amount_low";
type FilterOption = "all" | "pending" | "matched" | "entered" | "corporate" | "payments";

const POLL_INTERVAL = 15_000;

function makeDraft(expense: BrexExpense, prefill?: { vendor_name: string; property: string; gl_account: string; description: string } | null): ExpenseDraft {
  const postedDate = expense.posted_at || expense.initiated_at || '';
  let defaultDue = '';
  if (postedDate) {
    const d = new Date(postedDate);
    d.setDate(d.getDate() + 15);
    defaultDue = d.toISOString().split('T')[0];
  }

  // Use Brex memo as primary description, fall back to prefill description
  const brexLink = brexExpenseUrl(expense.expense_id, expense.brex_id);
  let description = '';
  if (expense.memo) {
    description = expense.memo;
  } else if (prefill?.description) {
    description = prefill.description;
  }
  // Append Brex link for AppFolio reference
  if (description) {
    description = `${description} | Brex: ${brexLink}`;
  } else {
    description = `Brex: ${brexLink}`;
  }

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
  const [collectionExpenses, setCollectionExpenses] = useState<BrexExpense[]>([]);
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
  const [prefillMap, setPrefillMap] = useState<Record<string, { vendor_name: string; property: string; gl_account: string; description: string } | null>>({});
  const prefillFetchedRef = useRef<Set<string>>(new Set());

  // Expand/collapse state for cards
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Potential matches state: expense.id -> { loading, matches }
  const [potentialMatches, setPotentialMatches] = useState<Record<number, { loading: boolean; matches: PotentialMatch[] }>>({});
  const matchFetchedRef = useRef<Set<number>>(new Set());
  const [linkingId, setLinkingId] = useState<number | null>(null);

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

      // Separate collections (payments) from regular expenses
      const collections = data.filter((e: BrexExpense) => e.transaction_type === 'COLLECTION');
      const nonCollections = data.filter((e: BrexExpense) => e.transaction_type !== 'COLLECTION');
      setCollectionExpenses(collections);
      setExpenses(nonCollections.filter((e: BrexExpense) => !e.is_corporate) || []);
      setCorporateExpenses(nonCollections.filter((e: BrexExpense) => e.is_corporate) || []);
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

  // ─── Potential match fetching ──────────────────────────────────────────────

  const fetchPotentialMatches = useCallback(async (expense: BrexExpense) => {
    if (matchFetchedRef.current.has(expense.id)) return;
    matchFetchedRef.current.add(expense.id);

    setPotentialMatches(prev => ({
      ...prev,
      [expense.id]: { loading: true, matches: [] },
    }));

    try {
      const res = await fetch("/api/admin/brex/find-matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_name: expense.merchant_name,
          amount: expense.amount,
        }),
      });
      if (!res.ok) throw new Error("Failed to fetch matches");
      const data = await res.json();
      setPotentialMatches(prev => ({
        ...prev,
        [expense.id]: { loading: false, matches: data.matches || [] },
      }));
    } catch (error) {
      console.error("Error fetching potential matches:", error);
      setPotentialMatches(prev => ({
        ...prev,
        [expense.id]: { loading: false, matches: [] },
      }));
    }
  }, []);

  const linkExpenseToBill = useCallback(async (expenseId: number, billId: number) => {
    setLinkingId(expenseId);
    try {
      const res = await fetch("/api/admin/brex/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expense_id: expenseId,
          bill_id: billId,
          action: 'link',
        }),
      });
      if (!res.ok) throw new Error("Failed to link expense");

      // Clear cached matches for this expense
      matchFetchedRef.current.delete(expenseId);

      // Refresh expenses to show updated match status
      await fetchExpenses(true);
    } catch (error) {
      console.error("Error linking expense:", error);
      alert("Failed to link expense to bill");
    }
    setLinkingId(null);
  }, [fetchExpenses]);

  const unlinkExpense = useCallback(async (expenseId: number) => {
    setLinkingId(expenseId);
    try {
      const res = await fetch("/api/admin/brex/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expense_id: expenseId,
          action: 'reject',
        }),
      });
      if (!res.ok) throw new Error("Failed to unlink expense");

      // Clear cached matches
      matchFetchedRef.current.delete(expenseId);

      // Refresh expenses to show updated status
      await fetchExpenses(true);
    } catch (error) {
      console.error("Error unlinking expense:", error);
      alert("Failed to unlink expense");
    }
    setLinkingId(null);
  }, [fetchExpenses]);

  // Auto-fetch potential matches when a pending expense is expanded
  useEffect(() => {
    Array.from(expandedIds).forEach(id => {
      const expense = expenses.find(e => e.id === id);
      if (expense && !expense.appfolio_synced && !expense.is_corporate && expense.match_status !== 'matched') {
        fetchPotentialMatches(expense);
      }
    });
  }, [expandedIds, expenses, fetchPotentialMatches]);

  // Pre-fetch matches for all pending expenses on initial load (for badge display)
  useEffect(() => {
    const pending = expenses.filter(e => !e.appfolio_synced && !e.is_corporate && e.match_status !== 'matched');
    // Stagger requests to avoid hammering the API
    pending.forEach((expense, idx) => {
      setTimeout(() => fetchPotentialMatches(expense), idx * 100);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses.length]); // Only re-run when expense count changes

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
  const matchedList = allNonCorporate.filter(e => e.match_status === 'matched' && !e.appfolio_synced);
  const pendingList = allNonCorporate.filter(e => !e.appfolio_synced && e.match_status !== 'matched');
  const enteredList = allNonCorporate.filter(e => e.appfolio_synced);

  const paymentsCount = collectionExpenses.length;

  const displayExpenses = filter === "corporate" ? corporateExpenses
    : filter === "payments" ? collectionExpenses
    : allNonCorporate;

  const filteredExpenses = displayExpenses.filter((expense) => {
    if (filter === "corporate") return true;
    if (filter === "payments") return true;
    if (filter === "pending") return !expense.appfolio_synced && expense.match_status !== 'matched';
    if (filter === "matched") return expense.match_status === 'matched' && !expense.appfolio_synced;
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
  const matchedCount = matchedList.length;
  const enteredCount = enteredList.length;
  const corporateCount = corporateExpenses.length;

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const inputCls = "w-full bg-white/5 border border-[var(--glass-border)] rounded px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30";
  const inputMissingCls = "w-full bg-white/5 border border-red-500/50 rounded px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400/30";
  const labelCls = "text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-0.5 block";
  const reqStar = <span className="text-red-400 ml-0.5">*</span>;

  const renderPotentialMatches = (expense: BrexExpense) => {
    const matchData = potentialMatches[expense.id];
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

    // Split into exact amount matches and vendor-only matches
    const amountMatches = matchData.matches.filter(m => Math.abs(m.amount - Number(expense.amount)) < 0.01);
    const vendorOnlyMatches = matchData.matches.filter(m => Math.abs(m.amount - Number(expense.amount)) >= 0.01);

    return (
      <div className="bg-cyan-500/5 border border-cyan-500/15 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-cyan-400 font-semibold flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" />
            Potential Matches ({matchData.matches.length})
          </p>
          <p className="text-[10px] text-slate-500">
            Bills already entered that may match this expense
          </p>
        </div>

        {/* Amount + Vendor matches (strong) */}
        {amountMatches.length > 0 && (
          <div className="space-y-1">
            {amountMatches.length > 0 && vendorOnlyMatches.length > 0 && (
              <p className="text-[10px] text-cyan-500 font-medium uppercase tracking-wide mt-1">Exact Amount Matches</p>
            )}
            {amountMatches.map(match => (
              <div
                key={match.id}
                className="flex items-center gap-2 px-2.5 py-2 rounded bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/15 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-cyan-300 truncate">{match.vendor_name}</span>
                    <span className="text-xs font-bold text-cyan-200 tabular-nums">${match.amount.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                    {match.invoice_date && <span>{new Date(match.invoice_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                    {match.invoice_number && <span>#{match.invoice_number}</span>}
                    {match.payment_status && (
                      <span className={match.payment_status === 'paid' ? 'text-emerald-500' : 'text-amber-500'}>
                        {match.payment_status}
                      </span>
                    )}
                    <span className="text-cyan-500/60">{match.match_reason}</span>
                  </div>
                </div>
                <button
                  onClick={() => linkExpenseToBill(expense.id, match.id)}
                  disabled={linkingId === expense.id}
                  className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-50"
                >
                  {linkingId === expense.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Link2 className="w-3 h-3" />
                  )}
                  Link
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Vendor-only matches (weaker) */}
        {vendorOnlyMatches.length > 0 && (
          <div className="space-y-1">
            {amountMatches.length > 0 && (
              <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide mt-1">Same Vendor (Different Amount)</p>
            )}
            {vendorOnlyMatches.slice(0, 5).map(match => (
              <div
                key={match.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-white/[0.03] border border-[var(--glass-border)] hover:bg-white/[0.06] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-300 truncate">{match.vendor_name}</span>
                    <span className="text-xs text-slate-400 tabular-nums">${match.amount.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-600 mt-0.5">
                    {match.invoice_date && <span>{new Date(match.invoice_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                    {match.invoice_number && <span>#{match.invoice_number}</span>}
                    {match.payment_status && (
                      <span className={match.payment_status === 'paid' ? 'text-emerald-600' : 'text-amber-600'}>
                        {match.payment_status}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => linkExpenseToBill(expense.id, match.id)}
                  disabled={linkingId === expense.id}
                  className="flex-shrink-0 flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors border border-[var(--glass-border)] disabled:opacity-50"
                >
                  {linkingId === expense.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Link2 className="w-3 h-3" />
                  )}
                  Link
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

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
        {/* Potential matches section — shown above the form */}
        {renderPotentialMatches(expense)}

        <p className="text-xs text-amber-400 font-medium">
          Review & approve for AppFolio upload:
        </p>

        {expense.af_approved_by && expense.af_approved_at && (
          <p className="text-[10px] text-slate-500">
            Previously approved by {expense.af_approved_by} on {new Date(expense.af_approved_at).toLocaleString()}
          </p>
        )}

        <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-3 space-y-2">
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
                className={`w-full ${isFieldMissing(expense.id, 'vendor') ? '[&_div]:!border-red-500/50' : ''}`}
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
              className={`w-full ${isFieldMissing(expense.id, 'gl_account') ? '[&_div]:!border-red-500/50' : ''}`}
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
          <div className={`text-xs px-3 py-2 rounded ${
            result.success
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
              : 'bg-red-500/15 text-red-400 border border-red-500/20'
          }`}>
            {result.message}
            {!result.success && (
              <button onClick={() => retryUpload(expense.id)} className="ml-2 underline font-medium">
                Retry
              </button>
            )}
          </div>
        )}

        {/* Missing fields warning */}
        {!canSubmit && missing.length > 0 && !isLocked && (
          <p className="text-[11px] text-red-400">
            Required: {missing.map(f => f === 'gl_account' ? 'GL Account' : f === 'invoice_date' ? 'Invoice Date' : f.charAt(0).toUpperCase() + f.slice(1)).join(', ')}
          </p>
        )}

        <button
          onClick={() => enqueueUpload(expense)}
          disabled={!canSubmit}
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
      </div>
    );
  };

  const renderMatchedPanel = (expense: BrexExpense) => {
    return (
      <div className="space-y-3">
        <p className="text-xs text-cyan-400 font-medium">
          Matched to existing bill in system:
        </p>

        <div className="bg-cyan-500/5 border border-cyan-500/15 rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {expense.bill_vendor_name && (
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Bill Vendor</span>
                <p className="font-semibold text-sm text-cyan-300">{expense.bill_vendor_name}</p>
              </div>
            )}
            {expense.bill_amount != null && (
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Bill Amount</span>
                <p className="font-semibold text-sm text-cyan-300">${Number(expense.bill_amount).toFixed(2)}</p>
              </div>
            )}
            {expense.bill_invoice_date && (
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Invoice Date</span>
                <p className="font-mono text-sm text-slate-300">{expense.bill_invoice_date}</p>
              </div>
            )}
            {expense.bill_invoice_number && (
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Invoice #</span>
                <p className="font-mono text-sm text-slate-300">{expense.bill_invoice_number}</p>
              </div>
            )}
            {expense.bill_status && (
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Bill Status</span>
                <p className="text-sm text-slate-300">{expense.bill_status}</p>
              </div>
            )}
            {expense.bill_payment_status && (
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Payment</span>
                <p className={`text-sm font-medium ${
                  expense.bill_payment_status === 'paid' ? 'text-emerald-400' :
                  expense.bill_payment_status === 'unpaid' ? 'text-amber-400' :
                  'text-slate-400'
                }`}>{expense.bill_payment_status}</p>
              </div>
            )}
          </div>
        </div>

        <div className="pt-2 border-t border-cyan-500/15 flex items-center justify-between">
          <div className="text-[10px] text-cyan-500/70">
            {expense.matched_at && <p>Matched {new Date(expense.matched_at).toLocaleString()}</p>}
            {expense.match_confidence && (
              <p className="capitalize">{expense.match_confidence} confidence · {expense.matched_by || 'auto'}</p>
            )}
          </div>
          <button
            onClick={() => unlinkExpense(expense.id)}
            disabled={linkingId === expense.id}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-white/5 hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors border border-[var(--glass-border)] disabled:opacity-50"
          >
            {linkingId === expense.id ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <X className="w-3 h-3" />
            )}
            Unlink
          </button>
        </div>
      </div>
    );
  };

  const renderEnteredPanel = (expense: BrexExpense) => {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {expense.af_vendor_name && (
            <div>
              <span className="text-xs text-slate-500">AF Vendor</span>
              <p className="font-semibold text-sm text-emerald-400">{expense.af_vendor_name}</p>
            </div>
          )}
          <div>
            <span className="text-xs text-slate-500">Amount</span>
            <p className="font-semibold text-sm text-emerald-400">${Number(expense.amount).toFixed(2)}</p>
          </div>
          {expense.af_property_input && (
            <div>
              <span className="text-xs text-slate-500">Property</span>
              <p className="text-sm text-emerald-300/80">{expense.af_property_input}</p>
            </div>
          )}
          {expense.af_gl_account_input && (
            <div>
              <span className="text-xs text-slate-500">GL Account</span>
              <p className="text-sm text-emerald-300/80 truncate" title={expense.af_gl_account_input}>{expense.af_gl_account_input}</p>
            </div>
          )}
          {expense.af_unit_input && (
            <div>
              <span className="text-xs text-slate-500">Unit</span>
              <p className="text-sm text-emerald-300/80">{expense.af_unit_input}</p>
            </div>
          )}
          {expense.appfolio_bill_id && (
            <div>
              <span className="text-xs text-slate-500">AF Bill ID</span>
              <p className="text-sm text-emerald-300/80 font-mono">{expense.appfolio_bill_id}</p>
            </div>
          )}
        </div>

        {expense.af_approved_by && (
          <div className="pt-2 border-t border-emerald-500/15 text-[10px] text-emerald-500/70">
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
        <p className="text-sm text-slate-400">
          This expense was marked as a corporate expense — not entered in AppFolio.
        </p>
        {expense.corporate_note && (
          <p className="text-xs text-slate-500 italic">
            Note: {expense.corporate_note}
          </p>
        )}
        {expense.corporate_at && (
          <p className="text-[10px] text-slate-600">
            Archived {new Date(expense.corporate_at).toLocaleDateString()}
          </p>
        )}
      </div>
    );
  };

  // ─── Loading state ──────────────────────────────────────────────────────────

  if (authLoading || loading || appUser?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LogoLoader text="Loading Brex expenses..." />
      </div>
    );
  }

  const finishedCount = uploadQueue.filter(q => q.status === 'success' || q.status === 'failed').length;

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-full mx-auto">
        {/* Header Card */}
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-100">Brex Expenses</h1>
              <p className="text-sm text-slate-400">
                {allNonCorporate.length} expenses · <span className="text-amber-400">{pendingCount} pending</span>
                {matchedCount > 0 && <> · <span className="text-cyan-400">{matchedCount} matched</span></>}
                {' '}· <span className="text-emerald-400">{enteredCount} entered</span>
                {corporateCount > 0 && <> · <span className="text-slate-500">{corporateCount} corporate</span></>}
                {paymentsCount > 0 && <> · <span className="text-purple-400">{paymentsCount} payments</span></>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => fetchExpenses()}
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
          <div className="flex gap-1.5 mt-3 pt-3 border-t border-[var(--glass-border)]">
            {(["all", "pending", "matched", "entered", "corporate", "payments"] as FilterOption[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-sm rounded font-medium transition-colors ${
                  filter === f
                    ? f === "pending"
                      ? "bg-amber-500/15 text-amber-400"
                      : f === "matched"
                      ? "bg-cyan-500/15 text-cyan-400"
                      : f === "entered"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : f === "corporate"
                      ? "bg-slate-500/20 text-slate-300"
                      : f === "payments"
                      ? "bg-purple-500/15 text-purple-400"
                      : "bg-accent text-surface-base"
                    : "bg-white/5 text-slate-400 hover:bg-white/10"
                }`}
              >
                {f === "all"
                  ? `All (${allNonCorporate.length})`
                  : f === "pending"
                  ? `Pending (${pendingCount})`
                  : f === "matched"
                  ? `Matched (${matchedCount})`
                  : f === "entered"
                  ? `Entered (${enteredCount})`
                  : f === "corporate"
                  ? `Corporate (${corporateCount})`
                  : `Payments (${paymentsCount})`}
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
                <div key={q.expenseId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
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
                <div key={q.expenseId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] border border-[var(--glass-border)]">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 flex items-center justify-center rounded-full bg-slate-700 text-[10px] text-slate-400 font-bold">{idx + 1}</span>
                    <span className="text-xs text-slate-300">{q.vendorName}</span>
                    <span className="text-xs text-slate-500">${q.amount.toFixed(2)}</span>
                  </div>
                  <button
                    onClick={() => dismissQueueItem(q.expenseId)}
                    className="text-slate-600 hover:text-slate-400 transition-colors"
                    title="Cancel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              {/* Successes */}
              {uploadQueue.filter(q => q.status === 'success').map(q => (
                <div key={q.expenseId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs text-slate-200">{q.vendorName}</span>
                    <span className="text-xs text-slate-500">${q.amount.toFixed(2)}</span>
                    <span className="text-[10px] text-emerald-400">Done</span>
                  </div>
                  <button
                    onClick={() => dismissQueueItem(q.expenseId)}
                    className="text-slate-600 hover:text-slate-400 transition-colors"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              {/* Failures */}
              {uploadQueue.filter(q => q.status === 'failed').map(q => (
                <div key={q.expenseId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                    <span className="text-xs text-slate-200">{q.vendorName}</span>
                    <span className="text-xs text-red-400/80 truncate">{q.message}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => retryUpload(q.expenseId)}
                      className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Retry
                    </button>
                    <button
                      onClick={() => dismissQueueItem(q.expenseId)}
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

        {/* Expense Cards */}
        {sortedExpenses.length === 0 ? (
          <div className="glass-card p-8 text-center text-slate-400">
            {filter === "corporate" ? "No corporate expenses." : "No expenses found for the current filter."}
          </div>
        ) : (
          <div className="space-y-1.5">
            {sortedExpenses.map((expense) => {
              const isPayment = expense.transaction_type === 'COLLECTION';
              const isEntered = expense.appfolio_synced;
              const isMatchedToBill = expense.match_status === 'matched' && !isEntered;
              const isCorporateView = filter === "corporate" || expense.is_corporate;
              const isPending = !isEntered && !expense.is_corporate && !isMatchedToBill && !isPayment;
              const isExpanded = expandedIds.has(expense.id);
              const draft = drafts[expense.id];
              const queueItem = uploadQueue.find(q => q.expenseId === expense.id);
              const result = uploadResult[expense.id];
              const missing = draft ? getMissingFields(draft) : [];
              const prefill = prefillMap[expense.merchant_name];
              const hasPrefill = !!prefill;

              // Status indicator color
              const statusColor = isPayment ? 'bg-purple-500' : isEntered ? 'bg-emerald-500' : isMatchedToBill ? 'bg-cyan-500' : isCorporateView ? 'bg-slate-500' : 'bg-amber-500';
              const statusBorder = isPayment ? 'border-purple-500/20' : isEntered ? 'border-emerald-500/20' : isMatchedToBill ? 'border-cyan-500/20' : isCorporateView ? 'border-slate-600' : queueItem?.status === 'uploading' ? 'border-cyan-500/30' : queueItem?.status === 'failed' ? 'border-red-500/30' : 'border-[var(--glass-border)]';

              return (
                <div
                  key={expense.id}
                  className={`glass-card overflow-hidden transition-all ${statusBorder} ${
                    isCorporateView && !isExpanded ? 'opacity-60' : ''
                  }`}
                >
                  {/* ── SLIM PREVIEW ROW ── */}
                  <div
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.03] transition-colors select-none ${
                      isExpanded ? 'border-b border-[var(--glass-border)]' : ''
                    }`}
                    onClick={() => toggleExpand(expense.id)}
                  >
                    {/* Expand chevron */}
                    <div className="flex-shrink-0 text-slate-500">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>

                    {/* Status dot */}
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />

                    {/* Merchant name */}
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-semibold text-slate-100 truncate block">{expense.merchant_name}</span>
                    </div>

                    {/* Memo snippet */}
                    <div className="hidden md:block min-w-0 flex-1 max-w-[200px]">
                      {expense.memo && (
                        <span className="text-xs text-slate-500 truncate block">{expense.memo}</span>
                      )}
                    </div>

                    {/* Pre-fill / match indicator */}
                    <div className="flex-shrink-0 w-20 text-center">
                      {isMatchedToBill && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-medium">Linked</span>
                      )}
                      {isPending && (() => {
                        const pm = potentialMatches[expense.id];
                        const hasAmountMatch = pm && !pm.loading && pm.matches.some(m => Math.abs(m.amount - Number(expense.amount)) < 0.01);
                        if (hasAmountMatch) {
                          return <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 font-medium animate-pulse">Match!</span>;
                        }
                        if (hasPrefill) {
                          return <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-medium">Prefill</span>;
                        }
                        if (missing.length > 0) {
                          return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">{missing.length} req</span>;
                        }
                        return null;
                      })()}
                    </div>

                    {/* Amount */}
                    <div className="flex-shrink-0 w-24 text-right">
                      <span className="text-sm font-bold text-slate-100 tabular-nums">${Number(expense.amount).toFixed(2)}</span>
                    </div>

                    {/* Date */}
                    <div className="flex-shrink-0 w-24 text-right">
                      <span className="text-xs text-slate-500 tabular-nums">
                        {expense.posted_at
                          ? new Date(expense.posted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : expense.initiated_at
                          ? new Date(expense.initiated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : '—'}
                      </span>
                    </div>

                    {/* Status badge */}
                    <div className="flex-shrink-0 w-24">
                      {isPayment ? (
                        <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-purple-500/15 text-purple-400">
                          Payment
                        </span>
                      ) : isEntered ? (
                        <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-500/15 text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" />
                          Entered
                        </span>
                      ) : isMatchedToBill ? (
                        <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-cyan-500/15 text-cyan-400">
                          <Link2 className="w-3 h-3" />
                          Matched
                        </span>
                      ) : isCorporateView ? (
                        <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-500/15 text-slate-400">
                          <Archive className="w-3 h-3" />
                          Corp
                        </span>
                      ) : queueItem?.status === 'uploading' ? (
                        <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-cyan-500/15 text-cyan-400">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Sending
                        </span>
                      ) : queueItem?.status === 'queued' ? (
                        <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-500/15 text-slate-400">
                          Queued
                        </span>
                      ) : result?.success === false ? (
                        <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-red-500/15 text-red-400">
                          <XCircle className="w-3 h-3" />
                          Failed
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/15 text-amber-400">
                          Pending
                        </span>
                      )}
                    </div>

                    {/* Quick actions (don't expand) */}
                    <div className="flex-shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <a
                        href={brexExpenseUrl(expense.expense_id, expense.brex_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 text-slate-500 hover:text-accent transition-colors"
                        title="Open in Brex"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      {expense.receipt_ids && expense.receipt_ids.length > 0 && (
                        <a
                          href={`/api/admin/brex/receipt?receipt_id=${expense.receipt_ids[0]}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 text-slate-500 hover:text-accent transition-colors"
                          title="View receipt"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* ── EXPANDED CONTENT ── */}
                  {isExpanded && (
                    <div className="grid grid-cols-2 divide-x divide-[var(--glass-border)]">
                      {/* LEFT PANEL: Brex Transaction */}
                      <div className="p-4">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Brex Transaction</span>
                          <a
                            href={brexExpenseUrl(expense.expense_id, expense.brex_id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors font-medium"
                            title="Open in Brex Dashboard"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Open in Brex
                          </a>
                        </div>
                        <h2 className="text-base font-semibold text-slate-100 mb-0.5">{expense.merchant_name}</h2>
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
                            <span className="text-xs text-slate-500">Amount</span>
                            <p className="font-bold text-slate-100 text-base">${Number(expense.amount).toFixed(2)}</p>
                          </div>
                          <div>
                            <span className="text-xs text-slate-500">Posted Date</span>
                            <p className="font-mono text-sm text-slate-300">
                              {expense.posted_at || "Pending"}
                            </p>
                          </div>
                          {expense.transaction_type && (
                            <div>
                              <span className="text-xs text-slate-500">Type</span>
                              <p className="text-sm text-slate-300">{expense.transaction_type}</p>
                            </div>
                          )}
                        </div>

                        {expense.memo && (
                          <p className="text-xs text-slate-400 mb-2 line-clamp-2">
                            <span className="text-slate-500">Memo: </span>{expense.memo}
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
                                className="flex items-center gap-1 px-2 py-1 bg-white/5 text-slate-400 rounded text-[10px] hover:bg-white/10 transition-colors"
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
                          <p className="text-xs text-orange-400 mb-2 italic">
                            <span className="text-orange-500">Corporate: </span>{expense.corporate_note}
                          </p>
                        )}

                        {/* Action Buttons */}
                        <div className="flex gap-2 flex-wrap">
                          {expense.is_corporate ? (
                            <button
                              onClick={() => unarchiveCorporate(expense.id)}
                              disabled={actionId === expense.id}
                              className="flex items-center gap-1 text-xs px-2 py-1 bg-white/5 text-slate-400 rounded hover:bg-white/10 disabled:opacity-50"
                            >
                              <ArchiveRestore className="w-3.5 h-3.5" />
                              {actionId === expense.id ? "..." : "Unarchive"}
                            </button>
                          ) : !isEntered ? (
                            <button
                              onClick={() => setArchiveModal({ expense, note: "" })}
                              className="flex items-center gap-1 text-xs px-2 py-1 bg-white/5 text-slate-400 rounded hover:bg-white/10"
                            >
                              <Archive className="w-3.5 h-3.5" />
                              Archive as Corporate
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {/* RIGHT PANEL: AppFolio / Matched Bill / Payment */}
                      <div className={`p-4 ${
                        isPayment ? "bg-purple-500/5" :
                        isEntered ? "bg-emerald-500/5" :
                        isMatchedToBill ? "bg-cyan-500/5" :
                        isCorporateView ? "bg-white/[0.02]" :
                        "bg-amber-500/5"
                      }`}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                            {isPayment ? 'Payment Record' : isMatchedToBill ? 'Matched Bill' : 'AppFolio'}
                          </span>
                          {isPayment ? (
                            <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-purple-500/20 text-purple-400">
                              Payment
                            </span>
                          ) : isEntered ? (
                            <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-emerald-500/20 text-emerald-400">
                              <CheckCircle2 className="w-3 h-3" />
                              Entered
                            </span>
                          ) : isMatchedToBill ? (
                            <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-cyan-500/20 text-cyan-400">
                              <Link2 className="w-3 h-3" />
                              Matched
                            </span>
                          ) : isCorporateView ? (
                            <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-slate-500/20 text-slate-400">
                              <Archive className="w-3 h-3" />
                              Corporate
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-amber-500/20 text-amber-400">
                              <AlertCircle className="w-3 h-3" />
                              Pending
                            </span>
                          )}
                        </div>

                        {isPayment && (
                          <div className="space-y-2">
                            <p className="text-sm text-slate-400">
                              Card payment / collection — for internal records only, not entered in AppFolio.
                            </p>
                            {expense.memo && (
                              <p className="text-xs text-purple-300">
                                <span className="text-slate-500">Memo: </span>{expense.memo}
                              </p>
                            )}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                              <div>
                                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Amount</span>
                                <p className="font-semibold text-purple-300">${Number(expense.amount).toFixed(2)}</p>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Posted</span>
                                <p className="text-sm text-slate-300">{expense.posted_at || '—'}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        {isPending && renderPendingPanel(expense)}
                        {isMatchedToBill && renderMatchedPanel(expense)}
                        {isEntered && renderEnteredPanel(expense)}
                        {isCorporateView && !isEntered && !isMatchedToBill && !isPayment && renderCorporatePanel(expense)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Archive Corporate Modal */}
      {archiveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-100">Archive as Corporate</h3>
              <button onClick={() => setArchiveModal(null)} className="text-slate-500 hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-300 mb-1">
              <span className="font-medium">{archiveModal.expense.merchant_name}</span> — ${Number(archiveModal.expense.amount).toFixed(2)}
            </p>
            <p className="text-xs text-slate-500 mb-4">
              {archiveModal.expense.posted_at
                ? `Posted ${new Date(archiveModal.expense.posted_at).toLocaleDateString()}`
                : ""}
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Note <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <textarea
                value={archiveModal.note}
                onChange={(e) => setArchiveModal((prev) => prev ? { ...prev, note: e.target.value } : null)}
                placeholder="e.g., Office supplies, team dinner, software subscription"
                className="w-full px-3 py-2 bg-white/5 border border-[var(--glass-border)] rounded-lg text-sm text-slate-200 placeholder:text-slate-500 focus:ring-1 focus:ring-accent focus:border-accent"
                rows={2}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setArchiveModal(null)}
                className="flex-1 px-4 py-2 border border-[var(--glass-border)] text-slate-300 rounded-lg hover:bg-white/5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => archiveCorporate(archiveModal.expense.id, archiveModal.note)}
                disabled={actionId === archiveModal.expense.id}
                className="flex-1 px-4 py-2 bg-accent text-surface-base rounded-lg hover:bg-accent/90 text-sm font-medium disabled:opacity-50"
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
