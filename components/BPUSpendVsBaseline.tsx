'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface SpendVsBaselineRow {
  meter: string;
  label: string;
  address: string;
  name: string;
  accountNumber: string;
  currentSpend: number;
  currentCcf: number;
  baselineSpend: number | null;
  baselineDailyCcf: number | null;
  changePct: number | null;
  priorDays: number;
  windowDays: number;
}

interface Props {
  rows: SpendVsBaselineRow[];
  loading: boolean;
  timeRange: string;
  onMeterClick?: (meter: string) => void;
}

function formatCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function changeColor(pct: number | null): string {
  if (pct === null) return 'text-slate-500';
  if (pct >= 50) return 'text-rose-400';
  if (pct >= 20) return 'text-amber-400';
  if (pct <= -20) return 'text-emerald-400';
  return 'text-slate-300';
}

function changeIcon(pct: number | null) {
  if (pct === null) return <Minus className="w-3.5 h-3.5" />;
  if (pct >= 5) return <TrendingUp className="w-3.5 h-3.5" />;
  if (pct <= -5) return <TrendingDown className="w-3.5 h-3.5" />;
  return <Minus className="w-3.5 h-3.5" />;
}

export default function BPUSpendVsBaseline({ rows, loading, timeRange, onMeterClick }: Props) {
  const totalCurrent = rows.reduce((s, r) => s + r.currentSpend, 0);
  const totalBaseline = rows.reduce((s, r) => s + (r.baselineSpend ?? 0), 0);
  const totalChangePct =
    totalBaseline > 0 ? ((totalCurrent - totalBaseline) / totalBaseline) * 100 : null;

  const rangeLabel =
    timeRange === 'all' ? 'All time' : `Last ${timeRange}d`;

  return (
    <div className="glass-card">
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Spend vs Baseline</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {rangeLabel} spend per meter vs 90-day trimmed median. Ranked by % change — biggest increases first.
          </p>
        </div>
        {totalBaseline > 0 && (
          <div className="text-right">
            <p className="text-xs text-slate-400">Portfolio total</p>
            <p className="text-sm text-slate-200 tabular-nums">
              {formatCurrency(totalCurrent)}{' '}
              <span className="text-slate-500">vs</span>{' '}
              {formatCurrency(totalBaseline)}
            </p>
            {totalChangePct !== null && (
              <p className={`text-xs font-semibold tabular-nums ${changeColor(totalChangePct)}`}>
                {totalChangePct >= 0 ? '+' : ''}
                {totalChangePct.toFixed(1)}%
              </p>
            )}
          </div>
        )}
      </div>

      <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-800/95 backdrop-blur">
            <tr className="border-b border-white/10">
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                Location
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                Property
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                Current
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                Baseline
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-xs">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-xs">
                  No data available.
                </td>
              </tr>
            )}
            {rows.map(r => {
              const insufficient = r.baselineSpend === null;
              return (
                <tr
                  key={r.meter}
                  className={`border-b border-white/5 transition-colors ${
                    onMeterClick ? 'hover:bg-white/5 cursor-pointer' : ''
                  }`}
                  onClick={() => onMeterClick?.(r.meter)}
                >
                  <td className="px-4 py-3 text-slate-200 text-xs font-medium">{r.label}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs truncate max-w-[180px]">
                    {r.name}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-200 text-xs">
                    {formatCurrency(r.currentSpend)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-xs">
                    {insufficient ? (
                      <span
                        className="text-slate-600 text-[10px] italic"
                        title={`Only ${r.priorDays} days of prior history — needs ≥30`}
                      >
                        insufficient history
                      </span>
                    ) : (
                      <span className="text-slate-400">{formatCurrency(r.baselineSpend!)}</span>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums text-xs ${changeColor(r.changePct)}`}>
                    <div className="inline-flex items-center gap-1 justify-end">
                      {!insufficient && changeIcon(r.changePct)}
                      <span className="font-semibold">
                        {r.changePct === null
                          ? insufficient
                            ? '—'
                            : 'n/a'
                          : (r.changePct >= 0 ? '+' : '') + r.changePct.toFixed(1) + '%'}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
