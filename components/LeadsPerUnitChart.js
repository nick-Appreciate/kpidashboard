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

export default function LeadsPerUnitChart({ property, region, startDate, endDate, selectedStages = [] }) {
  const [stageData, setStageData] = useState(null);
  const [rehabHistory, setRehabHistory] = useState(null);
  const [loading, setLoading] = useState(false);

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

  // Build daily chart data: funnel counts / completed rehab units
  const chartData = useMemo(() => {
    if (!stageData?.dailyDataByStage || !rehabHistory?.length) return [];

    // Build a lookup of completed units by date from rehab snapshots
    const completedByDate = {};
    rehabHistory.forEach(snap => {
      completedByDate[snap.snapshot_date] = snap.complete || 0;
    });

    // Get daily dates from stage stats, capped at today
    const allDates = stageData.allDates || [];
    if (allDates.length === 0) return [];

    const todayStr = new Date().toISOString().split('T')[0];

    return allDates
      .filter(dateStr => dateStr <= todayStr)
      .map(dateStr => {
        // Format date label as M/D
        const [y, m, d] = dateStr.split('-').map(Number);
        const label = `${m}/${d}`;

        const point = { date: dateStr, dateLabel: label };

        // Get completed units for this date
        const completedUnits = completedByDate[dateStr] || 0;
        point._completedUnits = completedUnits;

        // For each stage, calculate per-completed-unit ratio
        ALL_STAGES.forEach(stage => {
          const dailyData = stageData.dailyDataByStage[stage]?.data;
          // Find the entry matching this date
          const entry = dailyData?.find(d => d.date === dateStr);
          const count = entry?.count || 0;
          point[`${stage}_count`] = count;
          point[stage] = completedUnits > 0
            ? Math.round((count / completedUnits) * 100) / 100
            : 0;
        });

        return point;
      });
  }, [stageData, rehabHistory]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload;
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
        <p className="font-medium text-gray-700 mb-1">{point?.date}</p>
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

  // Filter to only show stages selected in the dashboard funnel
  const visibleStages = ALL_STAGES.filter(s => selectedStages.includes(s));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
      <div className="flex flex-col gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Leads per Completed Rehab Unit</h2>
          <p className="text-sm text-gray-500">Daily funnel metrics divided by completed rehab units</p>
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
      ) : visibleStages.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
          Select stages above to view leads per unit data.
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
                width={50}
                tickFormatter={(v) => v.toFixed(1)}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {visibleStages.map(stage => (
                <Line
                  key={stage}
                  type="monotone"
                  dataKey={stage}
                  name={`${STAGE_CONFIG[stage].label} / Unit`}
                  stroke={STAGE_CONFIG[stage].color}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData.length > 0 && visibleStages.length > 0 && (
        <p className="text-xs text-gray-500 mt-2 text-center">
          Showing {chartData.length} day{chartData.length !== 1 ? 's' : ''} of data
        </p>
      )}
    </div>
  );
}
