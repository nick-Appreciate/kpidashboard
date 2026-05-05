'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import useSWR from 'swr';
import Chart from 'chart.js/auto';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import Link from 'next/link';
import LeadsPerUnitChart from './LeadsPerUnitChart';
import SourcesChart from './SourcesChart';
import TimeSeriesChart from './TimeSeriesChart';
import TopPropertiesChart from './TopPropertiesChart';
import { DARK_CHART_DEFAULTS, STAGE_COLORS, CHART_PALETTE } from '../lib/chartTheme';
import DarkSelect from './DarkSelect';
import { fetcher } from '../lib/swr';

export default function Dashboard() {
  const [selectedProperty, setSelectedProperty] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [dateRange, setDateRange] = useState('last_month');
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    const lastMonth = new Date(today);
    lastMonth.setMonth(today.getMonth() - 1);
    return lastMonth.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    return nextWeek.toISOString().split('T')[0];
  });
  const [selectedStages, setSelectedStages] = useState(['inquiries']);
  const [granularity, setGranularity] = useState('weekly');
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [headerHovered, setHeaderHovered] = useState(false);

  const funnelChartRef = useRef(null);
  const conversionChartRef = useRef(null);
  const headerRef = useRef(null);
  const funnelRenderedRef = useRef(null); // track funnel data identity to prevent double-render

  // Calculate date range based on preset
  const getDateRangeFromPreset = (preset) => {
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    const formatDate = (date) => date.toISOString().split('T')[0];

    switch (preset) {
      case 'today':
        return { start: formatDate(today), end: formatDate(nextWeek) };
      case 'last_week': {
        const lastWeekStart = new Date(today);
        lastWeekStart.setDate(today.getDate() - 7);
        return { start: formatDate(lastWeekStart), end: formatDate(nextWeek) };
      }
      case 'last_month': {
        const lastMonthStart = new Date(today);
        lastMonthStart.setMonth(today.getMonth() - 1);
        return { start: formatDate(lastMonthStart), end: formatDate(nextWeek) };
      }
      case 'last_quarter': {
        const lastQuarterStart = new Date(today);
        lastQuarterStart.setMonth(today.getMonth() - 3);
        return { start: formatDate(lastQuarterStart), end: formatDate(nextWeek) };
      }
      case 'last_year': {
        const lastYearStart = new Date(today);
        lastYearStart.setFullYear(today.getFullYear() - 1);
        return { start: formatDate(lastYearStart), end: formatDate(nextWeek) };
      }
      case 'all_time':
        return { start: '', end: '' };
      case 'custom':
        return null;
      default:
        return { start: '', end: '' };
    }
  };

  // Update dates and auto-set granularity when preset changes
  useEffect(() => {
    const range = getDateRangeFromPreset(dateRange);
    if (range) {
      setStartDate(range.start);
      setEndDate(range.end);
    }
    const defaultGranularity = { today: 'daily', last_week: 'daily', last_month: 'weekly', last_quarter: 'weekly', last_year: 'monthly', all_time: 'monthly' };
    if (defaultGranularity[dateRange]) setGranularity(defaultGranularity[dateRange]);
  }, [dateRange]);

  // Scroll-based collapse for stage chips.
  // Delta threshold triggers toggle, then a cooldown locks out further changes
  // until the CSS transition (200ms) finishes. During cooldown the anchor stays
  // fresh so no stale delta fires when it resumes.
  useEffect(() => {
    const THRESHOLD = 20;
    const COOLDOWN = 250; // ms — slightly longer than the 200ms CSS transition
    let anchorY = window.scrollY || 0;
    let lastToggle = 0;

    const handleScroll = () => {
      const scrollY = window.scrollY || document.documentElement.scrollTop;
      const now = Date.now();

      // During cooldown: keep anchor fresh but don't toggle
      if (now - lastToggle < COOLDOWN) {
        anchorY = scrollY;
        return;
      }

      if (scrollY < 10) {
        setHeaderCollapsed(false);
        anchorY = scrollY;
        lastToggle = now;
        return;
      }

      const travel = scrollY - anchorY;

      if (travel > THRESHOLD && scrollY > 60) {
        setHeaderCollapsed(true);
        anchorY = scrollY;
        lastToggle = now;
      } else if (travel < -THRESHOLD) {
        setHeaderCollapsed(false);
        anchorY = scrollY;
        lastToggle = now;
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Build SWR cache keys from current filters
  const buildFilterParams = () => {
    const params = new URLSearchParams();
    if (selectedProperty.startsWith('region_') || selectedProperty === 'farquhar') {
      params.append('region', selectedProperty);
    } else if (selectedProperty !== 'all') {
      params.append('property', selectedProperty);
    }
    if (selectedStatus !== 'all') params.append('status', selectedStatus);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    return params;
  };

  const filterParams = buildFilterParams();

  // SWR data fetching — cached across navigations, deduped, background revalidation
  const { data: inquiriesData, error: inquiriesError, isLoading: inquiriesLoading } = useSWR(
    `/api/inquiries?${filterParams}`, fetcher, { revalidateOnMount: true, refreshInterval: 5 * 60 * 1000 }
  );
  const { data: statsData, isLoading: statsLoading } = useSWR(
    `/api/stats?${filterParams}`, fetcher, { revalidateOnMount: true, refreshInterval: 5 * 60 * 1000 }
  );
  const { data: funnelDataRes, isLoading: funnelLoading } = useSWR(
    `/api/funnel?${filterParams}`, fetcher, { revalidateOnMount: true, refreshInterval: 5 * 60 * 1000 }
  );
  const { data: propertiesData } = useSWR('/api/inquiries/properties', fetcher, { revalidateOnMount: true });
  const { data: statusesData } = useSWR('/api/inquiries/statuses', fetcher, { revalidateOnMount: true });

  // Derive values from SWR data (replacing old setState calls)
  const inquiries = inquiriesData?.inquiries || [];
  const stats = statsData || null;
  const funnelData = funnelDataRes || null;
  const properties = propertiesData || [];
  const statuses = statusesData || [];
  const loading = inquiriesLoading || statsLoading || funnelLoading;
  const error = inquiriesError;
  const lastUpdated = stats?.lastDataInsert ? new Date(stats.lastDataInsert) : null;

  // Stage-specific data
  const buildStageKey = () => {
    if (selectedStages.length === 0) return null;
    const params = new URLSearchParams();
    params.append('stages', selectedStages.join(','));
    if (selectedProperty.startsWith('region_') || selectedProperty === 'farquhar') {
      params.append('region', selectedProperty);
    } else if (selectedProperty !== 'all') {
      params.append('property', selectedProperty);
    }
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    params.append('granularity', granularity);
    return `/api/stage-stats?${params}`;
  };
  const { data: stageStats } = useSWR(buildStageKey(), fetcher, { revalidateOnMount: true });

  const handleStageClick = (stageName) => {
    const stageMap = {
      'Inquiries': 'inquiries',
      'Showings Scheduled': 'showings_scheduled',
      'Showings Completed': 'showings_completed',
      'Applications': 'applications',
      'Leases': 'leases'
    };

    const stageKey = stageMap[stageName];

    setSelectedStages(prev => {
      if (prev.includes(stageKey)) {
        return prev.filter(s => s !== stageKey);
      } else {
        return [...prev, stageKey];
      }
    });
  };

  const getStageDisplayNames = useCallback(() => {
    const nameMap = {
      'inquiries': 'Inquiries',
      'showings_scheduled': 'Showings Scheduled',
      'showings_completed': 'Showings Completed',
      'applications': 'Applications',
      'leases': 'Leases'
    };
    return selectedStages.map(s => nameMap[s]).filter(Boolean).join(', ');
  }, [selectedStages]);

  // Conversion rate chart (uses ref — always mounted, clears when no data)
  useEffect(() => {
    if (selectedStages.length === 0 || !stageStats) {
      // Clear chart when no stages selected
      if (conversionChartRef.current?.chart) {
        conversionChartRef.current.chart.destroy();
        conversionChartRef.current.chart = null;
      }
      return;
    }

    const data = stageStats;
    const hasBucketData = data.timeSeriesDataByStage && Object.keys(data.timeSeriesDataByStage).length > 0;
    if (!hasBucketData) return;

    const stages = data.stages || [];

    // Filter out future buckets — only show historical data
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const pastBucketCount = data.allBuckets?.filter(b => b.key <= todayStr).length ?? data.allBuckets?.length ?? 0;
    const bucketLabels = (data.allBuckets || []).slice(0, pastBucketCount).map(b => b.label);

    if (conversionChartRef.current && data.conversionByStage && bucketLabels.length > 0) {
      const ctx = conversionChartRef.current.getContext('2d');
      if (conversionChartRef.current.chart) conversionChartRef.current.chart.destroy();

      const conversionDatasets = stages
        .filter(stage => stage !== 'inquiries')
        .map(stage => {
          const stageData = data.conversionByStage[stage];
          const color = STAGE_COLORS[stage] || stageData.color;
          return {
            label: stageData.label,
            data: stageData.data.slice(0, pastBucketCount).map(d => d.percentage),
            borderColor: color,
            backgroundColor: `${color}20`,
            fill: false,
            tension: 0.4,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 2,
          };
        });

      conversionChartRef.current.chart = new Chart(ctx, {
        type: 'line',
        data: { labels: bucketLabels, datasets: conversionDatasets },
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
                label: function(context) {
                  const stage = stages.filter(s => s !== 'inquiries')[context.datasetIndex];
                  const convData = data.conversionByStage[stage]?.data[context.dataIndex];
                  if (convData) {
                    return `${context.dataset.label}: ${convData.percentage}% (${convData.count}/${convData.baseline} ${convData.baselineLabel || 'previous stage'})`;
                  }
                  return `${context.dataset.label}: ${context.parsed.y}%`;
                }
              }
            }
          },
          scales: {
            y: {
              ...DARK_CHART_DEFAULTS.scales.y,
              beginAtZero: true,
              max: 100,
              ticks: { ...DARK_CHART_DEFAULTS.scales.y.ticks, callback: function(value) { return value + '%'; } },
              title: { display: true, text: 'Conversion Rate (%)', color: '#94a3b8' }
            },
            x: { ...DARK_CHART_DEFAULTS.scales.x, ticks: { ...DARK_CHART_DEFAULTS.scales.x.ticks, maxRotation: 45, minRotation: 45 } }
          }
        }
      });
    }

    return () => {
      if (conversionChartRef.current?.chart) {
        conversionChartRef.current.chart.destroy();
        conversionChartRef.current.chart = null;
      }
    };
  }, [stageStats, selectedStages]);

  // Render horizontal bar chart for leasing lifecycle (uses ref — works fine since it's always mounted)
  useEffect(() => {
    if (!funnelData?.stages || !funnelChartRef.current) return;
    // Prevent double-render: compare actual counts, not object identity (Strict Mode causes two fetches with same data)
    const dataKey = funnelData.stages.map(s => s.count).join(',');
    if (funnelRenderedRef.current === dataKey) return;
    funnelRenderedRef.current = dataKey;

    if (funnelChartRef.current.chart) {
      funnelChartRef.current.chart.destroy();
    }

    const stageKeys = ['inquiries', 'showings_scheduled', 'showings_completed', 'applications', 'leases'];
    const stages = funnelData.stages;

    const ctx = funnelChartRef.current.getContext('2d');
    funnelChartRef.current.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: stages.map(s => s.name),
        datasets: [{
          data: stages.map(s => s.count),
          backgroundColor: stageKeys.map(k => STAGE_COLORS[k] + '99'),
          borderColor: stageKeys.map(k => STAGE_COLORS[k]),
          borderWidth: 1,
          borderRadius: 4,
          barThickness: 24,
        }],
      },
      plugins: [ChartDataLabels],
      options: {
        ...DARK_CHART_DEFAULTS,
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { right: 120 } },
        plugins: {
          ...DARK_CHART_DEFAULTS.plugins,
          legend: { display: false },
          datalabels: {
            anchor: 'end',
            align: 'end',
            formatter: (value, context) => {
              const stage = stages[context.dataIndex];
              if (context.dataIndex > 0 && stage.conversionFromPrevious !== null) {
                return `${value.toLocaleString()}  (${stage.conversionFromPrevious}%)`;
              }
              return `${value.toLocaleString()}`;
            },
            color: '#e2e8f0',
            font: { weight: 'bold', size: 11, family: 'Inter, sans-serif' },
          },
          tooltip: {
            ...DARK_CHART_DEFAULTS.plugins?.tooltip,
            callbacks: {
              title: (items) => items[0].label,
              label: (item) => {
                const stage = stages[item.dataIndex];
                const lines = [];
                if (stage.fallout?.count > 0) {
                  lines.push(`Lost: ${stage.fallout.count} (${stage.fallout.percentage}%)`);
                  stage.fallout.reasons?.filter(r => r.count > 0).forEach(r => {
                    lines.push(`  ${r.label}: ${r.count}`);
                  });
                }
                return lines;
              },
            },
          },
        },
        scales: {
          x: {
            ...DARK_CHART_DEFAULTS.scales?.x,
            suggestedMax: 50,
            grid: { color: 'rgba(255,255,255,0.04)' },
          },
          y: {
            ...DARK_CHART_DEFAULTS.scales?.y,
            grid: { display: false },
          },
        },
      },
    });

    return () => {
      if (funnelChartRef.current?.chart) {
        funnelChartRef.current.chart.destroy();
        funnelChartRef.current.chart = null;
      }
      funnelRenderedRef.current = null; // Allow re-creation on Strict Mode remount
    };
  }, [funnelData]);

  if (loading && !stats) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass-card p-8 flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent"></div>
          <p className="text-slate-400 text-sm">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="min-h-screen p-6 md:p-8 flex items-center justify-center">
        <div className="glass-card p-8 max-w-md">
          <p className="text-red-400 mb-4">{error.message || String(error)}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full btn-accent py-2 px-4"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const showStageChips = !headerCollapsed || headerHovered;

  return (
    <div className="min-h-screen">
      {/* Fixed header */}
      <div
        ref={headerRef}
        className="sticky-header"
        onMouseEnter={() => setHeaderHovered(true)}
        onMouseLeave={() => setHeaderHovered(false)}
      >
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-4 h-10 px-6 border-b border-[var(--glass-border)]">
            <h1 className="text-sm font-semibold text-slate-100 whitespace-nowrap">
              Leasing Dashboard
            </h1>
            <div className="flex items-center gap-2 flex-1 justify-end flex-wrap">
              <DarkSelect
                value={selectedProperty}
                onChange={setSelectedProperty}
                disabled={loading}
                compact
                className="w-36"
                options={[
                  { value: 'all', label: 'All Properties' },
                  { value: 'farquhar', label: 'Farquhar (excl. Glen Oaks)' },
                  { group: 'Regions', options: [
                    { value: 'region_kansas_city', label: 'Kansas City' },
                    { value: 'region_columbia', label: 'Columbia' },
                  ]},
                  { group: 'Properties', options: properties.map(prop => ({
                    value: prop,
                    label: prop.length > 50 ? prop.substring(0, 50) + '...' : prop,
                  }))},
                ]}
              />
              <DarkSelect
                value={selectedStatus}
                onChange={setSelectedStatus}
                disabled={loading}
                compact
                className="w-32"
                options={[
                  { value: 'all', label: 'All Statuses' },
                  ...statuses.map(status => ({ value: status, label: status })),
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
              <div className="flex rounded-lg border border-[var(--glass-border)] overflow-hidden h-[26px]">
                {['daily', 'weekly', 'monthly', 'quarterly'].map(g => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={`px-2 text-[11px] font-medium transition ${
                      granularity === g
                        ? 'bg-accent text-surface-base'
                        : 'bg-white/5 text-slate-400 hover:bg-white/10'
                    }`}
                  >
                    {g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>
              {(selectedProperty !== 'all' || selectedStatus !== 'all' || dateRange !== 'last_month' || granularity !== 'weekly') && (
                <button
                  onClick={() => {
                    setSelectedProperty('all');
                    setSelectedStatus('all');
                    setDateRange('last_month');
                    setGranularity('weekly');
                    setSelectedStages([]);
                  }}
                  disabled={loading}
                  className="text-xs text-slate-500 hover:text-accent transition whitespace-nowrap"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
          {dateRange === 'custom' && (
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
          {/* Stage multi-select chips — auto-collapse on scroll, expand on hover */}
          <div
            className="overflow-hidden transition-all duration-200 px-6"
            style={{
              maxHeight: showStageChips ? '60px' : '0px',
              opacity: showStageChips ? 1 : 0,
              paddingTop: showStageChips ? '6px' : '0px',
              paddingBottom: showStageChips ? '6px' : '0px',
            }}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 mr-1">Stages:</span>
              {[
                { key: 'inquiries', label: 'Inquiries' },
                { key: 'showings_scheduled', label: 'Scheduled' },
                { key: 'showings_completed', label: 'Completed' },
                { key: 'applications', label: 'Applications' },
                { key: 'leases', label: 'Leases' },
              ].map(({ key, label }) => {
                const color = STAGE_COLORS[key];
                const isActive = selectedStages.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => handleStageClick(Object.entries({
                      'inquiries': 'Inquiries',
                      'showings_scheduled': 'Showings Scheduled',
                      'showings_completed': 'Showings Completed',
                      'applications': 'Applications',
                      'leases': 'Leases',
                    }).find(([k]) => k === key)?.[1])}
                    className="px-2.5 py-0.5 rounded-full text-xs font-medium transition-all border"
                    style={{
                      backgroundColor: isActive ? `${color}25` : 'transparent',
                      borderColor: isActive ? `${color}60` : 'rgba(255,255,255,0.08)',
                      color: isActive ? color : '#64748b',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Content with spacer for fixed header */}
      <div className="px-6 md:px-8 pb-6 md:pb-8">
        <div className="max-w-7xl mx-auto">

        {/* Time Series Chart — standalone component, always mounted */}
        <TimeSeriesChart stageStats={selectedStages.length > 0 ? stageStats : null} stageName={getStageDisplayNames()} />

        {/* Leasing Lifecycle — Horizontal Bar Chart */}
        {funnelData && funnelData.stages && (
          <div className="glass-card p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">
              Leasing Lifecycle
            </h2>
            <div style={{ height: '180px' }}>
              <canvas ref={funnelChartRef}></canvas>
            </div>
            {/* Compact conversion stats */}
            <div className="grid grid-cols-5 gap-2 mt-4 pt-3 border-t border-[var(--glass-border)]">
              {[
                { label: 'Overall', sub: 'Inquiry \u2192 Lease', value: `${funnelData.summary.overallConversion}%`, color: '#6366f1' },
                { label: 'Scheduling', sub: 'Inquiry \u2192 Showing', value: `${funnelData.stages[1]?.conversionFromPrevious || 0}%`, color: '#8b5cf6' },
                { label: 'Completion', sub: 'Scheduled \u2192 Complete', value: `${funnelData.summary.showingCompletionRate || 0}%`, color: '#a78bfa' },
                { label: 'Application', sub: 'Complete \u2192 Applied', value: `${funnelData.stages[3]?.conversionFromPrevious || 0}%`, color: '#f472b6' },
                { label: 'Approval', sub: 'Applied \u2192 Lease', value: `${funnelData.summary.applicationApprovalRate || 0}%`, color: '#34d399' },
              ].map(({ label, sub, value, color }) => (
                <div key={label} className="text-center py-2 px-1 rounded-lg" style={{ backgroundColor: `${color}10`, border: `1px solid ${color}18` }}>
                  <p className="text-lg font-bold" style={{ color }}>{value}</p>
                  <p className="text-[11px] font-medium text-slate-300 leading-tight">{label}</p>
                  <p className="text-[10px] text-slate-500 leading-tight">{sub}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Conversion Rate Chart — always mounted */}
        <div className="glass-card p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">Conversion Rate (% of Previous Stage)</h2>
          <p className="text-sm text-slate-400 mb-4">Shows what percentage converted from the previous funnel stage each period</p>
          <canvas ref={conversionChartRef} style={{ display: selectedStages.length > 0 && stageStats && selectedStages.some(s => s !== 'inquiries') ? 'block' : 'none' }}></canvas>
          {!(selectedStages.length > 0 && stageStats && selectedStages.some(s => s !== 'inquiries')) && (
            <p className="text-slate-500 text-sm py-8 text-center">Select multiple stages to view conversion rates</p>
          )}
        </div>

        {/* Sources Line Chart — always mounted */}
        <SourcesChart stageStats={selectedStages.length > 0 ? stageStats : null} />

        {/* Leads per Completed Rehab Unit Chart — always mounted */}
        <LeadsPerUnitChart
          stageStats={selectedStages.length > 0 ? stageStats : null}
          granularity={granularity}
          startDate={startDate}
          endDate={endDate}
          selectedStages={selectedStages}
        />

        {/* Top Properties — standalone component, always mounted */}
        <TopPropertiesChart topProperties={selectedStages.length > 0 ? stageStats?.topProperties : null} stageName={getStageDisplayNames()} />
        </div>
      </div>
    </div>
  );
}
