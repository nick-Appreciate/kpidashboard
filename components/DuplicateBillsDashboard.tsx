'use client';

import React, { useEffect, useState, useCallback } from "react";
import { CheckCircle2, AlertTriangle, ExternalLink, Loader2, ChevronDown, ChevronRight, Undo2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useRouter } from "next/navigation";

interface BillDetail {
  bill_id: string;
  bill_date: string;
  bill_number: string | null;
  status: string | null;
  description: string | null;
}

interface DuplicateGroup {
  id: number;
  group_key: string;
  vendor_name: string;
  amount: number;
  property: string | null;
  unit: string | null;
  bill_month: string;
  bill_ids: string[];
  dup_count: number;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  resolved_note: string | null;
  bills: BillDetail[];
}

export default function DuplicateBillsDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const router = useRouter();

  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [resolveModal, setResolveModal] = useState<{ group: DuplicateGroup; note: string } | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [unresolvedCount, setUnresolvedCount] = useState(0);

  // Admin guard
  useEffect(() => {
    if (!authLoading && appUser?.role !== 'admin') {
      router.push('/');
    }
  }, [authLoading, appUser, router]);

  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      params.set('refresh', 'true');
      if (showResolved) params.set('show_resolved', 'true');

      const res = await fetch(`/api/admin/duplicates?${params}`);
      const data = await res.json();

      if (data.groups) {
        setGroups(data.groups);
        setTotalCount(data.total);
        setUnresolvedCount(data.unresolved);
      }
    } catch (err) {
      console.error('Failed to fetch duplicates:', err);
    } finally {
      setLoading(false);
    }
  }, [showResolved]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleResolve = async (groupId: number, note: string) => {
    setActionId(groupId);
    try {
      const res = await fetch('/api/admin/duplicates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: groupId,
          resolved_note: note,
          resolved_by: appUser?.email || appUser?.name,
        }),
      });

      if (res.ok) {
        setGroups(prev => prev.map(g =>
          g.id === groupId
            ? { ...g, resolved: true, resolved_by: appUser?.email, resolved_at: new Date().toISOString(), resolved_note: note }
            : g
        ));
        setUnresolvedCount(prev => prev - 1);
        setResolveModal(null);
      }
    } catch (err) {
      console.error('Failed to resolve:', err);
    } finally {
      setActionId(null);
    }
  };

  const handleUnresolve = async (groupId: number) => {
    setActionId(groupId);
    try {
      const res = await fetch('/api/admin/duplicates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId, unresolve: true }),
      });

      if (res.ok) {
        setGroups(prev => prev.map(g =>
          g.id === groupId
            ? { ...g, resolved: false, resolved_by: null, resolved_at: null, resolved_note: null }
            : g
        ));
        setUnresolvedCount(prev => prev + 1);
      }
    } catch (err) {
      console.error('Failed to unresolve:', err);
    } finally {
      setActionId(null);
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatMonth = (ym: string) => {
    const d = new Date(ym + '-01');
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  };

  const formatAmount = (amt: number) =>
    '$' + amt.toLocaleString('en-US', { minimumFractionDigits: 2 });

  const billLink = (billId: string) =>
    `https://appreciateinc.appfolio.com/accounting/payable_invoices/${billId}`;

  // Group by month for display
  const months = Array.from(new Set(groups.map(g => g.bill_month))).sort((a, b) => b.localeCompare(a));

  if (authLoading || (!authLoading && appUser?.role !== 'admin')) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Duplicate Bills</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Same vendor + amount + property + unit within the same month
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 bg-amber-500/15 text-amber-400 rounded">
              {unresolvedCount} unresolved
            </span>
            <span className="px-2 py-1 bg-slate-500/15 text-slate-400 rounded">
              {totalCount} total
            </span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="rounded bg-surface-overlay border-[var(--glass-border)] text-accent focus:ring-accent/30"
          />
          Show resolved
        </label>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      )}

      {/* Empty state */}
      {!loading && groups.length === 0 && (
        <div className="text-center py-20">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
          <p className="text-slate-300 text-sm">No duplicate bills found</p>
          <p className="text-slate-500 text-xs mt-1">All bills have been reviewed</p>
        </div>
      )}

      {/* Groups by month */}
      {!loading && months.map(month => {
        const monthGroups = groups.filter(g => g.bill_month === month);
        if (monthGroups.length === 0) return null;

        const unresolvedInMonth = monthGroups.filter(g => !g.resolved).length;

        return (
          <div key={month} className="mb-6">
            {/* Month header */}
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-slate-200">{formatMonth(month)}</h2>
              <span className="text-[10px] px-1.5 py-0.5 bg-white/5 text-slate-500 rounded">
                {monthGroups.length} group{monthGroups.length !== 1 ? 's' : ''}
                {unresolvedInMonth < monthGroups.length && ` (${unresolvedInMonth} unresolved)`}
              </span>
            </div>

            {/* Group cards */}
            <div className="space-y-2">
              {monthGroups.map(group => {
                const isExpanded = expandedIds.has(group.id);
                const isResolved = group.resolved;

                return (
                  <div
                    key={group.id}
                    className={`border rounded-lg transition-colors ${
                      isResolved
                        ? 'border-[var(--glass-border)] bg-white/[0.02] opacity-60'
                        : 'border-[var(--glass-border)] bg-surface-overlay/50 hover:border-[var(--glass-border-hover)]'
                    }`}
                  >
                    {/* Group header */}
                    <button
                      onClick={() => toggleExpand(group.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left"
                    >
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
                        : <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-200 truncate">{group.vendor_name}</span>
                          <span className="text-sm font-semibold text-amber-400">{formatAmount(group.amount)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-slate-500">{group.property || 'No property'}</span>
                          {group.unit && <span className="text-[11px] text-slate-500">Unit: {group.unit}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isResolved ? (
                          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-emerald-500/15 text-emerald-400 rounded">
                            <CheckCircle2 className="w-3 h-3" />
                            Resolved
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-amber-500/15 text-amber-400 rounded">
                            <AlertTriangle className="w-3 h-3" />
                            {group.dup_count} entries
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t border-[var(--glass-border)] px-4 py-3">
                        {/* Bills table */}
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-slate-500 border-b border-[var(--glass-border)] sticky top-0 z-10 bg-surface-overlay">
                              <th className="text-left py-1.5 pr-3 font-medium">Bill ID</th>
                              <th className="text-left py-1.5 pr-3 font-medium">Date</th>
                              <th className="text-left py-1.5 pr-3 font-medium">Bill #</th>
                              <th className="text-left py-1.5 pr-3 font-medium">Status</th>
                              <th className="text-left py-1.5 font-medium">Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.bills.map((bill, i) => (
                              <tr key={`${bill.bill_id}-${i}`} className="border-b border-white/[0.03] last:border-0">
                                <td className="py-2 pr-3">
                                  <a
                                    href={billLink(bill.bill_id)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-accent hover:text-accent-light"
                                  >
                                    {bill.bill_id}
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </td>
                                <td className="py-2 pr-3 text-slate-300">{bill.bill_date || '—'}</td>
                                <td className="py-2 pr-3 text-slate-400">{bill.bill_number || '—'}</td>
                                <td className="py-2 pr-3">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                    bill.status === 'Paid' ? 'bg-emerald-500/15 text-emerald-400' :
                                    bill.status === 'Unpaid' ? 'bg-amber-500/15 text-amber-400' :
                                    'bg-slate-500/15 text-slate-400'
                                  }`}>
                                    {bill.status || '—'}
                                  </span>
                                </td>
                                <td className="py-2 text-slate-400 max-w-xs truncate">{bill.description || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        {/* Resolved info or action buttons */}
                        <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.03]">
                          {isResolved ? (
                            <div className="flex items-center justify-between w-full">
                              <div className="text-[11px] text-slate-500">
                                Resolved by {group.resolved_by} on {new Date(group.resolved_at!).toLocaleDateString()}
                                {group.resolved_note && <span className="ml-2 text-slate-600">— {group.resolved_note}</span>}
                              </div>
                              <button
                                onClick={() => handleUnresolve(group.id)}
                                disabled={actionId === group.id}
                                className="flex items-center gap-1 text-xs px-2 py-1 bg-white/5 text-slate-400 rounded hover:bg-white/10 disabled:opacity-50"
                              >
                                <Undo2 className="w-3 h-3" />
                                {actionId === group.id ? '...' : 'Unresolve'}
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 ml-auto">
                              <button
                                onClick={() => setResolveModal({ group, note: '' })}
                                className="flex items-center gap-1 text-xs px-3 py-1.5 bg-emerald-500/15 text-emerald-400 rounded-lg hover:bg-emerald-500/25 transition-colors"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Resolve
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Resolve Modal */}
      {resolveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-card max-w-md w-full p-6 mx-4">
            <h3 className="text-sm font-semibold text-white mb-1">Resolve Duplicate Group</h3>
            <p className="text-xs text-slate-400 mb-4">
              {resolveModal.group.vendor_name} — {formatAmount(resolveModal.group.amount)} — {resolveModal.group.property}
            </p>
            <textarea
              value={resolveModal.note}
              onChange={(e) => setResolveModal(prev => prev ? { ...prev, note: e.target.value } : null)}
              placeholder="Optional note (e.g., 'Confirmed with vendor — separate invoices')"
              className="w-full px-3 py-2 text-xs bg-surface-overlay border border-[var(--glass-border)] rounded-lg text-slate-200 placeholder:text-slate-500 focus:border-accent focus:ring-1 focus:ring-accent/30 focus:outline-none resize-none h-20"
            />
            <div className="flex gap-3 mt-4 justify-end">
              <button
                onClick={() => setResolveModal(null)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleResolve(resolveModal.group.id, resolveModal.note)}
                disabled={actionId === resolveModal.group.id}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
              >
                {actionId === resolveModal.group.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                {actionId === resolveModal.group.id ? 'Resolving...' : 'Mark as Resolved'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
