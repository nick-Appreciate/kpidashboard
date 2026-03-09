'use client';

import React, { useState, useMemo, useCallback } from "react";
import { RefreshCw, X } from "lucide-react";
import { LogoLoader } from "./Logo";
import DarkSelect from "./DarkSelect";
import { useAuth } from "../contexts/AuthContext";
import { useSearchParams } from "next/navigation";
import { useAfOptions } from "../hooks/useAfOptions";
import { useBills } from "../hooks/useBills";
import BillRow from "./bookkeeping/BillRow";
import UploadActivityTracker from "./bookkeeping/UploadActivityTracker";
import ParseSettingsTab from "./bookkeeping/ParseSettingsTab";
import type { UnifiedBill, UnifiedFilterOption, SourceFilter, UnifiedSortOption } from "../types/bookkeeping";

type TabOption = "feed" | "parse_settings";

function getInitialTab(param: string | null): TabOption {
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

  const { glAccounts, properties, vendors, unitsByProperty } = useAfOptions();

  const b = useBills(isAdmin, appUser?.name || appUser?.email);

  // Hide modal state (for Front invoices)
  const [hideModal, setHideModal] = useState<{ bill: UnifiedBill; note: string } | null>(null);

  // Toggle expand
  const toggleExpand = (id: number) => {
    b.setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Click bill from upload tracker → expand + scroll into view
  const handleClickBill = useCallback((billId: number) => {
    b.setExpandedIds(prev => {
      const next = new Set(prev);
      next.add(billId);
      return next;
    });
    // Small delay so the DOM has expanded before scrolling
    setTimeout(() => {
      const el = document.getElementById(`bill-${billId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }, [b]);

  // Counts
  const counts = useMemo(() => {
    let needsEntered = 0;
    let awaitingAF = 0;
    let completed = 0;
    let corporate = 0;
    let hidden = 0;
    let payments = 0;
    let brexTotal = 0;
    let invoiceTotal = 0;

    for (const bill of b.bills) {
      if (bill.source === 'brex') brexTotal++;
      else invoiceTotal++;

      if (bill.status === 'corporate') corporate++;
      else if (bill.status === 'payment') payments++;
      else if (bill.is_hidden || bill.status === 'hidden') hidden++;
      else if (bill.status === 'entered') completed++;
      else if (bill.status === 'pending') {
        if (bill.appfolio_synced_at) awaitingAF++;
        else needsEntered++;
      }
    }

    return { needsEntered, awaitingAF, actionNeeded: needsEntered + awaitingAF, completed, corporate, hidden, payments, brexTotal, invoiceTotal };
  }, [b.bills]);

  // Filter + sort feed
  const feedItems = useMemo(() => {
    let items = b.bills.filter(bill => {
      // Source filter
      if (sourceFilter === 'brex' && bill.source !== 'brex') return false;
      if (sourceFilter === 'invoices' && bill.source === 'brex') return false;

      // Status filter
      switch (filter) {
        case 'action_needed':
          return bill.status === 'pending' && !bill.is_hidden;
        case 'completed':
          return bill.status === 'entered';
        case 'corporate':
          return bill.status === 'corporate';
        case 'hidden':
          return bill.is_hidden || bill.status === 'hidden';
        case 'payments':
          return bill.status === 'payment';
        case 'all':
          return !bill.is_hidden && bill.status !== 'hidden';
        default:
          return true;
      }
    });

    // Sort
    items.sort((a, b) => {
      const dateA = new Date(a.source === 'brex' ? (a.brex_posted_at || a.brex_initiated_at || a.invoice_date) : (a.invoice_date || a.created_at));
      const dateB = new Date(b.source === 'brex' ? (b.brex_posted_at || b.brex_initiated_at || b.invoice_date) : (b.invoice_date || b.created_at));

      if (sort === "action_first") {
        const aIsAction = a.status === 'pending' && !a.is_hidden;
        const bIsAction = b.status === 'pending' && !b.is_hidden;
        if (aIsAction !== bIsAction) return aIsAction ? -1 : 1;
        return dateB.getTime() - dateA.getTime();
      }
      if (sort === "date_newest") return dateB.getTime() - dateA.getTime();
      if (sort === "date_oldest") return dateA.getTime() - dateB.getTime();
      if (sort === "amount_high") return Number(b.amount) - Number(a.amount);
      if (sort === "amount_low") return Number(a.amount) - Number(b.amount);
      return 0;
    });

    return items;
  }, [b.bills, filter, sourceFilter, sort]);

  // Loading state
  if (authLoading || b.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LogoLoader text="Loading bookkeeping..." />
      </div>
    );
  }

  const handleHide = (bill: UnifiedBill) => {
    setHideModal({ bill, note: '' });
  };

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
                    <span className="text-violet-400">{counts.brexTotal} Brex</span>
                    {" · "}
                  </>
                )}
                <span className="text-blue-400">{counts.invoiceTotal} invoices</span>
                {" · "}
                <span className="text-amber-400">{counts.needsEntered} needs entered</span>
                {counts.awaitingAF > 0 && <>{" · "}<span className="text-cyan-400">{counts.awaitingAF} pending</span></>}
                {" · "}
                <span className="text-emerald-400">{counts.completed} entered</span>
                {isAdmin && counts.corporate > 0 && <>{" · "}<span className="text-slate-500">{counts.corporate} corporate</span></>}
                {counts.hidden > 0 && <>{" · "}<span className="text-slate-500">{counts.hidden} hidden</span></>}
                {isAdmin && counts.payments > 0 && <>{" · "}<span className="text-purple-400">{counts.payments} payments</span></>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => b.fetchBills()}
                disabled={b.refreshing}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                title="Refresh now"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${b.refreshing ? "animate-spin" : ""}`} />
                {b.lastRefresh.toLocaleTimeString()}
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
              <button
                onClick={() => setActiveTab("parse_settings")}
                className={`px-4 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                  activeTab === "parse_settings" ? "bg-accent text-surface-base" : "bg-white/5 text-slate-400 hover:bg-white/10"
                }`}
              >
                Parse Settings
              </button>
            )}
          </div>

          {/* Feed filters (only shown on feed tab) */}
          {activeTab === "feed" && (
            <div className="flex items-center gap-3 mt-3">
              {/* Filter chips */}
              <div className="flex gap-1.5 flex-1 flex-wrap">
                {([
                  { key: "all" as UnifiedFilterOption, label: `All (${b.bills.filter(x => !x.is_hidden && x.status !== 'hidden').length})`, color: "bg-accent text-surface-base" },
                  { key: "action_needed" as UnifiedFilterOption, label: `Needs Entered (${counts.needsEntered})${counts.awaitingAF > 0 ? ` + ${counts.awaitingAF} pending` : ''}`, color: "bg-amber-500/15 text-amber-400" },
                  { key: "completed" as UnifiedFilterOption, label: `Entered (${counts.completed})`, color: "bg-emerald-500/15 text-emerald-400" },
                  ...(isAdmin ? [{ key: "corporate" as UnifiedFilterOption, label: `Corporate (${counts.corporate})`, color: "bg-slate-500/20 text-slate-300" }] : []),
                  { key: "hidden" as UnifiedFilterOption, label: `Hidden (${counts.hidden})`, color: "bg-slate-500/20 text-slate-300" },
                  ...(isAdmin ? [{ key: "payments" as UnifiedFilterOption, label: `Payments (${counts.payments})`, color: "bg-purple-500/15 text-purple-400" }] : []),
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
              queue={b.uploadQueue}
              bills={b.bills}
              onDismiss={b.dismissQueueItem}
              onRetry={b.retryUpload}
              onClearFinished={b.clearFinished}
              onClickBill={handleClickBill}
            />

            {/* Feed items */}
            {feedItems.length === 0 ? (
              <div className="glass-card p-8 text-center text-slate-400">
                No items found for the current filter.
              </div>
            ) : (
              <div className="space-y-1.5">
                {feedItems.map(bill => (
                  <BillRow
                    key={bill.id}
                    bill={bill}
                    isExpanded={b.expandedIds.has(bill.id)}
                    onToggleExpand={() => toggleExpand(bill.id)}
                    draft={b.drafts[bill.id]}
                    uploadQueue={b.uploadQueue}
                    uploadResult={b.uploadResult}
                    vendors={vendors}
                    glAccounts={glAccounts}
                    properties={properties}
                    filter={filter}
                    actionId={b.actionId}
                    onUpdateDraft={b.updateDraft}
                    onEnqueueUpload={b.enqueueUpload}
                    onRetryUpload={b.retryUpload}
                    onHide={handleHide}
                    onUnhide={b.unhideBill}
                    onMarkCorporate={b.markCorporate}
                    onUnmarkCorporate={b.unmarkCorporate}
                    getMissingFields={b.getMissingFields}
                    isFieldMissing={b.isFieldMissing}
                    unitsByProperty={unitsByProperty}
                  />
                ))}
              </div>
            )}
          </>
        ) : activeTab === "parse_settings" ? (
          <ParseSettingsTab
            userEmail={appUser?.email || appUser?.name}
            onMerchantToggled={() => b.fetchBills()}
          />
        ) : null}
      </div>

      {/* Hide Bill Modal */}
      {hideModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-100">Hide Bill</h3>
              <button onClick={() => setHideModal(null)} className="text-slate-400 hover:text-slate-300"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-slate-400 mb-1">
              <span className="font-medium">{hideModal.bill.vendor_name}</span> — ${Number(hideModal.bill.amount).toFixed(2)}
            </p>
            <p className="text-xs text-slate-500 mb-4">{hideModal.bill.front_email_subject || hideModal.bill.description}</p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-200 mb-1">Why are you hiding this? <span className="text-slate-500 font-normal">(optional)</span></label>
              <textarea
                value={hideModal.note}
                onChange={(e) => setHideModal((prev) => prev ? { ...prev, note: e.target.value } : null)}
                placeholder="e.g., This is a rent payment, not a bill"
                className="dark-input w-full"
                rows={2}
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setHideModal(null)} className="flex-1 px-4 py-2 border border-[var(--glass-border)] text-slate-200 rounded-lg hover:bg-white/5 text-sm">Cancel</button>
              <button
                onClick={async () => {
                  await b.hideBill(hideModal.bill.id, hideModal.note);
                  setHideModal(null);
                }}
                disabled={b.actionId === hideModal.bill.id}
                className="flex-1 px-4 py-2 btn-accent rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {b.actionId === hideModal.bill.id ? "Hiding..." : "Hide Bill"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
