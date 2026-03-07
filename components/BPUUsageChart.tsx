'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { CHART_PALETTE } from '../lib/chartTheme';

interface DailyUsage {
  date: string;
  [meterLabel: string]: string | number;
}

interface Props {
  dailyUsage: DailyUsage[];
  timeRange: string;
  loading: boolean;
}

const TIME_RANGES = [
  { label: '7d', value: '7' },
  { label: '14d', value: '14' },
  { label: '30d', value: '30' },
  { label: '90d', value: '90' },
  { label: '1y', value: '365' },
  { label: 'All', value: 'all' },
];

export { TIME_RANGES };

export default function BPUUsageChart({ dailyUsage, timeRange, loading }: Props) {
  // Derive meter keys from data
  const meterKeys = useMemo(() => {
    const keys = new Set<string>();
    dailyUsage.forEach(row => {
      Object.keys(row).forEach(k => {
        if (k !== 'date') keys.add(k);
      });
    });
    // Sort by total usage descending
    return Array.from(keys).sort((a, b) => {
      const totalA = dailyUsage.reduce((s, r) => s + (Number(r[a]) || 0), 0);
      const totalB = dailyUsage.reduce((s, r) => s + (Number(r[b]) || 0), 0);
      return totalB - totalA;
    });
  }, [dailyUsage]);

  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-');
    if (timeRange === 'all' || parseInt(timeRange) > 90) {
      return `${parseInt(month)}/${parseInt(day)}/${year.slice(2)}`;
    }
    return `${parseInt(month)}/${parseInt(day)}`;
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const nonZero = payload.filter((p: any) => p.value > 0);
    if (!nonZero.length) return null;
    const dateLabel = new Date(label + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    const sorted = [...nonZero].sort((a: any, b: any) => b.value - a.value);
    return (
      <div className="bg-[var(--surface-overlay)] border border-white/10 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[180px]">
        <p className="font-medium text-slate-300 mb-1.5">{dateLabel}</p>
        {sorted.map((entry: any, i: number) => (
          <p key={i} className="flex justify-between gap-4" style={{ color: entry.color }}>
            <span className="truncate max-w-[120px]">{entry.name}</span>
            <span className="tabular-nums font-medium">{Number(entry.value).toFixed(2)} CCF</span>
          </p>
        ))}
        <p className="flex justify-between gap-4 border-t border-white/10 mt-1.5 pt-1.5 text-slate-300 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{sorted.reduce((s: number, e: any) => s + e.value, 0).toFixed(2)} CCF</span>
        </p>
      </div>
    );
  };

  if (loading && dailyUsage.length === 0) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: '3.5' }}>
          Loading usage data...
        </div>
      </div>
    );
  }

  if (dailyUsage.length === 0) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: '3.5' }}>
          No usage data available for this period.
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Usage Over Time</h3>
        {loading && <span className="text-xs text-slate-500">Refreshing...</span>}
      </div>

      <ResponsiveContainer width="100%" aspect={3.5}>
        <LineChart data={dailyUsage} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            stroke="#334155"
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            stroke="#334155"
            width={50}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
          {meterKeys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={key}
              stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
              strokeWidth={2}
              dot={dailyUsage.length < 60 ? { r: 2 } : false}
              activeDot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      <p className="text-xs text-slate-500 mt-2 text-center">
        Showing {dailyUsage.length} day{dailyUsage.length !== 1 ? 's' : ''} of usage data
        ({meterKeys.length} active meter{meterKeys.length !== 1 ? 's' : ''})
      </p>
    </div>
  );
}
