'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { CHART_PALETTE } from '../lib/chartTheme';

export default function SourcesChart({ stageStats }) {
  const { chartData, sources } = useMemo(() => {
    if (!stageStats?.dataBySource) return { chartData: [], sources: [] };

    const { sources: srcNames, data } = stageStats.dataBySource;
    if (!srcNames?.length || !data?.length) return { chartData: [], sources: [] };

    const filtered = data.map(d => ({ ...d, dateLabel: d.label }));

    return { chartData: filtered, sources: srcNames };
  }, [stageStats]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload;
    // Sort payload by value descending for tooltip
    const sorted = [...payload].sort((a, b) => (b.value || 0) - (a.value || 0));
    return (
      <div className="bg-surface-overlay/95 backdrop-blur border border-[var(--glass-border)] rounded-lg shadow-lg px-3 py-2 text-xs max-h-64 overflow-y-auto">
        <p className="font-medium text-slate-200 mb-1">{point?.label || point?.bucket}</p>
        {sorted.map((entry, i) => (
          entry.value > 0 && (
            <p key={i} style={{ color: entry.color }} className="flex justify-between gap-4">
              <span>{entry.name}</span>
              <span className="font-medium">{entry.value}</span>
            </p>
          )
        ))}
      </div>
    );
  };

  if (!stageStats) return null;

  return (
    <div className="glass-card p-6 mb-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-100">Sources</h2>
        <p className="text-sm text-slate-400">Lead sources across selected funnel stages</p>
      </div>

      {chartData.length === 0 || sources.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-slate-500 text-sm">
          Select stages above to view source data.
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 11, fill: '#64748b' }}
                stroke="#64748b"
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#64748b' }}
                stroke="#64748b"
                width={40}
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
              {sources.map((source, idx) => (
                <Line
                  key={source}
                  type="monotone"
                  dataKey={source}
                  name={source}
                  stroke={CHART_PALETTE[idx % CHART_PALETTE.length]}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
