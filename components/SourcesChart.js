'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const SOURCE_COLORS = [
  '#667eea', '#f093fb', '#43e97b', '#4facfe', '#764ba2',
  '#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff'
];

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
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs max-h-64 overflow-y-auto">
        <p className="font-medium text-gray-700 mb-1">{point?.label || point?.bucket}</p>
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
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Sources</h2>
        <p className="text-sm text-gray-500">Lead sources across selected funnel stages</p>
      </div>

      {chartData.length === 0 || sources.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
          Select stages above to view source data.
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
                width={40}
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {sources.map((source, idx) => (
                <Line
                  key={source}
                  type="monotone"
                  dataKey={source}
                  name={source}
                  stroke={SOURCE_COLORS[idx % SOURCE_COLORS.length]}
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
