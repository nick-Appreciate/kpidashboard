'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

const STATUS_COLORS = {
  'Not Started': '#ef4444',
  'Waiting': '#f97316',
  'Back Burner': '#fb923c',
  'In Progress': '#eab308',
  'Supervisor Onboard': '#a855f7',
  'Complete': '#22c55e'
};

const STATUS_ORDER = [
  'Not Started',
  'Supervisor Onboard',
  'Back Burner',
  'Waiting',
  'In Progress',
  'Complete'
];

// Map database column names to display names
const DB_TO_DISPLAY = {
  'not_started': 'Not Started',
  'supervisor_onboard': 'Supervisor Onboard',
  'back_burner': 'Back Burner',
  'waiting': 'Waiting',
  'in_progress': 'In Progress',
  'complete': 'Complete'
};

export default function RehabsChart({ rehabs = [], selectedProperty = 'all' }) {
  const [selectedStatuses, setSelectedStatuses] = useState(['In Progress', 'Complete']);
  const [timeRange, setTimeRange] = useState('30'); // days
  const [historyData, setHistoryData] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch historical data
  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ days: timeRange });
        if (selectedProperty && selectedProperty !== 'all' && selectedProperty !== 'portfolio') {
          params.append('property', selectedProperty);
        }
        
        const res = await fetch(`/api/rehabs/history?${params}`);
        if (res.ok) {
          const data = await res.json();
          setHistoryData(data.history || []);
        }
      } catch (err) {
        console.error('Error fetching rehab history:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchHistory();
  }, [timeRange, selectedProperty]);

  const toggleStatus = (status) => {
    setSelectedStatuses(prev => 
      prev.includes(status) 
        ? prev.filter(s => s !== status)
        : [...prev, status]
    );
  };

  const chartData = useMemo(() => {
    // Get today's date in Central Time
    const now = new Date();
    const centralTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const todayStr = centralTime.toISOString().split('T')[0];

    // Convert historical data to chart format
    const historicalPoints = historyData.map(snapshot => {
      const point = { date: snapshot.snapshot_date };
      Object.entries(DB_TO_DISPLAY).forEach(([dbKey, displayName]) => {
        point[displayName] = snapshot[dbKey] || 0;
      });
      return point;
    });

    // Create today's data point from current rehabs
    const todayPoint = { date: todayStr };
    STATUS_ORDER.forEach(status => {
      const count = rehabs.filter(r => {
        const rehabStatus = r.rehab_status || 'Not Started';
        return rehabStatus === status;
      }).length;
      todayPoint[status] = count;
    });

    // Merge historical with today (replace if today exists in history)
    const hasToday = historicalPoints.some(p => p.date === todayStr);
    if (hasToday) {
      return historicalPoints.map(p => p.date === todayStr ? todayPoint : p);
    } else if (historicalPoints.length > 0) {
      return [...historicalPoints, todayPoint];
    } else {
      return [todayPoint];
    }
  }, [rehabs, historyData]);

  // Calculate current totals for the legend
  // Units without a rehab_status are counted as "Not Started"
  const statusTotals = useMemo(() => {
    const totals = {};
    STATUS_ORDER.forEach(status => {
      totals[status] = rehabs.filter(r => {
        const rehabStatus = r.rehab_status || 'Not Started';
        return rehabStatus === status;
      }).length;
    });
    return totals;
  }, [rehabs]);

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">Rehab Status Overview</h3>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
          <option value="60">Last 60 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      {/* Status multi-select buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_ORDER.map(status => (
          <button
            key={status}
            onClick={() => toggleStatus(status)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
              selectedStatuses.includes(status)
                ? 'text-white border-transparent'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
            style={{
              backgroundColor: selectedStatuses.includes(status) ? STATUS_COLORS[status] : undefined
            }}
          >
            {status} ({statusTotals[status] || 0})
          </button>
        ))}
      </div>

      {/* Chart - Line chart that will fill in over time */}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis 
              dataKey="date" 
              tickFormatter={formatDate}
              tick={{ fontSize: 11 }}
              stroke="#9ca3af"
            />
            <YAxis 
              tick={{ fontSize: 11 }}
              stroke="#9ca3af"
              allowDecimals={false}
            />
            <Tooltip 
              labelFormatter={(label) => {
                const date = new Date(label);
                return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
              }}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {selectedStatuses.map(status => (
              <Line
                key={status}
                type="monotone"
                dataKey={status}
                name={status}
                stroke={STATUS_COLORS[status]}
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-gray-500 mt-2 text-center">
        {loading ? 'Loading historical data...' : 
          historyData.length > 0 
            ? `Showing ${chartData.length} days of data` 
            : 'Historical data will accumulate daily'}
      </p>
    </div>
  );
}
