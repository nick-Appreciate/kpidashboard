'use client';

/**
 * TimeCardsDashboard
 *
 * Side-by-side stacked-bar calendar per day for each tracked maintenance tech.
 * Bar height = clocked hours (Rippling). Bar fill segments = billed work
 * orders (AppFolio work_order_labor_summary). Gap at top = unbilled time.
 *
 * Target ratio: ≥ 7.5h billed per 8h clocked (93.75%).
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';

// ── Types ────────────────────────────────────────────────────────────────────

interface WorkOrderEntry {
  work_order_id: string | null;
  work_order_number: string | null;
  hours: number;
  property: string | null;
  unit: string | null;
  issue: string | null;
  description: string | null;
  status: string | null;
  start_time: string | null;
  end_time: string | null;
}

interface Shift {
  rippling_id: string;
  start_time: string;
  end_time: string | null;
  hours: number | null;
}

interface DayRow {
  technician: string;
  day: string;                          // YYYY-MM-DD
  clocked_hours: number | string;
  billed_hours: number | string;
  unbilled_hours: number | string;
  billed_pct: number | string | null;
  shifts: Shift[];
  work_orders: WorkOrderEntry[];
}

interface Worker {
  worker_id: string;
  name: string;
  work_email: string | null;
  status: string | null;
}

interface ApiResponse {
  days: number;
  since: string;
  workers: Worker[];
  rows: DayRow[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const TARGET_HOURS = 7.5;             // billed-hours threshold
const MAX_BAR_HOURS = 10;             // y-axis ceiling for the bar viewport
const DATE_RANGES = [
  { key: 7,  label: '7d' },
  { key: 14, label: '14d' },
  { key: 30, label: '30d' },
  { key: 60, label: '60d' },
];

// Two colour palettes — one per tech. Each palette has many distinct colours so
// individual work orders are easily distinguishable.
const PALETTE_BY_TECH: Record<string, string[]> = {
  'Will Herbert': [
    '#3b82f6', '#60a5fa', '#1d4ed8', '#0ea5e9', '#0891b2', '#06b6d4',
    '#0284c7', '#1e40af', '#0369a1', '#075985', '#155e75', '#0c4a6e',
  ],
  'Brett Seldomridge': [
    '#f97316', '#fb923c', '#ea580c', '#f59e0b', '#fbbf24', '#d97706',
    '#c2410c', '#9a3412', '#92400e', '#78350f', '#854d0e', '#713f12',
  ],
};
const FALLBACK_PALETTE = ['#10b981', '#34d399', '#059669', '#047857'];
const UNBILLED_COLOR = '#7f1d1d'; // dark red for the gap at top

// ── Helpers ──────────────────────────────────────────────────────────────────

function num(x: number | string | null | undefined): number {
  if (x == null) return 0;
  const n = typeof x === 'string' ? parseFloat(x) : x;
  return isNaN(n) ? 0 : n;
}

function fmtHours(h: number): string {
  if (h === 0) return '0';
  if (h < 10) return h.toFixed(2);
  return h.toFixed(1);
}

function fmtDate(d: string): string {
  const dt = new Date(d + 'T00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dayOfWeek(d: string): string {
  const dt = new Date(d + 'T00:00');
  return dt.toLocaleDateString('en-US', { weekday: 'short' });
}

function colorForWo(tech: string, idx: number): string {
  const p = PALETTE_BY_TECH[tech] ?? FALLBACK_PALETTE;
  return p[idx % p.length];
}

// Stable WO id for picking a colour even when the order changes
function woKey(wo: WorkOrderEntry): string {
  return wo.work_order_id || wo.work_order_number || (wo.issue || '?');
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TimeCardsDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const router = useRouter();

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(14);
  const [hoverWo, setHoverWo] = useState<{
    tech: string; day: string; wo: WorkOrderEntry; x: number; y: number;
  } | null>(null);

  useEffect(() => {
    if (!authLoading && appUser && appUser.role !== 'admin') router.push('/');
  }, [authLoading, appUser, router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/time-cards?days=${days}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ApiResponse = await res.json();
      setData(json);
    } catch (e: any) {
      console.error(e);
    } finally { setLoading(false); }
  }, [days]);

  useEffect(() => {
    if (!authLoading && appUser?.role === 'admin') fetchData();
  }, [authLoading, appUser, fetchData]);

  // Group rows: a map of day → tech → row
  const { dayList, byDay, perWorkerSummary, perWoColorMap } = useMemo(() => {
    if (!data) {
      return { dayList: [] as string[], byDay: {} as Record<string, Record<string, DayRow>>,
               perWorkerSummary: {} as Record<string, {clocked:number;billed:number;days:number}>,
               perWoColorMap: {} as Record<string, Record<string, string>> };
    }
    const trackedTechs = data.workers.map(w => w.name);
    const byDay: Record<string, Record<string, DayRow>> = {};
    for (const r of data.rows) {
      if (!byDay[r.day]) byDay[r.day] = {};
      byDay[r.day][r.technician] = r;
    }
    // Fill in missing days so the calendar has complete columns
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayList: string[] = [];
    for (let i = 0; i < data.days; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      dayList.push(d.toISOString().slice(0, 10));
    }
    // Per-tech rolling summary
    const perWorkerSummary: Record<string, { clocked: number; billed: number; days: number }> = {};
    for (const tech of trackedTechs) {
      perWorkerSummary[tech] = { clocked: 0, billed: 0, days: 0 };
    }
    for (const r of data.rows) {
      const s = perWorkerSummary[r.technician]; if (!s) continue;
      s.clocked += num(r.clocked_hours);
      s.billed += num(r.billed_hours);
      if (num(r.clocked_hours) > 0 || num(r.billed_hours) > 0) s.days += 1;
    }
    // Build a stable colour index per (tech, wo_key) so the same WO keeps a
    // colour across multiple days
    const perWoColorMap: Record<string, Record<string, string>> = {};
    for (const tech of trackedTechs) {
      perWoColorMap[tech] = {};
      const seen: string[] = [];
      // Iterate rows oldest-to-newest so the colour assignment is stable
      const techRows = data.rows.filter(r => r.technician === tech)
        .slice().sort((a, b) => a.day.localeCompare(b.day));
      for (const r of techRows) {
        for (const wo of r.work_orders) {
          const k = woKey(wo);
          if (!perWoColorMap[tech][k]) {
            perWoColorMap[tech][k] = colorForWo(tech, seen.length);
            seen.push(k);
          }
        }
      }
    }
    return { dayList, byDay, perWorkerSummary, perWoColorMap };
  }, [data]);

  if (authLoading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (!appUser || appUser.role !== 'admin') return null;

  const tracked = data?.workers ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <header className="flex items-baseline justify-between mb-4 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Time Cards</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Clocked hours (Rippling) vs billed labor on work orders (AppFolio). Target ≥ {TARGET_HOURS}h/day billed.
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded p-0.5">
              {DATE_RANGES.map(r => (
                <button key={r.key} onClick={() => setDays(r.key)}
                        className={`px-2.5 py-1 text-xs rounded transition-colors ${
                          days === r.key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}>
                  {r.label}
                </button>
              ))}
            </div>
            <button onClick={fetchData} disabled={loading}
                    className="px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded border border-slate-700">
              {loading ? 'Loading…' : '↻ Refresh'}
            </button>
          </div>
        </header>

        {/* Per-tech summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          {tracked.map(w => {
            const s = perWorkerSummary[w.name] || { clocked: 0, billed: 0, days: 0 };
            const ratio = s.clocked > 0 ? (s.billed / s.clocked) * 100 : 0;
            const ratioGood = ratio >= 93.75;
            const palette = PALETTE_BY_TECH[w.name]?.[0] ?? '#10b981';
            return (
              <div key={w.worker_id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <div>
                    <h3 className="text-base font-semibold flex items-center gap-2">
                      <span className="w-3 h-3 rounded" style={{ backgroundColor: palette }} />
                      {w.name}
                    </h3>
                    <div className="text-xs text-slate-500">{w.work_email}</div>
                  </div>
                  <div className={`px-2 py-0.5 rounded text-xs font-semibold ${ratioGood
                    ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'
                    : 'bg-rose-900/40 text-rose-300 border border-rose-700/50'}`}>
                    {ratio.toFixed(1)}% billed
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <Stat label="Days worked" value={String(s.days)} />
                  <Stat label="Clocked" value={`${fmtHours(s.clocked)}h`} />
                  <Stat label="Billed" value={`${fmtHours(s.billed)}h`} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Calendar grid */}
        <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
              Daily clocked vs billed
            </h2>
            <Legend tracked={tracked} />
          </div>
          {dayList.length === 0 || tracked.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">{loading ? 'Loading…' : 'No data.'}</div>
          ) : (
            <CalendarGrid
              dayList={dayList}
              tracked={tracked}
              byDay={byDay}
              perWoColorMap={perWoColorMap}
              onHover={setHoverWo}
            />
          )}
        </section>

        {hoverWo && (
          <Tooltip x={hoverWo.x} y={hoverWo.y} tech={hoverWo.tech} day={hoverWo.day} wo={hoverWo.wo} />
        )}
      </div>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-slate-500 text-[10px] uppercase tracking-wide">{label}</div>
      <div className="text-slate-100 font-semibold">{value}</div>
    </div>
  );
}

function Legend({ tracked }: { tracked: Worker[] }) {
  return (
    <div className="flex gap-3 text-xs text-slate-400">
      {tracked.map(w => (
        <span key={w.worker_id} className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: PALETTE_BY_TECH[w.name]?.[0] || '#888' }} />
          {w.name.split(' ')[0]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: UNBILLED_COLOR }} />
        Unbilled
      </span>
      <span className="text-slate-500 ml-2">Dashed line = {TARGET_HOURS}h target</span>
    </div>
  );
}

function CalendarGrid({ dayList, tracked, byDay, perWoColorMap, onHover }: {
  dayList: string[];
  tracked: Worker[];
  byDay: Record<string, Record<string, DayRow>>;
  perWoColorMap: Record<string, Record<string, string>>;
  onHover: (h: { tech: string; day: string; wo: WorkOrderEntry; x: number; y: number; } | null) => void;
}) {
  const PX_PER_HOUR = 22;
  const BAR_HEIGHT = MAX_BAR_HOURS * PX_PER_HOUR;

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1" style={{ minHeight: BAR_HEIGHT + 80 }}>
        {/* Y-axis labels */}
        <div className="shrink-0 w-10 pt-1 relative" style={{ height: BAR_HEIGHT }}>
          {Array.from({ length: MAX_BAR_HOURS + 1 }, (_, i) => i).map((i) => {
            const h = MAX_BAR_HOURS - i;
            return (
              <div
                key={h}
                className="absolute text-[10px] text-slate-500 right-1"
                style={{ top: i * PX_PER_HOUR - 6 }}
              >
                {h % 2 === 0 ? `${h}h` : ''}
              </div>
            );
          })}
        </div>

        {/* Day columns */}
        {dayList.slice().reverse().map((d) => (
          <DayColumn
            key={d}
            day={d}
            tracked={tracked}
            rows={byDay[d] || {}}
            perWoColorMap={perWoColorMap}
            pxPerHour={PX_PER_HOUR}
            barHeight={BAR_HEIGHT}
            onHover={onHover}
          />
        ))}
      </div>
    </div>
  );
}

function DayColumn({ day, tracked, rows, perWoColorMap, pxPerHour, barHeight, onHover }: {
  day: string;
  tracked: Worker[];
  rows: Record<string, DayRow>;
  perWoColorMap: Record<string, Record<string, string>>;
  pxPerHour: number;
  barHeight: number;
  onHover: (h: { tech: string; day: string; wo: WorkOrderEntry; x: number; y: number; } | null) => void;
}) {
  const isWeekend = ['Sat', 'Sun'].includes(dayOfWeek(day));
  return (
    <div className={`flex flex-col shrink-0 items-center ${isWeekend ? 'opacity-50' : ''}`}>
      {/* Bars container */}
      <div className="relative flex items-end gap-0.5 px-0.5" style={{ height: barHeight }}>
        {/* Target line */}
        <div
          className="absolute left-0 right-0 border-t border-dashed border-emerald-400/40 pointer-events-none"
          style={{ top: (MAX_BAR_HOURS - TARGET_HOURS) * pxPerHour, zIndex: 1 }}
        />
        {tracked.map((w) => (
          <TechBar
            key={w.worker_id}
            tech={w.name}
            day={day}
            row={rows[w.name]}
            colors={perWoColorMap[w.name] || {}}
            pxPerHour={pxPerHour}
            onHover={onHover}
          />
        ))}
      </div>

      {/* Day label */}
      <div className="text-[10px] text-slate-500 mt-1 text-center">
        <div className="font-medium">{fmtDate(day)}</div>
        <div className="text-slate-600">{dayOfWeek(day)}</div>
      </div>
    </div>
  );
}

function TechBar({ tech, day, row, colors, pxPerHour, onHover }: {
  tech: string;
  day: string;
  row: DayRow | undefined;
  colors: Record<string, string>;
  pxPerHour: number;
  onHover: (h: { tech: string; day: string; wo: WorkOrderEntry; x: number; y: number; } | null) => void;
}) {
  const clocked = num(row?.clocked_hours);
  const billed = num(row?.billed_hours);
  const total = Math.max(clocked, billed); // billed can exceed clocked sometimes
  const billedHeight = billed * pxPerHour;
  const totalHeight = total * pxPerHour;
  const unbilled = Math.max(clocked - billed, 0);
  const unbilledHeight = unbilled * pxPerHour;
  // billed_pct may be null/string; gracefully numerify
  const ratio = clocked > 0 ? (billed / clocked) * 100 : null;
  const ratioGood = ratio == null ? null : ratio >= 93.75;

  if (!row || (clocked === 0 && billed === 0)) {
    return (
      <div
        className="w-7 border-l border-r border-slate-800/60 border-b border-b-slate-700 rounded-b-sm bg-slate-900/30"
        style={{ height: '100%' }}
        title={`${tech} – no time logged on ${day}`}
      />
    );
  }

  // Build segments bottom-up from billed work orders, then unbilled on top
  const wos = (row.work_orders || []).slice().sort((a, b) => num(a.hours) - num(b.hours)); // smallest first → looks tidier bottom-up
  return (
    <div
      className="w-7 relative cursor-default"
      title={`${tech} · ${day} · clocked ${fmtHours(clocked)}h · billed ${fmtHours(billed)}h · ${ratio?.toFixed(0) ?? '—'}%`}
      style={{ height: totalHeight, alignSelf: 'flex-end' }}
    >
      {/* unbilled (top) */}
      {unbilled > 0 && (
        <div
          className="absolute left-0 right-0 border-t border-rose-700/40"
          style={{
            top: 0,
            height: unbilledHeight,
            backgroundColor: UNBILLED_COLOR,
            opacity: 0.85,
          }}
          title={`${fmtHours(unbilled)}h unbilled`}
        />
      )}
      {/* WO segments (filling the billed portion from bottom up) */}
      {(() => {
        let bottomOffset = 0;
        return wos.map((wo, i) => {
          const h = num(wo.hours);
          if (h === 0) return null;
          const segHeight = h * pxPerHour;
          const segStyle = {
            bottom: bottomOffset,
            height: segHeight,
            backgroundColor: colors[woKey(wo)] || '#888',
          };
          bottomOffset += segHeight;
          return (
            <div
              key={`${wo.work_order_id || wo.work_order_number || i}-${i}`}
              className="absolute left-0 right-0 hover:brightness-125 transition-all"
              style={segStyle}
              onMouseEnter={(e) =>
                onHover({ tech, day, wo, x: e.clientX, y: e.clientY })
              }
              onMouseLeave={() => onHover(null)}
            />
          );
        });
      })()}
      {/* Ratio chip at the top */}
      {ratio != null && (
        <div
          className={`absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-semibold ${
            ratioGood ? 'text-emerald-300' : 'text-rose-300'
          }`}
        >
          {Math.round(ratio)}%
        </div>
      )}
    </div>
  );
}

function Tooltip({ x, y, tech, day, wo }: { x: number; y: number; tech: string; day: string; wo: WorkOrderEntry; }) {
  const woRef = wo.work_order_number || wo.work_order_id || '—';
  const url = wo.work_order_id ? `https://appreciateinc.appfolio.com/work_orders/${wo.work_order_id}` : null;
  return (
    <div
      className="fixed z-50 pointer-events-none bg-slate-900 border border-slate-700 rounded p-2 shadow-xl text-xs max-w-xs"
      style={{ left: Math.min(x + 12, window.innerWidth - 260), top: Math.max(y - 8, 8) }}
    >
      <div className="font-semibold text-slate-100 mb-0.5">{tech} · {fmtDate(day)}</div>
      <div className="text-slate-400">WO #{woRef} · <span className="text-emerald-300 font-semibold">{fmtHours(num(wo.hours))}h</span></div>
      {wo.property && <div className="text-slate-300 truncate">{wo.property}{wo.unit ? ` · ${wo.unit}` : ''}</div>}
      {wo.issue && <div className="text-slate-300">{wo.issue}</div>}
      {wo.status && <div className="text-slate-500 text-[10px] mt-0.5">{wo.status}</div>}
      {url && <div className="text-indigo-300 text-[10px] mt-0.5">↗ Click in AppFolio</div>}
    </div>
  );
}
