'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const ACCOUNT_COLORS: Record<string, string> = {
  'Mercury Checking ••6531': '#f59e0b',
  'Mercury Checking ••4109': '#3b82f6',
  'Mercury Savings ••0148': '#06b6d4',
  'Mercury Checking ••5740': '#8b5cf6',
};

const FALLBACK_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
];

const TIME_RANGES = [
  { label: '7d', value: '7' },
  { label: '14d', value: '14' },
  { label: '30d', value: '30' },
  { label: '60d', value: '60' },
  { label: '90d', value: '90' },
  { label: '6m', value: '180' },
  { label: '1y', value: '365' },
  { label: 'All', value: 'all' },
  { label: 'Custom', value: 'custom' },
];

interface BalanceRecord {
  snapshot_date: string;
  account_id: string;
  account_name: string;
  account_type: string | null;
  current_balance: number;
  available_balance: number | null;
}

type ViewMode = 'total' | 'individual';

// Short display names for cleaner legend
function shortName(name: string): string {
  return name
    .replace(/^Mercury (Checking|Savings) /, '$1 ')
    .trim();
}

export default function MercuryBalanceChart() {
  const [timeRange, setTimeRange] = useState('all');
  const [balances, setBalances] = useState<BalanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('total');
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const fetchBalances = useCallback(async () => {
    setLoading(true);
    try {
      const days = timeRange === 'custom' ? 'all' : timeRange;
      const res = await fetch(`/api/admin/mercury/balances?days=${days}`);
      if (res.ok) {
        const data = await res.json();
        setBalances(data.balances || []);
      }
    } catch (err) {
      console.error('Error fetching Mercury balances:', err);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchBalances();
    const interval = setInterval(fetchBalances, 60_000);
    return () => clearInterval(interval);
  }, [fetchBalances]);

  // Derive unique accounts — exclude "Total Cash" (used only for total view)
  const accounts = useMemo(() => {
    const accountMap = new Map<string, string>();
    balances.forEach(b => {
      if (b.account_name === 'Total Cash') return;
      accountMap.set(b.account_id, b.account_name);
    });
    return Array.from(accountMap.entries()).map(([id, name]) => ({ id, name }));
  }, [balances]);

  // Only show accounts with non-zero balance on their most recent date
  const activeAccounts = useMemo(() => {
    const latestBalance = new Map<string, number>();
    const latestDate = new Map<string, string>();

    balances.forEach(b => {
      if (b.account_name === 'Total Cash') return;
      const existing = latestDate.get(b.account_id);
      if (!existing || b.snapshot_date > existing) {
        latestDate.set(b.account_id, b.snapshot_date);
        latestBalance.set(b.account_id, Number(b.current_balance));
      }
    });

    return accounts.filter(a => {
      const bal = latestBalance.get(a.id);
      return bal !== undefined && bal !== 0;
    });
  }, [accounts, balances]);

  // Auto-select only active accounts on first load
  useEffect(() => {
    if (activeAccounts.length > 0 && selectedAccounts.size === 0) {
      setSelectedAccounts(new Set(activeAccounts.map(a => a.id)));
    }
  }, [activeAccounts, selectedAccounts.size]);

  const activeAccountIds = useMemo(
    () => new Set(activeAccounts.map(a => a.id)),
    [activeAccounts]
  );

  // Build chart data
  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, any>>();

    if (viewMode === 'total') {
      const entriesByDate = new Map<string, BalanceRecord[]>();
      balances.forEach(b => {
        if (!entriesByDate.has(b.snapshot_date)) entriesByDate.set(b.snapshot_date, []);
        entriesByDate.get(b.snapshot_date)!.push(b);
      });

      entriesByDate.forEach((entries, date) => {
        const totalRow = entries.find(e => e.account_name === 'Total Cash');
        const individualAccounts = entries
          .filter(e => e.account_name !== 'Total Cash')
          .map(e => ({ name: e.account_name, balance: Number(e.current_balance) }))
          .filter(a => a.balance !== 0)
          .sort((a, b) => b.balance - a.balance);
        const total = totalRow
          ? Number(totalRow.current_balance)
          : individualAccounts.reduce((sum, a) => sum + a.balance, 0);
        byDate.set(date, { date, 'Total Cash': total, _accounts: individualAccounts });
      });
    } else {
      balances.forEach(b => {
        if (b.account_name === 'Total Cash') return;
        if (!activeAccountIds.has(b.account_id)) return;
        if (!selectedAccounts.has(b.account_id)) return;
        const bal = Number(b.current_balance);
        if (bal === 0) return;
        if (!byDate.has(b.snapshot_date)) {
          byDate.set(b.snapshot_date, { date: b.snapshot_date });
        }
        byDate.get(b.snapshot_date)![b.account_name] = bal;
      });
    }

    let sorted = Array.from(byDate.values()).sort(
      (a, b) => a.date.localeCompare(b.date)
    );

    if (timeRange === 'custom' && (customStart || customEnd)) {
      sorted = sorted.filter(d => {
        if (customStart && d.date < customStart) return false;
        if (customEnd && d.date > customEnd) return false;
        return true;
      });
    }

    return sorted;
  }, [balances, viewMode, selectedAccounts, activeAccountIds, timeRange, customStart, customEnd]);

  const visibleAccounts = useMemo(
    () => activeAccounts.filter(a => selectedAccounts.has(a.id)),
    [activeAccounts, selectedAccounts]
  );

  const toggleAccount = (accountId: string) => {
    setSelectedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  };

  const selectActiveOnly = () => {
    setSelectedAccounts(new Set(activeAccounts.map(a => a.id)));
  };

  const getAccountColor = (name: string, index: number) => {
    return ACCOUNT_COLORS[name] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  };

  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-');
    if (timeRange === 'all' || timeRange === 'custom' || parseInt(timeRange) > 90) {
      return `${parseInt(month)}/${parseInt(day)}/${year.slice(2)}`;
    }
    return `${parseInt(month)}/${parseInt(day)}`;
  };

  const formatCurrency = (value: number) =>
    `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const formatTooltipCurrency = (value: number) =>
    `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const formatAbsCurrency = (value: number) =>
    `$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const nonZero = payload.filter((p: any) => p.value !== 0 && p.value !== undefined && p.value !== null);
    if (!nonZero.length) return null;
    const dateLabel = new Date(label + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
    const dataPoint = chartData.find(d => d.date === label);
    const accountBreakdown: { name: string; balance: number }[] = dataPoint?._accounts || [];
    return (
      <div className="bg-[var(--surface-overlay)] border border-white/10 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[220px]">
        <p className="font-medium text-slate-300 mb-1">{dateLabel}</p>
        {nonZero.map((entry: any, i: number) => (
          <p key={i} style={{ color: entry.color }} className={`flex justify-between gap-4 font-semibold ${accountBreakdown.length > 0 ? 'border-b border-white/10 pb-1.5 mb-1.5' : ''}`}>
            <span>{entry.name}</span>
            <span>{formatTooltipCurrency(Number(entry.value))}</span>
          </p>
        ))}
        {accountBreakdown.length > 0 && (
          <div className="space-y-0.5">
            {accountBreakdown.map((acct, i) => (
              <p key={i} className={`flex justify-between gap-4 ${acct.balance < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                <span className="truncate max-w-[160px]">{shortName(acct.name)}</span>
                <span className="tabular-nums shrink-0">
                  {acct.balance < 0 ? '-' : ''}{formatAbsCurrency(acct.balance)}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="glass-card p-6 mb-6">
      {/* Header */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Account Balances</h3>
          <div className="flex items-center gap-1.5">
            {TIME_RANGES.map((t) => (
              <button
                key={t.value}
                onClick={() => setTimeRange(t.value)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  timeRange === t.value
                    ? 'bg-accent/15 text-accent'
                    : 'text-slate-500 hover:bg-white/10 hover:text-slate-300'
                }`}
              >
                {t.label}
              </button>
            ))}
            {timeRange === 'custom' && (
              <div className="flex items-center gap-1.5 ml-1">
                <input
                  type="date"
                  value={customStart}
                  onChange={e => setCustomStart(e.target.value)}
                  className="dark-input text-xs px-2 py-1"
                />
                <span className="text-xs text-slate-500">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)}
                  className="dark-input text-xs px-2 py-1"
                />
              </div>
            )}
          </div>
        </div>

        {/* View toggle + account picker */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-white/10 overflow-hidden">
              <button
                onClick={() => setViewMode('total')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === 'total'
                    ? 'bg-accent text-[var(--surface-base)]'
                    : 'bg-white/5 text-slate-400 hover:bg-white/10'
                }`}
              >
                Total Cash
              </button>
              <button
                onClick={() => setViewMode('individual')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-white/10 ${
                  viewMode === 'individual'
                    ? 'bg-accent text-[var(--surface-base)]'
                    : 'bg-white/5 text-slate-400 hover:bg-white/10'
                }`}
              >
                By Account
              </button>
            </div>

            {viewMode === 'individual' && (
              <div className="relative">
                <button
                  onClick={() => setShowAccountPicker(!showAccountPicker)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 transition-colors flex items-center gap-1"
                >
                  <span>
                    {selectedAccounts.size === activeAccounts.length
                      ? 'All accounts'
                      : `${selectedAccounts.size} account${selectedAccounts.size !== 1 ? 's' : ''}`}
                  </span>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showAccountPicker && (
                  <div className="absolute top-full left-0 mt-1 w-72 bg-[var(--surface-overlay)] border border-white/10 rounded-lg shadow-lg z-50 py-1">
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/10">
                      <button
                        onClick={selectActiveOnly}
                        className="text-xs text-accent hover:text-accent-light font-medium"
                      >
                        All
                      </button>
                      <span className="text-slate-600">|</span>
                      <button
                        onClick={() => setSelectedAccounts(new Set())}
                        className="text-xs text-accent hover:text-accent-light font-medium"
                      >
                        None
                      </button>
                    </div>
                    {activeAccounts.map((acct, i) => (
                      <label
                        key={acct.id}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedAccounts.has(acct.id)}
                          onChange={() => toggleAccount(acct.id)}
                          className="rounded border-white/20 bg-white/5 text-accent focus:ring-accent/50"
                        />
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: getAccountColor(acct.name, i) }}
                        />
                        <span className="text-xs text-slate-300 truncate">
                          {shortName(acct.name)}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {loading && (
            <span className="text-xs text-slate-500">Refreshing...</span>
          )}
        </div>
      </div>

      {/* Close picker overlay */}
      {showAccountPicker && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowAccountPicker(false)}
        />
      )}

      {loading && chartData.length === 0 ? (
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: '3.5' }}>
          Loading balance data...
        </div>
      ) : chartData.length === 0 ? (
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: '3.5' }}>
          {viewMode === 'individual' && selectedAccounts.size === 0
            ? 'Select at least one account to view.'
            : 'No balance data available.'}
        </div>
      ) : (
        <div>
          <ResponsiveContainer width="100%" aspect={3.5}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                stroke="#334155"
                interval={timeRange === 'all' || timeRange === 'custom' || parseInt(timeRange) > 90 ? 'preserveStartEnd' : undefined}
              />
              <YAxis
                tickFormatter={formatCurrency}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                stroke="#334155"
                width={85}
              />
              <Tooltip content={<CustomTooltip />} />
              {viewMode === 'individual' && <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />}

              {viewMode === 'total' ? (
                <Line
                  type="monotone"
                  dataKey="Total Cash"
                  name="Total Cash"
                  stroke="#22c55e"
                  strokeWidth={2.5}
                  dot={chartData.length < 100 ? { r: 2 } : false}
                  activeDot={{ r: 5 }}
                />
              ) : (
                visibleAccounts.map((acct, i) => (
                  <Line
                    key={acct.id}
                    type="monotone"
                    dataKey={acct.name}
                    name={shortName(acct.name)}
                    stroke={getAccountColor(acct.name, i)}
                    strokeWidth={2}
                    dot={chartData.length < 100 ? { r: 2 } : false}
                    activeDot={{ r: 5 }}
                  />
                ))
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData.length > 0 && (
        <p className="text-xs text-slate-500 mt-2 text-center">
          Showing {chartData.length} day{chartData.length !== 1 ? 's' : ''} of balance data
          {viewMode === 'individual' && ` (${visibleAccounts.length} account${visibleAccounts.length !== 1 ? 's' : ''})`}
        </p>
      )}
    </div>
  );
}
