'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine, Cell,
} from 'recharts';

interface BankFlowPeriod {
  period_start: string;
  period_label: string;
  opening: number;
  closing: number;
  net: number;
  mercury_in: number | null;
  mercury_out: number | null;
  simmons_in: number | null;
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
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/cash/bank-flow?period=${period}&months=24`);
      if (res.ok) {
        const j = await res.json();
        setPeriods(j.periods || []);
      }
    } catch (err) {
      console.error('Error fetching bank flow:', err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload as BankFlowPeriod | undefined;
    if (!p) return null;
    const hasDetail = p.mercury_in !== null || p.simmons_in !== null;
    return (
      <div className="bg-[var(--surface-overlay)] border border-white/10 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[220px]">
        <p className="font-medium text-slate-300 mb-1.5">{p.period_label}</p>
        <p className="flex justify-between gap-4 text-slate-500">
          <span>Opening</span>
          <span className="tabular-nums">{formatCurrencyFull(p.opening)}</span>
        </p>
        <p className="flex justify-between gap-4 text-slate-500">
          <span>Closing</span>
          <span className="tabular-nums">{formatCurrencyFull(p.closing)}</span>
        </p>
        <p className={`flex justify-between gap-4 mt-1 pt-1 border-t border-white/10 font-semibold ${p.net >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
          <span>Net change</span>
          <span className="tabular-nums">{p.net >= 0 ? '+' : '-'}{formatCurrencyFull(Math.abs(p.net))}</span>
        </p>
        {hasDetail && (
          <div className="mt-1.5 pt-1.5 border-t border-white/10 space-y-0.5">
            <p className="text-slate-500 text-[10px] uppercase tracking-wide">Transaction detail (where available)</p>
            {p.mercury_in !== null && (
              <p className="flex justify-between gap-4 text-emerald-400 text-[11px]">
                <span>Mercury inflows</span>
                <span className="tabular-nums">{formatCurrencyFull(p.mercury_in)}</span>
              </p>
            )}
            {p.mercury_out !== null && (
              <p className="flex justify-between gap-4 text-rose-400 text-[11px]">
                <span>Mercury outflows</span>
                <span className="tabular-nums">-{formatCurrencyFull(p.mercury_out)}</span>
              </p>
            )}
            {p.simmons_in !== null && (
              <p className="flex justify-between gap-4 text-emerald-400 text-[11px]">
                <span>Simmons deposits</span>
                <span className="tabular-nums">{formatCurrencyFull(p.simmons_in)}</span>
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Banking Net Cash Flow</h3>
          <p className="text-xs text-slate-400">
            {period === 'quarter' ? 'Quarterly' : 'Monthly'} change in total bank cash (Mercury + Simmons), from end-of-period balance deltas
          </p>
        </div>
      </div>

      {loading && periods.length === 0 ? (
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: 3 }}>
          Loading bank flow…
        </div>
      ) : periods.length === 0 ? (
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: 3 }}>
          No bank flow data available.
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" aspect={3}>
            <BarChart data={periods} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
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
              <Bar dataKey="net" name="Net cash change" radius={[3, 3, 0, 0]}>
                {periods.map((p, i) => (
                  <Cell key={i} fill={p.net >= 0 ? '#10b981' : '#f43f5e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-slate-500 mt-2">
            ⓘ Net = total bank balance at period end − at prior period end. Tooltip shows transaction detail when available
            (Mercury transactions ~1 month back; Simmons deposit history ~18 months back).
          </p>
        </>
      )}
    </div>
  );
}
