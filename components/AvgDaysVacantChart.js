'use client';

import { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { RECHARTS_THEME } from '../lib/chartTheme';

const RANGES = [
  { v: '90', label: '90d' },
  { v: '180', label: '180d' },
  { v: '365', label: '1y' },
  { v: 'all', label: 'All' },
];

const SERIES = [
  { key: 'median_days_vacant', label: 'Median', color: '#06b6d4', width: 2 },
  { key: 'avg_days_vacant',    label: 'Average', color: '#fbbf24', width: 2 },
  { key: 'p90_days_vacant',    label: '90th pct', color: '#f43f5e', width: 1 },
];

function fmtDate(d) {
  // d is 'YYYY-MM-DD'; build in local time so the label doesn't shift a day.
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function Tile({ label, value, suffix, tone = 'default', hint }) {
  const toneClass =
    tone === 'good' ? 'text-emerald-400'
    : tone === 'bad' ? 'text-rose-400'
    : tone === 'muted' ? 'text-slate-400'
    : 'text-slate-100';
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2" title={hint}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-lg font-semibold ${toneClass}`}>
        {value === null || value === undefined ? '—' : value}
        {value !== null && value !== undefined && suffix ? (
          <span className="text-[11px] font-normal text-slate-500 ml-0.5">{suffix}</span>
        ) : null}
      </div>
    </div>
  );
}

function Delta({ value, suffix = 'd' }) {
  if (value === null || value === undefined) return null;
  const up = value > 0;
  const flat = value === 0;
  return (
    <span className={flat ? 'text-slate-500' : up ? 'text-rose-400' : 'text-emerald-400'}>
      {flat ? '±0' : `${up ? '+' : ''}${value}`}{suffix}
    </span>
  );
}

export default function AvgDaysVacantChart({ selectedProperty = 'all' }) {
  const [range, setRange] = useState('365');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ days: range });
        if (selectedProperty && selectedProperty !== 'all') {
          params.append('property', selectedProperty);
        }
        const res = await fetch(`/api/rehabs/vacancy-trend?${params}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
        setData(body);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [selectedProperty, range]);

  const s = data?.summary;
  const series = data?.series ?? [];
  // Where the weekly-to-daily cadence change falls inside the current window.
  const boundary = data?.daily_snapshots_from;
  const showBoundary = series.length > 0
    && series[0].snapshot_date < boundary
    && series[series.length - 1].snapshot_date >= boundary;

  return (
    <div className="glass-card p-4 mt-4">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Days vacant over time</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            How long the vacant units have been sitting, as of each rent-roll snapshot.
          </p>
        </div>
        <div className="flex rounded-full border border-white/10 overflow-hidden">
          {RANGES.map(opt => (
            <button
              key={opt.v}
              onClick={() => setRange(opt.v)}
              className={`text-[11px] px-3 py-1 transition-colors ${
                range === opt.v ? 'bg-white/10 text-slate-100' : 'text-slate-400 hover:bg-white/5'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="text-[12px] text-slate-500 py-8 text-center">Loading vacancy trend…</div>}
      {error && <div className="text-[12px] text-rose-400 py-8 text-center">{error}</div>}

      {!loading && !error && s && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
            <Tile label="Vacant units" value={s.vacant_units} />
            <Tile label="Vacancy rate" value={s.vacancy_rate} suffix="%" />
            <Tile
              label="Median days"
              value={s.median_days_vacant}
              suffix="d"
              tone="default"
              hint="Half the vacant units have been empty longer than this."
            />
            <Tile
              label="Average days"
              value={s.avg_days_vacant}
              suffix="d"
              tone="muted"
              hint="Pulled upward by long-term vacancies; compare against the median."
            />
            <Tile label="90th pct" value={s.p90_days_vacant} suffix="d" tone="bad" />
            <Tile label="Longest" value={s.max_days_vacant} suffix="d" tone="bad" />
          </div>

          <div className="flex items-center gap-4 mb-3 text-[11px] text-slate-400">
            <span>Over this window: median <Delta value={s.median_change} /></span>
            <span>average <Delta value={s.avg_change} /></span>
          </div>

          {s.avg_days_vacant !== null && s.median_days_vacant !== null
            && s.avg_days_vacant - s.median_days_vacant > 30 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 mb-3">
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                The average sits {Math.round(s.avg_days_vacant - s.median_days_vacant)} days above the
                median, so a handful of long-term vacancies — the worst is {s.max_days_vacant} days —
                are carrying it. Read the median for turn performance and the 90th percentile for
                the tail.
              </p>
            </div>
          )}

          {series.length === 0 ? (
            <div className="text-[12px] text-slate-500 py-8 text-center">
              No snapshots in this window.
            </div>
          ) : (
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid {...RECHARTS_THEME.grid} />
                  <XAxis
                    dataKey="snapshot_date"
                    tickFormatter={fmtDate}
                    {...RECHARTS_THEME.axis}
                    tick={{ fill: RECHARTS_THEME.axis.stroke, fontSize: 10 }}
                    minTickGap={28}
                  />
                  <YAxis
                    {...RECHARTS_THEME.axis}
                    tick={{ fill: RECHARTS_THEME.axis.stroke, fontSize: 10 }}
                    label={{ value: 'days vacant', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 10 }}
                  />
                  <Tooltip
                    {...RECHARTS_THEME.tooltip}
                    labelFormatter={(d) => {
                      const pt = series.find(p => p.snapshot_date === d);
                      const res = pt && !pt.daily_resolution ? ' · weekly snapshot' : '';
                      return `${d}${res}`;
                    }}
                    formatter={(value, name) => [value === null ? '—' : `${value} d`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, color: '#94a3b8' }} />
                  {showBoundary && (
                    <ReferenceLine
                      x={boundary}
                      stroke="#64748b"
                      strokeDasharray="3 3"
                      label={{ value: 'daily snapshots start', fill: '#64748b', fontSize: 9, position: 'insideTopLeft' }}
                    />
                  )}
                  {SERIES.map(cfg => (
                    <Line
                      key={cfg.key}
                      type="monotone"
                      dataKey={cfg.key}
                      name={cfg.label}
                      stroke={cfg.color}
                      strokeWidth={cfg.width}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <p className="text-[10px] text-slate-500 mt-2">
            Counts a unit as vacant only once it is actually empty (Vacant-Unrented or
            Vacant-Rented); notice and eviction periods are excluded because the tenant is
            still in place. Each unit&apos;s clock restarts when it re-leases.
            {showBoundary && ' Points left of the dashed line come from weekly snapshots, so vacancy starts there are accurate to about a week.'}
          </p>
        </>
      )}
    </div>
  );
}
