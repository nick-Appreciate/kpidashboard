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

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Mirror the API's bucketing logic for rehab snapshots
function bucketForDate(dateStr, granularity) {
  const [y, m, d] = dateStr.split('-').map(Number);
  switch (granularity) {
    case 'daily':
      return dateStr;
    case 'weekly': {
      const date = new Date(y, m - 1, d);
      const day = date.getDay();
      const sun = new Date(date);
      sun.setDate(date.getDate() - day);
      return `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')}`;
    }
    case 'monthly':
      return `${y}-${String(m).padStart(2, '0')}`;
    case 'quarterly': {
      const q = Math.ceil(m / 3);
      return `${y}-Q${q}`;
    }
    default:
      return dateStr;
  }
}

export default function LeadsPerUnitChart({ stageStats, granularity = 'weekly', startDate, endDate, selectedStages = [] }) {
  const [rehabHistory, setRehabHistory] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchRehabHistory = useCallback(async () => {
    setLoading(true);
    try {
      let days = 90;
      if (startDate) {
        const diffMs = new Date() - new Date(startDate);
        days = Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 7;
      }

      const res = await fetch(`/api/rehabs/history?days=${days}`);
      if (res.ok) {
        const data = await res.json();
        setRehabHistory(data.history || []);
      }
    } catch (err) {
      console.error('Error fetching rehab history:', err);
    } finally {
      setLoading(false);
    }
  }, [startDate]);

  useEffect(() => {
    fetchRehabHistory();
  }, [fetchRehabHistory]);

  // Build chart data: funnel counts / completed rehab units, bucketed by granularity
  const chartData = useMemo(() => {
    if (!stageStats?.timeSeriesDataByStage || !rehabHistory?.length) return [];

    const allBuckets = stageStats.allBuckets || [];
    if (allBuckets.length === 0) return [];

    // Group rehab snapshots by bucket key, take the last snapshot per bucket
    const completedByBucket = {};
    // Sort snapshots by date so the last one wins
    const sortedSnaps = [...rehabHistory].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    sortedSnaps.forEach(snap => {
      const bk = bucketForDate(snap.snapshot_date, granularity);
      completedByBucket[bk] = snap.complete || 0;
    });

    return allBuckets.map(bucket => {
      const point = { bucket: bucket.key, dateLabel: bucket.label };

      const completedUnits = completedByBucket[bucket.key] || 0;
      point._completedUnits = completedUnits;

      ALL_STAGES.forEach(stage => {
        const stageData = stageStats.timeSeriesDataByStage[stage];
        const entry = stageData?.data?.find(d => d.bucket === bucket.key);
        const count = entry?.count || 0;
        point[`${stage}_count`] = count;
        point[stage] = completedUnits > 0
          ? Math.round((count / completedUnits) * 100) / 100
          : 0;
      });

      return point;
    });
  }, [stageStats, rehabHistory, granularity]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload;
    return (
      <div className="bg-surface-overlay/95 backdrop-blur border border-[var(--glass-border)] rounded-lg shadow-lg px-3 py-2 text-xs">
        <p className="font-medium text-slate-200 mb-1">{point?.dateLabel}</p>
        {point?._completedUnits !== undefined && (
          <p className="text-slate-400 mb-1">Completed Units: {point._completedUnits}</p>
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

  const visibleStages = ALL_STAGES.filter(s => selectedStages.includes(s));

  return (
    <div className="glass-card p-6 mb-6">
      <div className="flex flex-col gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Leads per Completed Rehab Unit</h2>
          <p className="text-sm text-slate-400">Funnel metrics divided by completed rehab units</p>
        </div>
      </div>

      {loading && chartData.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-slate-500 text-sm">
          Loading data...
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-slate-500 text-sm">
          No data available. Ensure rehab snapshots are being tracked.
        </div>
      ) : visibleStages.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-slate-500 text-sm">
          Select stages above to view leads per unit data.
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
                width={50}
                tickFormatter={(v) => v.toFixed(1)}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
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
        <p className="text-xs text-slate-500 mt-2 text-center">
          Showing {chartData.length} {granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week' : granularity === 'monthly' ? 'month' : 'quarter'}{chartData.length !== 1 ? 's' : ''} of data
        </p>
      )}
    </div>
  );
}
