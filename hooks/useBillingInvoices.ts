import { useState, useEffect, useCallback, useRef } from "react";
import type { Bill, BillDraft, BillQueueItem, PrefillData } from "../types/bookkeeping";

const POLL_INTERVAL = 10_000;

function makeDraft(bill: Bill): BillDraft {
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

export function useBillingInvoices() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [hiddenBills, setHiddenBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [hideModal, setHideModal] = useState<{ bill: Bill; note: string } | null>(null);
  const [hidingId, setHidingId] = useState<number | null>(null);

  const [drafts, setDrafts] = useState<Record<number, BillDraft>>({});
  const [prefillMap, setPrefillMap] = useState<Record<string, PrefillData>>({});
  const prefillFetchedRef = useRef(false);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [uploadQueue, setUploadQueue] = useState<BillQueueItem[]>([]);
  const processingRef = useRef(false);

  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const uploadResult: Record<number, { success: boolean; message: string }> = {};
  for (const q of uploadQueue) {
    if (q.status === 'success') uploadResult[q.billId] = { success: true, message: q.message || 'Uploaded to AppFolio!' };
    if (q.status === 'failed') uploadResult[q.billId] = { success: false, message: q.message || 'Upload failed' };
  }

  // ─── Data fetching ──────────────────────────────────────────────────────

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

      setDrafts(prev => {
        const next = { ...prev };
        for (const bill of bills) {
          const draft = next[bill.id];
          if (!draft) continue;
          const prefill = data[bill.vendor_name];
          if (!prefill) continue;
          if (!draft.af_property_input && prefill.property) draft.af_property_input = prefill.property;
          if (!draft.af_gl_account_input && prefill.gl_account) draft.af_gl_account_input = prefill.gl_account;
          if (!draft.description && prefill.description) draft.description = prefill.description;
        }
        return next;
      });
    } catch (error) {
      console.error("Error fetching prefill:", error);
    }
  }, [bills]);

  useEffect(() => {
    fetchBills(true);
    pollRef.current = setInterval(() => fetchBills(true, true), POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchBills]);

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const bill of bills) {
        if (bill.af_match_status === 'unmatched') {
          if (!next[bill.id]) {
            const draft = makeDraft(bill);
            const prefill = prefillMap[bill.vendor_name];
            if (prefill) {
              if (!draft.af_property_input && prefill.property) draft.af_property_input = prefill.property;
              if (!draft.af_gl_account_input && prefill.gl_account) draft.af_gl_account_input = prefill.gl_account;
              if (!draft.description && prefill.description) draft.description = prefill.description;
            }
            next[bill.id] = draft;
          } else {
            const d = next[bill.id];
            const fresh = makeDraft(bill);
            if (!d.vendor_name && fresh.vendor_name) d.vendor_name = fresh.vendor_name;
            if (!d.af_gl_account_input && fresh.af_gl_account_input) d.af_gl_account_input = fresh.af_gl_account_input;
            if (!d.af_property_input && fresh.af_property_input) d.af_property_input = fresh.af_property_input;
            if (!d.af_unit_input && fresh.af_unit_input) d.af_unit_input = fresh.af_unit_input;
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

    if (!prefillFetchedRef.current && bills.length > 0) {
      const unmatchedVendors = Array.from(new Set(
        bills.filter(b => b.af_match_status === 'unmatched' && b.vendor_name).map(b => b.vendor_name)
      ));
      if (unmatchedVendors.length > 0) {
        prefillFetchedRef.current = true;
        fetchPrefill(unmatchedVendors);
      }
    }
  }, [bills, prefillMap, fetchPrefill]);

  // ─── Queue processor ──────────────────────────────────────────────────

  const processNextInQueue = useCallback(async () => {
    if (processingRef.current) return;
    const nextItem = uploadQueue.find(q => q.status === 'queued');
    if (!nextItem) return;

    processingRef.current = true;
    setUploadQueue(prev => prev.map(q => q.billId === nextItem.billId ? { ...q, status: 'uploading' as const } : q));

    const draft = drafts[nextItem.billId];
    if (!draft) {
      setUploadQueue(prev => prev.map(q => q.billId === nextItem.billId
        ? { ...q, status: 'failed' as const, message: 'No draft data found', completedAt: new Date() } : q));
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
      // Extract AF bill ID from upload response
      const botResults = result.upload?.results || [];
      const thisBillResult = botResults.find((r: any) => r.bill_id == nextItem.billId);
      const afBillId = thisBillResult?.af_bill_id ? parseInt(thisBillResult.af_bill_id) : undefined;

      if (!res.ok || result.error) {
        setUploadQueue(prev => prev.map(q => q.billId === nextItem.billId
          ? { ...q, status: 'failed' as const, message: result.error || 'Upload failed. Check bot status.', completedAt: new Date() } : q));
      } else if (result.bot_success === false) {
        setUploadQueue(prev => prev.map(q => q.billId === nextItem.billId
          ? { ...q, status: 'success' as const, message: result.bot_error ? `Approved. Bot: ${result.bot_error}` : 'Approved & sent to AppFolio', afBillId, completedAt: new Date() } : q));
      } else {
        setUploadQueue(prev => prev.map(q => q.billId === nextItem.billId
          ? { ...q, status: 'success' as const, message: 'Uploaded to AppFolio!', afBillId, completedAt: new Date() } : q));
      }
      await fetchBills(true, true);
    } catch (error) {
      setUploadQueue(prev => prev.map(q => q.billId === nextItem.billId
        ? { ...q, status: 'failed' as const, message: error instanceof Error ? error.message : 'Network error', completedAt: new Date() } : q));
    }

    processingRef.current = false;
  }, [uploadQueue, drafts, fetchBills]);

  useEffect(() => {
    const hasQueued = uploadQueue.some(q => q.status === 'queued');
    const isProcessing = uploadQueue.some(q => q.status === 'uploading');
    if (hasQueued && !isProcessing && !processingRef.current) {
      processNextInQueue();
    }
  }, [uploadQueue, processNextInQueue]);

  // ─── Draft helpers ──────────────────────────────────────────────────

  const updateDraft = (billId: number, field: keyof BillDraft, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [billId]: { ...prev[billId], [field]: value },
    }));
  };

  const getMissingFields = (draft: BillDraft | undefined): string[] => {
    if (!draft) return ['all fields'];
    const missing: string[] = [];
    if (!draft.vendor_name.trim()) missing.push('vendor');
    if (!draft.amount || isNaN(Number(draft.amount))) missing.push('amount');
    if (!draft.invoice_date) missing.push('invoice_date');
    if (!draft.af_gl_account_input) missing.push('gl_account');
    return missing;
  };

  const isFieldMissing = (billId: number, field: string): boolean => {
    return getMissingFields(drafts[billId]).includes(field);
  };

  // ─── Actions ──────────────────────────────────────────────────────

  const enqueueUpload = (bill: Bill) => {
    const draft = drafts[bill.id];
    if (!draft) return;
    const missing = getMissingFields(draft);
    if (missing.length > 0) return;
    if (uploadQueue.some(q => q.billId === bill.id && (q.status === 'queued' || q.status === 'uploading'))) return;

    setUploadQueue(prev => [
      ...prev.filter(q => q.billId !== bill.id),
      { billId: bill.id, vendorName: draft.vendor_name.trim(), amount: Number(draft.amount), status: 'queued', queuedAt: new Date() },
    ]);
  };

  const retryUpload = (billId: number) => {
    const bill = bills.find(b => b.id === billId);
    if (!bill) return;
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

  return {
    bills,
    hiddenBills,
    loading,
    hideModal,
    setHideModal,
    hidingId,
    drafts,
    prefillMap,
    expandedIds,
    setExpandedIds,
    uploadQueue,
    uploadResult,
    lastRefresh,
    refreshing,
    fetchBills,
    updateDraft,
    getMissingFields,
    isFieldMissing,
    enqueueUpload,
    retryUpload,
    dismissQueueItem,
    clearFinished,
    hideBill,
    unhideBill,
  };
}
