'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const STAGE_CONFIG = {
  inquiries: { label: 'Inquiries', color: '#667eea' },
  showings_scheduled: { label: 'Showings Scheduled', color: '#8b5cf6' },
  showings_completed: { label: 'Showings Completed', color: '#764ba2' },
  applications: { label: 'Applications', color: '#f093fb' },
  leases: { label: 'Leases', color: '#43e97b' },
};

const ALL_STAGES = Object.keys(STAGE_CONFIG);

export default function LeadsPerUnitChart({ property, region, startDate, endDate }) {
  const [stageData, setStageData] = useState(null);
  const [rehabHistory, setRehabHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedStages, setSelectedStages] = useState(new Set(['inquiries', 'showings_completed', 'applications', 'leases']));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const stagesParam = ALL_STAGES.join(',');
      const params = new URLSearchParams({ stages: stagesParam });
      if (property && property !== 'all') params.set('property', property);
      if (region) params.set('region', region);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      // Calculate days for rehab history based on date range
      let days = 90;
      if (startDate) {
        const diffMs = new Date() - new Date(startDate);
        days = Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 7;
      }

      const [stageRes, rehabRes] = await Promise.all([
        fetch(`/api/stage-stats?${params}`),
        fetch(`/api/rehabs/history?days=${days}`),
      ]);

      if (stageRes.ok) {
        const data = await stageRes.json();
        setStageData(data);
      }
      if (rehabRes.ok) {
        const data = await rehabRes.json();
        setRehabHistory(data.history || []);
      }
    } catch (err) {
      console.error('Error fetching leads per unit data:', err);
    } finally {
      setLoading(false);
    }
  }, [property, region, startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build weekly chart data: funnel counts / completed rehab units
  const chartData = useMemo(() => {
    if (!stageData?.weeklyDataByStage || !rehabHistory?.length) return [];

    // Build a lookup of completed units by date from rehab snapshots
    const completedByDate = {};
    rehabHistory.forEach(snap => {
      completedByDate[snap.snapshot_date] = snap.complete || 0;
    });

    // Get weekly data from stage stats
    const weeks = stageData.allWeeks || [];
    if (weeks.length === 0) return [];

    return weeks.map((weekLabel, idx) => {
      const point = { week: weekLabel };

      // Parse the week range (e.g., "2/24-3/2") to find matching rehab snapshots
      // Average the completed units over the week range
      const parts = weekLabel.split('-');
      if (parts.length === 2) {
        const now = new Date();
        const year = now.getFullYear();

        // Parse start and end of week
        const [sm, sd] = parts[0].split('/').map(Number);
        const [em, ed] = parts[1].split('/').map(Number);

        // Handle year boundary
        const startYear = sm > em ? year - 1 : year;
        const weekStart = new Date(startYear, sm - 1, sd);
        const weekEnd = new Date(year, em - 1, ed);

        // Find all rehab snapshots within this week range
        let totalCompleted = 0;
        let snapCount = 0;
        const current = new Date(weekStart);
        while (current <= weekEnd) {
          const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
          if (completedByDate[dateStr] !== undefined) {
            totalCompleted += completedByDate[dateStr];
            snapCount++;
          }
          current.setDate(current.getDate() + 1);
        }

        const avgCompleted = snapCount > 0 ? totalCompleted / snapCount : 0;
        point._completedUnits = Math.round(avgCompleted * 10) / 10;

        // For each stage, calculate per-completed-unit ratio
        ALL_STAGES.forEach(stage => {
          const weeklyData = stageData.weeklyDataByStage[stage]?.data?.[idx];
          const count = weeklyData?.count || 0;
          point[`${stage}_count`] = count;
          point[stage] = avgCompleted > 0
            ? Math.round((count / avgCompleted) * 100) / 100
            : 0;
        });
      }

      return point;
    });
  }, [stageData, rehabHistory]);

  const toggleStage = (stage) => {
    setSelectedStages(prev => {
      const next = new Set(prev);
      if (next.has(stage)) {
        next.delete(stage);
      } else {
        next.add(stage);
      }
      return next;
    });
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload;
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
        <p className="font-medium text-gray-700 mb-1">Week of {label}</p>
        {point?._completedUnits !== undefined && (
          <p className="text-gray-500 mb-1">Completed Units: {point._completedUnits}</p>
        )}
        {payload.map((entry, i) => {
          const stage = entry.dataKey;
          const rawCount = point?.[`${stage}_count`];
          return (
            <p key={i} style={{ color: entry.color }} className="flex justify-between gap-4">
              <span>{entry.name}</span>
              <span className="font-medium">
                {entry.value?.toFixed(2)} <span className="text-gray-400">({rawCount})</span>
              </span>
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
      <div className="flex flex-col gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Leads per Completed Rehab Unit</h2>
          <p className="text-sm text-gray-500">Weekly funnel metrics divided by average completed rehab units</p>
        </div>

        {/* Stage toggles */}
        <div className="flex flex-wrap gap-1.5">
          {ALL_STAGES.map(stage => {
            const config = STAGE_CONFIG[stage];
            const isSelected = selectedStages.has(stage);
            return (
              <button
                key={stage}
                onClick={() => toggleStage(stage)}
                className="px-3 py-1 text-xs font-medium rounded-md transition-colors border"
                style={{
                  backgroundColor: isSelected ? config.color + '20' : 'transparent',
                  borderColor: isSelected ? config.color : '#e2e8f0',
                  color: isSelected ? config.color : '#94a3b8',
                }}
              >
                {config.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading && chartData.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
          Loading data...
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
          No data available. Ensure rehab snapshots are being tracked.
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
                width={50}
                tickFormatter={(v) => v.toFixed(1)}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {ALL_STAGES.filter(s => selectedStages.has(s)).map(stage => (
                <Line
                  key={stage}
                  type="monotone"
                  dataKey={stage}
                  name={`${STAGE_CONFIG[stage].label} / Unit`}
                  stroke={STAGE_CONFIG[stage].color}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData.length > 0 && (
        <p className="text-xs text-gray-500 mt-2 text-center">
          Showing {chartData.length} week{chartData.length !== 1 ? 's' : ''} of data
        </p>
      )}
    </div>
  );
}
