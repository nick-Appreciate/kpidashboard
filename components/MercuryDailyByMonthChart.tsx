'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

// 12-colour palette — most recent month gets index 0 (solid line)
const MONTH_COLORS = [
  'rgb(56,189,248)',  'rgb(168,85,247)',  'rgb(251,146,60)',
  'rgb(52,211,153)',  'rgb(251,113,133)', 'rgb(250,204,21)',
  'rgb(147,51,234)',  'rgb(34,211,238)',  'rgb(244,114,182)',
  'rgb(163,230,53)',  'rgb(249,115,22)',  'rgb(99,102,241)',
];

/** Linear interpolation between sparse daily balance points.
 *  Does NOT extrapolate outside the first/last known point. */
function interpolate(
  points: { day: number; balance: number }[],
  allDays: number[],
): Record<number, number> {
  if (points.length === 0) return {};
  const known: Record<number, number> = {};
  points.forEach(p => { known[p.day] = p.balance; });
  const knownDays = points.map(p => p.day).sort((a, b) => a - b);
  const result: Record<number, number> = {};
  allDays.forEach(day => {
    if (known[day] !== undefined) { result[day] = known[day]; return; }
    let lo: number | null = null, hi: number | null = null;
    for (const kd of knownDays) {
      if (kd <= day) lo = kd;
      if (kd >= day && hi === null) hi = kd;
    }
    if (lo !== null && hi !== null && lo !== hi) {
      const ratio = (day - lo) / (hi - lo);
      result[day] = Math.round(known[lo] + ratio * (known[hi] - known[lo]));
    }
  });
  return result;
}

function formatCurrency(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${value < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${value < 0 ? '-' : ''}$${(abs / 1_000).toFixed(0)}k`;
  return `${value < 0 ? '-' : ''}$${abs.toFixed(0)}`;
}

export default function MercuryDailyByMonthChart() {
  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/admin/mercury/balances?days=400', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          setBalances(json.balances || []);
        }
      } catch (err) {
        console.error('MercuryDailyByMonthChart fetch error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Sum all account balances per day, group by month, most recent first
  const monthlyData = useMemo(() => {
    if (balances.length === 0) return [];

    const dailyTotals = new Map<string, number>();
    for (const row of balances) {
      const date = row.snapshot_date as string;
      // Skip the synthetic "Total Cash" rows to avoid double-counting
      if (row.account_name === 'Total Cash') continue;
      dailyTotals.set(date, (dailyTotals.get(date) || 0) + (Number(row.current_balance) || 0));
    }

    // If every account_name is "Total Cash" (edge case), fall back to using it
    if (dailyTotals.size === 0) {
      for (const row of balances) {
        if (row.account_name !== 'Total Cash') continue;
        const date = row.snapshot_date as string;
        dailyTotals.set(date, Number(row.current_balance) || 0);
      }
    }

    const monthMap = new Map<string, { day: number; balance: number }[]>();
    for (const [date, total] of Array.from(dailyTotals)) {
      const [y, m, d] = date.split('-');
      const key = `${y}-${m}`;
      const dayNum = parseInt(d, 10);
      if (!monthMap.has(key)) monthMap.set(key, []);
      monthMap.get(key)!.push({ day: dayNum, balance: total });
    }

    const sorted = Array.from(monthMap.keys()).sort((a, b) => b.localeCompare(a)); // newest first

    return sorted.map(key => {
      const [y, m] = key.split('-');
      const dt = new Date(parseInt(y), parseInt(m) - 1, 1);
      const label = dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      return { label, points: monthMap.get(key)!.sort((a, b) => a.day - b.day) };
    });
  }, [balances]);

  const { merged, visibleMonths, sortedDays } = useMemo(() => {
    const visible = monthlyData.filter(m => m.points.length > 0);
    const daySet = new Set<number>();
    visible.forEach(m => m.points.forEach(p => daySet.add(p.day)));
    const days = Array.from(daySet).sort((a, b) => a - b);
    const interpolated = visible.map(m => interpolate(m.points, days));
    const rows = days.map(day => {
      const row: Record<string, any> = { day };
      visible.forEach((_, idx) => {
        if (interpolated[idx][day] !== undefined) row[`b${idx}`] = interpolated[idx][day];
      });
      return row;
    });
    return { merged: rows, visibleMonths: visible, sortedDays: days };
  }, [monthlyData]);

  const todayDay = new Date().getDate();

  const DailyCashTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const sorted = [...payload].sort((a: any, b: any) =>
      parseInt(a.dataKey.slice(1)) - parseInt(b.dataKey.slice(1))
    );
    return (
      <div className="bg-[var(--surface-overlay)] border border-white/10 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[180px]">
        <p className="font-semibold text-slate-200 mb-1">Day {label}</p>
        {sorted.map((entry: any, i: number) => {
          const idx = parseInt(entry.dataKey.slice(1));
          return (
            <p key={i} style={{ color: entry.color }} className="flex justify-between gap-3 tabular-nums">
              <span>{visibleMonths[idx]?.label}</span>
              <span>{formatCurrency(entry.value)}</span>
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div className="glass-card p-6">
      <h3 className="text-lg font-semibold text-white mb-4">Daily Cash by Month</h3>

      {loading ? (
        <div className="flex items-center justify-center text-slate-500 text-sm h-64">
          Loading…
        </div>
      ) : visibleMonths.length === 0 ? (
        <div className="flex items-center justify-center text-slate-500 text-sm h-64">
          No balance data available.
        </div>
      ) : (
        <>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={merged} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 11 }} stroke="#334155" />
                <YAxis
                  tickFormatter={formatCurrency}
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  stroke="#334155"
                  width={70}
                />
                <Tooltip content={<DailyCashTooltip />} />
                <ReferenceLine
                  x={todayDay}
                  stroke="white"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  label={{ value: 'Today', fill: 'white', fontSize: 10, position: 'top' }}
                />
                {/* Render older months first so current month draws on top */}
                {[...visibleMonths].reverse().map((_, reversedIdx) => {
                  const idx = visibleMonths.length - 1 - reversedIdx;
                  const color = MONTH_COLORS[idx % MONTH_COLORS.length];
                  const isCurrent = idx === 0;
                  return (
                    <Line
                      key={`b${idx}`}
                      type="monotone"
                      dataKey={`b${idx}`}
                      stroke={color}
                      strokeWidth={isCurrent ? 3 : 1}
                      strokeDasharray={isCurrent ? undefined : '5 3'}
                      strokeOpacity={isCurrent ? 1 : 0.45}
                      dot={isCurrent ? { fill: color, r: 3, strokeWidth: 0 } : false}
                      activeDot={isCurrent ? { r: 6, strokeWidth: 0 } : { r: 3 }}
                      connectNulls
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-2 text-xs text-slate-400 justify-center flex-wrap">
            {visibleMonths.map((m, idx) => (
              <span key={idx} className={`flex items-center gap-1.5 ${idx === 0 ? 'text-white font-semibold' : ''}`}>
                <span
                  className="inline-block w-4 rounded"
                  style={{
                    backgroundColor: MONTH_COLORS[idx % MONTH_COLORS.length],
                    opacity: idx === 0 ? 1 : 0.5,
                    height: idx === 0 ? '2.5px' : '1.5px',
                  }}
                />
                {m.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 border-t-2 border-dashed border-white opacity-50" />
              Today
            </span>
          </div>
        </>
      )}
    </div>
  );
}
