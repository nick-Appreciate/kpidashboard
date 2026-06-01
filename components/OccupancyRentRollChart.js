'use client';

/**
 * OccupancyRentRollChart
 *
 * Line chart of scheduled rent & charges DUE over time on the /occupancy
 * page. One data point per day (rent_roll_snapshots is captured daily).
 * Two modes:
 *   "All rent & charges" — single line summing total_rent across all units
 *   "By GL"              — multiselect; one line per selected GL column
 *
 * Data source: GET /api/occupancy/rent-roll-over-time (backed by the
 * v_rent_roll_daily_sum view — per-day cross-unit sum).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { CHART_PALETTE, DARK_CHART_DEFAULTS } from '../lib/chartTheme';

// Pretty-print "2026-04-15" as "Apr 15 '26"
const fmtDateAxis = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
const fmtDateWithYear = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

const fmtCurrencyShort = (n) => {
  const abs = Math.abs(Number(n) || 0);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
};
const fmtCurrencyFull = (n) =>
  `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function OccupancyRentRollChart() {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  // 'all' = single aggregate line. 'by_gl' = one line per selected GL.
  const [mode, setMode] = useState('all');
  const [selectedGls, setSelectedGls] = useState([]); // array of GL number strings
  const [pickerOpen, setPickerOpen] = useState(false);

  const [glOptions, setGlOptions] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (mode === 'by_gl' && selectedGls.length > 0) {
      params.set('gls', selectedGls.join(','));
    }
    // Else: omit gls → API returns the All-rent-and-charges aggregate
    const q = params.toString();
    return `/api/occupancy/rent-roll-over-time${q ? `?${q}` : ''}`;
  }, [mode, selectedGls]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(fetchUrl);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const j = await res.json();
      setData(j);
      // glOptions is stable; only update on first load to keep order
      if (glOptions.length === 0 && Array.isArray(j.glOptions)) {
        setGlOptions(j.glOptions);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchUrl, glOptions.length]);

  useEffect(() => { reload(); }, [reload]);

  // Render / re-render the Chart.js line chart whenever data changes
  useEffect(() => {
    if (!canvasRef.current || !data) return;

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const labels = (data.points || []).map(fmtDateAxis);
    const datasets = (data.series || []).map((s, i) => {
      const color = CHART_PALETTE[i % CHART_PALETTE.length];
      return {
        label: s.name,
        // Null amounts render as gaps (per-GL breakdown isn't populated
        // for older snapshots). The chart respects null when spanGaps
        // is false (the default).
        data: s.points.map(p => p.amount == null ? null : Number(p.amount)),
        borderColor: color,
        backgroundColor: color + '33',
        tension: 0.15,
        // Daily granularity means a lot of points — hide markers by
        // default and only show on hover so the line stays readable.
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 6,
        borderWidth: 1.75,
        fill: data.series.length === 1,
      };
    });

    const ctx = canvasRef.current.getContext('2d');
    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        ...DARK_CHART_DEFAULTS,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          ...DARK_CHART_DEFAULTS.plugins,
          tooltip: {
            ...(DARK_CHART_DEFAULTS.plugins?.tooltip || {}),
            callbacks: {
              title: (items) => {
                const idx = items?.[0]?.dataIndex;
                const iso = data?.points?.[idx];
                return iso ? fmtDateWithYear(iso) : '';
              },
              label: (item) => {
                if (item.raw == null) return `${item.dataset.label}: —`;
                return `${item.dataset.label}: ${fmtCurrencyFull(item.raw)}`;
              },
            },
          },
          legend: {
            ...(DARK_CHART_DEFAULTS.plugins?.legend || {}),
            display: datasets.length > 1,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: '#94a3b8',
              callback: (v) => fmtCurrencyShort(v),
            },
            grid: { color: 'rgba(148, 163, 184, 0.1)' },
          },
          x: {
            ticks: {
              color: '#94a3b8',
              // Cap visible X labels so daily-density data doesn't shred the axis
              autoSkip: true,
              maxTicksLimit: 12,
              maxRotation: 0,
            },
            grid: { color: 'rgba(148, 163, 184, 0.1)' },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [data]);

  const toggleGl = (gl) => {
    setSelectedGls(prev => prev.includes(gl) ? prev.filter(g => g !== gl) : [...prev, gl]);
  };

  // When switching into By GL mode for the first time, seed with the top
  // GL so the chart shows something instead of an empty axis.
  const switchToByGl = () => {
    setMode('by_gl');
    if (selectedGls.length === 0 && glOptions[0]) {
      setSelectedGls([glOptions[0].number]);
    }
    setPickerOpen(true);
  };

  return (
    <div className="glass-card p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-100">Rent Roll Over Time</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Daily scheduled rent &amp; charges due, from rent_roll_snapshots
            {data?.points?.length > 0 && (
              <> · {fmtDateWithYear(data.points[0])} → {fmtDateWithYear(data.points[data.points.length - 1])} ({data.points.length} days)</>
            )}
          </p>
          {data?.note && (
            <p className="text-[11px] text-amber-300/80 mt-1">{data.note}</p>
          )}
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-1 bg-slate-800/50 rounded-md p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => { setMode('all'); setPickerOpen(false); }}
            className={`px-2.5 py-1 text-xs font-medium rounded ${
              mode === 'all' ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={switchToByGl}
            className={`px-2.5 py-1 text-xs font-medium rounded ${
              mode === 'by_gl' ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            By GL
          </button>
        </div>
      </div>

      {/* GL picker — only when in By GL mode */}
      {mode === 'by_gl' && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setPickerOpen(o => !o)}
            className="w-full text-left px-3 py-2 text-sm rounded-md border border-[var(--glass-border)] bg-slate-800/40 text-slate-200 hover:bg-slate-800/70 flex items-center justify-between"
          >
            <span>
              {selectedGls.length === 0
                ? <span className="text-slate-500">Select GL accounts…</span>
                : <>{selectedGls.length} GL{selectedGls.length === 1 ? '' : 's'} selected</>}
            </span>
            <svg className={`w-4 h-4 text-slate-400 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {pickerOpen && (
            <div className="mt-2 rounded-md border border-[var(--glass-border)] bg-slate-900/80 backdrop-blur-sm overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-500 border-b border-[var(--glass-border)]">
                <button
                  type="button"
                  onClick={() => setSelectedGls(glOptions.map(o => o.number))}
                  className="hover:text-accent"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedGls([])}
                  className="hover:text-accent"
                >
                  Clear
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {glOptions.length === 0 && (
                  <div className="px-3 py-2 text-xs text-slate-500">No GLs found.</div>
                )}
                {glOptions.map(o => {
                  const checked = selectedGls.includes(o.number);
                  return (
                    <label
                      key={o.number}
                      className="flex items-center gap-3 px-3 py-1.5 text-sm cursor-pointer hover:bg-white/5"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleGl(o.number)}
                        className="rounded border-slate-600 bg-slate-800"
                      />
                      <span className="flex-1 text-slate-200">
                        <span className="text-slate-500 font-mono text-xs mr-2">{o.number}</span>
                        {o.name}
                      </span>
                      <span className="text-slate-500 text-xs tabular-nums">
                        {fmtCurrencyShort(o.totalAmount)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="relative h-72">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
            Loading…
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-rose-300">
            {error}
          </div>
        )}
        {!loading && !error && (data?.series?.length === 0 || data?.points?.length === 0) && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
            {mode === 'by_gl' && selectedGls.length === 0
              ? 'Pick at least one GL account above.'
              : 'No rent-roll snapshots in this window.'}
          </div>
        )}
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
