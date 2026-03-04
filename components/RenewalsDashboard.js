'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { DARK_CHART_DEFAULTS } from '../lib/chartTheme';
import DarkSelect from './DarkSelect';

// Color palette for multi-property charts
const propertyColors = [
  '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#a855f7', '#eab308', '#22c55e', '#0ea5e9'
];

// Helper: aggregate daily data points into weekly (one per week, using last value in each week)
const aggregateWeekly = (dataPoints, dateKey = 'date', valueKey = 'healthyLeaseRate') => {
  if (!dataPoints || dataPoints.length === 0) return [];
  const weekMap = {};
  dataPoints.forEach(d => {
    const date = new Date(d[dateKey] + 'T00:00:00');
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date);
    monday.setDate(diff);
    const weekKey = monday.toISOString().split('T')[0];
    if (!weekMap[weekKey] || d[dateKey] >= weekMap[weekKey][dateKey]) {
      weekMap[weekKey] = { ...d, _weekKey: weekKey };
    }
  });
  return Object.values(weekMap).sort((a, b) => a._weekKey.localeCompare(b._weekKey));
};

const formatWeekLabel = (dateStr) => {
  const [year, month, day] = dateStr.split('-');
  return `${month}/${day}`;
};

// Renewal status badge renderer
const RenewalBadge = ({ status }) => {
  const config = {
    'Renewed': { bg: 'bg-emerald-500/15', text: 'text-emerald-300', symbol: '\u2713' },
    'Pending': { bg: 'bg-blue-500/15', text: 'text-blue-400', symbol: '\u2022\u2022\u2022' },
    'Did Not Renew': { bg: 'bg-rose-500/15', text: 'text-rose-400', symbol: '\u2717' },
    'Canceled by User': { bg: 'bg-slate-500/15', text: 'text-slate-200', symbol: '\u2014' },
    'Not sent': { bg: 'bg-violet-500/15', text: 'text-violet-300', symbol: '\u2013' },
  };
  const c = config[status] || { bg: 'bg-slate-500/15', text: 'text-slate-500', symbol: '?' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text}`}>
      {c.symbol}<span className="ml-1 hidden sm:inline">{status || 'Unknown'}</span>
    </span>
  );
};

// Region definitions — matches rent-roll stats config
const KC_PROPERTIES = ['hilltop', 'oakwood', 'glen oaks', 'normandy', 'maple manor'];
const isKCProperty = (prop) => KC_PROPERTIES.some(kc => prop?.toLowerCase().includes(kc));

// Issue type badge renderer
const IssueBadge = ({ type }) => {
  const config = {
    'eviction': { bg: 'bg-red-500/10', text: 'text-red-300', label: 'Eviction' },
    'monthToMonth': { bg: 'bg-orange-500/10', text: 'text-orange-300', label: 'MTM' },
    'expiring': { bg: 'bg-amber-500/10', text: 'text-amber-300', label: '0-60' },
    'upcoming': { bg: 'bg-blue-500/10', text: 'text-blue-300', label: '60-90' },
  };
  const c = config[type] || { bg: 'bg-slate-500/10', text: 'text-slate-300', label: type };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
};

export default function RenewalsDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProperty, setSelectedProperty] = useState('portfolio');
  const [dateRange, setDateRange] = useState('all_time');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Lease detail multi-select filters
  const [activeIssues, setActiveIssues] = useState(new Set(['eviction', 'monthToMonth', 'expiring', 'upcoming']));
  const [activeStatuses, setActiveStatuses] = useState(new Set());
  const [leaseDetailView, setLeaseDetailView] = useState('table');

  // Chart refs (always-mounted pattern)
  const healthyLeaseCanvasRef = useRef(null);
  const healthyLeaseChartRef = useRef(null);
  const healthyLeaseRenderedRef = useRef(null);
  const renewalsCanvasRef = useRef(null);
  const renewalsChartRef = useRef(null);
  const renewalsRenderedRef = useRef(null);
  const expirationsMiniCanvasRef = useRef(null);
  const expirationsMiniChartRef = useRef(null);
  const expirationsMiniRenderedRef = useRef(null);
  const headerRef = useRef(null);

  // Date range presets
  const getDateRangeFromPreset = (preset) => {
    const today = new Date();
    const formatDate = (date) => date.toISOString().split('T')[0];
    switch (preset) {
      case 'today':
        return { start: formatDate(today), end: formatDate(today) };
      case 'last_week': {
        const d = new Date(today); d.setDate(today.getDate() - 7);
        return { start: formatDate(d), end: formatDate(today) };
      }
      case 'last_month': {
        const d = new Date(today); d.setMonth(today.getMonth() - 1);
        return { start: formatDate(d), end: formatDate(today) };
      }
      case 'last_quarter': {
        const d = new Date(today); d.setMonth(today.getMonth() - 3);
        return { start: formatDate(d), end: formatDate(today) };
      }
      case 'last_year': {
        const d = new Date(today); d.setFullYear(today.getFullYear() - 1);
        return { start: formatDate(d), end: formatDate(today) };
      }
      case 'all_time':
        return { start: '', end: '' };
      case 'custom':
        return null;
      default:
        return { start: '', end: '' };
    }
  };

  useEffect(() => {
    const range = getDateRangeFromPreset(dateRange);
    if (range) {
      setStartDate(range.start);
      setEndDate(range.end);
    }
  }, [dateRange]);

  useEffect(() => {
    fetchStats();
  }, [selectedProperty, startDate, endDate]);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedProperty !== 'portfolio' && selectedProperty !== 'all') {
        if (selectedProperty.startsWith('region_')) {
          params.append('region', selectedProperty);
        } else {
          params.append('property', selectedProperty);
        }
      }
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const res = await fetch(`/api/rent-roll/stats?${params}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStats(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching renewal stats:', err);
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // --- Build unified lease list with issue types ---
  const allLeases = useMemo(() => {
    if (!stats?.leaseHealthDetails) return [];
    const leases = [];
    const reasons = stats.leaseHealthDetails.badLeasesByReason || {};
    (reasons.evictions || []).forEach(l => leases.push({ ...l, issueType: 'eviction' }));
    (reasons.monthToMonth || []).forEach(l => leases.push({ ...l, issueType: 'monthToMonth' }));
    (reasons.expiringWithin60Days || []).forEach(l => leases.push({ ...l, issueType: 'expiring' }));
    (stats.leaseHealthDetails.upcomingExpirations || []).forEach(l => leases.push({ ...l, issueType: 'upcoming' }));
    return leases;
  }, [stats]);

  // For the detail table, only show upcoming expirations up to 90 days (chart shows full 180)
  const tableleases = useMemo(() => {
    return allLeases.filter(l => !(l.issueType === 'upcoming' && l.daysUntilExpiration > 90));
  }, [allLeases]);

  // Collect unique renewal statuses and init activeStatuses on first load
  const allRenewalStatuses = useMemo(() => {
    const statuses = [...new Set(tableleases.map(l => l.renewalStatus || 'Unknown'))].sort();
    return statuses;
  }, [tableleases]);

  // Initialize activeStatuses to all on first data load
  useEffect(() => {
    if (allRenewalStatuses.length > 0 && activeStatuses.size === 0) {
      setActiveStatuses(new Set(allRenewalStatuses));
    }
  }, [allRenewalStatuses]);

  // Issue type button config
  const issueButtons = [
    { key: 'eviction', label: 'Eviction', bg: 'bg-red-500', text: 'text-red-300', activeBg: 'bg-red-500/20', inactiveBg: 'bg-surface-overlay' },
    { key: 'monthToMonth', label: 'MTM', bg: 'bg-orange-500', text: 'text-orange-300', activeBg: 'bg-orange-500/20', inactiveBg: 'bg-surface-overlay' },
    { key: 'expiring', label: '0-60', bg: 'bg-amber-500', text: 'text-amber-300', activeBg: 'bg-amber-500/20', inactiveBg: 'bg-surface-overlay' },
    { key: 'upcoming', label: '60-90', bg: 'bg-blue-500', text: 'text-blue-300', activeBg: 'bg-blue-500/20', inactiveBg: 'bg-surface-overlay' },
  ];

  // Toggle helpers
  const toggleIssue = (key) => {
    setActiveIssues(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const toggleStatus = (key) => {
    setActiveStatuses(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Filtered + sorted leases: filter by issue type & renewal status, sort by days left asc, evictions last
  const filteredLeases = useMemo(() => {
    return tableleases
      .filter(l => activeIssues.has(l.issueType))
      .filter(l => activeStatuses.has(l.renewalStatus || 'Unknown'))
      .sort((a, b) => {
        // Evictions always at the bottom
        if (a.issueType === 'eviction' && b.issueType !== 'eviction') return 1;
        if (b.issueType === 'eviction' && a.issueType !== 'eviction') return -1;
        // MTM with no days left at the very top
        const aNull = a.daysUntilExpiration == null;
        const bNull = b.daysUntilExpiration == null;
        const aMtmNull = aNull && a.issueType === 'monthToMonth';
        const bMtmNull = bNull && b.issueType === 'monthToMonth';
        if (aMtmNull && !bMtmNull) return -1;
        if (bMtmNull && !aMtmNull) return 1;
        // Sort by days left ascending (oldest/most negative first), nulls last
        const aDays = a.daysUntilExpiration ?? Infinity;
        const bDays = b.daysUntilExpiration ?? Infinity;
        return aDays - bDays;
      });
  }, [tableleases, activeIssues, activeStatuses]);

  // Counts per issue type (unfiltered by status, for button badges)
  const issueCounts = useMemo(() => {
    const counts = {};
    tableleases.forEach(l => { counts[l.issueType] = (counts[l.issueType] || 0) + 1; });
    return counts;
  }, [tableleases]);

  // For the mini chart, provide leaseData-like shape
  const leaseData = useMemo(() => ({
    badLeases: allLeases.filter(l => ['eviction', 'monthToMonth', 'expiring'].includes(l.issueType)),
    upcoming: allLeases.filter(l => l.issueType === 'upcoming'),
  }), [allLeases]);

  // Compute upcoming expirations bucketed by month for next 6 months
  const monthlyExpirations = useMemo(() => {
    const today = new Date();
    const months = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      months.push({
        label: d.toLocaleDateString('en-US', { month: 'short' }),
        year: d.getFullYear(),
        month: d.getMonth(),
        count: 0,
      });
    }
    // Include all leases with an expiration date in the next 6 months
    const allLeases = [...leaseData.badLeases, ...leaseData.upcoming];
    allLeases.forEach(lease => {
      let expDate;
      if (lease.leaseEnd) {
        expDate = new Date(lease.leaseEnd + 'T00:00:00');
      } else if (lease.daysUntilExpiration != null) {
        expDate = new Date(today);
        expDate.setDate(expDate.getDate() + lease.daysUntilExpiration);
      }
      if (!expDate) return;
      const bucket = months.find(m => m.year === expDate.getFullYear() && m.month === expDate.getMonth());
      if (bucket) bucket.count++;
    });
    return months;
  }, [leaseData]);

  // --- Healthy Lease Rate Chart ---
  useEffect(() => {
    if (healthyLeaseChartRef.current) {
      healthyLeaseChartRef.current.destroy();
      healthyLeaseChartRef.current = null;
    }
    if (!healthyLeaseCanvasRef.current || !stats) return;

    const showMultiProperty = selectedProperty === 'all' && stats.healthyLeaseTrendByProperty;

    let healthyChartData;
    if (showMultiProperty) {
      const weeklyByProperty = {};
      Object.entries(stats.healthyLeaseTrendByProperty).forEach(([property, data]) => {
        weeklyByProperty[property] = aggregateWeekly(data, 'date', 'healthyLeaseRate');
      });
      const allWeekDates = [...new Set(
        Object.values(weeklyByProperty).flatMap(arr => arr.map(d => d._weekKey))
      )].sort();
      const datasets = Object.entries(weeklyByProperty).map(([property, data], idx) => {
        const color = propertyColors[idx % propertyColors.length];
        const dataMap = Object.fromEntries(data.map(d => [d._weekKey, parseFloat(d.healthyLeaseRate)]));
        return {
          label: property,
          data: allWeekDates.map(date => dataMap[date] ?? null),
          borderColor: color,
          backgroundColor: color + '20',
          fill: false,
          tension: 0.4,
          spanGaps: true
        };
      });
      healthyChartData = {
        labels: allWeekDates.map(d => formatWeekLabel(d)),
        datasets
      };
    } else {
      const weeklyHealthy = aggregateWeekly(stats.healthyLeaseTrend || [], 'date', 'healthyLeaseRate');
      healthyChartData = {
        labels: weeklyHealthy.map(d => formatWeekLabel(d.date)),
        datasets: [{
          label: 'Healthy Lease Rate (%)',
          data: weeklyHealthy.map(d => parseFloat(d.healthyLeaseRate)),
          borderColor: '#f59e0b',
          backgroundColor: '#f59e0b20',
          fill: true,
          tension: 0.4
        }]
      };
    }

    // Strict Mode double-render guard
    const dataKey = JSON.stringify(healthyChartData.datasets.map(ds => ds.data));
    if (healthyLeaseRenderedRef.current === dataKey) return;
    healthyLeaseRenderedRef.current = dataKey;

    healthyLeaseChartRef.current = new Chart(healthyLeaseCanvasRef.current.getContext('2d'), {
      type: 'line',
      data: healthyChartData,
      options: {
        ...DARK_CHART_DEFAULTS,
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 3.5,
        interaction: { mode: 'nearest', intersect: true },
        plugins: {
          legend: {
            display: showMultiProperty,
            position: 'bottom',
            labels: { boxWidth: 12, font: { size: 10 } }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const label = context.dataset.label || '';
                const value = context.parsed.y;
                return `${label}: ${value}%`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            min: 0,
            max: 100,
            ticks: { callback: v => v + '%' }
          }
        }
      }
    });

    return () => {
      if (healthyLeaseChartRef.current) {
        healthyLeaseChartRef.current.destroy();
        healthyLeaseChartRef.current = null;
      }
      healthyLeaseRenderedRef.current = null;
    };
  }, [stats, selectedProperty]);

  // --- Renewals by Month Chart ---
  useEffect(() => {
    if (renewalsChartRef.current) {
      renewalsChartRef.current.destroy();
      renewalsChartRef.current = null;
    }
    if (!renewalsCanvasRef.current || !stats?.leaseHealthDetails?.renewalsByMonth?.length) return;

    const renewalData = stats.leaseHealthDetails.renewalsByMonth;

    // Strict Mode double-render guard
    const dataKey = renewalData.map(d => d.count).join(',');
    if (renewalsRenderedRef.current === dataKey) return;
    renewalsRenderedRef.current = dataKey;

    renewalsChartRef.current = new Chart(renewalsCanvasRef.current.getContext('2d'), {
      type: 'bar',
      data: {
        labels: renewalData.map(d => d.label),
        datasets: [{
          label: 'Renewals',
          data: renewalData.map(d => d.count),
          backgroundColor: '#22c55e',
          borderColor: '#16a34a',
          borderWidth: 1
        }]
      },
      options: {
        ...DARK_CHART_DEFAULTS,
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.parsed.y} renewals`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1 }
          }
        }
      }
    });

    return () => {
      if (renewalsChartRef.current) {
        renewalsChartRef.current.destroy();
        renewalsChartRef.current = null;
      }
      renewalsRenderedRef.current = null;
    };
  }, [stats]);

  // --- Expirations Mini Bar Chart ---
  useEffect(() => {
    if (expirationsMiniChartRef.current) {
      expirationsMiniChartRef.current.destroy();
      expirationsMiniChartRef.current = null;
    }
    if (!expirationsMiniCanvasRef.current || !monthlyExpirations.length) return;

    const dataKey = monthlyExpirations.map(m => m.count).join(',');
    if (expirationsMiniRenderedRef.current === dataKey) return;
    expirationsMiniRenderedRef.current = dataKey;

    expirationsMiniChartRef.current = new Chart(expirationsMiniCanvasRef.current.getContext('2d'), {
      type: 'bar',
      data: {
        labels: monthlyExpirations.map(m => m.label),
        datasets: [{
          data: monthlyExpirations.map(m => m.count),
          backgroundColor: monthlyExpirations.map((m, i) => i === 0 ? '#f59e0b' : '#3b82f6'),
          borderRadius: 3,
          barPercentage: 0.6,
        }]
      },
      options: {
        ...DARK_CHART_DEFAULTS,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.parsed.y} lease${ctx.parsed.y !== 1 ? 's' : ''} expiring`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 } }
          },
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 10 } },
            grid: { color: 'rgba(255,255,255,0.04)' }
          }
        }
      }
    });

    return () => {
      if (expirationsMiniChartRef.current) {
        expirationsMiniChartRef.current.destroy();
        expirationsMiniChartRef.current = null;
      }
      expirationsMiniRenderedRef.current = null;
    };
  }, [monthlyExpirations]);

  // Renewal status badge config for filter buttons
  const statusButtonConfig = {
    'Renewed': { text: 'text-emerald-300', activeBg: 'bg-emerald-500/20' },
    'Pending': { text: 'text-blue-400', activeBg: 'bg-blue-500/20' },
    'Did Not Renew': { text: 'text-rose-400', activeBg: 'bg-rose-500/20' },
    'Canceled by User': { text: 'text-slate-200', activeBg: 'bg-slate-500/20' },
    'Not sent': { text: 'text-violet-300', activeBg: 'bg-violet-500/20' },
    'Unknown': { text: 'text-amber-300', activeBg: 'bg-amber-500/20' },
  };

  // Counts per renewal status (unfiltered by issue, for button badges)
  const statusCounts = useMemo(() => {
    const counts = {};
    tableleases.forEach(l => {
      const s = l.renewalStatus || 'Unknown';
      counts[s] = (counts[s] || 0) + 1;
    });
    return counts;
  }, [tableleases]);

  // Loading state
  if (loading && !stats) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Loading renewals data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-2">Error loading data</p>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  const summary = stats?.summary || {};
  const hasData = stats?.hasData;

  return (
    <div className="min-h-screen">
      {/* Sticky header */}
      <div ref={headerRef} className="sticky-header">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-4 h-10 px-6 border-b border-[var(--glass-border)]">
            <h1 className="text-sm font-semibold text-slate-100 whitespace-nowrap">
              Renewals
            </h1>
            {hasData && (
              <div className="flex items-center gap-2 flex-1 justify-end flex-wrap">
                <DarkSelect
                  value={selectedProperty}
                  onChange={setSelectedProperty}
                  compact
                  className="w-36"
                  options={[
                    { value: 'portfolio', label: 'Portfolio' },
                    { value: 'all', label: 'All Properties' },
                    { group: 'Regions', options: [
                      { value: 'region_kansas_city', label: 'Kansas City' },
                      { value: 'region_columbia', label: 'Columbia' },
                    ]},
                    { group: 'Properties', options: (stats?.properties || []).map(prop => ({
                      value: prop,
                      label: prop,
                    }))},
                  ]}
                />
                <DarkSelect
                  value={dateRange}
                  onChange={setDateRange}
                  disabled={loading}
                  compact
                  className="w-32"
                  options={[
                    { value: 'today', label: 'Today' },
                    { value: 'last_week', label: 'Last 7 Days' },
                    { value: 'last_month', label: 'Last 30 Days' },
                    { value: 'last_quarter', label: 'Last 90 Days' },
                    { value: 'last_year', label: 'Last Year' },
                    { value: 'all_time', label: 'All Time' },
                    { value: 'custom', label: 'Custom Range' },
                  ]}
                />
              </div>
            )}
          </div>
          {dateRange === 'custom' && hasData && (
            <div className="flex items-center gap-3 mt-2 pt-2 px-6 border-t border-white/5">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={loading}
                className="dark-input px-3 py-1.5 text-sm"
              />
              <span className="text-slate-500 text-sm">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={loading}
                className="dark-input px-3 py-1.5 text-sm"
              />
            </div>
          )}
        </div>
      </div>

      {/* Page content */}
      <div className="px-6 md:px-8 pb-6 md:pb-8">
        <div className="max-w-7xl mx-auto">

          {/* Healthy Lease Rate Chart */}
          <div className="glass-card p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-100 mb-2 pb-2 border-b border-[var(--glass-border)]">
              Healthy Lease Rate Trend
            </h2>
            <p className="text-sm text-slate-400 mb-4">
              Percentage of units with healthy leases (not expiring within 60 days, not evicting)
            </p>
            <div className="text-3xl font-bold tabular-nums text-amber-400 mb-4">
              {summary.healthyLeaseRate || 0}%
            </div>
            <canvas
              ref={healthyLeaseCanvasRef}
              style={{ display: stats?.healthyLeaseTrend?.length ? 'block' : 'none' }}
            />
            {!stats?.healthyLeaseTrend?.length && (
              <p className="text-slate-500 text-sm py-8 text-center">No healthy lease trend data available</p>
            )}
          </div>

          {/* Lease Detail Section */}
          <div className="glass-card p-6 mb-6">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--glass-border)]">
              <h2 className="text-lg font-semibold text-slate-100">
                Lease Detail
              </h2>
              <div className="flex gap-1 bg-surface-overlay rounded-lg p-0.5">
                <button
                  onClick={() => setLeaseDetailView('table')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    leaseDetailView === 'table'
                      ? 'bg-accent/20 text-accent-light'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Table
                </button>
                <button
                  onClick={() => setLeaseDetailView('kanban')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    leaseDetailView === 'kanban'
                      ? 'bg-accent/20 text-accent-light'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Board
                </button>
              </div>
            </div>

            {/* Issue type filter buttons */}
            <div className="mb-3">
              <div className="text-xs text-slate-500 mb-1.5">Issues</div>
              <div className="flex flex-wrap gap-1.5">
                {issueButtons.map(btn => {
                  const active = activeIssues.has(btn.key);
                  return (
                    <button
                      key={btn.key}
                      onClick={() => toggleIssue(btn.key)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        active
                          ? `${btn.activeBg} ${btn.text}`
                          : 'bg-surface-overlay text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {btn.label}
                      <span className="ml-1 tabular-nums opacity-70">{issueCounts[btn.key] || 0}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Renewal status filter buttons */}
            <div className="mb-4">
              <div className="text-xs text-slate-500 mb-1.5">Renewal Status</div>
              <div className="flex flex-wrap gap-1.5">
                {allRenewalStatuses.map(status => {
                  const active = activeStatuses.has(status);
                  const cfg = statusButtonConfig[status] || statusButtonConfig['Unknown'];
                  return (
                    <button
                      key={status}
                      onClick={() => toggleStatus(status)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        active
                          ? `${cfg.activeBg} ${cfg.text}`
                          : 'bg-surface-overlay text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {status}
                      <span className="ml-1 tabular-nums opacity-70">{statusCounts[status] || 0}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {leaseDetailView === 'table' ? (
              <>
                {/* Upcoming expirations mini bar chart */}
                <div className="mb-5">
                  <div className="text-xs text-slate-400 mb-2">Upcoming Expirations by Month</div>
                  <div style={{ height: '90px' }}>
                    <canvas ref={expirationsMiniCanvasRef} />
                  </div>
                </div>

                {/* Unified table */}
                <div className="max-h-[600px] overflow-y-auto border border-[var(--glass-border)] rounded-lg">
                  {filteredLeases.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead className="bg-surface-raised/80 text-xs text-slate-400 sticky top-0 z-10">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Property</th>
                          <th className="px-3 py-2 text-left font-medium">Unit</th>
                          <th className="px-3 py-2 text-left font-medium">Tenant</th>
                          <th className="px-3 py-2 text-left font-medium">Issue</th>
                          <th className="px-3 py-2 text-center font-medium">Days Left</th>
                          <th className="px-3 py-2 text-center font-medium">Renewal</th>
                          <th className="px-3 py-2 text-right font-medium">Rent</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {filteredLeases.map((lease, idx) => (
                          <tr key={idx} className="hover:bg-white/5 transition-colors">
                            <td className="px-3 py-2 text-slate-200 truncate max-w-[140px]" title={lease.property}>
                              {lease.property}
                            </td>
                            <td className="px-3 py-2 font-medium text-slate-100">{lease.unit}</td>
                            <td className="px-3 py-2 text-slate-200 truncate max-w-[120px]" title={lease.tenantName || ''}>
                              {lease.tenantName || <span className="text-slate-500 italic text-xs">-</span>}
                            </td>
                            <td className="px-3 py-2">
                              <IssueBadge type={lease.issueType} />
                            </td>
                            <td className="px-3 py-2 text-center text-xs font-medium tabular-nums">
                              {lease.daysUntilExpiration !== null && lease.daysUntilExpiration !== undefined ? (
                                <span className={
                                  lease.daysUntilExpiration < 0 ? 'text-rose-400' :
                                  lease.daysUntilExpiration <= 30 ? 'text-amber-400' :
                                  lease.daysUntilExpiration <= 60 ? 'text-amber-300' :
                                  'text-slate-400'
                                }>
                                  {lease.daysUntilExpiration}
                                </span>
                              ) : <span className="text-slate-500">-</span>}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <RenewalBadge status={lease.renewalStatus} />
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-slate-200 tabular-nums">
                              {lease.rent ? `$${Number(lease.rent).toLocaleString()}` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-center py-12 text-slate-500">
                      <p className="text-sm">No leases match the selected filters</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* Kanban Board View */
              (() => {
                const kanbanLeases = filteredLeases.filter(l =>
                  l.renewalStatus === 'Not sent' || l.renewalStatus === 'Pending'
                );
                const kcNotSent = kanbanLeases.filter(l => isKCProperty(l.property) && l.renewalStatus === 'Not sent');
                const kcPending = kanbanLeases.filter(l => isKCProperty(l.property) && l.renewalStatus === 'Pending');
                const coNotSent = kanbanLeases.filter(l => !isKCProperty(l.property) && l.renewalStatus === 'Not sent');
                const coPending = kanbanLeases.filter(l => !isKCProperty(l.property) && l.renewalStatus === 'Pending');

                const renewalLink = (occupancyId) =>
                  `https://appreciateinc.appfolio.com/leases/prepare_renewal?occupancy_id=${occupancyId}`;

                const KanbanCard = ({ lease }) => (
                  <div className="bg-white/[0.03] hover:bg-white/5 rounded-lg px-3 py-2 transition-colors">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-xs text-slate-400 truncate" title={lease.property}>{lease.property}</span>
                      <span className="text-xs font-medium text-slate-100 shrink-0">{lease.unit}</span>
                      {lease.occupancyId && lease.renewalStatus === 'Not sent' && (
                        <a
                          href={renewalLink(lease.occupancyId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="ml-auto shrink-0 text-[10px] font-medium text-accent hover:text-accent-light transition-colors"
                          title="Prepare renewal in AppFolio"
                        >
                          Prepare
                        </a>
                      )}
                      {lease.occupancyId && lease.renewalStatus === 'Pending' && (
                        <a
                          href={renewalLink(lease.occupancyId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="ml-auto shrink-0 text-accent hover:text-accent-light transition-colors"
                          title="Open renewal in AppFolio"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                            <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                          </svg>
                        </a>
                      )}
                    </div>
                    <div className="text-sm text-slate-200 truncate" title={lease.tenantName || ''}>
                      {lease.tenantName || <span className="text-slate-500 italic text-xs">-</span>}
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex items-center gap-2">
                        <IssueBadge type={lease.issueType} />
                        {lease.daysUntilExpiration !== null && lease.daysUntilExpiration !== undefined ? (
                          <span className={`text-xs tabular-nums font-medium ${
                            lease.daysUntilExpiration < 0 ? 'text-rose-400' :
                            lease.daysUntilExpiration <= 30 ? 'text-amber-400' :
                            lease.daysUntilExpiration <= 60 ? 'text-amber-300' :
                            'text-slate-400'
                          }`}>
                            {lease.daysUntilExpiration}d
                          </span>
                        ) : null}
                      </div>
                      <span className="text-xs font-medium text-slate-200 tabular-nums">
                        {lease.rent ? `$${Number(lease.rent).toLocaleString()}` : ''}
                      </span>
                    </div>
                  </div>
                );

                const KanbanColumn = ({ label, items, variant }) => {
                  const isTeal = variant === 'teal';
                  const headerBg = isTeal ? 'bg-accent' : 'bg-surface-raised';
                  const headerText = isTeal ? 'text-surface-base' : 'text-accent-light';
                  const countBadge = isTeal ? 'bg-white/20 text-surface-base' : 'bg-accent/15 text-accent';
                  const colBg = isTeal ? 'bg-accent/[0.06]' : 'bg-white/[0.03]';

                  return (
                    <div className="flex-1 min-w-0">
                      <div className={`${headerBg} ${headerText} px-3 py-1.5 rounded-lg flex items-center justify-between`}>
                        <span className="font-semibold text-xs">{label}</span>
                        <span className={`text-xs ${countBadge} px-1.5 py-0.5 rounded-full`}>{items.length}</span>
                      </div>
                      <div className={`${colBg} rounded-lg p-1.5 space-y-1.5 mt-1.5 min-h-[100px] max-h-[400px] overflow-y-auto dark-scrollbar`}>
                        {items.length === 0 ? (
                          <div className="text-center text-xs py-4 text-slate-500">No leases</div>
                        ) : (
                          items.map((lease, idx) => <KanbanCard key={idx} lease={lease} />)
                        )}
                      </div>
                    </div>
                  );
                };

                return (
                  <div className="space-y-6">
                    {/* Kansas City */}
                    <div>
                      <div className="text-sm font-medium text-slate-300 mb-2">Kansas City</div>
                      <div className="flex gap-3">
                        <KanbanColumn label="Not sent" items={kcNotSent} variant="teal" />
                        <KanbanColumn label="Pending" items={kcPending} variant="dark" />
                      </div>
                    </div>
                    {/* Columbia */}
                    <div>
                      <div className="text-sm font-medium text-slate-300 mb-2">Columbia</div>
                      <div className="flex gap-3">
                        <KanbanColumn label="Not sent" items={coNotSent} variant="teal" />
                        <KanbanColumn label="Pending" items={coPending} variant="dark" />
                      </div>
                    </div>
                  </div>
                );
              })()
            )}
          </div>

          {/* Renewals by Month Chart */}
          <div className="glass-card p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">
              Renewals by Month (Last 12 Months)
            </h2>
            <canvas
              ref={renewalsCanvasRef}
              style={{ display: stats?.leaseHealthDetails?.renewalsByMonth?.length ? 'block' : 'none' }}
            />
            {!stats?.leaseHealthDetails?.renewalsByMonth?.length && (
              <p className="text-slate-500 text-sm py-8 text-center">No renewal data available</p>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
