'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const ACCOUNT_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#8b5cf6', // purple
  '#ef4444', // red
  '#06b6d4', // cyan
];

interface BalanceRecord {
  snapshot_date: string;
  account_id: string;
  account_name: string;
  account_type: string | null;
  current_balance: number;
  available_balance: number | null;
}

export default function MercuryBalanceChart({ refreshKey = 0 }: { refreshKey?: number }) {
  const [timeRange, setTimeRange] = useState('30');
  const [balances, setBalances] = useState<BalanceRecord[]>([]);
  const [loading, setLoading] = useState(false);

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
  }, [timeRange, refreshKey]);

  // Derive unique accounts and pivot data for Recharts
  const { accounts, chartData } = useMemo(() => {
    const accountMap = new Map<string, string>();
    balances.forEach(b => accountMap.set(b.account_id, b.account_name));
    const accounts = Array.from(accountMap.entries()).map(
      ([id, name]) => ({ id, name })
    );

    // Group by date, one key per account name
    const byDate = new Map<string, Record<string, any>>();
    balances.forEach(b => {
      if (!byDate.has(b.snapshot_date)) {
        byDate.set(b.snapshot_date, { date: b.snapshot_date });
      }
      byDate.get(b.snapshot_date)![b.account_name] = Number(b.current_balance);
    });

    // Compute "Total" line if multiple accounts
    if (accounts.length > 1) {
      byDate.forEach((point) => {
        let total = 0;
        accounts.forEach(a => { total += point[a.name] || 0; });
        point['Total'] = total;
      });
    }

    const chartData = Array.from(byDate.values()).sort(
      (a, b) => a.date.localeCompare(b.date)
    );

    return { accounts, chartData };
  }, [balances]);

  const formatDate = (dateStr: string) => {
    const [, month, day] = dateStr.split('-');
    return `${parseInt(month)}/${parseInt(day)}`;
  };

  const formatCurrency = (value: number) =>
    `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const formatTooltipCurrency = (value: number) =>
    `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">Account Balances</h3>
        <div className="flex items-center gap-2">
          {['7', '14', '30', '60', '90'].map((d) => (
            <button
              key={d}
              onClick={() => setTimeRange(d)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                timeRange === d
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && chartData.length === 0 ? (
        <div className="h-72 flex items-center justify-center text-gray-400 text-sm">
          Loading balance data...
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-72 flex items-center justify-center text-gray-400 text-sm">
          No balance data yet. Click "Sync Now" to log today's balances.
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
                    weekday: 'short', month: 'short', day: 'numeric',
                  })
                }
                formatter={(value: number, name: string) => [formatTooltipCurrency(value), name]}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {/* Total line (dashed, bold) — only when multiple accounts */}
              {accounts.length > 1 && (
                <Line
                  type="monotone"
                  dataKey="Total"
                  name="Total"
                  stroke="#1e293b"
                  strokeWidth={2.5}
                  strokeDasharray="5 5"
                  dot={{ r: 2 }}
                  activeDot={{ r: 5 }}
                />
              )}
              {/* Individual account lines */}
              {accounts.map((acct, i) => (
                <Line
                  key={acct.id}
                  type="monotone"
                  dataKey={acct.name}
                  name={acct.name}
                  stroke={ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData.length > 0 && (
        <p className="text-xs text-gray-500 mt-2 text-center">
          Showing {chartData.length} day{chartData.length !== 1 ? 's' : ''} of balance data
        </p>
      )}
    </div>
  );
}
