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
  service_request_id: string | null;
  hours: number;
  property: string | null;
  unit: string | null;
  issue: string | null;
  description: string | null;
  status: string | null;
  start_time: string | null;
  end_time: string | null;
}

/**
 * Build the AppFolio deep-link for a work-order entry.
 * - Best: /maintenance/service_requests/{sr}/work_orders/{wo}  (both ids)
 * - Fallback: /maintenance/service_requests/{sr}                (CSV imports
 *   only have the SR prefix from the work_order_number, not the WO integer id)
 * - Returns null if neither is available.
 */
function appFolioWoUrl(wo: WorkOrderEntry): string | null {
  if (wo.service_request_id && wo.work_order_id) {
    return `https://appreciateinc.appfolio.com/maintenance/service_requests/${wo.service_request_id}/work_orders/${wo.work_order_id}`;
  }
  if (wo.service_request_id) {
    return `https://appreciateinc.appfolio.com/maintenance/service_requests/${wo.service_request_id}`;
  }
  return null;
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

const TARGET_RATIO = 0.9375;          // 7.5/8 = 93.75% billed / clocked
const TARGET_RATIO_PCT = TARGET_RATIO * 100;
const TARGET_LABEL = '7.5/8 (93.75%)';
const TZ = 'America/Chicago';         // Will + Brett are in Missouri/Kansas
const DEFAULT_HOUR_START = 6;         // 6 AM
const DEFAULT_HOUR_END = 22;          // 10 PM
const PX_PER_HOUR = 36;
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

/** Convert ISO timestamp → fractional hour-of-day (0..24) in the team's local TZ. */
function hourOfDay(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value || '0', 10);
  let h = get('hour'); if (h === 24) h = 0;
  const m = get('minute');
  const s = get('second');
  return h + m / 60 + s / 3600;
}

/** Local date (YYYY-MM-DD) of an ISO timestamp in the team's local TZ. */
function localDateOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Returns a list of time-blocks for a given local day, clipped to that day. */
interface TimeBlock {
  startHour: number;     // inclusive, fractional 0..24
  endHour: number;       // exclusive, fractional 0..24
  spillsToNextDay?: boolean;
}
function blocksForDay(startIso: string, endIso: string | null, dayStr: string): TimeBlock[] {
  const startDate = localDateOf(startIso);
  const endDate = endIso ? localDateOf(endIso) : null;
  const startHour = hourOfDay(startIso) ?? 0;
  const endHour = endIso ? (hourOfDay(endIso) ?? 24) : new Date().getTime() && hourOfDay(new Date().toISOString())!;
  // entirely within one day
  if (startDate === dayStr && (!endDate || endDate === dayStr)) {
    return [{ startHour, endHour: Math.max(endHour, startHour + 0.05) }];
  }
  // shift starts on this day, ends on a later day → clip to 24
  if (startDate === dayStr && endDate && endDate !== dayStr) {
    return [{ startHour, endHour: 24, spillsToNextDay: true }];
  }
  // shift started on a previous day, ends on this day → starts at 0
  if (endDate === dayStr && startDate !== dayStr) {
    return [{ startHour: 0, endHour }];
  }
  return [];
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
              Clocked hours (Rippling) vs billed labor on work orders (AppFolio). Target: <strong>{TARGET_LABEL}</strong> of clocked time billed.
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
            const ratioGood = ratio >= TARGET_RATIO_PCT;
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
    <div className="flex gap-3 text-xs text-slate-400 items-center flex-wrap">
      {tracked.map(w => (
        <span key={w.worker_id} className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: PALETTE_BY_TECH[w.name]?.[0] || '#888' }} />
          {w.name.split(' ')[0]}
        </span>
      ))}
      <span className="text-slate-500 ml-2">
        <span className="inline-block w-3 h-3 align-middle border border-dashed border-slate-500 mr-1"></span>
        Clocked
      </span>
      <span className="text-slate-500">
        <span className="inline-block w-3 h-3 align-middle bg-slate-400 mr-1"></span>
        Work order
      </span>
      <span className="text-slate-500 ml-2">Target: ≥ {TARGET_LABEL} of clocked time billed</span>
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
  // Auto-expand the visible hour range if data falls outside the default
  const { hourStart, hourEnd } = useMemo(() => {
    let earliest = DEFAULT_HOUR_START;
    let latest = DEFAULT_HOUR_END;
    for (const day of Object.keys(byDay)) {
      for (const row of Object.values(byDay[day])) {
        for (const s of row.shifts || []) {
          const sh = hourOfDay(s.start_time); if (sh != null) earliest = Math.min(earliest, sh);
          const eh = hourOfDay(s.end_time);   if (eh != null) latest   = Math.max(latest,   eh);
        }
        for (const wo of row.work_orders || []) {
          const sh = hourOfDay(wo.start_time); if (sh != null) earliest = Math.min(earliest, sh);
          const eh = hourOfDay(wo.end_time);   if (eh != null) latest   = Math.max(latest,   eh);
        }
      }
    }
    return {
      hourStart: Math.max(0, Math.floor(earliest)),
      hourEnd:   Math.min(24, Math.ceil(latest + 0.5)),
    };
  }, [byDay]);

  const totalHours = Math.max(hourEnd - hourStart, 4);
  const gridHeight = totalHours * PX_PER_HOUR;

  return (
    <div className="overflow-x-auto">
      <div className="flex" style={{ minHeight: gridHeight + 60 }}>
        {/* Y-axis (hours of day) */}
        <div className="shrink-0 w-12 relative pt-2" style={{ height: gridHeight }}>
          {Array.from({ length: totalHours + 1 }, (_, i) => hourStart + i).map((h) => {
            const top = (h - hourStart) * PX_PER_HOUR;
            return (
              <div
                key={h}
                className="absolute text-[10px] text-slate-500 right-1.5"
                style={{ top: top - 6 }}
              >
                {h === 24 ? '12 AM' : h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
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
            hourStart={hourStart}
            hourEnd={hourEnd}
            gridHeight={gridHeight}
            onHover={onHover}
          />
        ))}
      </div>
    </div>
  );
}

function DayColumn({ day, tracked, rows, perWoColorMap, hourStart, hourEnd, gridHeight, onHover }: {
  day: string;
  tracked: Worker[];
  rows: Record<string, DayRow>;
  perWoColorMap: Record<string, Record<string, string>>;
  hourStart: number;
  hourEnd: number;
  gridHeight: number;
  onHover: (h: { tech: string; day: string; wo: WorkOrderEntry; x: number; y: number; } | null) => void;
}) {
  const isWeekend = ['Sat', 'Sun'].includes(dayOfWeek(day));
  const isToday = (() => {
    const today = localDateOf(new Date().toISOString());
    return today === day;
  })();

  return (
    <div className={`flex flex-col shrink-0 ${isWeekend ? 'opacity-60' : ''}`}>
      {/* Day header */}
      <div className={`text-center pb-1 mb-0.5 border-b ${isToday ? 'border-indigo-500' : 'border-slate-800'}`}>
        <div className={`text-[10px] font-medium ${isToday ? 'text-indigo-300' : 'text-slate-300'}`}>
          {fmtDate(day)}
        </div>
        <div className={`text-[9px] ${isToday ? 'text-indigo-400' : 'text-slate-600'}`}>
          {dayOfWeek(day)}
        </div>
      </div>

      {/* Two tech tracks side-by-side */}
      <div className="flex gap-px relative" style={{ height: gridHeight }}>
        {/* Hour grid lines (every hour) */}
        {Array.from({ length: hourEnd - hourStart + 1 }, (_, i) => i).map((i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-t border-slate-800/60 pointer-events-none"
            style={{ top: i * PX_PER_HOUR }}
          />
        ))}
        {tracked.map((w) => (
          <TechTrack
            key={w.worker_id}
            tech={w.name}
            day={day}
            row={rows[w.name]}
            colors={perWoColorMap[w.name] || {}}
            hourStart={hourStart}
            gridHeight={gridHeight}
            onHover={onHover}
          />
        ))}
      </div>
    </div>
  );
}

function TechTrack({ tech, day, row, colors, hourStart, gridHeight, onHover }: {
  tech: string;
  day: string;
  row: DayRow | undefined;
  colors: Record<string, string>;
  hourStart: number;
  gridHeight: number;
  onHover: (h: { tech: string; day: string; wo: WorkOrderEntry; x: number; y: number; } | null) => void;
}) {
  const techPalette = PALETTE_BY_TECH[tech]?.[0] ?? '#888';

  if (!row || ((row.shifts?.length ?? 0) === 0 && (row.work_orders?.length ?? 0) === 0)) {
    return (
      <div className="w-12 relative border border-slate-900/40 bg-slate-900/20" style={{ height: gridHeight }}>
      </div>
    );
  }

  const ratio = num(row.clocked_hours) > 0
    ? (num(row.billed_hours) / num(row.clocked_hours)) * 100
    : null;

  return (
    <div className="w-12 relative border border-slate-900/60 bg-slate-900/10" style={{ height: gridHeight }}>
      {/* Clocked-in shifts (background outline + light fill) */}
      {(row.shifts || []).map((s, i) => {
        const blocks = blocksForDay(s.start_time, s.end_time, day);
        return blocks.map((b, j) => {
          const top = (b.startHour - hourStart) * PX_PER_HOUR;
          const height = Math.max((b.endHour - b.startHour) * PX_PER_HOUR, 1);
          return (
            <div
              key={`shift-${i}-${j}`}
              className="absolute left-0 right-0 border border-dashed pointer-events-none"
              style={{
                top, height,
                backgroundColor: `${techPalette}22`,
                borderColor: `${techPalette}66`,
              }}
              title={`Clocked: ${s.start_time?.slice(11, 16)} – ${s.end_time?.slice(11, 16) || 'now'}`}
            />
          );
        });
      })}

      {/* Work-order blocks (foreground, on top of clocked area).
          Two kinds: TIMED (has start_time/end_time → renders at the real
          slot) and UNTIMED (only `hours` recorded → stacks at the start
          of the day's first clocked shift, with a dashed border to signal
          "approximate position"). */}
      {(() => {
        const woList = row.work_orders || [];
        const timed = woList.filter((wo) => !!wo.start_time);
        const untimed = woList.filter((wo) => !wo.start_time && num(wo.hours) > 0);

        // For untimed blocks, anchor at the first shift's start hour (or 9 AM
        // if no shifts on this day). Stack downward in WO order.
        const firstShiftStart =
          row.shifts?.[0]?.start_time != null
            ? hourOfDay(row.shifts[0].start_time)
            : null;
        let untimedCursor = firstShiftStart != null ? firstShiftStart : 9;

        const renderBlock = (
          wo: WorkOrderEntry,
          startHour: number,
          endHour: number,
          keyPrefix: string,
          isApprox: boolean,
        ) => {
          const top = (startHour - hourStart) * PX_PER_HOUR;
          const height = Math.max((endHour - startHour) * PX_PER_HOUR, 4);
          const bg = colors[woKey(wo)] || '#888';
          const url = appFolioWoUrl(wo);
          return (
            <div
              key={keyPrefix}
              role={url ? 'link' : undefined}
              tabIndex={url ? 0 : undefined}
              className={`absolute left-0.5 right-0.5 rounded-sm shadow-md hover:brightness-125 overflow-hidden ${
                url ? 'cursor-pointer' : 'cursor-default'
              } ${isApprox ? 'ring-1 ring-dashed ring-white/40' : ''}`}
              style={{
                top, height, backgroundColor: bg, zIndex: 2,
                ...(isApprox ? { border: '1px dashed rgba(255,255,255,0.6)', opacity: 0.92 } : null),
              }}
              onMouseEnter={(e) =>
                onHover({ tech, day, wo: { ...wo, _approxTime: isApprox } as any, x: e.clientX, y: e.clientY })
              }
              onMouseLeave={() => onHover(null)}
              onClick={() => { if (url) window.open(url, '_blank', 'noopener,noreferrer'); }}
              onKeyDown={(e) => {
                if (url && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  window.open(url, '_blank', 'noopener,noreferrer');
                }
              }}
            >
              {height >= 24 && (
                <div className="text-[8.5px] text-white/95 font-medium px-1 truncate leading-tight">
                  {isApprox ? '≈ ' : ''}#{wo.work_order_number || wo.work_order_id}
                </div>
              )}
              {height >= 36 && wo.unit && (
                <div className="text-[8px] text-white/80 px-1 truncate leading-tight">{wo.unit}</div>
              )}
            </div>
          );
        };

        const els: React.ReactNode[] = [];
        // Render TIMED blocks at their real slots
        timed.forEach((wo, i) => {
          const blocks = blocksForDay(wo.start_time || '', wo.end_time, day);
          blocks.forEach((b, j) => {
            els.push(renderBlock(wo, b.startHour, b.endHour, `wo-${i}-${j}`, false));
          });
        });
        // Render UNTIMED blocks anchored at the first shift, stacking down
        untimed.forEach((wo, i) => {
          const h = num(wo.hours);
          const s = untimedCursor;
          const e = Math.min(s + h, 24);
          els.push(renderBlock(wo, s, e, `wou-${i}`, true));
          untimedCursor = e;
        });
        return els;
      })()}

      {/* Ratio chip at the top of the track */}
      {ratio != null && (
        <div
          className={`absolute top-1 left-1/2 -translate-x-1/2 text-[9px] font-bold z-10 px-1 py-0.5 rounded ${
            ratio >= TARGET_RATIO_PCT ? 'bg-emerald-900/80 text-emerald-200' : 'bg-rose-900/80 text-rose-200'
          }`}
        >
          {Math.round(ratio)}%
        </div>
      )}
    </div>
  );
}

function Tooltip({ x, y, tech, day, wo }: { x: number; y: number; tech: string; day: string; wo: WorkOrderEntry & { _approxTime?: boolean }; }) {
  const woRef = wo.work_order_number || wo.work_order_id || '—';
  const url = appFolioWoUrl(wo);
  const isApprox = !!wo._approxTime;
  return (
    <div
      className="fixed z-50 pointer-events-none bg-slate-900 border border-slate-700 rounded p-2 shadow-xl text-xs max-w-xs"
      style={{ left: Math.min(x + 12, window.innerWidth - 260), top: Math.max(y - 8, 8) }}
    >
      <div className="font-semibold text-slate-100 mb-0.5">{tech} · {fmtDate(day)}</div>
      <div className="text-slate-400">
        WO #{woRef} · <span className="text-emerald-300 font-semibold">{fmtHours(num(wo.hours))}h</span>
        {isApprox && <span className="ml-1 text-amber-300">≈ no clock-in/out</span>}
      </div>
      {wo.property && <div className="text-slate-300 truncate">{wo.property}{wo.unit ? ` · ${wo.unit}` : ''}</div>}
      {wo.issue && <div className="text-slate-300">{wo.issue}</div>}
      {wo.status && <div className="text-slate-500 text-[10px] mt-0.5">{wo.status}</div>}
      {url && <div className="text-indigo-300 text-[10px] mt-0.5">↗ Click to open in AppFolio</div>}
    </div>
  );
}
