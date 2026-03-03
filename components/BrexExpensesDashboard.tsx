'use client';

import React, { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Archive, ArchiveRestore, RefreshCw, Check, XCircle, X } from "lucide-react";
import { LogoLoader } from "./Logo";
import { useAuth } from "../contexts/AuthContext";
import { useRouter } from "next/navigation";

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
  match_status: "unmatched" | "matched" | "corporate";
  match_confidence: "high" | "low" | null;
  matched_bill_id: number | null;
  matched_at: string | null;
  matched_by: string | null;
  is_corporate: boolean;
  corporate_note: string | null;
  corporate_at: string | null;
  synced_at: string;
  bill_vendor_name: string | null;
  bill_amount: number | null;
  bill_invoice_date: string | null;
  bill_invoice_number: string | null;
  bill_status: string | null;
  bill_payment_status: string | null;
}

type SortOption = "unmatched_first" | "date_newest" | "date_oldest" | "amount_high" | "amount_low";
type FilterOption = "all" | "unmatched" | "matched" | "review" | "corporate";

export default function BrexExpensesDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const router = useRouter();

  const [expenses, setExpenses] = useState<BrexExpense[]>([]);
  const [corporateExpenses, setCorporateExpenses] = useState<BrexExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortOption>("unmatched_first");
  const [filter, setFilter] = useState<FilterOption>("all");
  const [archiveModal, setArchiveModal] = useState<{ expense: BrexExpense; note: string } | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Admin guard
  useEffect(() => {
    if (!authLoading && appUser?.role !== 'admin') {
      router.push('/');
    }
  }, [authLoading, appUser, router]);

  const fetchExpenses = async (includeCorporate = false) => {
    try {
      const url = includeCorporate
        ? "/api/admin/brex/expenses?include_corporate=true"
        : "/api/admin/brex/expenses";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch expenses");
      const data: BrexExpense[] = await response.json();

      if (includeCorporate) {
        setExpenses(data.filter((e) => !e.is_corporate) || []);
        setCorporateExpenses(data.filter((e) => e.is_corporate) || []);
      } else {
        setExpenses(data || []);
      }
    } catch (error) {
      console.error("Error fetching expenses:", error);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (appUser?.role === 'admin') {
      fetchExpenses(true);
      const interval = setInterval(() => fetchExpenses(true), 15000);
      return () => clearInterval(interval);
    }
  }, [appUser]);

  const triggerSync = async () => {
    setSyncing(true);
    try {
      const response = await fetch("/api/admin/brex/sync", { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Sync failed");
      await fetchExpenses(true);
    } catch (error) {
      console.error("Sync error:", error);
      alert(`Sync error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    setSyncing(false);
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

  const confirmMatch = async (expenseId: number) => {
    setActionId(expenseId);
    try {
      const response = await fetch("/api/admin/brex/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expense_id: expenseId, action: "confirm" }),
      });
      if (!response.ok) throw new Error("Failed to confirm match");

      setExpenses((prev) =>
        prev.map((e) =>
          e.id === expenseId ? { ...e, match_confidence: "high" as const, matched_by: "manual" } : e
        )
      );
    } catch (error) {
      console.error("Error confirming match:", error);
      alert("Failed to confirm match");
    }
    setActionId(null);
  };

  const rejectMatch = async (expenseId: number) => {
    setActionId(expenseId);
    try {
      const response = await fetch("/api/admin/brex/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expense_id: expenseId, action: "reject" }),
      });
      if (!response.ok) throw new Error("Failed to reject match");

      setExpenses((prev) =>
        prev.map((e) =>
          e.id === expenseId
            ? { ...e, match_status: "unmatched" as const, match_confidence: null, matched_bill_id: null, matched_at: null, matched_by: null, bill_vendor_name: null, bill_amount: null, bill_invoice_date: null, bill_invoice_number: null, bill_status: null, bill_payment_status: null }
            : e
        )
      );
    } catch (error) {
      console.error("Error rejecting match:", error);
      alert("Failed to reject match");
    }
    setActionId(null);
  };

  // Filter logic
  const displayExpenses = filter === "corporate" ? corporateExpenses : expenses;

  const filteredExpenses = displayExpenses.filter((expense) => {
    if (filter === "corporate") return true;
    if (filter === "unmatched") return expense.match_status === "unmatched";
    if (filter === "matched") return expense.match_status === "matched" && expense.match_confidence === "high";
    if (filter === "review") return expense.match_status === "matched" && expense.match_confidence === "low";
    return true;
  });

  const sortedExpenses = [...filteredExpenses].sort((a, b) => {
    if (sort === "unmatched_first") {
      if (a.match_status !== b.match_status) {
        if (a.match_status === "unmatched") return -1;
        if (b.match_status === "unmatched") return 1;
        // Low confidence before high confidence
        if (a.match_confidence === "low" && b.match_confidence === "high") return -1;
        if (a.match_confidence === "high" && b.match_confidence === "low") return 1;
      }
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
  const unmatchedCount = expenses.filter((e) => e.match_status === "unmatched").length;
  const matchedCount = expenses.filter((e) => e.match_status === "matched" && e.match_confidence === "high").length;
  const reviewCount = expenses.filter((e) => e.match_status === "matched" && e.match_confidence === "low").length;
  const corporateCount = corporateExpenses.length;

  if (authLoading || loading || appUser?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <LogoLoader text="Loading Brex expenses..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="max-w-full mx-auto">
        {/* Header Card */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">Brex Expenses</h1>
              <p className="text-sm text-slate-500">
                {expenses.length} expenses · <span className="text-yellow-600">{unmatchedCount} unmatched</span> · <span className="text-green-600">{matchedCount} matched</span>
                {reviewCount > 0 && <> · <span className="text-orange-600">{reviewCount} needs review</span></>}
                {corporateCount > 0 && <> · <span className="text-slate-400">{corporateCount} corporate</span></>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={triggerSync}
                disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing..." : "Sync"}
              </button>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                className="px-2 py-1 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="unmatched_first">Unmatched first</option>
                <option value="date_newest">Date (newest)</option>
                <option value="date_oldest">Date (oldest)</option>
                <option value="amount_high">Amount (high)</option>
                <option value="amount_low">Amount (low)</option>
              </select>
            </div>
          </div>

          {/* Filter Chips */}
          <div className="flex gap-1.5 mt-3 pt-3 border-t border-slate-100">
            {(["all", "unmatched", "matched", "review", "corporate"] as FilterOption[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-sm rounded font-medium transition-colors ${
                  filter === f
                    ? f === "unmatched"
                      ? "bg-yellow-100 text-yellow-800"
                      : f === "matched"
                      ? "bg-green-100 text-green-800"
                      : f === "review"
                      ? "bg-orange-100 text-orange-800"
                      : f === "corporate"
                      ? "bg-slate-300 text-slate-800"
                      : "bg-slate-800 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {f === "all"
                  ? `All (${expenses.length})`
                  : f === "unmatched"
                  ? `Unmatched (${unmatchedCount})`
                  : f === "matched"
                  ? `Matched (${matchedCount})`
                  : f === "review"
                  ? `Needs Review (${reviewCount})`
                  : `Corporate (${corporateCount})`}
              </button>
            ))}
          </div>
        </div>

        {/* Expense Cards */}
        {sortedExpenses.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8 text-center text-slate-500">
            {filter === "corporate" ? "No corporate expenses." : "No expenses found for the current filter."}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedExpenses.map((expense) => {
              const isMatched = expense.match_status === "matched";
              const isHighConfidence = isMatched && expense.match_confidence === "high";
              const isLowConfidence = isMatched && expense.match_confidence === "low";
              const isCorporateView = filter === "corporate";

              return (
                <div
                  key={expense.id}
                  className={`bg-white rounded-lg shadow-sm border overflow-hidden ${
                    isCorporateView ? "border-slate-300 opacity-75" : "border-slate-200"
                  }`}
                >
                  <div className="grid grid-cols-2 divide-x divide-slate-200">
                    {/* LEFT PANEL: Brex Transaction */}
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Brex Transaction</span>
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

                      {/* Corporate note */}
                      {isCorporateView && expense.corporate_note && (
                        <p className="text-xs text-orange-600 mb-2 italic">
                          <span className="text-orange-400">Corporate: </span>{expense.corporate_note}
                        </p>
                      )}

                      {/* Action Buttons */}
                      <div className="flex gap-2 flex-wrap">
                        {isCorporateView ? (
                          <button
                            onClick={() => unarchiveCorporate(expense.id)}
                            disabled={actionId === expense.id}
                            className="flex items-center gap-1 text-xs px-2 py-1 bg-slate-100 text-slate-700 rounded hover:bg-slate-200 disabled:opacity-50"
                          >
                            <ArchiveRestore className="w-3.5 h-3.5" />
                            {actionId === expense.id ? "..." : "Unarchive"}
                          </button>
                        ) : (
                          <button
                            onClick={() => setArchiveModal({ expense, note: "" })}
                            className="flex items-center gap-1 text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200"
                          >
                            <Archive className="w-3.5 h-3.5" />
                            Corporate
                          </button>
                        )}
                      </div>
                    </div>

                    {/* RIGHT PANEL: AppFolio Match */}
                    <div className={`p-4 ${
                      isHighConfidence ? "bg-green-50" :
                      isLowConfidence ? "bg-orange-50" :
                      isCorporateView ? "bg-slate-50" :
                      "bg-yellow-50"
                    }`}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">AppFolio</span>
                        {isHighConfidence ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-green-200 text-green-800">
                            <CheckCircle2 className="w-3 h-3" />
                            Matched
                          </span>
                        ) : isLowConfidence ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-orange-200 text-orange-800">
                            <AlertCircle className="w-3 h-3" />
                            Needs Review
                          </span>
                        ) : isCorporateView ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-slate-200 text-slate-700">
                            <Archive className="w-3 h-3" />
                            Corporate
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-yellow-200 text-yellow-800">
                            <AlertCircle className="w-3 h-3" />
                            Unmatched
                          </span>
                        )}
                      </div>

                      {(isHighConfidence || isLowConfidence) && expense.bill_vendor_name ? (
                        <div className="space-y-2 text-sm">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                            <div>
                              <span className="text-xs text-slate-400">Vendor</span>
                              <p className="font-semibold text-sm text-slate-800">{expense.bill_vendor_name}</p>
                            </div>
                            <div>
                              <span className="text-xs text-slate-400">Amount</span>
                              <p className="font-semibold text-sm text-slate-800">${Number(expense.bill_amount).toFixed(2)}</p>
                            </div>
                            {expense.bill_invoice_date && (
                              <div>
                                <span className="text-xs text-slate-400">Invoice Date</span>
                                <p className="font-mono text-sm text-slate-700">{expense.bill_invoice_date}</p>
                              </div>
                            )}
                            {expense.bill_invoice_number && (
                              <div>
                                <span className="text-xs text-slate-400">Invoice #</span>
                                <p className="font-mono text-sm text-slate-700">{expense.bill_invoice_number}</p>
                              </div>
                            )}
                            {expense.bill_status && (
                              <div>
                                <span className="text-xs text-slate-400">Status</span>
                                <p className="font-semibold text-sm text-slate-700">{expense.bill_status}</p>
                              </div>
                            )}
                            {expense.bill_payment_status && (
                              <div>
                                <span className="text-xs text-slate-400">Payment</span>
                                <p className={`font-semibold text-sm ${
                                  expense.bill_payment_status === "Paid" ? "text-green-700" : "text-yellow-700"
                                }`}>{expense.bill_payment_status}</p>
                              </div>
                            )}
                          </div>

                          {/* Confirm/Reject for low confidence */}
                          {isLowConfidence && (
                            <div className="flex gap-2 mt-3 pt-3 border-t border-orange-200">
                              <button
                                onClick={() => confirmMatch(expense.id)}
                                disabled={actionId === expense.id}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                              >
                                <Check className="w-3.5 h-3.5" />
                                {actionId === expense.id ? "..." : "Confirm"}
                              </button>
                              <button
                                onClick={() => rejectMatch(expense.id)}
                                disabled={actionId === expense.id}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                {actionId === expense.id ? "..." : "Reject"}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : isCorporateView ? (
                        <p className="text-sm text-slate-600">
                          This expense was marked as a corporate expense — not expected in AppFolio.
                        </p>
                      ) : (
                        <p className="text-sm text-yellow-800 font-medium">
                          No matching bill found in AppFolio. Archive as corporate if this is not a property expense.
                        </p>
                      )}
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
