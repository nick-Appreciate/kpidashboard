'use client';

import { useEffect, useRef, useMemo } from 'react';
import useSWR from 'swr';
import Chart from 'chart.js/auto';
import { fetcher } from '../lib/swr';
import { DARK_CHART_DEFAULTS } from '../lib/chartTheme';

// Rate-over-time chart for the Leasing Lifecycle module.
// Fetches /api/funnel-timeseries and plots the selected rate.
//
// The chart intentionally uses a fixed 12-month lookback (independent of
// the dashboard's active date filter) so the trend is comparable across
// dashboard interactions. Property and region filters are still honored.
//
// Props:
//   filterParams — URLSearchParams string (property, region — dates are
//                  overridden below to force a 12-month window)
//   rateKey      — 'overall' | 'scheduling' | 'completion' | 'application' | 'approval'
//                  or null to render an empty placeholder.
//   granularity  — from parent; used for the chart title
//   onClose      — called when the user clicks × to dismiss the chart

const RATE_DEFS = {
  overall:     { label: 'Overall',     sub: 'Inquiry → Lease',       num: 'leases',            den: 'inquiries',         color: '#6366f1' },
  scheduling:  { label: 'Scheduling',  sub: 'Inquiry → Showing',     num: 'showings_scheduled', den: 'inquiries',         color: '#8b5cf6' },
  completion:  { label: 'Completion',  sub: 'Scheduled → Complete',  num: 'showings_completed', den: 'showings_scheduled', color: '#a78bfa' },
  application: { label: 'Application', sub: 'Complete → Applied',    num: 'applications',       den: 'showings_completed', color: '#f472b6' },
  approval:    { label: 'Approval',    sub: 'Applied → Lease',       num: 'leases',            den: 'applications',       color: '#34d399' },
};

export default function RateOverTimeChart({ filterParams, rateKey, granularity, onClose }) {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  // Force a 12-month window regardless of the dashboard's date filter, so
  // this chart always shows the same lookback shape. Property/region are
  // kept as passed.
  const lookbackParams = useMemo(() => {
    const p = new URLSearchParams(filterParams || '');
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    p.set('startDate', ymd(oneYearAgo));
    p.set('endDate',   ymd(today));
    return p.toString();
  }, [filterParams]);

  const shouldFetch = !!rateKey;
  const { data, error, isLoading } = useSWR(
    shouldFetch ? `/api/funnel-timeseries?${lookbackParams}` : null,
    fetcher,
    { revalidateOnMount: true, refreshInterval: 5 * 60 * 1000 },
  );

  const def = rateKey ? RATE_DEFS[rateKey] : null;

  const series = useMemo(() => {
    if (!def || !data?.buckets) return null;
    const labels = [];
    const values = [];
    const numerators = [];
    const denominators = [];
    for (const b of data.buckets) {
      const num = b[def.num] || 0;
      const den = b[def.den] || 0;
      labels.push(b.label);
      numerators.push(num);
      denominators.push(den);
      // Skip buckets with zero denominator — plotting 0 would misread as "0% conversion"
      // when reality is "no cohort in this bucket". Chart.js accepts null with spanGaps.
      if (den === 0) {
        values.push(null);
      } else {
        values.push(Math.round((num / den) * 1000) / 10); // one decimal
      }
    }
    // Compute weighted-average across the visible window for the reference line
    const totalNum = numerators.reduce((s, x) => s + x, 0);
    const totalDen = denominators.reduce((s, x) => s + x, 0);
    const windowAvg = totalDen > 0 ? (totalNum / totalDen) * 100 : null;
    return { labels, values, numerators, denominators, windowAvg };
  }, [def, data]);

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }
    const canvas = canvasRef.current;
    if (!canvas || !series || !def) return;

    // Nice y-max: cap at 100 when all values are <=100; otherwise a bit above max.
    const nonNull = series.values.filter(v => v !== null);
    const maxVal  = nonNull.length ? Math.max(...nonNull, series.windowAvg ?? 0) : 0;
    const yMax = maxVal <= 100 ? 100 : Math.ceil(maxVal / 25) * 25;

    chartRef.current = new Chart(canvas, {
      type: 'line',
      data: {
        labels: series.labels,
        datasets: [
          {
            label: `${def.label} rate`,
            data: series.values,
            borderColor: def.color,
            backgroundColor: `${def.color}25`,
            fill: true,
            tension: 0.35,
            spanGaps: true,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 2,
          },
          series.windowAvg !== null && {
            label: `Window avg (${series.windowAvg.toFixed(1)}%)`,
            data: series.labels.map(() => series.windowAvg),
            borderColor: 'rgba(255,255,255,0.35)',
            borderDash: [4, 4],
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
          },
        ].filter(Boolean),
      },
      options: {
        ...DARK_CHART_DEFAULTS,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          ...(DARK_CHART_DEFAULTS.plugins || {}),
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => items?.[0]?.label ?? '',
              label: (ctx) => {
                if (ctx.datasetIndex === 1) return null; // skip avg dataset in tooltip
                const i = ctx.dataIndex;
                const num = series.numerators[i];
                const den = series.denominators[i];
                if (den === 0) return `${def.label}: — (no ${def.den.replace('_', ' ')} this period)`;
                return `${def.label}: ${ctx.parsed.y.toFixed(1)}%   (${num} / ${den})`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            grid:  { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            min: 0,
            max: yMax,
            ticks: {
              color: '#94a3b8',
              callback: (v) => `${v}%`,
            },
            grid: { color: 'rgba(255,255,255,0.05)' },
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
  }, [series, def]);

  if (!rateKey) return null;

  return (
    <div className="mt-4 pt-4 border-t border-[var(--glass-border)]">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            {def.label} rate over time
          </h3>
          <p className="text-xs text-slate-500">
            {def.sub} · last 12 months · {granularity} buckets · click a tile above to switch
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 text-xs px-2 py-1 rounded hover:bg-white/5"
          aria-label="Close rate chart"
        >
          ×  Close
        </button>
      </div>
      {isLoading && (
        <div className="flex items-center justify-center text-slate-500 text-sm h-48">
          Loading…
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center text-red-300 text-sm h-48">
          Failed to load: {error.message}
        </div>
      )}
      {!isLoading && !error && series && series.values.every(v => v === null) && (
        <div className="flex items-center justify-center text-slate-500 text-sm h-48">
          No {def.den.replace('_', ' ')} data in the selected window.
        </div>
      )}
      {!isLoading && !error && series && series.values.some(v => v !== null) && (
        <div style={{ height: '220px' }}>
          <canvas ref={canvasRef} />
        </div>
      )}
    </div>
  );
}
