'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const ACCOUNT_COLORS: Record<string, string> = {
  'Mercury (Column N.A.)-Corporate Checking': '#3b82f6',
  'Mercury (Column N.A.)-Columbia Properties': '#22c55e',
  'Mercury (Column N.A.)-KC Operating Acct': '#f59e0b',
  'Mercury(Column N.A.)-KC Security Deposits': '#8b5cf6',
  'Mercury(Column N.A.)-CoMo Security Deposits': '#06b6d4',
  'Simmons - Columbia Operating Account 5218': '#ef4444',
  'Como Security Deposits - Simmons Checking 3505 -': '#ec4899',
  'Mercury Checking (3241) - Columbia Properties Operating Account': '#14b8a6',
  'Mercury Checking (7828) - KC Operating Account [closed]': '#a3a3a3',
  'Mercury Checking (7980) - Corporate Checking - DL Account [closed]': '#d4d4d4',
  'Simmons - KC Operating (1552) [closed]': '#737373',
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
  const map: Record<string, string> = {
    'Mercury (Column N.A.)-Corporate Checking': 'Corporate Checking',
    'Mercury (Column N.A.)-Columbia Properties': 'Columbia Properties',
    'Mercury (Column N.A.)-KC Operating Acct': 'KC Operating',
    'Mercury(Column N.A.)-KC Security Deposits': 'KC Security Deposits',
    'Mercury(Column N.A.)-CoMo Security Deposits': 'CoMo Security Deposits',
    'Simmons - Columbia Operating Account 5218': 'Simmons Columbia 5218',
    'Como Security Deposits - Simmons Checking 3505 -': 'Simmons CoMo 3505',
    'Mercury Checking (3241) - Columbia Properties Operating Account': 'Mercury 3241 (Columbia)',
    'Mercury Checking (7828) - KC Operating Account [closed]': 'Mercury 7828 [closed]',
    'Mercury Checking (7980) - Corporate Checking - DL Account [closed]': 'Mercury 7980 [closed]',
    'Simmons - KC Operating (1552) [closed]': 'Simmons KC [closed]',
  };
  return map[name] || name;
}

export default function MercuryBalanceChart({ refreshKey = 0 }: { refreshKey?: number }) {
  const [timeRange, setTimeRange] = useState('30');
  const [balances, setBalances] = useState<BalanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('total');
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  const fetchBalances = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/mercury/balances?days=${timeRange}`);
      if (res.ok) {
        const data = await res.json();
        setBalances(data.balances || []);
      }
    } catch (err) {
      console.error('Error fetching Mercury balances:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalances();
    const interval = setInterval(fetchBalances, 60_000);
    return () => clearInterval(interval);
  }, [timeRange, refreshKey]);

  // Derive unique accounts (exclude pre-computed "Total Cash" from CSV)
  const accounts = useMemo(() => {
    const accountMap = new Map<string, string>();
    balances.forEach(b => {
      if (b.account_name !== 'Total Cash') {
        accountMap.set(b.account_id, b.account_name);
      }
    });
    return Array.from(accountMap.entries()).map(([id, name]) => ({ id, name }));
  }, [balances]);

  // Auto-select all accounts when data first loads
  useEffect(() => {
    if (accounts.length > 0 && selectedAccounts.size === 0) {
      setSelectedAccounts(new Set(accounts.map(a => a.id)));
    }
  }, [accounts]);

  // Filter out accounts that are always 0 in the current data range
  const activeAccounts = useMemo(() => {
    const accountTotals = new Map<string, number>();
    balances.forEach(b => {
      if (b.account_name !== 'Total Cash') {
        const current = accountTotals.get(b.account_id) || 0;
        accountTotals.set(b.account_id, current + Math.abs(Number(b.current_balance)));
      }
    });
    return accounts.filter(a => (accountTotals.get(a.id) || 0) > 0);
  }, [accounts, balances]);

  // Build chart data based on view mode
  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, any>>();

    // Only include non-"Total Cash" rows
    const filtered = balances.filter(b => b.account_name !== 'Total Cash');

    if (viewMode === 'total') {
      // Single "Total" line — sum of all accounts per date
      filtered.forEach(b => {
        if (!byDate.has(b.snapshot_date)) {
          byDate.set(b.snapshot_date, { date: b.snapshot_date, Total: 0 });
        }
        byDate.get(b.snapshot_date)!.Total += Number(b.current_balance);
      });
    } else {
      // Individual account lines — only selected accounts
      filtered.forEach(b => {
        if (!selectedAccounts.has(b.account_id)) return;
        if (!byDate.has(b.snapshot_date)) {
          byDate.set(b.snapshot_date, { date: b.snapshot_date });
        }
        byDate.get(b.snapshot_date)![b.account_name] = Number(b.current_balance);
      });
    }

    return Array.from(byDate.values()).sort(
      (a, b) => a.date.localeCompare(b.date)
    );
  }, [balances, viewMode, selectedAccounts]);

  const visibleAccounts = useMemo(() => {
    return accounts.filter(a => selectedAccounts.has(a.id));
  }, [accounts, selectedAccounts]);

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

  const selectAllAccounts = () => {
    setSelectedAccounts(new Set(accounts.map(a => a.id)));
  };

  const selectActiveOnly = () => {
    setSelectedAccounts(new Set(activeAccounts.map(a => a.id)));
  };

  const getAccountColor = (name: string, index: number) => {
    return ACCOUNT_COLORS[name] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  };

  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-');
    if (timeRange === 'all' || parseInt(timeRange) > 90) {
      return `${parseInt(month)}/${parseInt(day)}/${year.slice(2)}`;
    }
    return `${parseInt(month)}/${parseInt(day)}`;
  };

  const formatCurrency = (value: number) =>
    `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const formatTooltipCurrency = (value: number) =>
    `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      {/* Header with view mode toggle and time range selector */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-800">Account Balances</h3>
          <div className="flex items-center gap-1.5">
            {TIME_RANGES.map((t) => (
              <button
                key={t.value}
                onClick={() => setTimeRange(t.value)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  timeRange === t.value
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* View mode toggle + account picker */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
              <button
                onClick={() => setViewMode('total')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === 'total'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Total
              </button>
              <button
                onClick={() => setViewMode('individual')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-200 ${
                  viewMode === 'individual'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                By Account
              </button>
            </div>

            {viewMode === 'individual' && (
              <div className="relative">
                <button
                  onClick={() => setShowAccountPicker(!showAccountPicker)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1"
                >
                  <span>
                    {selectedAccounts.size === accounts.length
                      ? 'All accounts'
                      : `${selectedAccounts.size} account${selectedAccounts.size !== 1 ? 's' : ''}`}
                  </span>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showAccountPicker && (
                  <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-100">
                      <button
                        onClick={selectAllAccounts}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        All
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={selectActiveOnly}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        Active only
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={() => setSelectedAccounts(new Set())}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        None
                      </button>
                    </div>
                    {accounts.map((acct, i) => {
                      const isActive = activeAccounts.some(a => a.id === acct.id);
                      return (
                        <label
                          key={acct.id}
                          className={`flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer ${
                            !isActive ? 'opacity-50' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedAccounts.has(acct.id)}
                            onChange={() => toggleAccount(acct.id)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: getAccountColor(acct.name, i) }}
                          />
                          <span className="text-xs text-gray-700 truncate">
                            {shortName(acct.name)}
                            {!isActive && ' (inactive)'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {loading && (
            <span className="text-xs text-gray-400">Refreshing...</span>
          )}
        </div>
      </div>

      {/* Close account picker when clicking elsewhere */}
      {showAccountPicker && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowAccountPicker(false)}
        />
      )}

      {loading && chartData.length === 0 ? (
        <div className="h-72 flex items-center justify-center text-gray-400 text-sm">
          Loading balance data...
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-72 flex items-center justify-center text-gray-400 text-sm">
          {viewMode === 'individual' && selectedAccounts.size === 0
            ? 'Select at least one account to view.'
            : 'No balance data yet. Click "Sync Now" to log today\'s balances.'}
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
                interval={timeRange === 'all' || parseInt(timeRange) > 90 ? 'preserveStartEnd' : undefined}
              />
              <YAxis
                tickFormatter={formatCurrency}
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
                width={85}
              />
              <Tooltip
                labelFormatter={(label) =>
                  new Date(label + 'T12:00:00').toLocaleDateString('en-US', {
                    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                  })
                }
                formatter={(value: number, name: string) => [formatTooltipCurrency(value), name]}
                contentStyle={{ fontSize: 12 }}
              />
              {viewMode === 'individual' && <Legend wrapperStyle={{ fontSize: 11 }} />}

              {viewMode === 'total' ? (
                <Line
                  type="monotone"
                  dataKey="Total"
                  name="Total"
                  stroke="#3b82f6"
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
        <p className="text-xs text-gray-500 mt-2 text-center">
          Showing {chartData.length} day{chartData.length !== 1 ? 's' : ''} of balance data
          {viewMode === 'total' ? ' (all accounts combined)' : ` (${visibleAccounts.length} account${visibleAccounts.length !== 1 ? 's' : ''})`}
        </p>
      )}
    </div>
  );
}
