'use client';

import React, { useState, useMemo } from "react";
import { RefreshCw, X } from "lucide-react";
import { LogoLoader } from "./Logo";
import DarkSelect from "./DarkSelect";
import { useAuth } from "../contexts/AuthContext";
import { useSearchParams } from "next/navigation";
import { useAfOptions } from "../hooks/useAfOptions";
import { useBrexExpenses } from "../hooks/useBrexExpenses";
import { useBillingInvoices } from "../hooks/useBillingInvoices";
import BrexExpenseRow from "./bookkeeping/BrexExpenseRow";
import BillingInvoiceRow from "./bookkeeping/BillingInvoiceRow";
import UploadActivityTracker from "./bookkeeping/UploadActivityTracker";
import DuplicatesTab from "./bookkeeping/DuplicatesTab";
import ParseSettingsTab from "./bookkeeping/ParseSettingsTab";
import type { FeedItem, UnifiedFilterOption, SourceFilter, UnifiedSortOption } from "../types/bookkeeping";

type TabOption = "feed" | "duplicates" | "parse_settings";

function getInitialTab(param: string | null): TabOption {
  if (param === "duplicates") return "duplicates";
  if (param === "parse_settings") return "parse_settings";
  return "feed";
}

export default function BookkeepingDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const isAdmin = appUser?.role === "admin";

  const [activeTab, setActiveTab] = useState<TabOption>(getInitialTab(searchParams.get("tab")));
  const [filter, setFilter] = useState<UnifiedFilterOption>("action_needed");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sort, setSort] = useState<UnifiedSortOption>("action_first");

  const { glAccounts, properties, vendors } = useAfOptions();

  const brex = useBrexExpenses(isAdmin);
  const billing = useBillingInvoices();

  // Unified expanded IDs
  const toggleExpand = (id: string) => {
    if (id.startsWith("brex-")) {
      brex.setExpandedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      billing.setExpandedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
  };

  // Build unified feed
  const feedItems = useMemo(() => {
    const items: FeedItem[] = [];

    // Add Brex expenses (only for admins)
    if (isAdmin && sourceFilter !== "invoices") {
      let brexList = brex.expenses;
      if (filter === "corporate") brexList = brex.corporateExpenses;
      else if (filter === "payments") brexList = brex.collectionExpenses;

      for (const expense of brexList) {
        if (filter === "action_needed") {
          if (expense.appfolio_synced || expense.match_status === "matched") continue;
        } else if (filter === "completed") {
          if (!expense.appfolio_synced && expense.match_status !== "matched") continue;
        } else if (filter === "corporate") {
          // Already filtered above
        } else if (filter === "payments") {
          // Already filtered above
        } else if (filter === "hidden") {
          continue;
        }

        items.push({
          type: "brex",
          data: expense,
          sortDate: new Date(expense.posted_at || expense.initiated_at || expense.synced_at),
        });
      }
    }

    // Add billing invoices
    if (sourceFilter !== "brex") {
      const billList = filter === "hidden" ? billing.hiddenBills : billing.bills;

      for (const bill of billList) {
        if (filter === "action_needed") {
          if (bill.af_match_status === "matched") continue;
        } else if (filter === "completed") {
          if (bill.af_match_status !== "matched") continue;
        } else if (filter === "corporate" || filter === "payments") {
          continue;
        } else if (filter === "hidden") {
          // Already using hiddenBills above
        }

        items.push({
          type: "bill",
          data: bill,
          sortDate: new Date(bill.invoice_date || bill.created_at),
        });
      }
    }

    // Sort
    items.sort((a, b) => {
      if (sort === "action_first") {
        const aIsAction = a.type === "brex"
          ? (!a.data.appfolio_synced && a.data.match_status !== "matched" && !a.data.is_corporate && a.data.transaction_type !== "COLLECTION")
          : (a.data as any).af_match_status === "unmatched";
        const bIsAction = b.type === "brex"
          ? (!b.data.appfolio_synced && b.data.match_status !== "matched" && !b.data.is_corporate && b.data.transaction_type !== "COLLECTION")
          : (b.data as any).af_match_status === "unmatched";
        if (aIsAction !== bIsAction) return aIsAction ? -1 : 1;
        return b.sortDate.getTime() - a.sortDate.getTime();
      }
      if (sort === "date_newest") return b.sortDate.getTime() - a.sortDate.getTime();
      if (sort === "date_oldest") return a.sortDate.getTime() - b.sortDate.getTime();
      if (sort === "amount_high") return Number(b.data.amount) - Number(a.data.amount);
      if (sort === "amount_low") return Number(a.data.amount) - Number(b.data.amount);
      return 0;
    });

    return items;
  }, [
    isAdmin, sourceFilter, filter, sort,
    brex.expenses, brex.corporateExpenses, brex.collectionExpenses,
    billing.bills, billing.hiddenBills,
  ]);

  // Counts
  const brexPendingCount = brex.expenses.filter(e => !e.appfolio_synced && e.match_status !== "matched").length;
  const brexMatchedCount = brex.expenses.filter(e => e.match_status === "matched" && !e.appfolio_synced).length;
  const brexEnteredCount = brex.expenses.filter(e => e.appfolio_synced).length;
  const brexCorporateCount = brex.corporateExpenses.length;
  const brexPaymentsCount = brex.collectionExpenses.length;

  const billUnmatchedCount = billing.bills.filter(b => b.af_match_status === "unmatched").length;
  const billMatchedCount = billing.bills.filter(b => b.af_match_status === "matched").length;
  const billHiddenCount = billing.hiddenBills.length;

  const actionNeededCount = brexPendingCount + billUnmatchedCount;
  const completedCount = brexEnteredCount + brexMatchedCount + billMatchedCount;

  // Loading state
  if (authLoading || (brex.loading && billing.loading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LogoLoader text="Loading bookkeeping..." />
      </div>
    );
  }

  const handleRefresh = () => {
    if (isAdmin) brex.fetchExpenses();
    billing.fetchBills(true);
  };

  const lastRefreshTime = new Date(Math.max(
    brex.lastRefresh.getTime(),
    billing.lastRefresh.getTime()
  ));

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-full mx-auto">
        {/* Header Card */}
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-100">Bookkeeping</h1>
              <p className="text-sm text-slate-400">
                {isAdmin && (
                  <>
                    <span className="text-violet-400">{brex.expenses.length + brex.corporateExpenses.length} Brex</span>
                    {" \u00b7 "}
                  </>
                )}
                <span className="text-blue-400">{billing.bills.length} invoices</span>
                {" \u00b7 "}
                <span className="text-amber-400">{actionNeededCount} action needed</span>
                {" \u00b7 "}
                <span className="text-emerald-400">{completedCount} completed</span>
                {isAdmin && brexCorporateCount > 0 && <>{" \u00b7 "}<span className="text-slate-500">{brexCorporateCount} corporate</span></>}
                {billHiddenCount > 0 && <>{" \u00b7 "}<span className="text-slate-500">{billHiddenCount} hidden</span></>}
                {isAdmin && brexPaymentsCount > 0 && <>{" \u00b7 "}<span className="text-purple-400">{brexPaymentsCount} payments</span></>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRefresh}
                disabled={brex.refreshing || billing.refreshing}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                title="Refresh now"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${(brex.refreshing || billing.refreshing) ? "animate-spin" : ""}`} />
                {lastRefreshTime.toLocaleTimeString()}
              </button>
              {/* @ts-ignore */}
              <DarkSelect
                value={sort}
                onChange={(val: string) => setSort(val as UnifiedSortOption)}
                compact
                searchable={false}
                className="w-44"
                options={[
                  { value: "action_first", label: "Action needed first" },
                  { value: "date_newest", label: "Date (newest)" },
                  { value: "date_oldest", label: "Date (oldest)" },
                  { value: "amount_high", label: "Amount (high)" },
                  { value: "amount_low", label: "Amount (low)" },
                ]}
              />
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3 pt-3 border-t border-[var(--glass-border)]">
            <button
              onClick={() => setActiveTab("feed")}
              className={`px-4 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                activeTab === "feed" ? "bg-accent text-surface-base" : "bg-white/5 text-slate-400 hover:bg-white/10"
              }`}
            >
              Feed
            </button>
            {isAdmin && (
              <>
                <button
                  onClick={() => setActiveTab("duplicates")}
                  className={`px-4 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                    activeTab === "duplicates" ? "bg-accent text-surface-base" : "bg-white/5 text-slate-400 hover:bg-white/10"
                  }`}
                >
                  Duplicates
                </button>
                <button
                  onClick={() => setActiveTab("parse_settings")}
                  className={`px-4 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                    activeTab === "parse_settings" ? "bg-accent text-surface-base" : "bg-white/5 text-slate-400 hover:bg-white/10"
                  }`}
                >
                  Parse Settings
                </button>
              </>
            )}
          </div>

          {/* Feed filters (only shown on feed tab) */}
          {activeTab === "feed" && (
            <div className="flex items-center gap-3 mt-3">
              {/* Filter chips */}
              <div className="flex gap-1.5 flex-1 flex-wrap">
                {([
                  { key: "all" as UnifiedFilterOption, label: `All (${feedItems.length})`, color: "bg-accent text-surface-base" },
                  { key: "action_needed" as UnifiedFilterOption, label: `Action Needed (${actionNeededCount})`, color: "bg-amber-500/15 text-amber-400" },
                  { key: "completed" as UnifiedFilterOption, label: `Completed (${completedCount})`, color: "bg-emerald-500/15 text-emerald-400" },
                  ...(isAdmin ? [{ key: "corporate" as UnifiedFilterOption, label: `Corporate (${brexCorporateCount})`, color: "bg-slate-500/20 text-slate-300" }] : []),
                  { key: "hidden" as UnifiedFilterOption, label: `Hidden (${billHiddenCount})`, color: "bg-slate-500/20 text-slate-300" },
                  ...(isAdmin ? [{ key: "payments" as UnifiedFilterOption, label: `Payments (${brexPaymentsCount})`, color: "bg-purple-500/15 text-purple-400" }] : []),
                ]).map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`px-3 py-1 text-sm rounded font-medium transition-colors ${
                      filter === f.key ? f.color : "bg-white/5 text-slate-400 hover:bg-white/10"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Source toggle */}
              {isAdmin && (
                <div className="flex gap-1 border-l border-[var(--glass-border)] pl-3">
                  {(["all", "brex", "invoices"] as SourceFilter[]).map(s => (
                    <button
                      key={s}
                      onClick={() => setSourceFilter(s)}
                      className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                        sourceFilter === s
                          ? s === "brex" ? "bg-violet-500/15 text-violet-400"
                            : s === "invoices" ? "bg-blue-500/15 text-blue-400"
                            : "bg-white/10 text-slate-200"
                          : "bg-white/5 text-slate-500 hover:bg-white/10"
                      }`}
                    >
                      {s === "all" ? "All" : s === "brex" ? "Brex" : "Invoices"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tab Content */}
        {activeTab === "feed" ? (
          <>
            {/* Upload Activity Tracker */}
            <UploadActivityTracker
              brexQueue={brex.uploadQueue}
              billQueue={billing.uploadQueue}
              onDismissBrex={brex.dismissQueueItem}
              onDismissBill={billing.dismissQueueItem}
              onRetryBrex={brex.retryUpload}
              onRetryBill={billing.retryUpload}
              onClearFinishedBrex={brex.clearFinished}
              onClearFinishedBill={billing.clearFinished}
            />

            {/* Feed items */}
            {feedItems.length === 0 ? (
              <div className="glass-card p-8 text-center text-slate-400">
                No items found for the current filter.
              </div>
            ) : (
              <div className="space-y-1.5">
                {feedItems.map(item => {
                  if (item.type === "brex") {
                    const expense = item.data;
                    const expandKey = `brex-${expense.id}`;
                    return (
                      <BrexExpenseRow
                        key={expandKey}
                        expense={expense}
                        isExpanded={brex.expandedIds.has(expandKey)}
                        onToggleExpand={() => toggleExpand(expandKey)}
                        draft={brex.drafts[expense.id]}
                        prefillMap={brex.prefillMap}
                        potentialMatches={brex.potentialMatches[expense.id]}
                        linkingId={brex.linkingId}
                        actionId={brex.actionId}
                        uploadQueue={brex.uploadQueue}
                        uploadResult={brex.uploadResult}
                        vendors={vendors}
                        glAccounts={glAccounts}
                        properties={properties}
                        filter={filter}
                        onUpdateDraft={brex.updateDraft}
                        onEnqueueUpload={brex.enqueueUpload}
                        onRetryUpload={brex.retryUpload}
                        onLinkExpenseToBill={brex.linkExpenseToBill}
                        onUnlinkExpense={brex.unlinkExpense}
                        onArchiveCorporate={brex.archiveCorporate}
                        onUnarchiveCorporate={brex.unarchiveCorporate}
                        getMissingFields={brex.getMissingFields}
                        isFieldMissing={brex.isFieldMissing}
                      />
                    );
                  } else {
                    const bill = item.data;
                    const expandKey = `bill-${bill.id}`;
                    return (
                      <BillingInvoiceRow
                        key={expandKey}
                        bill={bill}
                        isExpanded={billing.expandedIds.has(expandKey)}
                        onToggleExpand={() => toggleExpand(expandKey)}
                        draft={billing.drafts[bill.id]}
                        prefillMap={billing.prefillMap}
                        uploadQueue={billing.uploadQueue}
                        uploadResult={billing.uploadResult}
                        hidingId={billing.hidingId}
                        vendors={vendors}
                        glAccounts={glAccounts}
                        properties={properties}
                        filter={filter}
                        onUpdateDraft={billing.updateDraft}
                        onEnqueueUpload={billing.enqueueUpload}
                        onRetryUpload={billing.retryUpload}
                        onSetHideModal={billing.setHideModal}
                        onUnhideBill={billing.unhideBill}
                        getMissingFields={billing.getMissingFields}
                        isFieldMissing={billing.isFieldMissing}
                      />
                    );
                  }
                })}
              </div>
            )}
          </>
        ) : activeTab === "duplicates" ? (
          <DuplicatesTab userEmail={appUser?.email || appUser?.name} />
        ) : activeTab === "parse_settings" ? (
          <ParseSettingsTab
            userEmail={appUser?.email || appUser?.name}
            onMerchantToggled={() => brex.fetchExpenses(true)}
          />
        ) : null}
      </div>

      {/* Hide Bill Modal */}
      {billing.hideModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-100">Hide Bill</h3>
              <button onClick={() => billing.setHideModal(null)} className="text-slate-400 hover:text-slate-300"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-slate-400 mb-1">
              <span className="font-medium">{billing.hideModal.bill.vendor_name}</span> — ${Number(billing.hideModal.bill.amount).toFixed(2)}
            </p>
            <p className="text-xs text-slate-500 mb-4">{billing.hideModal.bill.front_email_subject}</p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-200 mb-1">Why are you hiding this? <span className="text-slate-500 font-normal">(optional)</span></label>
              <textarea
                value={billing.hideModal.note}
                onChange={(e) => billing.setHideModal((prev) => prev ? { ...prev, note: e.target.value } : null)}
                placeholder="e.g., This is a rent payment, not a bill"
                className="dark-input w-full"
                rows={2}
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => billing.setHideModal(null)} className="flex-1 px-4 py-2 border border-[var(--glass-border)] text-slate-200 rounded-lg hover:bg-white/5 text-sm">Cancel</button>
              <button
                onClick={() => billing.hideBill(billing.hideModal!.bill.id, billing.hideModal!.note)}
                disabled={billing.hidingId === billing.hideModal.bill.id}
                className="flex-1 px-4 py-2 btn-accent rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {billing.hidingId === billing.hideModal.bill.id ? "Hiding..." : "Hide Bill"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
