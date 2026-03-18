'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Search, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { LogoLoader } from './Logo';
import DarkSelect from './DarkSelect';
import { useAuth } from '../contexts/AuthContext';
import useSWR from 'swr';
import { fetcher } from '../lib/swr';

interface WorkOrder {
  id: number;
  work_order_id: number;
  work_order_number: string;
  service_request_number: string | null;
  service_request_description: string | null;
  job_description: string | null;
  work_order_issue: string | null;
  instructions: string | null;
  status_notes: string | null;
  status: string;
  priority: string;
  work_order_type: string | null;
  property_name: string;
  property_id: number;
  unit_name: string | null;
  unit_id: number | null;
  primary_tenant: string | null;
  requesting_tenant: string | null;
  submitted_by_tenant: boolean;
  vendor: string | null;
  vendor_id: number | null;
  vendor_trade: string | null;
  assigned_user: string | null;
  created_at: string;
  created_by: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  completed_on: string | null;
  canceled_on: string | null;
  amount: number | null;
  vendor_bill_id: string | null;
  vendor_bill_amount: number | null;
  tenant_total_charge_amount: number | null;
  recurring: boolean;
  similarity?: number;
  bill?: {
    bill_id: string;
    vendor_name: string;
    amount: number;
    gl_account_name: string;
    memo: string;
    status: string;
    paid_date: string | null;
  } | null;
}

const STATUS_COLORS: Record<string, string> = {
  'Completed': 'bg-emerald-500/20 text-emerald-300',
  'Completed No Need To Bill': 'bg-emerald-500/10 text-emerald-400/70',
  'Scheduled': 'bg-amber-500/20 text-amber-300',
  'New': 'bg-blue-500/20 text-blue-300',
  'Assigned': 'bg-violet-500/20 text-violet-300',
  'Work Done': 'bg-teal-500/20 text-teal-300',
  'Canceled': 'bg-slate-500/20 text-slate-400',
};

const PRIORITY_COLORS: Record<string, string> = {
  'Emergency': 'bg-red-500/20 text-red-300',
  'Urgent': 'bg-amber-500/20 text-amber-300',
  'Normal': 'bg-slate-500/15 text-slate-400',
};

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d + (d.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function truncate(s: string | null, len: number): string {
  if (!s) return '—';
  return s.length > len ? s.slice(0, len) + '…' : s;
}

export default function WorkOrdersDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Build list URL with filters
  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (propertyFilter !== 'all') params.set('property', propertyFilter);
    if (priorityFilter !== 'all') params.set('priority', priorityFilter);
    const qs = params.toString();
    return `/api/work-orders${qs ? '?' + qs : ''}`;
  }, [statusFilter, propertyFilter, priorityFilter]);

  // Fetch list data
  const { data: listData, error: listError, isLoading: listLoading, mutate } = useSWR(
    appUser ? listUrl : null,
    fetcher,
    { dedupingInterval: 30000 }
  );

  // Fetch search results (only when there's a query)
  const searchUrl = debouncedQuery.trim()
    ? `/api/work-orders/search?q=${encodeURIComponent(debouncedQuery.trim())}`
    : null;

  const { data: searchData, error: searchError, isLoading: searchLoading } = useSWR(
    appUser && searchUrl ? searchUrl : null,
    fetcher,
    { dedupingInterval: 10000 }
  );

  const isSearching = debouncedQuery.trim().length > 0;
  const workOrders: WorkOrder[] = isSearching
    ? (searchData?.results || [])
    : (listData?.workOrders || []);
  const filters = listData?.filters;
  const statusCounts = listData?.statusCounts || {};

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Loading state
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LogoLoader />
      </div>
    );
  }

  const totalCount = listData?.workOrders?.length || 0;

  return (
    <div className="max-w-[1400px] mx-auto space-y-4">
      {/* Header */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-semibold text-white">Work Orders</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {totalCount} work orders from Appfolio
              {Object.keys(statusCounts).length > 0 && (
                <span className="ml-2">
                  {Object.entries(statusCounts).map(([s, c]) => (
                    <span key={s} className="inline-flex items-center mr-2">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[s] || 'bg-slate-500/20 text-slate-400'}`}>
                        {s}: {c as number}
                      </span>
                    </span>
                  ))}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => mutate()}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Search bar */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Semantic search work orders... (e.g. toilet leak, broken window, HVAC not working)"
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-slate-500 text-sm focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition-all"
          />
          {searchLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <DarkSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: 'All Statuses' },
              ...(filters?.statuses || []).map((s: string) => ({ value: s, label: s })),
            ]}
            compact
          />
          <DarkSelect
            value={propertyFilter}
            onChange={setPropertyFilter}
            options={[
              { value: 'all', label: 'All Properties' },
              ...(filters?.properties || []).map((p: string) => ({ value: p, label: p })),
            ]}
            compact
            searchable
          />
          <DarkSelect
            value={priorityFilter}
            onChange={setPriorityFilter}
            options={[
              { value: 'all', label: 'All Priorities' },
              ...(filters?.priorities || []).map((p: string) => ({ value: p, label: p })),
            ]}
            compact
          />
          {isSearching && (
            <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-sm">
              {searchData?.results?.length ?? '…'} semantic results
            </span>
          )}
        </div>
      </div>

      {/* Error states */}
      {(listError || searchError) && (
        <div className="glass-card p-4 border border-red-500/30">
          <p className="text-red-400 text-sm">{listError?.message || searchError?.message || 'Failed to load work orders'}</p>
        </div>
      )}

      {/* Results table */}
      <div className="glass-card overflow-hidden">
        {listLoading && !listData ? (
          <div className="flex items-center justify-center h-48">
            <LogoLoader />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="dark-thead sticky top-0 z-10">
                <tr className="text-left text-slate-400 text-xs uppercase tracking-wider">
                  <th className="px-3 py-3 w-8"></th>
                  <th className="px-3 py-3">WO #</th>
                  <th className="px-3 py-3">Property</th>
                  <th className="px-3 py-3">Unit</th>
                  <th className="px-3 py-3">Issue</th>
                  <th className="px-3 py-3 min-w-[200px]">Description</th>
                  <th className="px-3 py-3">Vendor</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Priority</th>
                  <th className="px-3 py-3 text-right">Amount</th>
                  <th className="px-3 py-3">Created</th>
                  {isSearching && <th className="px-3 py-3 text-right">Match</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {workOrders.length === 0 ? (
                  <tr>
                    <td colSpan={isSearching ? 12 : 11} className="px-3 py-12 text-center text-slate-500">
                      {isSearching ? 'No matching work orders found. Try a different search.' : 'No work orders found.'}
                    </td>
                  </tr>
                ) : (
                  workOrders.map((wo) => {
                    const isExpanded = expandedIds.has(wo.id);
                    return (
                      <React.Fragment key={wo.id}>
                        <tr
                          onClick={() => toggleExpand(wo.id)}
                          className="hover:bg-white/[0.03] cursor-pointer transition-colors"
                        >
                          <td className="px-3 py-2.5 text-slate-500">
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </td>
                          <td className="px-3 py-2.5 text-white font-mono text-xs">{wo.work_order_number}</td>
                          <td className="px-3 py-2.5 text-slate-300">{wo.property_name}</td>
                          <td className="px-3 py-2.5 text-slate-400">{wo.unit_name || '—'}</td>
                          <td className="px-3 py-2.5 text-slate-300">{wo.work_order_issue || '—'}</td>
                          <td className="px-3 py-2.5 text-slate-400">{truncate(wo.job_description, 60)}</td>
                          <td className="px-3 py-2.5 text-slate-300">{wo.vendor || '—'}</td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[wo.status] || 'bg-slate-500/20 text-slate-400'}`}>
                              {wo.status}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[wo.priority] || 'bg-slate-500/15 text-slate-400'}`}>
                              {wo.priority}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-300 font-mono text-xs">
                            {wo.amount ? `$${Number(wo.amount).toFixed(2)}` : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-slate-400 text-xs">{formatDate(wo.created_at)}</td>
                          {isSearching && (
                            <td className="px-3 py-2.5 text-right">
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-mono bg-accent/10 text-accent">
                                {wo.similarity ? (wo.similarity * 100).toFixed(0) + '%' : '—'}
                              </span>
                            </td>
                          )}
                        </tr>
                        {isExpanded && (
                          <tr className="bg-white/[0.02]">
                            <td colSpan={isSearching ? 12 : 11} className="px-6 py-4">
                              <ExpandedDetails wo={wo} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ExpandedDetails({ wo }: { wo: WorkOrder }) {
  return (
    <div className="grid grid-cols-2 gap-6 text-sm">
      {/* Left: Details */}
      <div className="space-y-3">
        <div>
          <span className="text-slate-500 text-xs uppercase tracking-wider">Full Description</span>
          <p className="text-slate-300 mt-1 whitespace-pre-wrap">{wo.job_description || '—'}</p>
        </div>
        {wo.service_request_description && wo.service_request_description !== wo.job_description && (
          <div>
            <span className="text-slate-500 text-xs uppercase tracking-wider">Service Request</span>
            <p className="text-slate-300 mt-1 whitespace-pre-wrap">{wo.service_request_description}</p>
          </div>
        )}
        {wo.instructions && (
          <div>
            <span className="text-slate-500 text-xs uppercase tracking-wider">Instructions</span>
            <p className="text-slate-300 mt-1 whitespace-pre-wrap">{wo.instructions}</p>
          </div>
        )}
        {wo.status_notes && (
          <div>
            <span className="text-slate-500 text-xs uppercase tracking-wider">Status Notes</span>
            <p className="text-slate-300 mt-1 whitespace-pre-wrap">{wo.status_notes}</p>
          </div>
        )}
      </div>

      {/* Right: Meta & Financials */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-slate-500">Type</span>
            <p className="text-slate-300">{wo.work_order_type || '—'}</p>
          </div>
          <div>
            <span className="text-slate-500">Assigned To</span>
            <p className="text-slate-300">{wo.assigned_user || '—'}</p>
          </div>
          <div>
            <span className="text-slate-500">Created By</span>
            <p className="text-slate-300">{wo.created_by || '—'}</p>
          </div>
          <div>
            <span className="text-slate-500">Vendor Trade</span>
            <p className="text-slate-300">{wo.vendor_trade || '—'}</p>
          </div>
          <div>
            <span className="text-slate-500">Tenant</span>
            <p className="text-slate-300">{wo.primary_tenant || wo.requesting_tenant || '—'}</p>
          </div>
          <div>
            <span className="text-slate-500">Submitted by Tenant</span>
            <p className="text-slate-300">{wo.submitted_by_tenant ? 'Yes' : 'No'}</p>
          </div>
          {wo.scheduled_start && (
            <div>
              <span className="text-slate-500">Scheduled</span>
              <p className="text-slate-300">{formatDate(wo.scheduled_start)}</p>
            </div>
          )}
          {wo.completed_on && (
            <div>
              <span className="text-slate-500">Completed</span>
              <p className="text-slate-300">{formatDate(wo.completed_on)}</p>
            </div>
          )}
          {wo.canceled_on && (
            <div>
              <span className="text-slate-500">Canceled</span>
              <p className="text-slate-300">{formatDate(wo.canceled_on)}</p>
            </div>
          )}
        </div>

        {/* Bill linkage */}
        {wo.bill && (
          <div className="mt-3 p-3 rounded-lg bg-white/[0.03] border border-white/5">
            <span className="text-slate-500 text-xs uppercase tracking-wider">Linked Bill</span>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div>
                <span className="text-slate-500">Bill #</span>
                <p className="text-slate-300">{wo.vendor_bill_id}</p>
              </div>
              <div>
                <span className="text-slate-500">Bill Amount</span>
                <p className="text-slate-300">${Number(wo.bill.amount).toFixed(2)}</p>
              </div>
              <div>
                <span className="text-slate-500">GL Account</span>
                <p className="text-slate-300">{wo.bill.gl_account_name}</p>
              </div>
              <div>
                <span className="text-slate-500">Bill Status</span>
                <p className="text-slate-300">{wo.bill.status}{wo.bill.paid_date ? ` (${formatDate(wo.bill.paid_date)})` : ''}</p>
              </div>
              {wo.bill.memo && (
                <div className="col-span-2">
                  <span className="text-slate-500">Memo</span>
                  <p className="text-slate-300">{wo.bill.memo}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Financial summary if no bill but has amounts */}
        {!wo.bill && (wo.vendor_bill_amount || wo.tenant_total_charge_amount) && (
          <div className="mt-3 p-3 rounded-lg bg-white/[0.03] border border-white/5">
            <span className="text-slate-500 text-xs uppercase tracking-wider">Financials</span>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              {wo.vendor_bill_amount && (
                <div>
                  <span className="text-slate-500">Vendor Bill</span>
                  <p className="text-slate-300">${Number(wo.vendor_bill_amount).toFixed(2)}</p>
                </div>
              )}
              {wo.tenant_total_charge_amount && (
                <div>
                  <span className="text-slate-500">Tenant Charge</span>
                  <p className="text-slate-300">${Number(wo.tenant_total_charge_amount).toFixed(2)}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
