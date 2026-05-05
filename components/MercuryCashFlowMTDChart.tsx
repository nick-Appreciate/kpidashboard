'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine, Cell,
} from 'recharts';

interface MTDPeriod {
  period_start: string;
  period_label: string;
  operating_income: number;
  operating_expense: number;
  capex: number;
  noi: number;
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

function ordinalSuffix(n: number) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

export default function MercuryCashFlowMTDChart() {
  const [periods, setPeriods] = useState<MTDPeriod[]>([]);
  const [dayOfMonth, setDayOfMonth] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/cash/flow-mtd?months=12');
      if (res.ok) {
        const j = await res.json();
        setPeriods(j.periods || []);
        setDayOfMonth(j.day_of_month || 0);
      }
    } catch (err) {
      console.error('Error fetching MTD comparison:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload as MTDPeriod | undefined;
    if (!p) return null;
    const d = new Date(p.period_start + 'T12:00:00');
    const dayLabel = `${d.toLocaleDateString('en-US', { month: 'short' })} ${dayOfMonth}, ${d.getFullYear()}`;
    return (
      <div className="bg-[var(--surface-overlay)] border border-white/10 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[240px]">
        <p className="font-medium text-slate-300 mb-1.5">
          {p.period_label}
          <span className="ml-2 text-slate-500 font-normal">(thru {dayLabel})</span>
        </p>
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
        {p.capex !== 0 && (
          <p className="flex justify-between gap-4 mt-0.5 text-slate-400">
            <span>CapEx</span>
            <span className="tabular-nums">{formatCurrencyFull(p.capex)}</span>
          </p>
        )}
        <p className={`flex justify-between gap-4 mt-1.5 pt-1.5 border-t border-white/10 font-semibold ${p.net >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
          <span>Net (after CapEx)</span>
          <span className="tabular-nums">{p.net >= 0 ? '+' : '-'}{formatCurrencyFull(Math.abs(p.net))}</span>
        </p>
      </div>
    );
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">MTD Comparison</h3>
          <p className="text-xs text-slate-400">
            {dayOfMonth > 0 ? (
              <>Each month&apos;s cash flow as of the {dayOfMonth}{ordinalSuffix(dayOfMonth)} — apples-to-apples MTD vs prior months</>
            ) : (
              'Each month\'s cash flow at today\'s day-of-month'
            )}
          </p>
        </div>
      </div>

      {loading && periods.length === 0 ? (
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: 3 }}>
          Loading MTD comparison…
        </div>
      ) : periods.length === 0 ? (
        <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: 3 }}>
          No data available.
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
              <Bar dataKey="net" name="Cash Flow MTD" radius={[3, 3, 0, 0]}>
                {periods.map((p, i) => (
                  <Cell key={i} fill={p.net >= 0 ? '#10b981' : '#f43f5e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-slate-500 mt-2">
            ⓘ Each bar shows what cash flow looked like {dayOfMonth} day{dayOfMonth === 1 ? '' : 's'} into that month —
            so you can spot whether this month is tracking ahead or behind prior months at the same point.
          </p>
        </>
      )}
    </div>
  );
}
