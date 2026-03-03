'use client';

import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { DARK_CHART_DEFAULTS, STAGE_COLORS } from '../lib/chartTheme';

/**
 * Standalone time series line chart for stage data.
 * Owns its own canvas ref and Chart.js instance lifecycle.
 *
 * Props:
 *   stageStats  — full stage stats object from /api/stage-stats
 *   stageName   — display name string (e.g. "Inquiries, Showings Scheduled")
 */
export default function TimeSeriesChart({ stageStats, stageName }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    // Destroy previous chart
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const canvas = canvasRef.current;
    if (!canvas || !stageStats) return;

    const data = stageStats;
    const hasBucketData = data.timeSeriesDataByStage && Object.keys(data.timeSeriesDataByStage).length > 0;
    if (!hasBucketData) return;

    const stages = data.stages || [];
    const bucketLabels = (data.allBuckets || []).map(b => b.label);

    // Filter out future buckets — only show historical data
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const pastBucketCount = data.allBuckets?.filter(b => b.key <= todayStr).length ?? bucketLabels.length;

    // Build datasets
    const tsBucketLabels = bucketLabels.slice(0, pastBucketCount);
    const tsDatasets = stages.map(stage => {
      const stageData = data.timeSeriesDataByStage[stage];
      const color = STAGE_COLORS[stage] || stageData.color;
      return {
        label: stageData.label,
        data: stageData.data.slice(0, pastBucketCount).map(d => d.count),
        borderColor: color,
        backgroundColor: `${color}40`,
        fill: false,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
      };
    });

    // Tooltip details by stage
    const tsDetailsByStage = {};
    stages.forEach(stage => {
      tsDetailsByStage[stage] = data.timeSeriesDataByStage[stage].data.slice(0, pastBucketCount).map(d => d.details || []);
    });

    const ctx = canvas.getContext('2d');
    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: { labels: tsBucketLabels, datasets: tsDatasets },
      options: {
        ...DARK_CHART_DEFAULTS,
        maintainAspectRatio: true,
        aspectRatio: 3.5,
        plugins: {
          ...DARK_CHART_DEFAULTS.plugins,
          legend: { ...DARK_CHART_DEFAULTS.plugins.legend, display: true, position: 'top' },
          tooltip: {
            ...DARK_CHART_DEFAULTS.plugins.tooltip,
            callbacks: {
              afterBody: function(context) {
                const idx = context[0].dataIndex;
                const datasetIndex = context[0].datasetIndex;
                const stage = stages[datasetIndex];
                const details = tsDetailsByStage[stage]?.[idx] || [];
                if (details.length === 0) return '';
                const lines = details.slice(0, 10).map(d => {
                  const location = d.property ? `${d.property}${d.unit ? ' #' + d.unit : ''}` : '';
                  return `• ${d.name}${location ? ' (' + location + ')' : ''}`;
                });
                if (details.length > 10) lines.push(`... and ${details.length - 10} more`);
                return lines;
              }
            }
          }
        },
        scales: {
          y: { ...DARK_CHART_DEFAULTS.scales.y, beginAtZero: true },
          x: { ...DARK_CHART_DEFAULTS.scales.x, ticks: { ...DARK_CHART_DEFAULTS.scales.x.ticks, maxRotation: 45, minRotation: 45 } }
        }
      }
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [stageStats, stageName]);

  return (
    <div className="glass-card p-6 mb-6">
      <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">
        {stageName ? `${stageName} Over Time` : 'Trends Over Time'}
      </h2>
      <canvas ref={canvasRef} style={{ display: stageStats ? 'block' : 'none' }}></canvas>
      {!stageStats && (
        <p className="text-slate-500 text-sm py-8 text-center">Select stages above to view trends</p>
      )}
    </div>
  );
}
