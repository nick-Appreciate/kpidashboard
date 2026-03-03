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

  const chartData = useMemo(() => {
    const today = new Date();
    const dayOfMonth = today.getDate();

    // Filter to "Total Cash" entries only
    const totalCashEntries = balances
      .filter(b => b.account_name === 'Total Cash')
      .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

    if (totalCashEntries.length === 0) return [];

    // Group entries by year-month
    const byMonth = new Map<string, BalanceRecord[]>();
    totalCashEntries.forEach(b => {
      const ym = b.snapshot_date.substring(0, 7); // "2025-06"
      if (!byMonth.has(ym)) byMonth.set(ym, []);
      byMonth.get(ym)!.push(b);
    });

    // For each month, find the entry closest to today's day-of-month
    const points: { date: string; label: string; balance: number }[] = [];
    byMonth.forEach((entries, ym) => {
      // Find closest day to dayOfMonth
      let best = entries[0];
      let bestDiff = Math.abs(parseInt(best.snapshot_date.split('-')[2]) - dayOfMonth);
      entries.forEach(e => {
        const day = parseInt(e.snapshot_date.split('-')[2]);
        const diff = Math.abs(day - dayOfMonth);
        if (diff < bestDiff) {
          best = e;
          bestDiff = diff;
        }
      });
      const d = new Date(best.snapshot_date + 'T12:00:00');
      points.push({
        date: best.snapshot_date,
        label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        balance: Number(best.current_balance),
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

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const point = payload[0];
    const dateLabel = new Date(label + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
        <p className="font-medium text-gray-700 mb-1">{dateLabel}</p>
        <p style={{ color: point.color }} className="flex justify-between gap-4">
          <span>Total Cash</span>
          <span className="font-medium">
            ${Number(point.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </p>
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
                  return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
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
