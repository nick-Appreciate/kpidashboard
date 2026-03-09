import { useState, useEffect, useCallback, useRef } from "react";
import type { UnifiedBill, UnifiedBillDraft, UnifiedQueueItemV2, PrefillData } from "../types/bookkeeping";

const POLL_INTERVAL = 12_000;

function makeDraft(bill: UnifiedBill, prefill?: PrefillData | null): UnifiedBillDraft {
  // Bill Date & Due Date default to today (upload date), not the invoice/transaction date
  const today = new Date().toISOString().split('T')[0];
  const dateStr = today;

  const defaultDue = bill.due_date || today;

  let description = bill.description || '';
  if (!description && bill.source === 'brex') {
    description = bill.brex_memo || prefill?.description || `Brex charge - ${bill.brex_merchant_name || bill.vendor_name}`;
  } else if (!description && prefill?.description) {
    description = prefill.description;
  }

  return {
    vendor_name: bill.af_property_input ? bill.vendor_name : (prefill?.vendor_name || bill.vendor_name || ''),
    amount: String(bill.amount || ''),
    invoice_date: dateStr,
    due_date: defaultDue,
    invoice_number: bill.invoice_number || '',
    description,
    af_property_input: bill.af_property_input || prefill?.property || '',
    af_gl_account_input: bill.af_gl_account_input || prefill?.gl_account || '',
    af_unit_input: bill.af_unit_input || '',
  };
}

export function useBills(isAdmin: boolean, userName?: string) {
  const [bills, setBills] = useState<UnifiedBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);

  const [drafts, setDrafts] = useState<Record<number, UnifiedBillDraft>>({});
  const [prefillMap, setPrefillMap] = useState<Record<string, PrefillData | null>>({});
  const prefillFetchedRef = useRef<Set<string>>(new Set());

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const [uploadQueue, setUploadQueue] = useState<UnifiedQueueItemV2[]>([]);
  const processingRef = useRef(false);

  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const verifiedBillsRef = useRef<Set<number>>(new Set());

  // Derive upload results from queue
  const uploadResult: Record<number, { success: boolean; message: string }> = {};
  for (const q of uploadQueue) {
    if (q.status === 'success') uploadResult[q.billId] = { success: true, message: q.message || 'Uploaded to AppFolio!' };
    if (q.status === 'failed') uploadResult[q.billId] = { success: false, message: q.message || 'Upload failed' };
  }

  // ─── Data fetching ────────────────────────────────────────────────────

  const fetchBills = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch("/api/admin/bills?include_hidden=true&include_corporate=true");
      if (!response.ok) throw new Error("Failed to fetch bills");
      const data: UnifiedBill[] = await response.json();
      setBills(data);
      setLastRefresh(new Date());
    } catch (error) {
      console.error("Error fetching bills:", error);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const fetchPrefill = useCallback(async (vendorNames: string[]) => {
    const newVendors = vendorNames.filter(v => !prefillFetchedRef.current.has(v));
    if (newVendors.length === 0) return;
    newVendors.forEach(v => prefillFetchedRef.current.add(v));

    try {
      const res = await fetch("/api/admin/bills/prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendors: newVendors }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setPrefillMap(prev => ({ ...prev, ...data }));
    } catch (error) {
      console.error("Error fetching prefill:", error);
    }
  }, []);

  // Polling
  useEffect(() => {
    if (isAdmin) {
      fetchBills();
      pollRef.current = setInterval(() => fetchBills(true), POLL_INTERVAL);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    } else {
      setLoading(false);
    }
  }, [isAdmin, fetchBills]);

  // Auto-fetch prefill for pending bills
  useEffect(() => {
    const pending = bills.filter(b => b.status === 'pending');
    const vendorNames = Array.from(new Set(
      pending.map(b => b.source === 'brex' ? (b.brex_merchant_name || b.vendor_name) : b.vendor_name)
    ));
    if (vendorNames.length > 0) fetchPrefill(vendorNames);
  }, [bills, fetchPrefill]);

  // Auto-create drafts for pending bills when prefill arrives
  useEffect(() => {
    setDrafts(prev => {
      const next = { ...prev };
      for (const bill of bills) {
        if (bill.status !== 'pending') continue;
        const vendorKey = bill.source === 'brex' ? (bill.brex_merchant_name || bill.vendor_name) : bill.vendor_name;
        const prefill = prefillMap[vendorKey] || null;
        if (!next[bill.id]) {
          next[bill.id] = makeDraft(bill, prefill);
        } else {
          const d = next[bill.id];
          if (!d.vendor_name && (prefill?.vendor_name || bill.vendor_name)) {
            d.vendor_name = prefill?.vendor_name || bill.vendor_name || '';
          }
          if (!d.af_property_input && (bill.af_property_input || prefill?.property)) {
            d.af_property_input = bill.af_property_input || prefill?.property || '';
          }
          if (!d.af_gl_account_input && (bill.af_gl_account_input || prefill?.gl_account)) {
            d.af_gl_account_input = bill.af_gl_account_input || prefill?.gl_account || '';
          }
        }
      }
      return next;
    });
  }, [bills, prefillMap]);

  // Auto-verify bills that have been awaiting AF confirmation > 5 min.
  // Updates our AF records (matching), then marks as failed if still no match.
  useEffect(() => {
    const VERIFY_AFTER_MS = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();

    const needsVerify = bills.filter(b =>
      b.status === 'pending' &&
      b.appfolio_synced_at &&
      !verifiedBillsRef.current.has(b.id) &&
      (now - new Date(b.appfolio_synced_at).getTime()) > VERIFY_AFTER_MS
    );

    if (needsVerify.length === 0) return;

    for (const bill of needsVerify) {
      verifiedBillsRef.current.add(bill.id);
      fetch(`/api/admin/bills/${bill.id}/verify-upload`, { method: 'POST' })
        .then(res => res.json())
        .then(result => {
          console.log(`Verify bill ${bill.id}:`, result.matched ? 'matched!' : 'not matched — marked for retry');
          fetchBills(true);
        })
        .catch(err => console.error(`Verify bill ${bill.id} failed:`, err));
    }
  }, [bills, fetchBills]);

  // ─── Queue processor ──────────────────────────────────────────────────

  const processNextInQueue = useCallback(async () => {
    if (processingRef.current) return;
    const nextItem = uploadQueue.find(q => q.status === 'queued');
    if (!nextItem) return;

    processingRef.current = true;
    setUploadQueue(prev => prev.map(q =>
      q.billId === nextItem.billId ? { ...q, status: 'uploading' as const } : q
    ));

    const draft = drafts[nextItem.billId];
    if (!draft) {
      setUploadQueue(prev => prev.map(q =>
        q.billId === nextItem.billId
          ? { ...q, status: 'failed' as const, message: 'No draft data found', completedAt: new Date() } : q
      ));
      processingRef.current = false;
      return;
    }

    try {
      const res = await fetch(`/api/admin/bills/${nextItem.billId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approved_by: userName || 'dashboard_user',
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
      const botResults = result.upload?.results || [];
      const thisResult = botResults.find((r: any) => r.bill_id == nextItem.billId);
      const afBillId = thisResult?.af_bill_id ? parseInt(thisResult.af_bill_id) : undefined;

      if (!res.ok || result.error) {
        setUploadQueue(prev => prev.map(q =>
          q.billId === nextItem.billId
            ? { ...q, status: 'failed' as const, message: result.error || 'Upload failed. Check bot status.', completedAt: new Date() } : q
        ));
      } else if (result.bot_success === false) {
        // Bot failed (form errors, etc.) — show as failed, not success
        setUploadQueue(prev => prev.map(q =>
          q.billId === nextItem.billId
            ? { ...q, status: 'failed' as const, message: result.bot_error ? `Bot error: ${result.bot_error}` : 'Bot failed to create bill in AppFolio', completedAt: new Date() } : q
        ));
      } else if (!afBillId) {
        // Bot reported success but didn't return AF bill ID — awaiting confirmation
        setUploadQueue(prev => prev.map(q =>
          q.billId === nextItem.billId
            ? { ...q, status: 'success' as const, message: 'Sent to AppFolio — awaiting confirmation', completedAt: new Date() } : q
        ));
      } else {
        setUploadQueue(prev => prev.map(q =>
          q.billId === nextItem.billId
            ? { ...q, status: 'success' as const, message: 'Uploaded to AppFolio!', afBillId, completedAt: new Date() } : q
        ));
      }
      await fetchBills(true);
      // Delayed re-fetch: the approve route triggers a background AF bill_detail sync,
      // so re-poll after ~8s to pick up the real AppFolio data (vendor, GL, status, etc.)
      setTimeout(() => fetchBills(true), 8000);
    } catch (error) {
      setUploadQueue(prev => prev.map(q =>
        q.billId === nextItem.billId
          ? { ...q, status: 'failed' as const, message: error instanceof Error ? error.message : 'Network error', completedAt: new Date() } : q
      ));
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

  const updateDraft = (billId: number, field: keyof UnifiedBillDraft, value: string) => {
    setDrafts(prev => ({
      ...prev,
      [billId]: { ...prev[billId], [field]: value },
    }));
  };

  const getMissingFields = (draft: UnifiedBillDraft | undefined): string[] => {
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

  const enqueueUpload = (bill: UnifiedBill) => {
    const draft = drafts[bill.id];
    if (!draft) return;
    const missing = getMissingFields(draft);
    if (missing.length > 0) return;
    if (uploadQueue.some(q => q.billId === bill.id && (q.status === 'queued' || q.status === 'uploading'))) return;

    setUploadQueue(prev => [
      ...prev.filter(q => q.billId !== bill.id),
      {
        billId: bill.id,
        source: bill.source,
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
    setUploadQueue(prev => prev.filter(q => q.billId !== billId));
    setTimeout(() => enqueueUpload(bill), 0);
  };

  const dismissQueueItem = (billId: number) => {
    setUploadQueue(prev => prev.filter(q => q.billId !== billId));
  };

  const clearFinished = () => {
    setUploadQueue(prev => prev.filter(q => q.status === 'queued' || q.status === 'uploading'));
  };

  const hideBill = async (billId: number, note?: string) => {
    setActionId(billId);
    try {
      const res = await fetch(`/api/admin/bills/${billId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_hidden: true, hidden_note: note || '' }),
      });
      if (!res.ok) throw new Error("Failed to hide bill");
      await fetchBills(true);
    } catch (error) {
      console.error("Error hiding bill:", error);
      alert("Failed to hide bill");
    }
    setActionId(null);
  };

  const unhideBill = async (billId: number) => {
    setActionId(billId);
    try {
      const res = await fetch(`/api/admin/bills/${billId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_hidden: false }),
      });
      if (!res.ok) throw new Error("Failed to unhide bill");
      await fetchBills(true);
    } catch (error) {
      console.error("Error unhiding bill:", error);
      alert("Failed to unhide bill");
    }
    setActionId(null);
  };

  const markCorporate = async (billId: number) => {
    setActionId(billId);
    try {
      const res = await fetch(`/api/admin/bills/${billId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: 'corporate' }),
      });
      if (!res.ok) throw new Error("Failed to mark as corporate");
      await fetchBills(true);
    } catch (error) {
      console.error("Error marking corporate:", error);
      alert("Failed to mark as corporate");
    }
    setActionId(null);
  };

  const unmarkCorporate = async (billId: number) => {
    setActionId(billId);
    try {
      const res = await fetch(`/api/admin/bills/${billId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: 'pending' }),
      });
      if (!res.ok) throw new Error("Failed to unmark corporate");
      await fetchBills(true);
    } catch (error) {
      console.error("Error unmarking corporate:", error);
      alert("Failed to unmark corporate");
    }
    setActionId(null);
  };

  const resolveDuplicate = async (billId: number, action: 'confirm_duplicate' | 'mark_unique', duplicateOfId?: number) => {
    setActionId(billId);
    try {
      const res = await fetch(`/api/admin/bills/${billId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, duplicate_of_id: duplicateOfId }),
      });
      if (!res.ok) throw new Error("Failed to resolve duplicate");
      await fetchBills(true);
    } catch (error) {
      console.error("Error resolving duplicate:", error);
      alert("Failed to resolve duplicate");
    }
    setActionId(null);
  };

  return {
    bills,
    loading,
    actionId,
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
    markCorporate,
    unmarkCorporate,
    resolveDuplicate,
  };
}
