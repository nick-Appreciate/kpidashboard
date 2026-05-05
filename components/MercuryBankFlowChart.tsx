'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ComposedChart, Line, ReferenceLine,
} from 'recharts';

interface BankFlowPeriod {
  period_start: string;
  period_label: string;
  mercury_in: number;
  mercury_out: number;
  simmons_in: number;
  cash_in: number;
  cash_out: number;
  net: number;
}

interface Coverage {
  mercury_first: string | null;
  mercury_last: string | null;
  simmons_first: string | null;
  simmons_last: string | null;
  note: string;
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

export default function MercuryBankFlowChart({ period }: Props) {
  const [periods, setPeriods] = useState<BankFlowPeriod[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/cash/bank-flow?period=${period}&months=24`);
      if (res.ok) {
        const j = await res.json();
        setPeriods(j.periods || []);
        setCoverage(j.coverage || null);
      }
    } catch (err) {
      console.error('Error fetching bank flow:', err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const chartData = useMemo(
    () => periods.map(p => ({
      ...p,
      cash_out_neg: -p.cash_out,
    })),
    [periods],
  );

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload as (BankFlowPeriod & { cash_out_neg: number }) | undefined;
    if (!p) return null;
    return (
      <div className="bg-[var(--surface-overlay)] border border-white/10 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[220px]">
        <p className="font-medium text-slate-300 mb-1.5">{p.period_label}</p>
        <p className="flex justify-between gap-4 text-emerald-400">
          <span>Cash in</span>
          <span className="tabular-nums">{formatCurrencyFull(p.cash_in)}</span>
        </p>
        <div className="ml-3 space-y-0.5">
          <p className="flex justify-between gap-4 text-slate-500 text-[11px]">
            <span>· Mercury</span>
            <span className="tabular-nums">{formatCurrencyFull(p.mercury_in)}</span>
          </p>
          <p className="flex justify-between gap-4 text-slate-500 text-[11px]">
            <span>· Simmons</span>
            <span className="tabular-nums">{formatCurrencyFull(p.simmons_in)}</span>
          </p>
        </div>
        <p className="flex justify-between gap-4 text-rose-400 mt-1">
          <span>Cash out</span>
          <span className="tabular-nums">-{formatCurrencyFull(p.cash_out)}</span>
        </p>
        <p className="ml-3 flex justify-between gap-4 text-slate-500 text-[11px]">
          <span>· Mercury</span>
          <span className="tabular-nums">-{formatCurrencyFull(p.mercury_out)}</span>
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
          <h3 className="text-lg font-semibold text-white">Banking Cash In / Out / Net</h3>
          <p className="text-xs text-slate-400">
            Real bank flows per {period === 'quarter' ? 'quarter' : 'month'}: Mercury transactions + Simmons deposits
          </p>
        </div>
      </div>

      {loading && chartData.length === 0 ? (
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: 3 }}>
          Loading bank flow…
        </div>
      ) : chartData.length === 0 ? (
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: 3 }}>
          No bank flow data available.
        </div>
      ) : (
        <>
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
              <Bar dataKey="simmons_in" name="Simmons in" stackId="in" fill="#34d399" radius={[3, 3, 0, 0]} />
              <Bar dataKey="mercury_in" name="Mercury in" stackId="in" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="cash_out_neg" name="Mercury out" fill="#f43f5e" radius={[0, 0, 3, 3]} />
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
          <p className="text-[11px] text-slate-500 mt-2">
            ⓘ Mercury transactions cover {coverage?.mercury_first ?? '—'} → {coverage?.mercury_last ?? '—'};
            Simmons deposits cover {coverage?.simmons_first ?? '—'} → {coverage?.simmons_last ?? '—'}.
            Simmons withdrawals are not yet scraped, so periods outside the Mercury window show inflows only.
          </p>
        </>
      )}
    </div>
  );
}
