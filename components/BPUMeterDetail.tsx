'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

interface MeterSummary {
  meter: string;
  label: string;
  address: string;
  name: string;
  accountNumber: string;
  totalCcf: number;
  avgHourly: number;
  maxHourly: number;
  pctActive: number;
  dayCount: number;
  readingCount: number;
}

interface Alert {
  type: string;
  severity: string;
  meter: string;
  date: string;
  actual: number;
  expected: number;
  message: string;
}

interface Props {
  meter: MeterSummary;
  alerts: Alert[];
  onBack: () => void;
}

interface HourlyReading {
  reading_timestamp: string;
  ccf: number | null;
}

export default function BPUMeterDetail({ meter, alerts, onBack }: Props) {
  const [hourlyData, setHourlyData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDetail = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/utilities?days=all&meter=${encodeURIComponent(meter.meter)}`);
        if (res.ok) {
          const data = await res.json();
          // dailyUsage from the API for this single meter
          setHourlyData(data.dailyUsage || []);
        }
      } catch (err) {
        console.error('Error fetching meter detail:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [meter.meter]);

  // Build 24-hour profile from hourly data
  // We need raw hourly readings. Since our API returns daily, let's compute profile from the data.
  // For now, show daily chart and basic stats. The 24hr profile needs raw readings.
  // We'll compute it from the meter detail endpoint.

  const meterAlerts = useMemo(
    () => alerts.filter(a => a.meter === meter.meter),
    [alerts, meter.meter]
  );

  const meterKey = useMemo(() => {
    if (hourlyData.length === 0) return null;
    const keys = Object.keys(hourlyData[0]).filter(k => k !== 'date');
    return keys[0] || null;
  }, [hourlyData]);

  const formatDate = (dateStr: string) => {
    const [, month, day] = dateStr.split('-');
    return `${parseInt(month)}/${parseInt(day)}`;
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const dateLabel = new Date(label + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    return (
      <div className="bg-[var(--surface-overlay)] border border-white/10 rounded-lg shadow-lg px-3 py-2 text-xs">
        <p className="font-medium text-slate-300 mb-1">{dateLabel}</p>
        {payload.map((entry: any, i: number) => (
          <p key={i} className="text-cyan-400 font-medium">
            {Number(entry.value).toFixed(4)} CCF
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h2 className="text-lg font-semibold text-white">{meter.label}</h2>
          <p className="text-xs text-slate-400">{meter.name} &middot; {meter.address}</p>
        </div>
      </div>

      {/* Mini stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="glass-stat">
          <div>
            <p className="text-xl font-bold text-white">{meter.totalCcf.toFixed(2)}</p>
            <p className="text-xs text-slate-400">Total CCF</p>
          </div>
        </div>
        <div className="glass-stat">
          <div>
            <p className="text-xl font-bold text-white">{meter.avgHourly.toFixed(4)}</p>
            <p className="text-xs text-slate-400">Avg Hourly CCF</p>
          </div>
        </div>
        <div className="glass-stat">
          <div>
            <p className="text-xl font-bold text-white">{meter.maxHourly.toFixed(4)}</p>
            <p className="text-xs text-slate-400">Max Hourly CCF</p>
          </div>
        </div>
        <div className="glass-stat">
          <div>
            <p className="text-xl font-bold text-white">{meter.pctActive.toFixed(1)}%</p>
            <p className="text-xs text-slate-400">Hours Active</p>
          </div>
        </div>
      </div>

      {/* Daily usage chart */}
      <div className="glass-card p-6">
        <h3 className="text-sm font-semibold text-white mb-4">Daily Usage</h3>
        {loading ? (
          <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: '3.5' }}>
            Loading meter data...
          </div>
        ) : hourlyData.length === 0 || !meterKey ? (
          <div className="flex items-center justify-center text-slate-500 text-sm" style={{ aspectRatio: '3.5' }}>
            No data available for this meter.
          </div>
        ) : (
          <ResponsiveContainer width="100%" aspect={3.5}>
            <LineChart data={hourlyData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                stroke="#334155"
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                stroke="#334155"
                width={50}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine
                y={meter.avgHourly * 24}
                stroke="#fbbf24"
                strokeDasharray="3 3"
                label={{ value: 'avg', fill: '#fbbf24', fontSize: 10 }}
              />
              <Line
                type="monotone"
                dataKey={meterKey}
                stroke="#06b6d4"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#06b6d4' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Alerts for this meter */}
      {meterAlerts.length > 0 && (
        <div className="glass-card">
          <div className="p-4 border-b border-white/10">
            <h3 className="text-sm font-semibold text-white">
              Alerts ({meterAlerts.length})
            </h3>
          </div>
          <div className="divide-y divide-white/5">
            {meterAlerts.map((alert, i) => (
              <div key={i} className="px-4 py-3 flex items-start gap-3">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium shrink-0 mt-0.5 ${
                  alert.severity === 'critical' ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30' :
                  alert.severity === 'warning' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' :
                  'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                }`}>
                  {alert.severity}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-slate-300">{alert.message}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{alert.date}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
