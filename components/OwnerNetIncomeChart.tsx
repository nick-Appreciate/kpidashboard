'use client';

/**
 * OwnerNetIncomeChart
 *
 * Models "true net to owner" per month:
 *   net = (Owner Distributions − Owner Contributions) − Insurance − Debt Service
 *
 * AppFolio owner distributions don't account for insurance + mortgage
 * paid out of holding-company accounts, so the distribution figure
 * alone overstates what owners actually netted. This chart joins
 * AppFolio distributions with the property_debt_insurance lookup
 * (seeded from "Cash Balance.xls") to compute the real number.
 *
 * Two view modes:
 *   "Portfolio total"  — stacked bars showing the components per month +
 *                        a net-line on top
 *   "By property"      — net-to-owner per property (latest month)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, BarChart, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { RECHARTS_THEME } from '../lib/chartTheme';

interface MonthTotal {
  month: string;
  distributions: number;
  contributions: number;
  insurance: number;
  taxes: number;
  debt_service: number;
  net_to_owner: number;
}

interface PerPropertyRow extends MonthTotal { property: string; }

interface ApiResponse {
  months: string[];
  properties: string[];
  rows: PerPropertyRow[];
  totals: MonthTotal[];
  unmodeled: string[];
}

const fmtMonth = (iso: string) => {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  const d = new Date(parseInt(y), parseInt(m) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

const fmtCurrencyShort = (n: number) => {
  const abs = Math.abs(Number(n) || 0);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
};
const fmtCurrencyFull = (n: number) => {
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return v < 0 ? `($${abs})` : `$${abs}`;
};

export default function OwnerNetIncomeChart() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'portfolio' | 'byProperty'>('portfolio');
  const [months, setMonths] = useState(12);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/financials/owner-net-income?months=${months}`);
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      setData(await res.json());
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => { reload(); }, [reload]);

  const totalsForChart = useMemo(() => {
    if (!data?.totals) return [];
    return data.totals.map(t => ({
      ...t,
      // Recharts stacked bars want positive values for proper stacking. We
      // negate the "cost" components so they stack downward visually,
      // making it obvious that net = distributions − costs.
      negInsurance:     -(t.insurance || 0),
      negTaxes:         -(t.taxes || 0),
      negDebt:          -(t.debt_service || 0),
      negContributions: -(t.contributions || 0),
    }));
  }, [data]);

  const latestPropertyBreakdown = useMemo(() => {
    if (!data?.rows?.length) return [];
    const latestMonth = data.months[data.months.length - 1];
    return data.rows
      .filter(r => r.month === latestMonth)
      .map(r => ({ ...r }))
      .sort((a, b) => b.net_to_owner - a.net_to_owner);
  }, [data]);

  const ytdTotal = useMemo(() => {
    if (!data?.totals?.length) return null;
    const sum = data.totals.reduce((acc, t) => ({
      distributions: acc.distributions + (t.distributions || 0),
      contributions: acc.contributions + (t.contributions || 0),
      insurance: acc.insurance + (t.insurance || 0),
      taxes: acc.taxes + (t.taxes || 0),
      debt_service: acc.debt_service + (t.debt_service || 0),
      net_to_owner: acc.net_to_owner + (t.net_to_owner || 0),
    }), { distributions: 0, contributions: 0, insurance: 0, taxes: 0, debt_service: 0, net_to_owner: 0 });
    return sum;
  }, [data]);

  return (
    <div className="glass-card p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4 pb-3 border-b border-[var(--glass-border)]">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Owner Net Income</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Distributions <span className="text-slate-500">−</span> contributions
            {' '}<span className="text-slate-500">−</span> insurance
            {' '}<span className="text-slate-500">−</span> taxes
            {' '}<span className="text-slate-500">−</span> debt service
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Insurance / taxes / debt are per-period overlays editable on <code className="text-slate-400">/admin/properties</code>
          </p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-2">
          <div className="flex items-center gap-1 bg-slate-800/50 rounded-md p-0.5 shrink-0">
            {[
              { key: 'portfolio',  label: 'Portfolio' },
              { key: 'byProperty', label: 'By property' },
            ].map(o => (
              <button
                key={o.key}
                onClick={() => setMode(o.key as any)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  mode === o.key ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:text-slate-200'
                }`}
              >{o.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-slate-800/50 rounded-md p-0.5 shrink-0">
            {[3, 6, 12, 24].map(n => (
              <button
                key={n}
                onClick={() => setMonths(n)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  months === n ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:text-slate-200'
                }`}
              >{n}mo</button>
            ))}
          </div>
        </div>
      </div>

      {ytdTotal && !loading && (
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-4 text-xs">
          <StatCard label="Distributions"  value={ytdTotal.distributions} positive />
          <StatCard label="Contributions"  value={-ytdTotal.contributions} />
          <StatCard label="Insurance"      value={-ytdTotal.insurance} />
          <StatCard label="Taxes"          value={-ytdTotal.taxes} />
          <StatCard label="Debt service"   value={-ytdTotal.debt_service} />
          <StatCard label={`Net (${months}mo)`} value={ytdTotal.net_to_owner} accent />
        </div>
      )}

      <div className="h-80 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">Loading…</div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-rose-300">{error}</div>
        )}

        {!loading && !error && mode === 'portfolio' && totalsForChart.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={totalsForChart} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={RECHARTS_THEME.grid.stroke} />
              <XAxis dataKey="month" tickFormatter={fmtMonth} stroke={RECHARTS_THEME.axis.stroke} fontSize={11} fontFamily={RECHARTS_THEME.axis.fontFamily} />
              <YAxis tickFormatter={fmtCurrencyShort} stroke={RECHARTS_THEME.axis.stroke} fontSize={11} fontFamily={RECHARTS_THEME.axis.fontFamily} width={70} />
              <Tooltip
                contentStyle={RECHARTS_THEME.tooltip.contentStyle}
                labelStyle={RECHARTS_THEME.tooltip.labelStyle}
                labelFormatter={(l) => fmtMonth(String(l))}
                formatter={(v: any, name: string, item: any) => {
                  // The "neg*" dataKeys hold pre-negated values so the bars
                  // stack downward visually — flip back to positive for the
                  // tooltip label. Everything else (including net_to_owner)
                  // keeps its real sign so a loss shows as "($X)".
                  const key = item?.dataKey ?? '';
                  const display = typeof key === 'string' && key.startsWith('neg') ? Math.abs(v) : v;
                  return [fmtCurrencyFull(display), name];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={0} stroke={RECHARTS_THEME.grid.stroke} />
              <Bar dataKey="distributions"    stackId="positive" fill="#34d399" name="Distributions" />
              <Bar dataKey="negContributions" stackId="negative" fill="#fb7185" name="Contributions" />
              <Bar dataKey="negInsurance"     stackId="negative" fill="#fbbf24" name="Insurance" />
              <Bar dataKey="negTaxes"         stackId="negative" fill="#a3e635" name="Taxes" />
              <Bar dataKey="negDebt"          stackId="negative" fill="#fb923c" name="Debt service" />
              <Line type="monotone" dataKey="net_to_owner" stroke="#06b6d4" strokeWidth={2.5} dot={{ r: 4 }} name="Net to owner" />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {!loading && !error && mode === 'byProperty' && latestPropertyBreakdown.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={latestPropertyBreakdown}
              margin={{ top: 10, right: 20, left: 10, bottom: 60 }}
              layout="horizontal"
            >
              <CartesianGrid strokeDasharray="3 3" stroke={RECHARTS_THEME.grid.stroke} />
              <XAxis dataKey="property" stroke={RECHARTS_THEME.axis.stroke} fontSize={10} fontFamily={RECHARTS_THEME.axis.fontFamily} angle={-35} textAnchor="end" interval={0} height={70} />
              <YAxis tickFormatter={fmtCurrencyShort} stroke={RECHARTS_THEME.axis.stroke} fontSize={11} fontFamily={RECHARTS_THEME.axis.fontFamily} width={70} />
              <Tooltip
                contentStyle={RECHARTS_THEME.tooltip.contentStyle}
                labelStyle={RECHARTS_THEME.tooltip.labelStyle}
                formatter={(v: any, name: string) => [fmtCurrencyFull(v), name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={0} stroke={RECHARTS_THEME.grid.stroke} />
              <Bar dataKey="net_to_owner" name="Net to owner" fill="#06b6d4" />
            </BarChart>
          </ResponsiveContainer>
        )}

        {!loading && !error && (
          (mode === 'portfolio' && totalsForChart.length === 0) ||
          (mode === 'byProperty' && latestPropertyBreakdown.length === 0)
        ) && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
            No data in this window.
          </div>
        )}
      </div>

      {data?.unmodeled?.length ? (
        <p className="text-[11px] text-amber-300/80 mt-3">
          Not modeled (no debt/insurance row in spreadsheet): {data.unmodeled.join(', ')}
        </p>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, positive, accent }: {
  label: string; value: number; positive?: boolean; accent?: boolean;
}) {
  const negative = value < 0;
  return (
    <div className={`px-3 py-2 rounded-md border ${
      accent ? 'border-cyan-500/30 bg-cyan-500/10' : 'border-[var(--glass-border)] bg-surface-overlay/40'
    }`}>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${
        accent ? 'text-cyan-300' :
        positive ? 'text-emerald-300' :
        negative ? 'text-rose-300' : 'text-slate-200'
      }`}>
        {value < 0 ? `(${fmtCurrencyShort(Math.abs(value))})` : fmtCurrencyShort(value)}
      </div>
    </div>
  );
}
