'use client';

import { useState, useMemo } from 'react';

interface Alert {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  meter: string;
  label: string;
  address: string;
  name: string;
  date: string;
  actual: number;
  expected: number;
  zScore?: number;
  message: string;
}

interface Props {
  alerts: Alert[];
  onMeterClick: (meter: string) => void;
  timeRange?: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  info: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
};

const TYPE_LABELS: Record<string, string> = {
  daily_spike: 'Daily Spike',
  hourly_spike: 'Hourly Spike',
  sustained_elevated: 'Sustained High',
  overnight_usage: 'Overnight Leak',
};

/**
 * Extract the most recent date from an alert's date field.
 * Handles: "2025-01-05", "2025-01-01 to 2025-01-05", "2025-01-01 to 2025-01-05 (ongoing)", "Recurring"
 */
function extractAlertDate(dateStr: string): string | null {
  if (!dateStr || dateStr === 'Recurring') return null;
  // For ranges like "2025-01-01 to 2025-01-05 (ongoing)", extract the end date
  const rangeMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})\s*(?:\(ongoing\))?$/);
  if (rangeMatch) return rangeMatch[1];
  // Single date
  const singleMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (singleMatch) return singleMatch[1];
  return null;
}

export default function BPULeakAlerts({ alerts, onMeterClick, timeRange }: Props) {
  const [showHistorical, setShowHistorical] = useState(false);

  // For short time ranges (7d, 14d), show all alerts by default
  const isShortRange = timeRange === '7' || timeRange === '14';

  const { filteredAlerts, mostRecentDate, hasHistorical } = useMemo(() => {
    // Find the most recent date across all alerts
    let maxDate = '';
    for (const a of alerts) {
      const d = extractAlertDate(a.date);
      if (d && d > maxDate) maxDate = d;
    }

    const hasHistorical = alerts.some(a => {
      const d = extractAlertDate(a.date);
      return d !== null && d !== maxDate;
    });

    // Sort by date descending (most recent first), recurring alerts last
    const sortByDate = (arr: Alert[]) =>
      [...arr].sort((a, b) => {
        const da = extractAlertDate(a.date);
        const db = extractAlertDate(b.date);
        if (!da && !db) return 0;
        if (!da) return 1;  // Recurring → end
        if (!db) return -1;
        return db.localeCompare(da);
      });

    // Short ranges: show all alerts, no filtering
    if (isShortRange || showHistorical || !maxDate) {
      return { filteredAlerts: sortByDate(alerts), mostRecentDate: maxDate, hasHistorical };
    }

    // Show only most recent date + recurring alerts
    const filtered = alerts.filter(a => {
      const d = extractAlertDate(a.date);
      return d === null || d === maxDate; // null = Recurring, always show
    });

    return { filteredAlerts: sortByDate(filtered), mostRecentDate: maxDate, hasHistorical };
  }, [alerts, showHistorical, isShortRange]);

  if (alerts.length === 0) {
    return (
      <div className="glass-card p-6">
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <svg className="w-12 h-12 mb-3 text-emerald-500/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm font-medium text-emerald-400">No leak alerts detected</p>
          <p className="text-xs text-slate-500 mt-1">All meters are operating within normal parameters</p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card">
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-white">Leak Alerts</h3>
          {hasHistorical && !isShortRange && (
            <button
              onClick={() => setShowHistorical(!showHistorical)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                showHistorical
                  ? 'bg-accent/15 text-accent'
                  : 'text-slate-500 hover:bg-white/10 hover:text-slate-300'
              }`}
            >
              {showHistorical ? 'All' : 'Historical'}
            </button>
          )}
        </div>
        <span className="text-xs text-slate-400">
          {filteredAlerts.length === alerts.length
            ? `${alerts.length} alert${alerts.length !== 1 ? 's' : ''}`
            : `${filteredAlerts.length} of ${alerts.length} alerts`}
        </span>
      </div>
      <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-800/95 backdrop-blur">
            <tr className="border-b border-white/10">
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Severity</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Location</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Date</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Actual</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Expected</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Details</th>
            </tr>
          </thead>
          <tbody>
            {filteredAlerts.map((alert, i) => (
              <tr
                key={i}
                className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                onClick={() => onMeterClick(alert.meter)}
              >
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_STYLES[alert.severity]}`}>
                    {alert.severity}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-200 text-xs font-medium">{alert.label}</td>
                <td className="px-4 py-3 text-slate-300 text-xs">{TYPE_LABELS[alert.type] || alert.type}</td>
                <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{alert.date}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300 text-xs">{alert.actual.toFixed(4)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-400 text-xs">{alert.expected.toFixed(4)}</td>
                <td className="px-4 py-3 text-slate-500 text-xs max-w-[200px] truncate">{alert.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
