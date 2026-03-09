import { useState, useEffect, useCallback, useRef } from "react";
import type { BrexExpense, ExpenseDraft, PotentialMatch, BrexQueueItem, PrefillData } from "../types/bookkeeping";

const POLL_INTERVAL = 15_000;

function makeDraft(
  expense: BrexExpense,
  prefill?: PrefillData | null
): ExpenseDraft {
  const postedDate = expense.posted_at || expense.initiated_at || '';
  let defaultDue = '';
  if (postedDate) {
    const d = new Date(postedDate);
    d.setDate(d.getDate() + 15);
    defaultDue = d.toISOString().split('T')[0];
  }

  let description = '';
  if (expense.memo) {
    description = expense.memo;
  } else if (prefill?.description) {
    description = prefill.description;
  } else {
    description = `Brex charge - ${expense.merchant_name}`;
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

export function useBrexExpenses(isAdmin: boolean) {
  const [expenses, setExpenses] = useState<BrexExpense[]>([]);
  const [corporateExpenses, setCorporateExpenses] = useState<BrexExpense[]>([]);
  const [collectionExpenses, setCollectionExpenses] = useState<BrexExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);

  const [drafts, setDrafts] = useState<Record<number, ExpenseDraft>>({});
  const [prefillMap, setPrefillMap] = useState<Record<string, PrefillData | null>>({});
  const prefillFetchedRef = useRef<Set<string>>(new Set());

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [potentialMatches, setPotentialMatches] = useState<Record<number, { loading: boolean; matches: PotentialMatch[] }>>({});
  const matchFetchedRef = useRef<Set<number>>(new Set());
  const [linkingId, setLinkingId] = useState<number | null>(null);

  const [uploadQueue, setUploadQueue] = useState<BrexQueueItem[]>([]);
  const processingRef = useRef(false);

  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const uploadResult: Record<number, { success: boolean; message: string }> = {};
  for (const q of uploadQueue) {
    if (q.status === 'success') uploadResult[q.expenseId] = { success: true, message: q.message || 'Uploaded to AppFolio!' };
    if (q.status === 'failed') uploadResult[q.expenseId] = { success: false, message: q.message || 'Upload failed' };
  }

  // ─── Data fetching ──────────────────────────────────────────────────────

  const fetchExpenses = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch("/api/admin/brex/expenses?include_corporate=true");
      if (!response.ok) throw new Error("Failed to fetch expenses");
      const data: BrexExpense[] = await response.json();

      const collections = data.filter((e) => e.transaction_type === 'COLLECTION');
      const nonCollections = data.filter((e) => e.transaction_type !== 'COLLECTION');
      setCollectionExpenses(collections);
      setExpenses(nonCollections.filter((e) => !e.is_corporate) || []);
      setCorporateExpenses(nonCollections.filter((e) => e.is_corporate) || []);
      setLastRefresh(new Date());
    } catch (error) {
      console.error("Error fetching expenses:", error);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const fetchPrefill = useCallback(async (merchantNames: string[]) => {
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
    if (isAdmin) {
      fetchExpenses();
      pollRef.current = setInterval(() => fetchExpenses(true), POLL_INTERVAL);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    } else {
      setLoading(false);
    }
  }, [isAdmin, fetchExpenses]);

  useEffect(() => {
    const pendingExpenses = expenses.filter(e => !e.appfolio_synced && !e.is_corporate);
    const uniqueMerchants = Array.from(new Set(pendingExpenses.map(e => e.merchant_name)));
    if (uniqueMerchants.length > 0) fetchPrefill(uniqueMerchants);
  }, [expenses, fetchPrefill]);

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const expense of expenses) {
        if (!expense.appfolio_synced && !expense.is_corporate) {
          const prefill = prefillMap[expense.merchant_name] || null;
          if (!next[expense.id]) {
            next[expense.id] = makeDraft(expense, prefill);
          } else {
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

  // ─── Potential match fetching ──────────────────────────────────────────

  const fetchPotentialMatches = useCallback(async (expense: BrexExpense, vendorOverride?: string) => {
    if (!vendorOverride && matchFetchedRef.current.has(expense.id)) return;
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
          merchant_name: vendorOverride || expense.merchant_name,
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
        body: JSON.stringify({ expense_id: expenseId, bill_id: billId, action: 'link' }),
      });
      if (!res.ok) throw new Error("Failed to link expense");
      matchFetchedRef.current.delete(expenseId);
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
        body: JSON.stringify({ expense_id: expenseId, action: 'reject' }),
      });
      if (!res.ok) throw new Error("Failed to unlink expense");
      matchFetchedRef.current.delete(expenseId);
      await fetchExpenses(true);
    } catch (error) {
      console.error("Error unlinking expense:", error);
      alert("Failed to unlink expense");
    }
    setLinkingId(null);
  }, [fetchExpenses]);

  // Auto-fetch matches when expanded
  useEffect(() => {
    Array.from(expandedIds).forEach(id => {
      if (!id.startsWith('brex-')) return;
      const numId = Number(id.replace('brex-', ''));
      const expense = expenses.find(e => e.id === numId);
      if (expense && !expense.appfolio_synced && !expense.is_corporate && expense.match_status !== 'matched') {
        fetchPotentialMatches(expense);
      }
    });
  }, [expandedIds, expenses, fetchPotentialMatches]);

  // Pre-fetch matches for pending expenses
  useEffect(() => {
    const pending = expenses.filter(e => !e.appfolio_synced && !e.is_corporate && e.match_status !== 'matched');
    pending.forEach((expense, idx) => {
      setTimeout(() => fetchPotentialMatches(expense), idx * 100);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses.length]);

  // ─── Queue processor ──────────────────────────────────────────────────

  const processNextInQueue = useCallback(async () => {
    if (processingRef.current) return;
    const nextItem = uploadQueue.find(q => q.status === 'queued');
    if (!nextItem) return;

    processingRef.current = true;
    setUploadQueue(prev => prev.map(q => q.expenseId === nextItem.expenseId ? { ...q, status: 'uploading' as const } : q));

    const draft = drafts[nextItem.expenseId];
    if (!draft) {
      setUploadQueue(prev => prev.map(q => q.expenseId === nextItem.expenseId
        ? { ...q, status: 'failed' as const, message: 'No draft data found', completedAt: new Date() } : q));
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
      // Extract AF bill ID from upload response
      const botResults = result.upload?.results || [];
      const thisExpResult = botResults.find((r: any) => r.bill_id == nextItem.expenseId);
      const afBillId = thisExpResult?.af_bill_id ? parseInt(thisExpResult.af_bill_id) : undefined;

      if (!res.ok || result.error) {
        setUploadQueue(prev => prev.map(q => q.expenseId === nextItem.expenseId
          ? { ...q, status: 'failed' as const, message: result.error || 'Upload failed. Check bot status.', completedAt: new Date() } : q));
      } else if (result.bot_success === false) {
        setUploadQueue(prev => prev.map(q => q.expenseId === nextItem.expenseId
          ? { ...q, status: 'success' as const, message: result.bot_error ? `Approved. Bot: ${result.bot_error}` : 'Approved & sent to AppFolio', afBillId, completedAt: new Date() } : q));
      } else {
        setUploadQueue(prev => prev.map(q => q.expenseId === nextItem.expenseId
          ? { ...q, status: 'success' as const, message: 'Uploaded to AppFolio!', afBillId, completedAt: new Date() } : q));
      }
      await fetchExpenses(true);
    } catch (error) {
      setUploadQueue(prev => prev.map(q => q.expenseId === nextItem.expenseId
        ? { ...q, status: 'failed' as const, message: error instanceof Error ? error.message : 'Network error', completedAt: new Date() } : q));
    }

    processingRef.current = false;
  }, [uploadQueue, drafts, fetchExpenses]);

  useEffect(() => {
    const hasQueued = uploadQueue.some(q => q.status === 'queued');
    const isProcessing = uploadQueue.some(q => q.status === 'uploading');
    if (hasQueued && !isProcessing && !processingRef.current) {
      processNextInQueue();
    }
  }, [uploadQueue, processNextInQueue]);

  // ─── Draft helpers ──────────────────────────────────────────────────

  const updateDraft = (expenseId: number, field: keyof ExpenseDraft, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [expenseId]: { ...prev[expenseId], [field]: value },
    }));
    if (field === 'vendor_name' && value) {
      const expense = expenses.find(e => e.id === expenseId);
      if (expense) fetchPotentialMatches(expense, value);
    }
  };

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

  // ─── Actions ──────────────────────────────────────────────────────

  const enqueueUpload = (expense: BrexExpense) => {
    const draft = drafts[expense.id];
    if (!draft) return;
    const missing = getMissingFields(draft);
    if (missing.length > 0) return;
    if (uploadQueue.some(q => q.expenseId === expense.id && (q.status === 'queued' || q.status === 'uploading'))) return;

    setUploadQueue(prev => [
      ...prev.filter(q => q.expenseId !== expense.id),
      { expenseId: expense.id, vendorName: draft.vendor_name.trim(), amount: Number(draft.amount), status: 'queued', queuedAt: new Date() },
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

  const archiveCorporate = async (expenseId: number) => {
    setActionId(expenseId);
    try {
      const response = await fetch("/api/admin/brex/corporate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: expenseId, is_corporate: true, note: "" }),
      });
      if (!response.ok) throw new Error("Failed to archive expense");
      const expense = expenses.find((e) => e.id === expenseId);
      if (expense) {
        setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
        setCorporateExpenses((prev) => [...prev, { ...expense, is_corporate: true, corporate_note: null, corporate_at: new Date().toISOString(), match_status: "corporate" }]);
      }
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

  return {
    expenses,
    corporateExpenses,
    collectionExpenses,
    loading,
    actionId,
    drafts,
    prefillMap,
    expandedIds,
    setExpandedIds,
    potentialMatches,
    linkingId,
    uploadQueue,
    uploadResult,
    lastRefresh,
    refreshing,
    fetchExpenses,
    fetchPotentialMatches,
    linkExpenseToBill,
    unlinkExpense,
    updateDraft,
    getMissingFields,
    isFieldMissing,
    enqueueUpload,
    retryUpload,
    dismissQueueItem,
    clearFinished,
    archiveCorporate,
    unarchiveCorporate,
  };
}
