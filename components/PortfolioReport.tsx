'use client';

/**
 * PortfolioReport — /admin/portfolio-report
 *
 * On-demand portfolio status page. Third-party observer voice; designed
 * to double as a printable one-pager (Cmd-P / "Save as PDF").
 *
 * Comparison anchors:
 *   Now  · 1 month ago · 3 months ago · earliest available (~last year)
 * Data comes from portfolio_snapshots — see /api/admin/portfolio-report.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '../lib/swr';
import { Printer, RefreshCw, Loader2, ArrowUp, ArrowDown, Minus, Filter, X } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, Legend,
} from 'recharts';

interface Snapshot {
  snapshot_date: string;
  property_id: number;
  property_name: string;
  total_units: number | null;
  occupied: number | null;
  vacant_rented: number | null;
  vacant_unrented: number | null;
  vacant_not_started: number | null;
  vacant_in_progress: number | null;
  vacant_complete: number | null;
  notice_rented: number | null;
  notice_unrented: number | null;
  wt_avg_rent: number | null;
  wt_avg_market_rent: number | null;
  tenants_owing: number | null;
  total_receivable: number | null;
  ar_0_30: number | null;
  ar_30_60: number | null;
  ar_60_90: number | null;
  ar_90_plus: number | null;
  in_collections: number | null;
}

interface AnchorAgg {
  total_units: number; occupied: number;
  vacant_rented: number; vacant_unrented: number;
  vacant_not_started: number; vacant_in_progress: number; vacant_complete: number;
  notice_rented: number; notice_unrented: number;
  wt_avg_rent: number | null; wt_avg_market_rent: number | null;
  tenants_owing: number; total_receivable: number;
  ar_0_30: number; ar_30_60: number; ar_60_90: number; ar_90_plus: number;
  in_collections: number;
}
interface ArSeriesPoint {
  date: string; total_receivable: number;
  ar_0_30: number; ar_30_60: number; ar_60_90: number; ar_90_plus: number;
  ar_under_mgmt: number;
}
interface SameStorePoint { date: string; same_store_ar: number; units_included: number; }
interface AvailableProperty {
  property_id: number;
  property_name: string;         // cleaned
  property_name_full: string;    // raw AppFolio "Name - address" string
  total_units: number | null;
}
interface VacancyRow {
  property_id: number | null;
  property: string;
  unit: string;
  bed_bath: string | null;
  sqft: number | null;
  leasing_status: string;
  rehab_status: string | null;
  market_rent: number | null;
  notice_lease_end: string | null;
  tenant_on_notice: string | null;
}
interface ReportData {
  generated_at: string;
  today: string;
  earliest: string;
  anchor_dates: Record<'now' | 'mo1' | 'mo3' | 'yr1', string | null>;
  properties_by_date: Record<string, Snapshot[]>;
  ar_series_by_property: Record<number, ArSeriesPoint[]>;
  same_store_series_by_property: Record<string, SameStorePoint[]>;  // keyed by cleaned property name
  available_properties: AvailableProperty[];
  vacancies: VacancyRow[];
}

// Property groups for the "quick pick" preset chips. Combines region-based
// groupings (used in app/api/rent-roll/stats) with ownership groupings.
// Farquhar = everything EXCEPT Glen Oaks (per ownership contract) AND — after
// the 2026-04-22 Hilltop sale — no Hilltop either.
const HILLTOP_SOLD = new Date() >= new Date('2026-04-22T00:00:00');
const PROPERTY_PRESETS: Array<{ label: string; matches: (name: string) => boolean }> = [
  // KC metro — matches app/api/rent-roll/stats REGION_PROPERTIES.region_kansas_city
  // Includes Independence (Maple Manor) and downtown KCMO (Ide Lofts) — the KC
  // metro area, not just the city-of-KCK/KCMO limits.
  { label: 'Kansas City metro',
    matches: (n) => /hilltop|oakwood|glen oaks|normandy|maple manor|ide lofts/i.test(n) },
  { label: 'Columbia',
    matches: (n) => /pioneer|sylvan|pecan|washington|fairview|oakland gravel/i.test(n) },
  { label: 'Farquhar',
    matches: (n) => !/glen oaks/i.test(n) && !(HILLTOP_SOLD && /hilltop/i.test(n)) },
];

const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt$c = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toFixed(1)}%`;
const fmtDate = (s?: string) => {
  if (!s) return '—';
  return new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Strip the "- <street>" suffix AppFolio appends to some property names
const cleanName = (s: string) => s.split(' - ')[0].trim();

/**
 * dedupeVacantBuckets — classify each vacant unit into exactly one bucket
 * using a priority ladder so the four buckets sum to total vacancy.
 *
 * Priority (best → worst): Rented → Complete → In Progress → Not Started.
 * Rationale: a leased-but-not-moved-in unit that is also "rehab complete"
 * gets counted in both raw sources; we want it shown only under its most
 * favorable status (Rented). Same logic cascades down the rehab ladder.
 *
 * Slack: if the rehab tracker's total differs from AppFolio's vacant count
 * (source-of-truth mismatch), any residual falls out of the buckets — we
 * intentionally don't invent extra vacancy.
 */
function dedupeVacantBuckets(r: {
  vacant_rented?: number | null;
  vacant_unrented?: number | null;
  vacant_not_started?: number | null;
  vacant_in_progress?: number | null;
  vacant_complete?: number | null;
}) {
  let remaining = (r.vacant_rented ?? 0) + (r.vacant_unrented ?? 0);
  const rented     = Math.min(r.vacant_rented ?? 0,     remaining); remaining -= rented;
  const complete   = Math.min(r.vacant_complete ?? 0,   remaining); remaining -= complete;
  const inProgress = Math.min(r.vacant_in_progress ?? 0, remaining); remaining -= inProgress;
  const notStarted = Math.min(r.vacant_not_started ?? 0, remaining); remaining -= notStarted;
  return { rented, complete, inProgress, notStarted, total: rented + complete + inProgress + notStarted };
}

function pctOcc(a: { occupied: number; total_units: number } | null | undefined) {
  if (!a || !a.total_units) return null;
  return (100 * a.occupied) / a.total_units;
}

function Delta({ current, prior, kind = 'number', invert = false, normDenomNow, normDenomPrior }: {
  current: number | null | undefined;
  prior: number | null | undefined;
  kind?: 'number' | 'currency' | 'percentPoints';
  invert?: boolean;   // true when a decrease is "good" (e.g. receivables)
  // Same-store normalization: when set, delta = (current-prior) - (denomNow-denomPrior).
  // Removes the effect of acquisitions/dispositions on a count metric so a 15-unit
  // acquisition that came with 2 vacancies shows as -2 net (not +13 gross).
  normDenomNow?: number | null;
  normDenomPrior?: number | null;
}) {
  if (current == null || prior == null || Number.isNaN(current) || Number.isNaN(prior)) {
    return <span className="text-gray-400 text-xs">—</span>;
  }
  let diff = current - prior;
  if (normDenomNow != null && normDenomPrior != null) {
    diff -= (normDenomNow - normDenomPrior);
  }
  if (Math.abs(diff) < 0.005) {
    return (
      <span className="text-gray-500 text-xs inline-flex items-center gap-0.5">
        <Minus className="h-3 w-3" /> 0
      </span>
    );
  }
  const good = invert ? diff < 0 : diff > 0;
  const color = good ? 'text-emerald-700' : 'text-red-700';
  const Icon = diff > 0 ? ArrowUp : ArrowDown;
  let label: string;
  if (kind === 'currency') label = fmt$(Math.abs(Math.round(diff)));
  else if (kind === 'percentPoints') label = `${Math.abs(diff).toFixed(1)}%`;
  else label = Math.abs(diff).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return (
    <span className={`${color} text-xs inline-flex items-center gap-0.5 font-medium`}>
      <Icon className="h-3 w-3" />
      {diff > 0 ? '+' : '−'}{label}
    </span>
  );
}

const ANCHOR_LABELS: Record<string, string> = {
  now: 'Now',
  mo1: '1 mo ago',
  mo3: '3 mo ago',
  yr1: 'Earliest',
};

export default function PortfolioReport() {
  // Selected property IDs — empty set = whole portfolio. State persists in the
  // URL so a filtered view can be shared / bookmarked / printed with the same
  // slice reproduced.
  const [selectedIds, setSelectedIds] = useState<number[]>(() => {
    if (typeof window === 'undefined') return [];
    const u = new URL(window.location.href);
    const q = u.searchParams.get('property_ids');
    return q ? q.split(',').map(s => parseInt(s, 10)).filter(Number.isFinite) : [];
  });

  // Sync selection → URL (so refresh / print retains filter, no reload)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const u = new URL(window.location.href);
    if (selectedIds.length > 0) u.searchParams.set('property_ids', selectedIds.join(','));
    else u.searchParams.delete('property_ids');
    window.history.replaceState({}, '', u.toString());
  }, [selectedIds]);

  // Single fetch of the full unfiltered dataset — filter is applied purely
  // client-side so toggling properties is instant.
  const { data, error, isLoading, mutate } = useSWR<ReportData>(
    '/api/admin/portfolio-report', fetcher,
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [pickerOpen]);

  // ── Client-side aggregation memos — recompute instantly when selectedIds
  // changes, no network round-trip needed.
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filterRows = <T extends { property_id: number }>(rows: T[]): T[] =>
    selectedIds.length === 0 ? rows : rows.filter(r => selectedSet.has(r.property_id));

  const nullableSum = (arr: any[], k: string): number | null => {
    let hasAny = false, total = 0;
    for (const r of arr) {
      if (r[k] != null) { hasAny = true; total += Number(r[k]) || 0; }
    }
    return hasAny ? total : null;
  };
  const weightedRent = (arr: any[], amtKey: 'wt_avg_rent' | 'wt_avg_market_rent') => {
    let num = 0, den = 0;
    for (const r of arr) {
      const w = Number(r.total_units) || 0;
      const v = r[amtKey] == null ? null : Number(r[amtKey]);
      if (w && v) { num += w * v; den += w; }
    }
    return den ? Math.round((num / den) * 100) / 100 : null;
  };
  const aggregate = (arr: Snapshot[]): AnchorAgg => ({
    total_units:        nullableSum(arr, 'total_units') as any,
    occupied:           nullableSum(arr, 'occupied') as any,
    vacant_rented:      nullableSum(arr, 'vacant_rented') as any,
    vacant_unrented:    nullableSum(arr, 'vacant_unrented') as any,
    vacant_not_started: nullableSum(arr, 'vacant_not_started') as any,
    vacant_in_progress: nullableSum(arr, 'vacant_in_progress') as any,
    vacant_complete:    nullableSum(arr, 'vacant_complete') as any,
    notice_rented:      nullableSum(arr, 'notice_rented') as any,
    notice_unrented:    nullableSum(arr, 'notice_unrented') as any,
    wt_avg_rent:        weightedRent(arr, 'wt_avg_rent'),
    wt_avg_market_rent: weightedRent(arr, 'wt_avg_market_rent'),
    tenants_owing:      nullableSum(arr, 'tenants_owing') as any,
    total_receivable:   nullableSum(arr, 'total_receivable') as any,
    ar_0_30:            nullableSum(arr, 'ar_0_30') as any,
    ar_30_60:           nullableSum(arr, 'ar_30_60') as any,
    ar_60_90:           nullableSum(arr, 'ar_60_90') as any,
    ar_90_plus:         nullableSum(arr, 'ar_90_plus') as any,
    in_collections:     nullableSum(arr, 'in_collections') as any,
  });

  const anchorAggregates = useMemo(() => {
    if (!data) return { now: undefined, mo1: undefined, mo3: undefined, yr1: undefined } as any;
    const out: Partial<Record<'now'|'mo1'|'mo3'|'yr1', AnchorAgg>> = {};
    for (const key of ['now', 'mo1', 'mo3', 'yr1'] as const) {
      const dt = data.anchor_dates[key];
      if (!dt) continue;
      const rows = filterRows(data.properties_by_date[dt] || []);
      out[key] = aggregate(rows);
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedIds]);

  const propertiesTodayFiltered = useMemo(() => {
    if (!data) return [];
    return filterRows(data.properties_by_date[data.today] || []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedIds]);

  // Aggregate per-property AR series → single portfolio-level series
  const arSeries = useMemo(() => {
    if (!data) return [] as ArSeriesPoint[];
    const bucket: Record<string, ArSeriesPoint> = {};
    const activeIds = selectedIds.length === 0
      ? Object.keys(data.ar_series_by_property).map(Number)
      : selectedIds;
    for (const pid of activeIds) {
      const rows = data.ar_series_by_property[pid] || [];
      for (const r of rows) {
        const cur = bucket[r.date] || (bucket[r.date] = {
          date: r.date, total_receivable: 0, ar_0_30: 0, ar_30_60: 0, ar_60_90: 0, ar_90_plus: 0, ar_under_mgmt: 0,
        });
        cur.total_receivable += r.total_receivable;
        cur.ar_0_30   += r.ar_0_30;
        cur.ar_30_60  += r.ar_30_60;
        cur.ar_60_90  += r.ar_60_90;
        cur.ar_90_plus += r.ar_90_plus;
        cur.ar_under_mgmt += r.ar_under_mgmt;
      }
    }
    return Object.values(bucket).sort((a, b) => a.date.localeCompare(b.date));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedIds]);

  // Aggregate per-property same-store series (keyed by cleaned property name)
  const sameStoreSeries = useMemo(() => {
    if (!data) return [] as SameStorePoint[];
    const nameById = new Map(data.available_properties.map(ap => [ap.property_id, ap.property_name]));
    const activeNames = new Set(
      (selectedIds.length === 0
        ? data.available_properties.map(ap => ap.property_name)
        : selectedIds.map(id => nameById.get(id)).filter(Boolean) as string[]),
    );
    const bucket: Record<string, SameStorePoint> = {};
    for (const [name, rows] of Object.entries(data.same_store_series_by_property)) {
      if (!activeNames.has(name)) continue;
      for (const r of rows) {
        const cur = bucket[r.date] || (bucket[r.date] = { date: r.date, same_store_ar: 0, units_included: 0 });
        cur.same_store_ar += r.same_store_ar;
        cur.units_included += r.units_included;
      }
    }
    return Object.values(bucket).sort((a, b) => a.date.localeCompare(b.date));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedIds]);

  // Vacancies filtered to selected properties
  const vacanciesFiltered = useMemo(() => {
    const all = data?.vacancies || [];
    return selectedIds.length === 0
      ? all
      : all.filter(v => v.property_id != null && selectedSet.has(v.property_id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedIds]);

  if (isLoading) {
    return (
      <div className="p-8 flex items-center gap-3 text-gray-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading portfolio snapshot…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-8 text-red-700">
        Could not load report: {String(error?.message || 'unknown error')}
      </div>
    );
  }

  const now = anchorAggregates.now;
  const mo1 = anchorAggregates.mo1;
  const mo3 = anchorAggregates.mo3;
  const yr1 = anchorAggregates.yr1;

  const pctNow = pctOcc(now || null);
  const pctMo1 = pctOcc(mo1 || null);
  const pctMo3 = pctOcc(mo3 || null);
  const pctYr1 = pctOcc(yr1 || null);

  // The report is a "light document" inside the app's dark chrome — bg-white
  // + text-gray-900 on the outer wrapper so every descendant inherits dark
  // text, and children only need to override colors where semantic.
  return (
    <div className="max-w-7xl mx-auto p-6 print:p-2 print:max-w-none">
      {/* Print styles — tightened for paper: no wasted whitespace, no
          duplicate legends, and layout that starts each section high on its
          page so scannable data stays above the fold. */}
      <style jsx global>{`
        @media print {
          @page { size: letter landscape; margin: 0.3in 0.4in; }
          html, body { background: white !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-size: 10.5px !important; }

          /* Hide app chrome */
          aside, nav { display: none !important; }
          main { margin-left: 0 !important; }

          .no-print { display: none !important; }
          .print-break-before { page-break-before: always; }
          .print-avoid-break { page-break-inside: avoid; }
          .print-only { display: block !important; }

          /* Report card: strip screen-only decorations */
          .report-card { box-shadow: none !important; padding: 4px !important; ring-width: 0 !important; }
          .report-card > * + * { margin-top: 0 !important; }

          h1 { font-size: 16px !important; margin: 0 !important; }
          h2 { font-size: 11.5px !important; margin: 6px 0 3px !important; }
          p  { margin: 0 !important; }

          /* KPI grid: 4 columns × 2 rows, compact */
          .kpi-grid { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; gap: 6px !important; margin-bottom: 8px !important; }
          .kpi-grid > div { padding: 4px 6px !important; }
          .kpi-grid .kpi-value { font-size: 15px !important; }
          .kpi-grid .kpi-label { font-size: 8.5px !important; }
          .kpi-grid .kpi-row { font-size: 9px !important; line-height: 1.15 !important; }

          /* Chart + readout: explicit CSS Grid so Recharts' ResponsiveContainer
             gets a known-narrower column and never renders on top of the readout.
             (Flex with flex-1 races the ResizeObserver in print media.) */
          .chart-with-readout {
            display: grid !important;
            grid-template-columns: minmax(0, 1fr) 200px !important;
            gap: 10px !important;
          }
          .chart-with-readout .chart-box { width: 100% !important; height: 220px !important; }
          .chart-with-readout .readout {
            width: 200px !important;
            padding-left: 8px !important;
            border-left: 1px solid #E5E7EB !important;
          }
          .chart-with-readout .readout .readout-rows { font-size: 9px !important; }

          /* Hide Recharts' built-in legend everywhere — the SeriesReadout side
             panel already labels every line, so the browser legend is just
             clutter under the plot. */
          .recharts-legend-wrapper { display: none !important; }

          /* Sections + tables: tight vertical rhythm */
          section { margin-bottom: 6px !important; }
          table    { font-size: 9.5px !important; }
          thead    { display: table-header-group; }  /* repeat headers on new pages */
          tr, td, th { page-break-inside: avoid !important; }
          td, th   { padding: 2px 5px !important; }

          /* Charts should stay together with their headings */
          .chart-section h2 + p, .chart-section h2 { page-break-after: avoid !important; }
        }
      `}</style>

      <div className="rounded-lg bg-white text-gray-900 shadow-lg ring-1 ring-gray-200 p-6 print:p-2 print:shadow-none print:ring-0 report-card">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Portfolio Status Report</h1>
          <p className="text-sm text-gray-700 mt-0.5">
            Appreciate Inc &nbsp;·&nbsp; As of {fmtDate(data.today)}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Data window: {fmtDate(data.earliest)} → {fmtDate(data.today)}. Comparison anchors:{' '}
            {(['now', 'mo1', 'mo3', 'yr1'] as const)
              .filter((k) => data.anchor_dates[k])
              .map((k) => `${ANCHOR_LABELS[k]} (${fmtDate(data.anchor_dates[k]!)})`)
              .join(' · ')}
          </p>
        </div>
        <div className="flex gap-2 no-print items-start">
          {/* Property multi-select */}
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Filter className="h-4 w-4" />
              {selectedIds.length === 0
                ? 'All properties'
                : `${selectedIds.length} of ${(data.available_properties ?? []).length}`}
            </button>
            {pickerOpen && (
              <div className="absolute right-0 top-full mt-1 z-30 w-80 rounded-md border border-gray-300 bg-white shadow-lg text-gray-900">
                <div className="p-2 border-b border-gray-200">
                  <div className="text-[10px] uppercase text-gray-500 font-semibold tracking-wide mb-1.5">
                    Quick presets
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      onClick={() => setSelectedIds([])}
                      className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                    >
                      All
                    </button>
                    {PROPERTY_PRESETS.map((p) => {
                      const ids = (data.available_properties ?? [])
                        .filter((ap) => p.matches(ap.property_name))
                        .map((ap) => ap.property_id);
                      const disabled = ids.length === 0;
                      return (
                        <button
                          key={p.label}
                          disabled={disabled}
                          onClick={() => setSelectedIds(ids)}
                          className={`text-xs px-2 py-1 rounded border ${disabled ? 'border-gray-200 text-gray-400 cursor-not-allowed' : 'border-gray-300 hover:bg-gray-50'}`}
                        >
                          {p.label} ({ids.length})
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto p-2">
                  <div className="text-[10px] uppercase text-gray-500 font-semibold tracking-wide mb-1.5">
                    Individual properties
                  </div>
                  {(data.available_properties ?? []).map((ap) => {
                    const checked = selectedIds.includes(ap.property_id);
                    return (
                      <label
                        key={ap.property_id}
                        className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer text-sm"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedIds((prev) =>
                                checked
                                  ? prev.filter((id) => id !== ap.property_id)
                                  : [...prev, ap.property_id],
                              )
                            }
                            className="h-3.5 w-3.5"
                          />
                          <span className="truncate">{ap.property_name}</span>
                        </span>
                        <span className="text-xs text-gray-500 flex-none">
                          {ap.total_units ?? '—'} u
                        </span>
                      </label>
                    );
                  })}
                </div>
                {selectedIds.length > 0 && (
                  <div className="border-t border-gray-200 p-2 flex justify-end">
                    <button
                      onClick={() => setSelectedIds([])}
                      className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"
                    >
                      <X className="h-3 w-3" /> Clear selection
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => mutate()}
            className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1 rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800"
          >
            <Printer className="h-4 w-4" /> Save as PDF
          </button>
        </div>
      </div>

      {/* When filtered, show which properties are active (visible in print too) */}
      {selectedIds.length > 0 && (data.available_properties ?? []).length > 0 && (
        <div className="mb-3 text-xs text-gray-700 print-avoid-break">
          <span className="font-semibold">Filter active:</span>{' '}
          {(data.available_properties ?? [])
            .filter((ap) => selectedIds.includes(ap.property_id))
            .map((ap) => ap.property_name)
            .join(', ')}
        </div>
      )}

      {/* KPI strip with deltas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 print-avoid-break kpi-grid">
        <KpiCard
          label="Physical Occupancy"
          value={pctNow == null ? '—' : `${pctNow.toFixed(1)}%`}
          rows={[
            ['vs 1 mo ago', <Delta key="m1" current={pctNow} prior={pctMo1} kind="percentPoints" />],
            ['vs 3 mo ago', <Delta key="m3" current={pctNow} prior={pctMo3} kind="percentPoints" />],
            ['vs earliest', <Delta key="y1" current={pctNow} prior={pctYr1} kind="percentPoints" />],
          ]}
        />
        <KpiCard
          label="Units Occupied"
          value={now ? `${now.occupied}/${now.total_units}` : '—'}
          rows={[
            ['vs 1 mo ago (same-store)', <Delta key="m1" current={now?.occupied} prior={mo1?.occupied} normDenomNow={now?.total_units} normDenomPrior={mo1?.total_units} />],
            ['vs 3 mo ago (same-store)', <Delta key="m3" current={now?.occupied} prior={mo3?.occupied} normDenomNow={now?.total_units} normDenomPrior={mo3?.total_units} />],
            ['vs earliest (same-store)', <Delta key="y1" current={now?.occupied} prior={yr1?.occupied} normDenomNow={now?.total_units} normDenomPrior={yr1?.total_units} />],
          ]}
        />
        <KpiCard
          label="In-Place Rent (wt. avg)"
          value={fmt$(now?.wt_avg_rent ?? null)}
          rows={[
            ['vs 1 mo ago', <Delta key="m1" current={now?.wt_avg_rent} prior={mo1?.wt_avg_rent} kind="currency" />],
            ['vs 3 mo ago', <Delta key="m3" current={now?.wt_avg_rent} prior={mo3?.wt_avg_rent} kind="currency" />],
            ['vs earliest', <Delta key="y1" current={now?.wt_avg_rent} prior={yr1?.wt_avg_rent} kind="currency" />],
          ]}
        />
        <KpiCard
          label="Market Rent (wt. avg)"
          value={fmt$(now?.wt_avg_market_rent ?? null)}
          rows={[
            ['vs 1 mo ago', <Delta key="m1" current={now?.wt_avg_market_rent} prior={mo1?.wt_avg_market_rent} kind="currency" />],
            ['vs 3 mo ago', <Delta key="m3" current={now?.wt_avg_market_rent} prior={mo3?.wt_avg_market_rent} kind="currency" />],
            ['vs earliest', <Delta key="y1" current={now?.wt_avg_market_rent} prior={yr1?.wt_avg_market_rent} kind="currency" />],
          ]}
        />
        <KpiCard
          label="Gross Receivable"
          value={fmt$(now?.total_receivable ?? null)}
          rows={[
            ['vs 1 mo ago', <Delta key="m1" current={now?.total_receivable} prior={mo1?.total_receivable} kind="currency" invert />],
            ['vs 3 mo ago', <Delta key="m3" current={now?.total_receivable} prior={mo3?.total_receivable} kind="currency" invert />],
            ['vs earliest', <Delta key="y1" current={now?.total_receivable} prior={yr1?.total_receivable} kind="currency" invert />],
          ]}
        />
        <KpiCard
          label="Tenants w/ balance"
          value={now?.tenants_owing?.toString() ?? '—'}
          rows={[
            ['vs 1 mo ago', <Delta key="m1" current={now?.tenants_owing} prior={mo1?.tenants_owing} invert />],
            ['vs 3 mo ago', <Delta key="m3" current={now?.tenants_owing} prior={mo3?.tenants_owing} invert />],
            ['vs earliest', <Delta key="y1" current={now?.tenants_owing} prior={yr1?.tenants_owing} invert />],
          ]}
        />
        <KpiCard
          label="AR 30+ days"
          value={fmt$((now?.ar_30_60 ?? 0) + (now?.ar_60_90 ?? 0) + (now?.ar_90_plus ?? 0))}
          rows={[
            ['0–30', fmt$(now?.ar_0_30 ?? null)],
            ['30–60', fmt$(now?.ar_30_60 ?? null)],
            ['60–90', fmt$(now?.ar_60_90 ?? null)],
            ['90+', fmt$(now?.ar_90_plus ?? null)],
          ]}
        />
        {(() => {
          const v = dedupeVacantBuckets(now || {});
          return (
            <KpiCard
              label="Vacancy status"
              value={String(v.total)}
              rows={[
                ['Rented (awaiting M/I)', String(v.rented)],
                ['Complete',              String(v.complete)],
                ['In progress',           String(v.inProgress)],
                ['Not started',           String(v.notStarted)],
                ['On notice',             String((now?.notice_rented ?? 0) + (now?.notice_unrented ?? 0))],
              ]}
            />
          );
        })()}
      </div>

      {/* Gross receivables over time (daily) */}
      <div className="mb-6 print-avoid-break chart-section">
        <h2 className="text-base font-semibold text-gray-900 mb-2">Gross receivables over time</h2>
        <div className="border border-gray-200 rounded-md bg-white text-gray-900 p-3">
          <div className="flex gap-4 chart-with-readout">
            <div className="flex-1 min-w-0 chart-box" style={{ height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={arSeries} margin={{ top: 6, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: any) => fmt$c(v as number)}
                    labelFormatter={(l) => fmtDate(l as string)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="ar_under_mgmt"    name="Total AR under management (rent + subsidy + fees)" stroke="#166534" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="total_receivable" name="Total AR" stroke="#1F4E79" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="ar_0_30"    name="0–30d"   stroke="#7AA6D9" strokeWidth={1} dot={false} strokeDasharray="4 3" />
                  <Line type="monotone" dataKey="ar_30_60"   name="30–60d"  stroke="#F0B429" strokeWidth={1} dot={false} strokeDasharray="4 3" />
                  <Line type="monotone" dataKey="ar_60_90"   name="60–90d"  stroke="#E67700" strokeWidth={1} dot={false} strokeDasharray="4 3" />
                  <Line type="monotone" dataKey="ar_90_plus" name="90+d"    stroke="#B71C1C" strokeWidth={1} dot={false} strokeDasharray="4 3" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <SeriesReadout
              title={`Current (${fmtDate(data.today)})`}
              rows={(() => {
                const last = arSeries[arSeries.length - 1];
                if (!last) return [];
                return [
                  { color: '#166534', label: 'AR under mgmt', value: last.ar_under_mgmt, bold: true },
                  { color: '#1F4E79', label: 'Total AR',      value: last.total_receivable, bold: true },
                  { color: '#7AA6D9', label: '0–30d',         value: last.ar_0_30 },
                  { color: '#F0B429', label: '30–60d',        value: last.ar_30_60 },
                  { color: '#E67700', label: '60–90d',        value: last.ar_60_90 },
                  { color: '#B71C1C', label: '90+d',          value: last.ar_90_plus },
                ];
              })()}
            />
          </div>
        </div>
      </div>

      {/* Same-store AR growth on units currently held */}
      <div className="mb-6 print-avoid-break">
        <h2 className="text-base font-semibold text-gray-900 mb-2">
          Same-store AR growth (organic, current units only)
        </h2>
        <p className="text-xs text-gray-600 mb-2">
          Cumulative growth in monthly AR under management for units currently in the portfolio,
          each starting at its own acquisition-day baseline. A newly-acquired unit contributes $0
          on acquisition day and only starts contributing as its rent grows — acquisition steps
          don&apos;t distort the trend.
        </p>
        <div className="border border-gray-200 rounded-md bg-white text-gray-900 p-3">
          <div className="flex gap-4 chart-with-readout">
            <div className="flex-1 min-w-0 chart-box" style={{ height: 240 }}>
              <ResponsiveContainer>
                <LineChart data={sameStoreSeries} margin={{ top: 6, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v >= 0 ? '+' : '-'}$${Math.abs(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: any, name: string) => {
                      if (name === 'units_included') return [Math.round(v as number), 'Units w/ data'];
                      const n = Number(v);
                      return [`${n >= 0 ? '+' : '-'}${fmt$c(Math.abs(n))}`, 'Same-store AR growth'];
                    }}
                    labelFormatter={(l) => fmtDate(l as string)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="same_store_ar" name="Cumulative organic AR growth" stroke="#166534" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <SeriesReadout
              title={`Current (${fmtDate(data.today)})`}
              rows={(() => {
                const last = sameStoreSeries[sameStoreSeries.length - 1];
                const first = sameStoreSeries[0];
                if (!last) return [];
                return [
                  { color: '#166534', label: 'Organic growth', value: last.same_store_ar, bold: true, signed: true },
                  { color: '#666',    label: 'Units contributing', value: last.units_included, kind: 'count' },
                  { color: '#666',    label: 'Series start',    text: first ? fmtDate(first.date) : '—' },
                ];
              })()}
            />
          </div>
        </div>
      </div>

      {/* Per-property occupancy + rent */}
      <PropertyTable
        title="Per-property occupancy & rent"
        rowsNow={propertiesTodayFiltered}
        rowsMo1={data.anchor_dates.mo1
          ? filterRows(data.properties_by_date[data.anchor_dates.mo1] || [])
          : []}
      />

      {/* Current vacancies */}
      <VacanciesTable rows={vacanciesFiltered} />

      {/* Per-property delinquency */}
      <PropertyDelinqTable
        title="Per-property delinquency"
        rowsNow={propertiesTodayFiltered}
        rowsMo1={data.anchor_dates.mo1
          ? filterRows(data.properties_by_date[data.anchor_dates.mo1] || [])
          : []}
      />

      <p className="text-[10px] text-gray-500 mt-6">
        Data source: portfolio_snapshots (daily snapshot table). AR history from{' '}
        {fmtDate(data.earliest)}. Occupancy/market-rent history begins the day the daily capture
        cron started running — deltas that fall inside the pre-capture window read as flat because
        the anchor row was seeded from today's occupancy back-fill. Report generated {new Date(data.generated_at).toLocaleString()}.
      </p>
      </div>
    </div>
  );
}

/**
 * SeriesReadout — colored numeric legend rendered next to a line chart so
 * printed / saved-as-PDF versions of the report don't require hovering the
 * tooltip to see today's values. Each row shows a colored dot matching the
 * line, a label, and the current value.
 */
function SeriesReadout({ title, rows }: {
  title: string;
  rows: Array<{
    color: string;
    label: string;
    value?: number | null;
    text?: string;
    bold?: boolean;
    signed?: boolean;   // prepend + / − for growth metrics
    kind?: 'currency' | 'count';
  }>;
}) {
  return (
    <div className="hidden sm:block flex-none w-60 pl-3 border-l border-gray-200 readout">
      <div className="text-[10px] uppercase text-gray-500 font-semibold tracking-wide mb-1">
        {title}
      </div>
      <div className="space-y-1 readout-rows">
        {rows.map((r) => {
          let display: string;
          if (r.text != null) display = r.text;
          else if (r.value == null) display = '—';
          else if (r.kind === 'count') display = Math.round(r.value).toLocaleString('en-US');
          else if (r.signed) {
            const sign = r.value > 0 ? '+' : r.value < 0 ? '−' : '';
            display = `${sign}${fmt$(Math.abs(r.value))}`;
          } else display = fmt$(r.value);
          return (
            <div key={r.label} className="flex items-baseline gap-2 text-xs leading-tight">
              <span
                className="inline-block h-2 w-2 rounded-full flex-none translate-y-[2px]"
                style={{ backgroundColor: r.color }}
                aria-hidden
              />
              <span className="text-gray-600 flex-1 min-w-0">{r.label}</span>
              <span className={`text-gray-900 tabular-nums whitespace-nowrap ${r.bold ? 'font-semibold' : ''}`}>
                {display}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KpiCard({ label, value, rows }: { label: string; value: string; rows: [string, React.ReactNode][] }) {
  return (
    <div className="border border-gray-200 rounded-md bg-gray-50 text-gray-900 p-3 print-avoid-break">
      <div className="text-[11px] uppercase text-gray-600 font-semibold tracking-wide kpi-label">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-0.5 kpi-value">{value}</div>
      <div className="mt-2 space-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-xs kpi-row">
            <span className="text-gray-600">{k}</span>
            <span className="text-gray-900 font-medium">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PropertyTable({
  title, rowsNow, rowsMo1,
}: {
  title: string;
  rowsNow: Snapshot[];
  rowsMo1: Snapshot[] | undefined;
}) {
  const priorByPid: Record<number, Snapshot> = {};
  for (const r of rowsMo1 || []) priorByPid[r.property_id] = r;

  const sorted = [...rowsNow].sort((a, b) => (b.total_units || 0) - (a.total_units || 0));
  const totals = rowsNow.reduce(
    (acc, r) => {
      acc.units += r.total_units || 0;
      acc.occ   += r.occupied || 0;
      return acc;
    },
    { units: 0, occ: 0 },
  );

  return (
    <section className="mb-6 print-avoid-break">
      <h2 className="text-base font-semibold text-gray-900 mb-2">{title}</h2>
      <div className="overflow-x-auto border border-gray-200 rounded-md bg-white">
        <table className="w-full text-sm text-gray-900">
          <thead className="bg-gray-100 sticky top-0 z-10">
            <tr className="text-xs uppercase text-gray-700">
              <th className="text-left px-3 py-2" rowSpan={2}>Property</th>
              <th className="text-right px-2 py-2" rowSpan={2}>Units</th>
              <th className="text-right px-2 py-2" rowSpan={2}>Occ</th>
              <th className="text-center px-2 py-2 border-b border-gray-200" colSpan={4}>Vacancy (best → worst)</th>
              <th className="text-right px-2 py-2" rowSpan={2}>Notice</th>
              <th className="text-right px-2 py-2" rowSpan={2}>% Occ</th>
              <th className="text-right px-2 py-2" rowSpan={2}>Δ 1 mo</th>
              <th className="text-right px-2 py-2" rowSpan={2}>In-Place</th>
              <th className="text-right px-2 py-2" rowSpan={2}>Market</th>
              <th className="text-right px-2 py-2" rowSpan={2}>Δ / Unit</th>
            </tr>
            <tr className="text-[10px] text-gray-600">
              <th className="text-right px-2 py-1 font-normal">Rented</th>
              <th className="text-right px-2 py-1 font-normal">Complete</th>
              <th className="text-right px-2 py-1 font-normal">In prog</th>
              <th className="text-right px-2 py-1 font-normal">Not started</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map((r) => {
              const prior = priorByPid[r.property_id];
              const pctNow = r.total_units ? (100 * (r.occupied || 0)) / r.total_units : null;
              const pctPrior = prior?.total_units ? (100 * (prior.occupied || 0)) / prior.total_units : null;
              const delta = r.wt_avg_rent != null && r.wt_avg_market_rent != null
                ? r.wt_avg_rent - r.wt_avg_market_rent : null;
              const v = dedupeVacantBuckets(r);
              return (
                <tr key={r.property_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-900">{cleanName(r.property_name)}</td>
                  <td className="px-2 py-2 text-right">{r.total_units ?? '—'}</td>
                  <td className="px-2 py-2 text-right">{r.occupied ?? '—'}</td>
                  <td className="px-2 py-2 text-right">{v.rented || '—'}</td>
                  <td className="px-2 py-2 text-right">{v.complete || '—'}</td>
                  <td className="px-2 py-2 text-right">{v.inProgress || '—'}</td>
                  <td className="px-2 py-2 text-right">{v.notStarted || '—'}</td>
                  <td className="px-2 py-2 text-right">{(r.notice_rented ?? 0) + (r.notice_unrented ?? 0)}</td>
                  <td className="px-2 py-2 text-right">{fmtPct(pctNow)}</td>
                  <td className="px-2 py-2 text-right">
                    <Delta current={pctNow} prior={pctPrior} kind="percentPoints" />
                  </td>
                  <td className="px-2 py-2 text-right">{fmt$(r.wt_avg_rent)}</td>
                  <td className="px-2 py-2 text-right">{fmt$(r.wt_avg_market_rent)}</td>
                  <td className={`px-2 py-2 text-right font-medium ${delta == null ? '' : delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${fmt$(delta)}`}
                  </td>
                </tr>
              );
            })}
            {(() => {
              const tot = rowsNow.reduce((acc, r) => {
                const v = dedupeVacantBuckets(r);
                acc.rented += v.rented; acc.complete += v.complete;
                acc.inProgress += v.inProgress; acc.notStarted += v.notStarted;
                return acc;
              }, { rented: 0, complete: 0, inProgress: 0, notStarted: 0 });
              return (
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-3 py-2">Portfolio</td>
                  <td className="px-2 py-2 text-right">{totals.units}</td>
                  <td className="px-2 py-2 text-right">{totals.occ}</td>
                  <td className="px-2 py-2 text-right">{tot.rented}</td>
                  <td className="px-2 py-2 text-right">{tot.complete}</td>
                  <td className="px-2 py-2 text-right">{tot.inProgress}</td>
                  <td className="px-2 py-2 text-right">{tot.notStarted}</td>
                  <td className="px-2 py-2 text-right"></td>
                  <td className="px-2 py-2 text-right">{totals.units ? fmtPct((100 * totals.occ) / totals.units) : '—'}</td>
                  <td className="px-2 py-2 text-right" colSpan={4}></td>
                </tr>
              );
            })()}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * VacanciesTable — every currently vacant or on-notice unit, with leasing
 * status, latest rehab status, market rent, and the tenant + lease-end for
 * notice units. Grouped visually by property with a subtotal row.
 */
function VacanciesTable({ rows }: { rows: VacancyRow[] }) {
  const RANK: Record<string, number> = {
    'Vacant-Rented': 1, 'Complete': 2, 'Vacant-Complete': 2,
    'In Progress': 3, 'Waiting': 4, 'Back Burner': 5, 'Supervisor Onboard': 6,
    'Not Started': 7, 'Vacant-Unrented': 8, 'Notice-Unrented': 9,
  };
  const rank = (r: VacancyRow) =>
    (RANK[r.leasing_status ?? ''] ?? RANK[r.rehab_status ?? ''] ?? 99);
  const sorted = [...rows].sort((a, b) => {
    if (a.property !== b.property) return a.property.localeCompare(b.property);
    return rank(a) - rank(b);
  });

  // Portfolio subtotals
  const totalMarket = sorted.reduce((s, r) => s + (r.market_rent || 0), 0);

  const statusPill = (r: VacancyRow) => {
    let text = r.leasing_status || '—';
    let cls  = 'bg-gray-100 text-gray-700';
    if (r.leasing_status === 'Vacant-Rented')      { text = 'Rented — awaiting M/I'; cls = 'bg-emerald-100 text-emerald-800'; }
    else if (r.leasing_status === 'Notice-Unrented') { text = `Notice · ends ${r.notice_lease_end || '—'}`; cls = 'bg-amber-100 text-amber-800'; }
    else if (r.leasing_status?.startsWith('Vacant')) { text = 'Vacant'; cls = 'bg-red-100 text-red-800'; }
    return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>{text}</span>;
  };

  const rehabPill = (r: VacancyRow) => {
    const s = r.rehab_status || '—';
    let cls = 'bg-gray-100 text-gray-600';
    if (/complete|rented/i.test(s)) cls = 'bg-emerald-100 text-emerald-700';
    else if (/in progress|waiting|onboard/i.test(s)) cls = 'bg-blue-100 text-blue-700';
    else if (/back burner/i.test(s)) cls = 'bg-purple-100 text-purple-700';
    else if (/not started/i.test(s)) cls = 'bg-red-100 text-red-700';
    return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>{s}</span>;
  };

  return (
    <section className="mb-6 print-avoid-break">
      <h2 className="text-base font-semibold text-gray-900 mb-2">
        Current vacancies <span className="text-sm font-normal text-gray-600">({sorted.length})</span>
      </h2>
      {sorted.length === 0 ? (
        <div className="border border-gray-200 rounded-md bg-white text-gray-600 text-sm p-4">
          No vacant or notice units in the selected properties.
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-md bg-white">
          <table className="w-full text-sm text-gray-900">
            <thead className="bg-gray-100 sticky top-0 z-10">
              <tr className="text-xs uppercase text-gray-700">
                <th className="text-left px-3 py-2">Property</th>
                <th className="text-left px-2 py-2">Unit</th>
                <th className="text-left px-2 py-2">Bed/Bath</th>
                <th className="text-right px-2 py-2">Sqft</th>
                <th className="text-left px-2 py-2">Leasing status</th>
                <th className="text-left px-2 py-2">Rehab status</th>
                <th className="text-right px-2 py-2">Market rent</th>
                <th className="text-left px-2 py-2">Tenant on notice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((r) => (
                <tr key={`${r.property}-${r.unit}`} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5">{cleanName(r.property)}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{r.unit}</td>
                  <td className="px-2 py-1.5 text-gray-700">{r.bed_bath || '—'}</td>
                  <td className="px-2 py-1.5 text-right text-gray-700">{r.sqft ? r.sqft.toLocaleString('en-US') : '—'}</td>
                  <td className="px-2 py-1.5">{statusPill(r)}</td>
                  <td className="px-2 py-1.5">{rehabPill(r)}</td>
                  <td className="px-2 py-1.5 text-right font-medium">{fmt$(r.market_rent)}</td>
                  <td className="px-2 py-1.5 text-gray-700">{r.tenant_on_notice || ''}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-semibold">
                <td className="px-3 py-2" colSpan={6}>Subtotal · monthly market rent at risk</td>
                <td className="px-2 py-2 text-right">{fmt$(totalMarket)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PropertyDelinqTable({
  title, rowsNow, rowsMo1,
}: {
  title: string;
  rowsNow: Snapshot[];
  rowsMo1: Snapshot[] | undefined;
}) {
  const priorByPid: Record<number, Snapshot> = {};
  for (const r of rowsMo1 || []) priorByPid[r.property_id] = r;

  const sorted = [...rowsNow].sort((a, b) => (b.total_receivable || 0) - (a.total_receivable || 0));
  const totals = rowsNow.reduce(
    (acc, r) => {
      acc.tenants += r.tenants_owing || 0;
      acc.ar      += r.total_receivable || 0;
      acc.a30     += r.ar_0_30 || 0;
      acc.a60     += r.ar_30_60 || 0;
      acc.a90     += r.ar_60_90 || 0;
      acc.a90p    += r.ar_90_plus || 0;
      acc.col     += r.in_collections || 0;
      return acc;
    },
    { tenants: 0, ar: 0, a30: 0, a60: 0, a90: 0, a90p: 0, col: 0 },
  );

  return (
    <section className="mb-6 print-avoid-break">
      <h2 className="text-base font-semibold text-gray-900 mb-2">{title}</h2>
      <div className="overflow-x-auto border border-gray-200 rounded-md bg-white">
        <table className="w-full text-sm text-gray-900">
          <thead className="bg-gray-100 sticky top-0 z-10">
            <tr className="text-xs uppercase text-gray-700">
              <th className="text-left px-3 py-2">Property</th>
              <th className="text-right px-2 py-2">Tenants</th>
              <th className="text-right px-2 py-2">Total AR</th>
              <th className="text-right px-2 py-2">Δ 1 mo</th>
              <th className="text-right px-2 py-2">0–30</th>
              <th className="text-right px-2 py-2">30–60</th>
              <th className="text-right px-2 py-2">60–90</th>
              <th className="text-right px-2 py-2">90+</th>
              <th className="text-right px-2 py-2">In Coll.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map((r) => {
              const prior = priorByPid[r.property_id];
              return (
                <tr key={r.property_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-900">{cleanName(r.property_name)}</td>
                  <td className="px-2 py-2 text-right">{r.tenants_owing ?? '—'}</td>
                  <td className="px-2 py-2 text-right">{fmt$(r.total_receivable)}</td>
                  <td className="px-2 py-2 text-right">
                    <Delta current={r.total_receivable} prior={prior?.total_receivable} kind="currency" invert />
                  </td>
                  <td className="px-2 py-2 text-right">{fmt$(r.ar_0_30)}</td>
                  <td className="px-2 py-2 text-right">{fmt$(r.ar_30_60)}</td>
                  <td className="px-2 py-2 text-right">{fmt$(r.ar_60_90)}</td>
                  <td className={`px-2 py-2 text-right ${(r.ar_90_plus || 0) > 0 ? 'text-red-700 font-medium' : ''}`}>
                    {fmt$(r.ar_90_plus)}
                  </td>
                  <td className="px-2 py-2 text-right">{r.in_collections ?? 0}</td>
                </tr>
              );
            })}
            <tr className="bg-gray-50 font-semibold">
              <td className="px-3 py-2">Portfolio</td>
              <td className="px-2 py-2 text-right">{totals.tenants}</td>
              <td className="px-2 py-2 text-right">{fmt$(totals.ar)}</td>
              <td className="px-2 py-2 text-right"></td>
              <td className="px-2 py-2 text-right">{fmt$(totals.a30)}</td>
              <td className="px-2 py-2 text-right">{fmt$(totals.a60)}</td>
              <td className="px-2 py-2 text-right">{fmt$(totals.a90)}</td>
              <td className="px-2 py-2 text-right">{fmt$(totals.a90p)}</td>
              <td className="px-2 py-2 text-right">{totals.col}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
