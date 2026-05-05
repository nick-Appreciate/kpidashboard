'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ComposedChart, Line, ReferenceLine,
} from 'recharts';

interface CashFlowPeriod {
  period_start: string;
  period_label: string;
  cash_in: number;
  cash_out: number;
  net: number;
}

function formatCurrencyShort(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatCurrencyFull(value: number) {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

interface Props {
  period: 'month' | 'quarter';
}

export default function MercuryCashFlowChart({ period }: Props) {
  const [periods, setPeriods] = useState<CashFlowPeriod[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/cash/flow?period=${period}&months=24`);
      if (res.ok) {
        const j = await res.json();
        setPeriods(j.periods || []);
      }
    } catch (err) {
      console.error('Error fetching cash flow:', err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // For the bars, plot cash_out as a NEGATIVE value so it visually drops
  // below the axis. Tooltip shows the raw positive amount.
  const chartData = useMemo(
    () => periods.map(p => ({
      ...p,
      cash_out_neg: -p.cash_out,
    })),
    [periods],
  );

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload as (CashFlowPeriod & { cash_out_neg: number }) | undefined;
    if (!p) return null;
    return (
      <div className="bg-[var(--surface-overlay)] border border-white/10 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[200px]">
        <p className="font-medium text-slate-300 mb-1.5">{p.period_label}</p>
        <p className="flex justify-between gap-4 text-emerald-400">
          <span>Cash in</span>
          <span className="tabular-nums">{formatCurrencyFull(p.cash_in)}</span>
        </p>
        <p className="flex justify-between gap-4 text-rose-400">
          <span>Cash out</span>
          <span className="tabular-nums">-{formatCurrencyFull(p.cash_out)}</span>
        </p>
        <p className={`flex justify-between gap-4 mt-1 pt-1 border-t border-white/10 font-semibold ${p.net >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
          <span>Net</span>
          <span className="tabular-nums">{p.net >= 0 ? '' : '-'}{formatCurrencyFull(Math.abs(p.net))}</span>
        </p>
      </div>
    );
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Cash In / Out / Net</h3>
          <p className="text-xs text-slate-400">
            Portfolio cash flow per {period === 'quarter' ? 'quarter' : 'month'} from AppFolio
          </p>
        </div>
      </div>

      {loading && chartData.length === 0 ? (
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: 3 }}>
          Loading cash flow…
        </div>
      ) : chartData.length === 0 ? (
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: 3 }}>
          No cash flow data available.
        </div>
      ) : (
        <ResponsiveContainer width="100%" aspect={3}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }} stackOffset="sign">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="period_label"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              stroke="#334155"
            />
            <YAxis
              tickFormatter={formatCurrencyShort}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              stroke="#334155"
              width={70}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
            <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
            <Bar dataKey="cash_in" name="Cash in" fill="#10b981" radius={[3, 3, 0, 0]} />
            <Bar dataKey="cash_out_neg" name="Cash out" fill="#f43f5e" radius={[0, 0, 3, 3]} />
            <Line
              type="monotone"
              dataKey="net"
              name="Net"
              stroke="#6366f1"
              strokeWidth={2.5}
              dot={{ r: 4, fill: '#6366f1', strokeWidth: 2, stroke: '#1e293b' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
