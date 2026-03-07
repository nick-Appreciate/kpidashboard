'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { CHART_PALETTE } from '../lib/chartTheme';

interface Props {
  baselineDeviation: any[];
  timeRange: string;
  loading: boolean;
}

export default function BPUBaselineChart({ baselineDeviation, timeRange, loading }: Props) {
  const meterKeys = useMemo(() => {
    const keys = new Set<string>();
    baselineDeviation.forEach(row => {
      Object.keys(row).forEach(k => {
        if (k !== 'date') keys.add(k);
      });
    });
    // Sort by max deviation descending (most anomalous first)
    return Array.from(keys).sort((a, b) => {
      const maxA = baselineDeviation.reduce((m, r) => Math.max(m, Number(r[a]) || 0), 0);
      const maxB = baselineDeviation.reduce((m, r) => Math.max(m, Number(r[b]) || 0), 0);
      return maxB - maxA;
    });
  }, [baselineDeviation]);

  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-');
    if (timeRange === 'all' || parseInt(timeRange) > 90) {
      return `${parseInt(month)}/${parseInt(day)}/${year.slice(2)}`;
    }
    return `${parseInt(month)}/${parseInt(day)}`;
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const dateLabel = new Date(label + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    // Show entries sorted by deviation, highlight those above threshold
    const sorted = [...payload].sort((a: any, b: any) => b.value - a.value);
    const aboveBaseline = sorted.filter((p: any) => p.value > 1.5);
    const rest = sorted.filter((p: any) => p.value <= 1.5);
    return (
      <div className="bg-[var(--surface-overlay)] border border-white/10 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[200px]">
        <p className="font-medium text-slate-300 mb-1.5">{dateLabel}</p>
        {aboveBaseline.map((entry: any, i: number) => (
          <p key={i} className="flex justify-between gap-4 text-rose-400 font-medium">
            <span className="truncate max-w-[130px]">{entry.name}</span>
            <span className="tabular-nums">{Number(entry.value).toFixed(2)}x</span>
          </p>
        ))}
        {rest.length > 0 && aboveBaseline.length > 0 && (
          <div className="border-t border-white/10 my-1" />
        )}
        {rest.slice(0, 5).map((entry: any, i: number) => (
          <p key={i} className="flex justify-between gap-4" style={{ color: entry.color }}>
            <span className="truncate max-w-[130px]">{entry.name}</span>
            <span className="tabular-nums">{Number(entry.value).toFixed(2)}x</span>
          </p>
        ))}
        {rest.length > 5 && (
          <p className="text-slate-500 mt-0.5">+{rest.length - 5} more</p>
        )}
      </div>
    );
  };

  if (loading && baselineDeviation.length === 0) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: '3.5' }}>
          Loading baseline data...
        </div>
      </div>
    );
  }

  if (baselineDeviation.length === 0) return null;

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Baseline Deviation</h3>
          <p className="text-xs text-slate-500 mt-0.5">1.0 = median daily usage per meter. Values above indicate elevated usage.</p>
        </div>
        {loading && <span className="text-xs text-slate-500">Refreshing...</span>}
      </div>

      <ResponsiveContainer width="100%" aspect={3.5}>
        <LineChart data={baselineDeviation} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
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
            width={40}
            tickFormatter={(v: number) => `${v.toFixed(1)}x`}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={1}
            stroke="#fbbf24"
            strokeWidth={2}
            strokeDasharray="6 3"
            label={{ value: 'baseline', fill: '#fbbf24', fontSize: 10, position: 'right' }}
          />
          {meterKeys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={key}
              stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
              strokeWidth={2}
              dot={baselineDeviation.length < 60 ? { r: 2 } : false}
              activeDot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
