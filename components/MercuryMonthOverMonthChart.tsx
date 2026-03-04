'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts';

const TIME_RANGES = [
  { label: '3m', value: '3' },
  { label: '6m', value: '6' },
  { label: '1y', value: '12' },
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

export default function MercuryMonthOverMonthChart() {
  const [timeRange, setTimeRange] = useState('6');
  const [balances, setBalances] = useState<BalanceRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchBalances = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/mercury/balances?days=all');
      if (res.ok) {
        const data = await res.json();
        setBalances(data.balances || []);
      }
    } catch (err) {
      console.error('Error fetching Mercury balances:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBalances();
    const interval = setInterval(fetchBalances, 60_000);
    return () => clearInterval(interval);
  }, [fetchBalances]);

  interface ChartPoint {
    date: string;
    label: string;
    balance: number;
    accounts: { name: string; balance: number }[];
  }

  const chartData = useMemo((): ChartPoint[] => {
    const today = new Date();
    const dayOfMonth = today.getDate();

    // Group all balance records by date
    const allByDate = new Map<string, BalanceRecord[]>();
    balances.forEach(b => {
      if (!allByDate.has(b.snapshot_date)) allByDate.set(b.snapshot_date, []);
      allByDate.get(b.snapshot_date)!.push(b);
    });

    // Build total cash entries with account breakdowns
    const totalCashByDate = new Map<string, { total: number; accounts: { name: string; balance: number }[] }>();
    allByDate.forEach((entries, date) => {
      const totalRow = entries.find(e => e.account_name === 'Total Cash');
      const individualAccounts = entries
        .filter(e => e.account_name !== 'Total Cash')
        .map(e => ({ name: e.account_name, balance: Number(e.current_balance) }))
        .filter(a => a.balance !== 0)
        .sort((a, b) => b.balance - a.balance);
      const total = totalRow
        ? Number(totalRow.current_balance)
        : individualAccounts.reduce((sum, a) => sum + a.balance, 0);
      totalCashByDate.set(date, { total, accounts: individualAccounts });
    });

    if (totalCashByDate.size === 0) return [];

    // Group by year-month, pick best date per month
    const byMonth = new Map<string, string[]>();
    totalCashByDate.forEach((_, date) => {
      const ym = date.substring(0, 7);
      if (!byMonth.has(ym)) byMonth.set(ym, []);
      byMonth.get(ym)!.push(date);
    });

    const points: ChartPoint[] = [];
    byMonth.forEach((dates) => {
      // Prefer exact match on dayOfMonth, fall back to closest
      let bestDate = dates[0];
      const exactMatch = dates.find(d => parseInt(d.split('-')[2]) === dayOfMonth);
      if (exactMatch) {
        bestDate = exactMatch;
      } else {
        let bestDiff = Math.abs(parseInt(bestDate.split('-')[2]) - dayOfMonth);
        dates.forEach(d => {
          const diff = Math.abs(parseInt(d.split('-')[2]) - dayOfMonth);
          if (diff < bestDiff) { bestDate = d; bestDiff = diff; }
        });
      }
      const entry = totalCashByDate.get(bestDate)!;
      const d = new Date(bestDate + 'T12:00:00');
      points.push({
        date: bestDate,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        balance: entry.total,
        accounts: entry.accounts,
      });
    });

    points.sort((a, b) => a.date.localeCompare(b.date));

    // Apply time range filter
    if (timeRange !== 'all') {
      const months = parseInt(timeRange);
      const cutoff = new Date(today);
      cutoff.setMonth(cutoff.getMonth() - months);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      return points.filter(p => p.date >= cutoffStr);
    }

    return points;
  }, [balances, timeRange]);

  const formatCurrency = (value: number) =>
    `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const formatTooltipCurrency = (value: number) =>
    `$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Shorten long Mercury account names for the tooltip
  const shortName = (name: string) => {
    return name
      .replace(/^Mercury \(Column N\.A\.\)-?/, '')
      .replace(/^Mercury\(Column N\.A\.\)-?/, '')
      .replace(/^Mercury (Checking|Savings) /, '$1 ')
      .replace(/^Simmons - /, '')
      .replace(/^Como Security Deposits - Simmons Checking \d+ -/, 'Simmons CoMo SD')
      .replace(/ Operating Account$/, '')
      .replace(/ \[closed\]$/, '')
      .trim() || name;
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const point = payload[0];
    const dataPoint = chartData.find(d => d.date === label);
    const dateLabel = new Date(label + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[200px]">
        <p className="font-medium text-gray-700 mb-1.5">{dateLabel}</p>
        <p style={{ color: point.color }} className="flex justify-between gap-4 font-semibold border-b border-gray-100 pb-1.5 mb-1.5">
          <span>Total Cash</span>
          <span>{formatTooltipCurrency(Number(point.value))}</span>
        </p>
        {dataPoint?.accounts && dataPoint.accounts.length > 0 && (
          <div className="space-y-0.5">
            {dataPoint.accounts.map((acct, i) => (
              <p key={i} className={`flex justify-between gap-4 ${acct.balance < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                <span className="truncate max-w-[160px]">{shortName(acct.name)}</span>
                <span className="tabular-nums shrink-0">
                  {acct.balance < 0 ? '-' : ''}{formatTooltipCurrency(acct.balance)}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
    );
  };

  const today = new Date();
  const dayOfMonth = today.getDate();
  const suffix = dayOfMonth === 1 ? 'st' : dayOfMonth === 2 ? 'nd' : dayOfMonth === 3 ? 'rd' : 'th';

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Month-over-Month</h3>
          <p className="text-xs text-gray-500">
            Total cash on the {dayOfMonth}{suffix} of each month
          </p>
        </div>
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

      {loading && chartData.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
          Loading balance data...
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
          No month-over-month data available.
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => {
                  const dt = new Date(d + 'T12:00:00');
                  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }}
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
              />
              <YAxis
                tickFormatter={formatCurrency}
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
                width={85}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="balance"
                name="Total Cash"
                stroke="#6366f1"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#6366f1', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData.length > 0 && (
        <p className="text-xs text-gray-500 mt-2 text-center">
          Showing {chartData.length} month{chartData.length !== 1 ? 's' : ''} of data
        </p>
      )}
    </div>
  );
}
