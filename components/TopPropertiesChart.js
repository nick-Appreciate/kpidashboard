'use client';

import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { DARK_CHART_DEFAULTS } from '../lib/chartTheme';

/**
 * Standalone horizontal bar chart for top properties.
 * Owns its own canvas ref and Chart.js instance lifecycle.
 *
 * Props:
 *   topProperties — array of { property: string, count: number }
 *   stageName     — display name string for the dataset label
 */
export default function TopPropertiesChart({ topProperties, stageName }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    // Destroy previous chart
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const canvas = canvasRef.current;
    if (!canvas || !topProperties?.length) return;

    const ctx = canvas.getContext('2d');
    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: topProperties.map(p => {
          const parts = p.property.split('-');
          return parts[0].trim().substring(0, 30) + '...';
        }),
        datasets: [{
          label: stageName || 'Count',
          data: topProperties.map(p => p.count),
          backgroundColor: '#06b6d4',
        }],
      },
      options: {
        ...DARK_CHART_DEFAULTS,
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { ...DARK_CHART_DEFAULTS.plugins, legend: { display: false } },
        scales: {
          x: { ...DARK_CHART_DEFAULTS.scales.x, beginAtZero: true, ticks: { ...DARK_CHART_DEFAULTS.scales.x.ticks, stepSize: 1 } },
          y: DARK_CHART_DEFAULTS.scales.y,
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [topProperties, stageName]);

  // 28px per bar + 20px padding
  const chartHeight = topProperties?.length ? Math.max(120, topProperties.length * 28 + 20) : 0;

  return (
    <div className="glass-card p-6 mb-6">
      <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">
        Top Properties
      </h2>
      {topProperties?.length ? (
        <div style={{ height: `${chartHeight}px` }}>
          <canvas ref={canvasRef}></canvas>
        </div>
      ) : (
        <p className="text-slate-500 text-sm py-8 text-center">Select stages above to view top properties</p>
      )}
    </div>
  );
}
