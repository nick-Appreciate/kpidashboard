'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';

const TIME_RANGES = [
  { label: '3m', value: '3' },
  { label: '6m', value: '6' },
  { label: '1y', value: '12' },
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

export default function MercuryMonthOverMonthChart() {
  const [timeRange, setTimeRange] = useState('6');
  const [balances, setBalances] = useState<BalanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

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
    high: number;
    low: number;
    highDate: string;
    lowDate: string;
    accounts: { name: string; balance: number }[];
  }

  const chartData = useMemo((): ChartPoint[] => {
    const today = new Date();
    const dayOfMonth = today.getDate();

    const allByDate = new Map<string, BalanceRecord[]>();
    balances.forEach(b => {
      if (!allByDate.has(b.snapshot_date)) allByDate.set(b.snapshot_date, []);
      allByDate.get(b.snapshot_date)!.push(b);
    });

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

    const byMonth = new Map<string, string[]>();
    totalCashByDate.forEach((_, date) => {
      const ym = date.substring(0, 7);
      if (!byMonth.has(ym)) byMonth.set(ym, []);
      byMonth.get(ym)!.push(date);
    });

    const points: ChartPoint[] = [];
    byMonth.forEach((dates) => {
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

      let high = -Infinity;
      let low = Infinity;
      let highDate = '';
      let lowDate = '';
      dates.forEach(date => {
        const dayEntry = totalCashByDate.get(date)!;
        if (dayEntry.total > high) { high = dayEntry.total; highDate = date; }
        if (dayEntry.total < low) { low = dayEntry.total; lowDate = date; }
      });

      const d = new Date(bestDate + 'T12:00:00');
      points.push({
        date: bestDate,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        balance: entry.total,
        high,
        low,
        highDate,
        lowDate,
        accounts: entry.accounts,
      });
    });

    points.sort((a, b) => a.date.localeCompare(b.date));

    if (timeRange === 'custom') {
      if (customStart || customEnd) {
        return points.filter(p => {
          if (customStart && p.date < customStart) return false;
          if (customEnd && p.date > customEnd) return false;
          return true;
        });
      }
    } else if (timeRange !== 'all') {
      const months = parseInt(timeRange);
      const cutoff = new Date(today);
      cutoff.setMonth(cutoff.getMonth() - months);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      return points.filter(p => p.date >= cutoffStr);
    }

    return points;
  }, [balances, timeRange, customStart, customEnd]);

  const formatCurrency = (value: number) =>
    `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const formatTooltipCurrency = (value: number) =>
    `$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const shortName = (name: string) => {
    return name
      .replace(/^Mercury (Checking|Savings) /, '$1 ')
      .trim();
  };

  const formatDateLabel = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const dataPoint = chartData.find(d => d.date === label);
    if (!dataPoint) return null;
    const monthLabel = new Date(label + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'long', year: 'numeric',
    });
    return (
      <div className="bg-[var(--surface-overlay)] border border-white/10 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[220px]">
        <p className="font-medium text-slate-300 mb-1.5">{monthLabel}</p>
        <p className="flex justify-between gap-4 font-semibold text-indigo-400">
          <span>Snapshot ({formatDateLabel(dataPoint.date)})</span>
          <span>{formatTooltipCurrency(dataPoint.balance)}</span>
        </p>
        <p className="flex justify-between gap-4 font-semibold text-emerald-400 mt-0.5">
          <span>High ({formatDateLabel(dataPoint.highDate)})</span>
          <span>{formatTooltipCurrency(dataPoint.high)}</span>
        </p>
        <p className="flex justify-between gap-4 font-semibold text-rose-400 mt-0.5">
          <span>Low ({formatDateLabel(dataPoint.lowDate)})</span>
          <span>{formatTooltipCurrency(dataPoint.low)}</span>
        </p>
        <p className="flex justify-between gap-4 text-slate-500 mt-1 pt-1 border-t border-white/10">
          <span>Spread</span>
          <span>{formatTooltipCurrency(dataPoint.high - dataPoint.low)}</span>
        </p>
        {dataPoint.accounts.length > 0 && (
          <div className="space-y-0.5 mt-1.5 pt-1.5 border-t border-white/10">
            {dataPoint.accounts.map((acct, i) => (
              <p key={i} className={`flex justify-between gap-4 ${acct.balance < 0 ? 'text-red-400' : 'text-slate-400'}`}>
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
    <div className="glass-card p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Month-over-Month</h3>
          <p className="text-xs text-slate-400">
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

      {loading && chartData.length === 0 ? (
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: '3.5' }}>
          Loading balance data...
        </div>
      ) : chartData.length === 0 ? (
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: '3.5' }}>
          No month-over-month data available.
        </div>
      ) : (
        <div>
          <ResponsiveContainer width="100%" aspect={3.5}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => {
                  const dt = new Date(d + 'T12:00:00');
                  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                stroke="#334155"
              />
              <YAxis
                tickFormatter={formatCurrency}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                stroke="#334155"
                width={85}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
              <Line
                type="monotone"
                dataKey="high"
                name="Monthly High"
                stroke="#10b981"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                dot={{ r: 3, fill: '#10b981', strokeWidth: 1.5, stroke: '#1e293b' }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="balance"
                name="Snapshot"
                stroke="#6366f1"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#6366f1', strokeWidth: 2, stroke: '#1e293b' }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="low"
                name="Monthly Low"
                stroke="#f43f5e"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                dot={{ r: 3, fill: '#f43f5e', strokeWidth: 1.5, stroke: '#1e293b' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData.length > 0 && (
        <p className="text-xs text-slate-500 mt-2 text-center">
          Showing {chartData.length} month{chartData.length !== 1 ? 's' : ''} of data
        </p>
      )}
    </div>
  );
}
