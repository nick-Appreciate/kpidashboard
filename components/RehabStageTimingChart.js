'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { RECHARTS_THEME } from '../lib/chartTheme';

// Waiting -> under construction -> leasing. Notice/Eviction days are not turn
// time (the tenant is still in place) and are excluded upstream by the RPC.
const STAGE_META = [
  { key: 'waiting_days',      label: 'Waiting',            color: '#f97316' },
  { key: 'construction_days', label: 'Under construction', color: '#eab308' },
  { key: 'leasing_days',      label: 'Leasing',            color: '#22c55e' },
];

const UNTRACKED_COLOR = '#475569';
const ROW_PX = 26;

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

export default function RehabStageTimingChart({ selectedProperty = 'all' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [scope, setScope] = useState('open');
  const [selectedUnit, setSelectedUnit] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ scope });
        // 'farquhar' is a region alias, not a property name.
        if (selectedProperty === 'farquhar') {
          params.append('region', 'farquhar');
        } else if (selectedProperty && selectedProperty !== 'all' && selectedProperty !== 'portfolio') {
          params.append('property', selectedProperty);
        }
        const res = await fetch(`/api/rehabs/stage-timing?${params}`);
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
  }, [selectedProperty, scope]);

  // Changing the filter can hide the isolated unit; don't strand the view.
  useEffect(() => { setSelectedUnit(null); }, [selectedProperty, scope]);

  const goal = data?.goal_days ?? 14;
  const summary = data?.summary;

  const chartRows = useMemo(() => {
    if (!data?.units) return [];
    const rows = data.units
      .filter(u => u.elapsed_days !== null)
      .map(u => ({
        id: u.rehab_id,
        name: `${u.property} ${u.unit}`,
        property: u.property,
        unit: u.unit,
        status: u.rehab_status,
        measured: u.measured,
        end_basis: u.end_basis,
        elapsed_days: u.elapsed_days,
        // A backfilled row has no real split, so everything sits in the
        // untracked series rather than being guessed into a stage.
        waiting_days: u.measured ? u.waiting_days : 0,
        construction_days: u.measured ? u.construction_days : 0,
        leasing_days: u.measured ? u.leasing_days : 0,
        untracked_days: u.measured ? 0 : u.elapsed_days,
      }))
      .sort((a, b) => b.elapsed_days - a.elapsed_days);
    return selectedUnit ? rows.filter(r => r.id === selectedUnit) : rows;
  }, [data, selectedUnit]);

  const selectedRow = selectedUnit
    ? chartRows.find(r => r.id === selectedUnit)
    : null;

  const anyMeasured = (summary?.measured_count ?? 0) > 0;
  const inferredCount = summary?.by_end_basis?.archived_at ?? 0;

  return (
    <div className="glass-card p-4 mt-4">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Stage timing</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Days per unit in each stage against a {goal}-day turn goal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedUnit && (
            <button
              onClick={() => setSelectedUnit(null)}
              className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 text-slate-300 hover:bg-white/5"
            >
              Clear “{selectedRow?.name ?? 'unit'}”
            </button>
          )}
          <div className="flex rounded-full border border-white/10 overflow-hidden">
            {[
              { v: 'open', label: 'In pipeline' },
              { v: 'all', label: 'Incl. finished' },
            ].map(opt => (
              <button
                key={opt.v}
                onClick={() => setScope(opt.v)}
                className={`text-[11px] px-3 py-1 transition-colors ${
                  scope === opt.v
                    ? 'bg-white/10 text-slate-100'
                    : 'text-slate-400 hover:bg-white/5'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && <div className="text-[12px] text-slate-500 py-8 text-center">Loading stage timing…</div>}
      {error && <div className="text-[12px] text-rose-400 py-8 text-center">{error}</div>}

      {!loading && !error && summary && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 mb-3">
            <Tile label="Units" value={summary.count} />
            <Tile
              label="Median total"
              value={summary.median_elapsed}
              suffix="d"
              tone={summary.median_elapsed > goal ? 'bad' : 'good'}
              hint="Median days from vacancy start to completion (or today)."
            />
            <Tile
              label="Average total"
              value={summary.avg_elapsed}
              suffix="d"
              tone={summary.avg_elapsed > goal ? 'bad' : 'good'}
            />
            <Tile
              label={`Within ${goal}d`}
              value={summary.within_goal}
              tone="good"
            />
            <Tile label={`Over ${goal}d`} value={summary.over_goal} tone="bad" />
            <Tile
              label="Measured split"
              value={`${summary.measured_count}/${summary.count}`}
              tone="muted"
              hint="Units whose stage transitions have been logged since tracking started."
            />
          </div>

          {anyMeasured && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {STAGE_META.map((s, i) => (
                <Tile
                  key={s.key}
                  label={`Avg ${s.label.toLowerCase()}`}
                  value={[summary.avg_waiting, summary.avg_construction, summary.avg_leasing][i]}
                  suffix="d"
                />
              ))}
            </div>
          )}

          {!anyMeasured && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 mb-3">
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                <span className="font-semibold">Stage split starts accruing now.</span>{' '}
                Status changes weren’t being recorded before today, so these bars show
                total turn time only. The waiting / construction / leasing breakdown fills
                in as units move between statuses from here.
              </p>
            </div>
          )}

          {(summary.pre_vacancy_count ?? 0) > 0 && (
            <p className="text-[10px] text-slate-500 mb-2">
              {summary.pre_vacancy_count} unit{summary.pre_vacancy_count === 1 ? '' : 's'} on notice or
              in eviction {summary.pre_vacancy_count === 1 ? 'is' : 'are'} excluded — the tenant is still
              in place, so no rehab time has accrued yet.
            </p>
          )}

          {inferredCount > 0 && (
            <p className="text-[10px] text-slate-500 mb-2">
              {inferredCount} unit{inferredCount === 1 ? '' : 's'} had no recorded completion date —
              end time inferred from when the sync archived them (accurate to about a day).
            </p>
          )}

          {chartRows.length === 0 ? (
            <div className="text-[12px] text-slate-500 py-8 text-center">
              No units with a usable start date in this view.
            </div>
          ) : (
            <div style={{ height: Math.min(Math.max(chartRows.length * ROW_PX + 60, 180), 520) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartRows}
                  layout="vertical"
                  margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
                  barCategoryGap={3}
                >
                  <CartesianGrid {...RECHARTS_THEME.grid} horizontal={false} />
                  <XAxis
                    type="number"
                    {...RECHARTS_THEME.axis}
                    tick={{ fill: RECHARTS_THEME.axis.stroke, fontSize: 10 }}
                    label={{ value: 'days', position: 'insideBottomRight', offset: -2, fill: '#64748b', fontSize: 10 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    {...RECHARTS_THEME.axis}
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                  />
                  <Tooltip
                    {...RECHARTS_THEME.tooltip}
                    formatter={(value, name) => [`${value} d`, name]}
                    labelFormatter={(label, payload) => {
                      const row = payload?.[0]?.payload;
                      if (!row) return label;
                      return `${label} · ${row.status}${row.measured ? '' : ' · split not tracked'}`;
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, color: '#94a3b8' }} />
                  <ReferenceLine
                    x={goal}
                    stroke="#06b6d4"
                    strokeDasharray="4 3"
                    label={{ value: `${goal}d goal`, fill: '#06b6d4', fontSize: 10, position: 'top' }}
                  />
                  {STAGE_META.map(s => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      name={s.label}
                      stackId="stage"
                      fill={s.color}
                      cursor="pointer"
                      onClick={(d) => setSelectedUnit(d?.payload?.id ?? null)}
                    />
                  ))}
                  <Bar
                    dataKey="untracked_days"
                    name="Total (split not tracked)"
                    stackId="stage"
                    fill={UNTRACKED_COLOR}
                    cursor="pointer"
                    onClick={(d) => setSelectedUnit(d?.payload?.id ?? null)}
                  >
                    {chartRows.map(row => (
                      <Cell
                        key={row.id}
                        fill={row.elapsed_days > goal ? '#64748b' : '#334155'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {selectedRow && (
            <div className="mt-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
              <div className="text-[12px] text-slate-200 font-medium">{selectedRow.name}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {selectedRow.status} · {selectedRow.elapsed_days} days total
                {selectedRow.measured
                  ? ` · ${selectedRow.waiting_days}d waiting, ${selectedRow.construction_days}d construction, ${selectedRow.leasing_days}d leasing`
                  : ' · stage split not tracked for this cycle'}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
