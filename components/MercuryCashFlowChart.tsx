'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine, Cell,
} from 'recharts';

interface CashFlowPeriod {
  period_start: string;
  period_label: string;
  net: number;
  noi: number;
  operating_income: number;
  operating_expense: number;
  capex: number;
  owner_contributions: number;
  owner_distributions: number;
  other_other: number;
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

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload as CashFlowPeriod | undefined;
    if (!p) return null;
    return (
      <div className="bg-[var(--surface-overlay)] border border-white/10 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[260px]">
        <p className="font-medium text-slate-300 mb-1.5">{p.period_label}</p>
        <p className="flex justify-between gap-4 text-slate-300">
          <span>Operating income</span>
          <span className="tabular-nums">{formatCurrencyFull(p.operating_income)}</span>
        </p>
        <p className="flex justify-between gap-4 text-slate-400">
          <span>Operating expense</span>
          <span className="tabular-nums">-{formatCurrencyFull(p.operating_expense)}</span>
        </p>
        <p className={`flex justify-between gap-4 mt-0.5 pt-0.5 border-t border-white/5 ${p.noi >= 0 ? 'text-slate-200' : 'text-rose-300'}`}>
          <span>NOI</span>
          <span className="tabular-nums">{formatCurrencyFull(p.noi)}</span>
        </p>
        {(p.capex !== 0 || p.owner_contributions !== 0 || p.owner_distributions !== 0 || p.other_other !== 0) && (
          <div className="mt-1 pt-1 border-t border-white/10 space-y-0.5">
            <p className="text-slate-500 text-[10px] uppercase tracking-wide">Other items</p>
            {p.capex !== 0 && (
              <p className="flex justify-between gap-4 text-slate-400 text-[11px]">
                <span>CapEx (labor + materials)</span>
                <span className="tabular-nums">{formatCurrencyFull(p.capex)}</span>
              </p>
            )}
            {p.owner_contributions !== 0 && (
              <p className="flex justify-between gap-4 text-emerald-400 text-[11px]">
                <span>Owner contributions</span>
                <span className="tabular-nums">+{formatCurrencyFull(p.owner_contributions)}</span>
              </p>
            )}
            {p.owner_distributions !== 0 && (
              <p className="flex justify-between gap-4 text-rose-400 text-[11px]">
                <span>Owner distributions</span>
                <span className="tabular-nums">{formatCurrencyFull(p.owner_distributions)}</span>
              </p>
            )}
            {p.other_other !== 0 && (
              <p className="flex justify-between gap-4 text-slate-400 text-[11px]">
                <span>Other</span>
                <span className="tabular-nums">{formatCurrencyFull(p.other_other)}</span>
              </p>
            )}
          </div>
        )}
        <p className={`flex justify-between gap-4 mt-1.5 pt-1.5 border-t border-white/10 font-semibold ${p.net >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
          <span>Cash Flow (net)</span>
          <span className="tabular-nums">{p.net >= 0 ? '+' : '-'}{formatCurrencyFull(Math.abs(p.net))}</span>
        </p>
      </div>
    );
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Portfolio Cash Flow</h3>
          <p className="text-xs text-slate-400">
            Net cash flow per {period === 'quarter' ? 'quarter' : 'month'} from AppFolio
            (NOI + capex + owner equity, matches AppFolio&apos;s &quot;Cash Flow&quot; line)
          </p>
        </div>
      </div>

      {loading && periods.length === 0 ? (
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: 3 }}>
          Loading cash flow…
        </div>
      ) : periods.length === 0 ? (
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: 3 }}>
          No cash flow data available.
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
              <Bar dataKey="net" name="Cash Flow" radius={[3, 3, 0, 0]}>
                {periods.map((p, i) => (
                  <Cell key={i} fill={p.net >= 0 ? '#10b981' : '#f43f5e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-slate-500 mt-2">
            ⓘ Bars show the AppFolio &quot;Cash Flow&quot; line — NOI minus CapEx minus owner distributions plus owner contributions.
            Hover for the full breakdown. In-progress current {period === 'quarter' ? 'quarter' : 'month'} is excluded.
          </p>
        </>
      )}
    </div>
  );
}
