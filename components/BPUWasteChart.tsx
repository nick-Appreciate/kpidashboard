'use client';

import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { WASTE_PALETTE } from '../lib/chartTheme';

interface Props {
  dailyWaste: any[];
  timeRange: string;
  loading: boolean;
}

export default function BPUWasteChart({ dailyWaste, timeRange, loading }: Props) {
  const meterKeys = useMemo(() => {
    const keys = new Set<string>();
    dailyWaste.forEach(row => {
      Object.keys(row).forEach(k => {
        if (k !== 'date') keys.add(k);
      });
    });
    // Sort by total waste descending (worst offenders first)
    return Array.from(keys).sort((a, b) => {
      const totalA = dailyWaste.reduce((s, r) => s + (Number(r[a]) || 0), 0);
      const totalB = dailyWaste.reduce((s, r) => s + (Number(r[b]) || 0), 0);
      return totalB - totalA;
    });
  }, [dailyWaste]);

  const periodTotal = useMemo(() => {
    let total = 0;
    dailyWaste.forEach(row => {
      Object.keys(row).forEach(k => {
        if (k !== 'date') total += Number(row[k]) || 0;
      });
    });
    return total;
  }, [dailyWaste]);

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
            <span className="tabular-nums font-medium">${Number(entry.value).toFixed(2)}</span>
          </p>
        ))}
        <p className="flex justify-between gap-4 border-t border-white/10 mt-1.5 pt-1.5 text-slate-300 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">${sorted.reduce((s: number, e: any) => s + e.value, 0).toFixed(2)}</span>
        </p>
      </div>
    );
  };

  if (loading && dailyWaste.length === 0) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: '3.5' }}>
          Loading waste data...
        </div>
      </div>
    );
  }

  if (dailyWaste.length === 0) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: '3.5' }}>
          No estimated waste detected for this period.
        </div>
      </div>
    );
  }

  const days = parseInt(timeRange);
  const hasHourlyData = timeRange !== 'all' && !isNaN(days) && days <= 90;

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Estimated Waste</h3>
          <p className="text-xs text-slate-500 mt-0.5">Daily estimated cost of leaks and excess usage</p>
        </div>
        {loading && <span className="text-xs text-slate-500">Refreshing...</span>}
      </div>

      <ResponsiveContainer width="100%" aspect={3.5}>
        <AreaChart data={dailyWaste} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
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
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
          />
          <Tooltip content={<CustomTooltip />} />
          {meterKeys.map((key, i) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={key}
              stroke={WASTE_PALETTE[i % WASTE_PALETTE.length]}
              fill={WASTE_PALETTE[i % WASTE_PALETTE.length]}
              fillOpacity={0.15}
              strokeWidth={2}
              dot={dailyWaste.length < 60 ? { r: 2 } : false}
              activeDot={{ r: 4 }}
              connectNulls
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>

      <div className="text-xs text-slate-500 mt-2 text-center">
        <span>Estimated waste: <span className="text-rose-400 font-medium">${periodTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> over {dailyWaste.length} day{dailyWaste.length !== 1 ? 's' : ''}</span>
        {!hasHourlyData && (
          <span className="ml-2 text-slate-600">&#8226; Overnight leak detection requires hourly data (≤90d)</span>
        )}
      </div>
    </div>
  );
}
