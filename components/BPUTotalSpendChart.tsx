'use client';

import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

interface DailyCost {
  date: string;
  [meterLabel: string]: string | number;
}

interface Props {
  dailyCost: DailyCost[];
  timeRange: string;
  loading: boolean;
}

export default function BPUTotalSpendChart({ dailyCost, timeRange, loading }: Props) {
  // Roll per-meter daily entries into a single total-per-day series.
  const totals = useMemo(() => {
    return dailyCost.map(row => {
      let total = 0;
      for (const k of Object.keys(row)) {
        if (k === 'date') continue;
        const v = Number(row[k]);
        if (!Number.isNaN(v)) total += v;
      }
      return { date: row.date, total: Math.round(total * 100) / 100 };
    });
  }, [dailyCost]);

  const periodTotal = useMemo(
    () => totals.reduce((s, r) => s + r.total, 0),
    [totals],
  );

  const dailyAvg = totals.length > 0 ? periodTotal / totals.length : 0;

  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-');
    if (timeRange === 'all' || parseInt(timeRange) > 90) {
      return `${parseInt(month)}/${parseInt(day)}/${year.slice(2)}`;
    }
    return `${parseInt(month)}/${parseInt(day)}`;
  };

  const formatCurrency = (n: number) =>
    '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const v = payload[0].value ?? 0;
    return (
      <div className="bg-slate-900/95 border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl backdrop-blur">
        <p className="text-slate-300 font-medium mb-1">{label}</p>
        <p className="text-cyan-400 tabular-nums">
          {'$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>
    );
  };

  return (
    <div className="glass-card">
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Daily Utilities Spend</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Total portfolio cost per day across all meters.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Period total</p>
          <p className="text-lg font-semibold text-cyan-400 tabular-nums">
            {formatCurrency(periodTotal)}
          </p>
          {totals.length > 0 && (
            <p className="text-[10px] text-slate-500 tabular-nums">
              avg {formatCurrency(dailyAvg)}/day
            </p>
          )}
        </div>
      </div>

      <div className="p-4">
        {loading && totals.length === 0 ? (
          <div className="h-72 flex items-center justify-center text-slate-500 text-xs">
            Loading…
          </div>
        ) : totals.length === 0 ? (
          <div className="h-72 flex items-center justify-center text-slate-500 text-xs">
            No data in range.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={288}>
            <AreaChart data={totals} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="totalSpendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={formatDate}
                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={(v: number) => '$' + v.toLocaleString('en-US')}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="total"
                stroke="#06b6d4"
                strokeWidth={2}
                fill="url(#totalSpendFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
