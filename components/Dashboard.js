'use client';

import { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import Link from 'next/link';
import LeadsPerUnitChart from './LeadsPerUnitChart';
import SourcesChart from './SourcesChart';
import { DARK_CHART_DEFAULTS, STAGE_COLORS, CHART_PALETTE } from '../lib/chartTheme';

export default function Dashboard() {
  const [inquiries, setInquiries] = useState([]);
  const [stats, setStats] = useState(null);
  const [funnelData, setFunnelData] = useState(null);
  const [properties, setProperties] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [selectedProperty, setSelectedProperty] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [dateRange, setDateRange] = useState('last_month'); // Preset date range
  // Initialize dates based on default preset (last_month)
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedStages, setSelectedStages] = useState([]); // array for multi-select
  const [stageStats, setStageStats] = useState(null);
  const [granularity, setGranularity] = useState('weekly');

  // Chart refs
  const timeSeriesChartRef = useRef(null);
  const conversionChartRef = useRef(null);
  const propertyChartRef = useRef(null);
  const unitTypeChartRef = useRef(null);
  
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
        return null; // Don't change dates for custom
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
  
  // Fetch data
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000); // Every 5 minutes
    return () => clearInterval(interval);
  }, [selectedProperty, selectedStatus, startDate, endDate]);
  
  // Fetch stage-specific data when stages are selected or filters change
  useEffect(() => {
    const fetchStageData = async () => {
      if (selectedStages.length === 0) {
        setStageStats(null);
        return;
      }
      
      try {
        const params = new URLSearchParams();
        params.append('stages', selectedStages.join(','));
        if (selectedProperty.startsWith('region_')) {
          params.append('region', selectedProperty);
        } else if (selectedProperty !== 'all') {
          params.append('property', selectedProperty);
        }
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        params.append('granularity', granularity);

        const res = await fetch(`/api/stage-stats?${params}`);
        const data = await res.json();
        setStageStats(data);
      } catch (err) {
        console.error('Error fetching stage data:', err);
      }
    };

    fetchStageData();
  }, [selectedStages, selectedProperty, startDate, endDate, granularity]);
  
  const handleStageClick = (stageName) => {
    // Map stage names to API stage values
    const stageMap = {
      'Inquiries': 'inquiries',
      'Showings Scheduled': 'showings_scheduled',
      'Showings Completed': 'showings_completed',
      'Applications': 'applications',
      'Leases': 'leases'
    };
    
    const stageKey = stageMap[stageName];
    
    // Multi-select toggle - add or remove from array
    setSelectedStages(prev => {
      if (prev.includes(stageKey)) {
        return prev.filter(s => s !== stageKey);
      } else {
        return [...prev, stageKey];
      }
    });
  };
  
  // Get display names for selected stages
  const getStageDisplayNames = () => {
    const nameMap = {
      'inquiries': 'Inquiries',
      'showings_scheduled': 'Showings Scheduled',
      'showings_completed': 'Showings Completed',
      'applications': 'Applications',
      'leases': 'Leases'
    };
    return selectedStages.map(s => nameMap[s]).filter(Boolean).join(', ');
  };
  
  const fetchData = async () => {
    try {
      setLoading(true);
      
      const params = new URLSearchParams();
      if (selectedProperty.startsWith('region_')) {
        params.append('region', selectedProperty);
      } else if (selectedProperty !== 'all') {
        params.append('property', selectedProperty);
      }
      if (selectedStatus !== 'all') params.append('status', selectedStatus);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      // Fetch inquiries
      const inquiriesRes = await fetch(`/api/inquiries?${params}`);
      const inquiriesData = await inquiriesRes.json();
      setInquiries(inquiriesData.inquiries || []);
      
      // Fetch stats
      const statsRes = await fetch(`/api/stats?${params}`);
      const statsData = await statsRes.json();
      setStats(statsData);
      
      // Fetch funnel data
      const funnelRes = await fetch(`/api/funnel?${params}`);
      const funnelDataRes = await funnelRes.json();
      setFunnelData(funnelDataRes);
      
      // Fetch filter options
      const propertiesRes = await fetch('/api/inquiries/properties');
      const propertiesData = await propertiesRes.json();
      setProperties(propertiesData || []);
      
      const statusesRes = await fetch('/api/inquiries/statuses');
      const statusesData = await statusesRes.json();
      setStatuses(statusesData || []);
      
      // Use the last data insert time from Supabase
      if (statsData.lastDataInsert) {
        setLastUpdated(new Date(statsData.lastDataInsert));
      } else {
        setLastUpdated(new Date());
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  // Update charts when stage stats change
  useEffect(() => {
    if (selectedStages.length === 0 || !stageStats) return;
    
    updateChartsWithData(stageStats, getStageDisplayNames());
    
    return () => {
      [timeSeriesChartRef, propertyChartRef, conversionChartRef].forEach(ref => {
        if (ref.current?.chart) {
          ref.current.chart.destroy();
        }
      });
    };
  }, [stageStats, selectedStages]);
  
  const updateChartsWithData = (data, stageName) => {
    // Unified bucketed data format
    const hasBucketData = data.timeSeriesDataByStage && Object.keys(data.timeSeriesDataByStage).length > 0;

    if (hasBucketData) {
      const stages = data.stages || [];
      const bucketLabels = (data.allBuckets || []).map(b => b.label);

      // Compute "Today" line position (only when future data exists)
      let todayBucketIndex = -1;
      if (data.hasFutureData && data.allBuckets?.length > 0) {
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        // Find the bucket that contains today
        for (let i = 0; i < data.allBuckets.length; i++) {
          if (data.allBuckets[i].key >= todayStr) { todayBucketIndex = i; break; }
        }
      }

      // Chart.js plugin to draw a vertical "Today" line
      const todayLinePlugin = {
        id: 'todayLine',
        afterDraw(chart) {
          const todayIdx = chart.options.plugins?.todayLine?.index;
          if (todayIdx == null || todayIdx < 0) return;
          const meta = chart.getDatasetMeta(0);
          if (!meta.data[todayIdx]) return;
          const ctx = chart.ctx;
          const yScale = chart.scales.y;
          const x = meta.data[todayIdx].x;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x, yScale.top);
          ctx.lineTo(x, yScale.bottom);
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
          ctx.setLineDash([6, 4]);
          ctx.stroke();
          ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Today', x, yScale.top - 6);
          ctx.restore();
        }
      };

      // Time series chart (line)
      if (timeSeriesChartRef.current && bucketLabels.length > 0) {
        const ctx = timeSeriesChartRef.current.getContext('2d');
        if (timeSeriesChartRef.current.chart) timeSeriesChartRef.current.chart.destroy();

        const datasets = stages.map(stage => {
          const stageData = data.timeSeriesDataByStage[stage];
          const color = STAGE_COLORS[stage] || stageData.color;
          return {
            label: stageData.label,
            data: stageData.data.map(d => d.count),
            borderColor: color,
            backgroundColor: `${color}40`,
            fill: false,
            tension: 0.4,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 2,
          };
        });

        const detailsByStage = {};
        stages.forEach(stage => {
          detailsByStage[stage] = data.timeSeriesDataByStage[stage].data.map(d => d.details || []);
        });

        timeSeriesChartRef.current.chart = new Chart(ctx, {
          type: 'line',
          data: { labels: bucketLabels, datasets },
          plugins: [todayLinePlugin],
          options: {
            ...DARK_CHART_DEFAULTS,
            plugins: {
              ...DARK_CHART_DEFAULTS.plugins,
              todayLine: { index: todayBucketIndex },
              legend: { ...DARK_CHART_DEFAULTS.plugins.legend, display: true, position: 'top' },
              tooltip: {
                ...DARK_CHART_DEFAULTS.plugins.tooltip,
                callbacks: {
                  afterBody: function(context) {
                    const idx = context[0].dataIndex;
                    const datasetIndex = context[0].datasetIndex;
                    const stage = stages[datasetIndex];
                    const details = detailsByStage[stage]?.[idx] || [];
                    if (details.length === 0) return '';
                    const lines = details.slice(0, 10).map(d => {
                      const location = d.property ? `${d.property}${d.unit ? ' #' + d.unit : ''}` : '';
                      return `• ${d.name}${location ? ' (' + location + ')' : ''}`;
                    });
                    if (details.length > 10) lines.push(`... and ${details.length - 10} more`);
                    return lines;
                  }
                }
              }
            },
            scales: {
              y: { ...DARK_CHART_DEFAULTS.scales.y, beginAtZero: true, ticks: { ...DARK_CHART_DEFAULTS.scales.y.ticks, stepSize: 1 } },
              x: { ...DARK_CHART_DEFAULTS.scales.x, ticks: { ...DARK_CHART_DEFAULTS.scales.x.ticks, maxRotation: 45, minRotation: 45 } }
            }
          }
        });
      }

      // Conversion percentage chart
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
              data: stageData.data.map(d => d.percentage),
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
          plugins: [todayLinePlugin],
          options: {
            ...DARK_CHART_DEFAULTS,
            plugins: {
              ...DARK_CHART_DEFAULTS.plugins,
              todayLine: { index: todayBucketIndex },
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
    }
    
    // Property, lead type, source, and status charts work the same for single or multi-stage
    // Use a default color for aggregated data
    const defaultColor = '#06b6d4';
    
    if (propertyChartRef.current && data.topProperties?.length > 0) {
      const ctx = propertyChartRef.current.getContext('2d');
      if (propertyChartRef.current.chart) propertyChartRef.current.chart.destroy();
      
      propertyChartRef.current.chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: data.topProperties.map(p => {
            const parts = p.property.split('-');
            return parts[0].trim().substring(0, 30) + '...';
          }),
          datasets: [{
            label: stageName || 'Count',
            data: data.topProperties.map(p => p.count),
            backgroundColor: '#06b6d4'
          }]
        },
        options: {
          ...DARK_CHART_DEFAULTS,
          indexAxis: 'y',
          plugins: { ...DARK_CHART_DEFAULTS.plugins, legend: { display: false } },
          scales: {
            x: { ...DARK_CHART_DEFAULTS.scales.x, beginAtZero: true, ticks: { ...DARK_CHART_DEFAULTS.scales.x.ticks, stepSize: 1 } },
            y: DARK_CHART_DEFAULTS.scales.y
          }
        }
      });
    }

  };

  const updateCharts = () => {
    if (propertyChartRef.current && stats.topProperties?.length > 0) {
      const ctx = propertyChartRef.current.getContext('2d');
      if (propertyChartRef.current.chart) propertyChartRef.current.chart.destroy();

      propertyChartRef.current.chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: stats.topProperties.map(p => {
            const parts = p.property.split('-');
            return parts[0].trim().substring(0, 30) + '...';
          }),
          datasets: [{
            label: 'Inquiries',
            data: stats.topProperties.map(p => p.count),
            backgroundColor: '#06b6d4'
          }]
        },
        options: {
          ...DARK_CHART_DEFAULTS,
          indexAxis: 'y',
          plugins: { ...DARK_CHART_DEFAULTS.plugins, legend: { display: false } },
          scales: {
            x: { ...DARK_CHART_DEFAULTS.scales.x, beginAtZero: true, ticks: { ...DARK_CHART_DEFAULTS.scales.x.ticks, stepSize: 1 } },
            y: DARK_CHART_DEFAULTS.scales.y
          }
        }
      });
    }

    if (unitTypeChartRef.current && stats.unitTypeDistribution?.length > 0) {
      const ctx = unitTypeChartRef.current.getContext('2d');
      if (unitTypeChartRef.current.chart) unitTypeChartRef.current.chart.destroy();

      unitTypeChartRef.current.chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: stats.unitTypeDistribution.map(u => u.unit_type || 'Unknown'),
          datasets: [{
            label: 'Inquiries',
            data: stats.unitTypeDistribution.map(u => u.count),
            backgroundColor: '#06b6d4'
          }]
        },
        options: {
          ...DARK_CHART_DEFAULTS,
          indexAxis: 'y',
          plugins: { ...DARK_CHART_DEFAULTS.plugins, legend: { display: false } },
          scales: {
            x: { ...DARK_CHART_DEFAULTS.scales.x, beginAtZero: true, ticks: { ...DARK_CHART_DEFAULTS.scales.x.ticks, stepSize: 1 } },
            y: DARK_CHART_DEFAULTS.scales.y
          }
        }
      });
    }
  };
  
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
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="w-full btn-accent py-2 px-4"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  
  const activeCount = stats?.statusDistribution?.find(s => s.status === 'Active')?.count || 0;
  const avgPerProperty = stats?.propertyCount > 0 ? (stats.total / stats.propertyCount).toFixed(1) : 0;
  
  return (
    <div className="min-h-screen p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="glass-card p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-semibold text-slate-100 mb-1">
                Leasing Dashboard
              </h1>
              <p className="text-slate-400 text-sm">
                Real-time property inquiry analytics
                {lastUpdated && (
                  <span className="text-slate-500 ml-2">
                    • Last sync: {lastUpdated.toLocaleDateString()} {lastUpdated.toLocaleTimeString()}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
        
        {/* Filters */}
        <div className="glass-card p-4 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                Property
              </label>
              <select
                value={selectedProperty}
                onChange={(e) => setSelectedProperty(e.target.value)}
                disabled={loading}
                className="dark-select w-full px-3 py-2 text-sm"
              >
                <option value="all">All Properties</option>
                <optgroup label="Regions">
                  <option value="region_kansas_city">Kansas City</option>
                  <option value="region_columbia">Columbia</option>
                </optgroup>
                <optgroup label="Properties">
                  {properties.map(prop => (
                    <option key={prop} value={prop}>
                      {prop.substring(0, 50)}{prop.length > 50 ? '...' : ''}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                Status
              </label>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                disabled={loading}
                className="dark-select w-full px-3 py-2 text-sm"
              >
                <option value="all">All Statuses</option>
                {statuses.map(status => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                Date Range
              </label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                disabled={loading}
                className="dark-select w-full px-3 py-2 text-sm"
              >
                <option value="today">Today</option>
                <option value="last_week">Last 7 Days</option>
                <option value="last_month">Last 30 Days</option>
                <option value="last_quarter">Last 90 Days</option>
                <option value="last_year">Last Year</option>
                <option value="all_time">All Time</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                Granularity
              </label>
              <div className="flex rounded-lg border border-[var(--glass-border)] overflow-hidden h-[38px]">
                {['daily', 'weekly', 'monthly', 'quarterly'].map(g => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={`flex-1 px-2 text-xs font-medium transition ${
                      granularity === g
                        ? 'bg-accent text-surface-base'
                        : 'bg-white/5 text-slate-400 hover:bg-white/10'
                    }`}
                  >
                    {g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {dateRange === 'custom' && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={loading}
                  className="dark-input w-full px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={loading}
                  className="dark-input w-full px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {(selectedProperty !== 'all' || selectedStatus !== 'all' || dateRange !== 'last_month' || granularity !== 'weekly') && (
            <div className="mt-3 pt-3 border-t border-[var(--glass-border)]">
              <button
                onClick={() => {
                  setSelectedProperty('all');
                  setSelectedStatus('all');
                  setDateRange('last_month');
                  setGranularity('weekly');
                  setSelectedStages([]);
                  setStageStats(null);
                }}
                disabled={loading}
                className="text-xs text-slate-500 hover:text-accent transition"
              >
                Reset all filters
              </button>
            </div>
          )}
        </div>
        
        {/* Leasing Lifecycle Funnel */}
        {funnelData && funnelData.stages && (
          <div className="glass-card p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-100 mb-2 pb-2 border-b border-[var(--glass-border)]">
              Leasing Lifecycle Funnel
            </h2>
            <p className="text-slate-400 text-sm mb-4">
              Click on any stage to view detailed analytics for that stage
            </p>
            {selectedStages.length > 0 && (
              <div className="mb-4 flex items-center gap-2 flex-wrap">
                <span className="text-sm text-slate-400">Viewing:</span>
                {selectedStages.map(stageKey => {
                  const stageColor = STAGE_COLORS[stageKey];
                  return (
                    <span key={stageKey} className="px-3 py-1 rounded-full text-sm font-medium border" style={{
                      backgroundColor: `${stageColor}20`,
                      borderColor: `${stageColor}40`,
                      color: stageColor
                    }}>
                      {{
                        'inquiries': 'Inquiries',
                        'showings_scheduled': 'Showings Scheduled',
                        'showings_completed': 'Showings Completed',
                        'applications': 'Applications',
                        'leases': 'Leases'
                      }[stageKey]}
                    </span>
                  );
                })}
                <button
                  onClick={() => setSelectedStages([])}
                  className="text-xs text-slate-500 hover:text-slate-300 underline"
                >
                  Clear all
                </button>
              </div>
            )}
            
            {/* Funnel Visualization with Fallout */}
            <div className="mb-8">
              {funnelData.stages.map((stage, idx) => {
                const widthPercent = Math.max(35, 100 - (idx * 14));
                const showFallout = stage.fallout && stage.fallout.count > 0;
                const stageKey = {
                  'Inquiries': 'inquiries',
                  'Showings Scheduled': 'showings_scheduled',
                  'Showings Completed': 'showings_completed',
                  'Applications': 'applications',
                  'Leases': 'leases'
                }[stage.name];
                const isSelected = selectedStages.includes(stageKey);
                // On-brand stage colors from shared palette
                const stageKey2 = {
                  'Inquiries': 'inquiries',
                  'Showings Scheduled': 'showings_scheduled',
                  'Showings Completed': 'showings_completed',
                  'Applications': 'applications',
                  'Leases': 'leases'
                }[stage.name];
                const brandColor = STAGE_COLORS[stageKey2] || stage.color;
                
                return (
                  <div key={stage.name}>
                    {/* Fallout Section - BEFORE the stage (shows loss from previous stage to this one) */}
                    {showFallout && idx > 0 && (
                      <div className="flex items-stretch my-1">
                        {/* Connector Line */}
                        <div className="w-16 md:w-24 flex justify-center">
                          <div className="w-0.5 bg-slate-600 h-full min-h-[60px]"></div>
                        </div>
                        
                        {/* Arrow pointing to fallout */}
                        <div className="flex items-center">
                          <div className="text-slate-500 text-lg mr-2">→</div>
                          
                          {/* Fallout Box */}
                          <div className="bg-rose-500/8 backdrop-blur border border-rose-500/20 rounded-lg p-3 max-w-xs">
                            <div className="text-xs font-semibold text-rose-300 mb-2 flex items-center gap-1">
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                              </svg>
                              Lost: {stage.fallout.count} ({stage.fallout.percentage}%)
                            </div>
                            <div className="space-y-1">
                              {stage.fallout.reasons.filter(r => r.count > 0).map((reason, rIdx) => (
                                <div key={rIdx} className="flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-1.5">
                                    <div 
                                      className="w-2.5 h-2.5 rounded-full" 
                                      style={{ backgroundColor: reason.color }}
                                    />
                                    <span className="text-slate-300">{reason.label}</span>
                                  </div>
                                  <span className="font-bold ml-3" style={{ color: reason.color }}>
                                    {reason.count}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Simple connector for stages without fallout (except first stage) */}
                    {(!showFallout && idx > 0) && (
                      <div className="flex my-2">
                        <div className="w-16 md:w-24 flex justify-center">
                          <div className="text-slate-500 text-2xl">↓</div>
                        </div>
                      </div>
                    )}
                    
                    {/* Main Stage Row */}
                    <div className="flex items-center">
                      {/* Funnel Bar - Left Side */}
                      <div className="flex-1 flex justify-start pl-4 md:pl-8">
                        <div
                          onClick={() => handleStageClick(stage.name)}
                          className={`py-4 px-5 text-white font-semibold rounded-xl transition-all cursor-pointer border ${
                            isSelected
                              ? 'ring-2 ring-offset-2 ring-offset-surface-base scale-[1.02]'
                              : 'hover:scale-[1.02] hover:brightness-110'
                          }`}
                          style={{
                            width: `${widthPercent}%`,
                            background: `linear-gradient(135deg, ${brandColor}cc, ${brandColor}88)`,
                            borderColor: `${brandColor}60`,
                            boxShadow: isSelected ? `0 0 20px ${brandColor}40` : `0 4px 12px ${brandColor}20`,
                            ringColor: brandColor,
                            '--tw-ring-color': brandColor,
                            minWidth: '200px'
                          }}
                        >
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <span className="text-sm md:text-base font-medium">{stage.name}</span>
                              {isSelected && (
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                            <div className="text-right">
                              <span className="text-2xl md:text-3xl font-bold">{stage.count.toLocaleString()}</span>
                              {stage.conversionFromPrevious !== null && (
                                <span className="text-xs ml-2 opacity-75 bg-white/20 px-2 py-0.5 rounded">
                                  {stage.conversionFromPrevious}%
                                </span>
                              )}
                              {stage.subtitle && (
                                <div className="text-xs opacity-75 mt-0.5">{stage.subtitle}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Final stage fallout (Denied) - shown AFTER the Leases stage */}
                    {showFallout && idx === funnelData.stages.length - 1 && (
                      <div className="flex items-center mt-2 ml-16 md:ml-24">
                        <div className="text-slate-500 text-lg mr-2">↳</div>
                        <div className="bg-rose-500/8 backdrop-blur border border-rose-500/20 rounded-lg p-3">
                          <div className="text-xs font-semibold text-rose-300 mb-2 flex items-center gap-1">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                            Rejected: {stage.fallout.count} ({stage.fallout.percentage}%)
                          </div>
                          <div className="space-y-1">
                            {stage.fallout.reasons.filter(r => r.count > 0).map((reason, rIdx) => (
                              <div key={rIdx} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-1.5">
                                  <div 
                                    className="w-2.5 h-2.5 rounded-full" 
                                    style={{ backgroundColor: reason.color }}
                                  />
                                  <span className="text-slate-300">{reason.label}</span>
                                </div>
                                <span className="font-bold ml-3" style={{ color: reason.color }}>
                                  {reason.count}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            {/* Funnel Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-4 border-t">
              <div className="text-center p-4 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                <p className="text-2xl md:text-3xl font-bold text-indigo-400">{funnelData.summary.overallConversion}%</p>
                <p className="text-xs md:text-sm text-slate-300 mt-1">Overall Conversion</p>
                <p className="text-xs text-slate-500">Inquiry → Lease</p>
              </div>
              <div className="text-center p-4 bg-violet-500/10 rounded-xl border border-violet-500/20">
                <p className="text-2xl md:text-3xl font-bold text-violet-400">
                  {funnelData.stages[1]?.conversionFromPrevious || 0}%
                </p>
                <p className="text-xs md:text-sm text-slate-300 mt-1">Scheduling Rate</p>
                <p className="text-xs text-slate-500">Inquiry → Scheduled</p>
              </div>
              <div className="text-center p-4 bg-purple-500/10 rounded-xl border border-purple-500/20">
                <p className="text-2xl md:text-3xl font-bold text-purple-400">
                  {funnelData.summary.showingCompletionRate || 0}%
                </p>
                <p className="text-xs md:text-sm text-slate-300 mt-1">Completion Rate</p>
                <p className="text-xs text-slate-500">Scheduled → Completed</p>
              </div>
              <div className="text-center p-4 bg-pink-500/10 rounded-xl border border-pink-500/20">
                <p className="text-2xl md:text-3xl font-bold text-pink-400">
                  {funnelData.stages[3]?.conversionFromPrevious || 0}%
                </p>
                <p className="text-xs md:text-sm text-slate-300 mt-1">Application Rate</p>
                <p className="text-xs text-slate-500">Completed → Applied</p>
              </div>
              <div className="text-center p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                <p className="text-2xl md:text-3xl font-bold text-emerald-400">
                  {funnelData.summary.applicationApprovalRate || 0}%
                </p>
                <p className="text-xs md:text-sm text-slate-300 mt-1">Approval Rate</p>
                <p className="text-xs text-slate-500">Applied → Approved</p>
              </div>
            </div>
          </div>
        )}
        
        {/* Charts Section - Only visible when stages are selected */}
        {selectedStages.length > 0 && stageStats && (
          <>
            {/* Time Series Chart - Full Width */}
            <div className="glass-card p-6 mb-6">
              <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">{getStageDisplayNames()} Over Time</h2>
              <canvas ref={timeSeriesChartRef}></canvas>
            </div>

            {/* Conversion Rate Chart - Full Width */}
            {selectedStages.some(s => s !== 'inquiries') && (
              <div className="glass-card p-6 mb-6">
                <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">Conversion Rate (% of Previous Stage)</h2>
                <p className="text-sm text-slate-400 mb-4">Shows what percentage converted from the previous funnel stage each period</p>
                <canvas ref={conversionChartRef}></canvas>
              </div>
            )}
            
            {/* Sources Line Chart - Full Width */}
            <SourcesChart stageStats={stageStats} />

            {/* Leads per Completed Rehab Unit Chart */}
            <LeadsPerUnitChart
              stageStats={stageStats}
              granularity={granularity}
              startDate={startDate}
              endDate={endDate}
              selectedStages={selectedStages}
            />

            {/* Top Properties */}
            {stageStats?.topProperties?.length > 0 && (
              <div className="glass-card p-6 mb-6">
                <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">Top Properties</h2>
                <canvas ref={propertyChartRef}></canvas>
              </div>
            )}
          </>
        )}

        {/* Prompt to select a stage when none selected */}
        {selectedStages.length === 0 && (
          <div className="glass-card p-8 mb-6 text-center">
            <div className="text-slate-500 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-slate-200 mb-2">Select Funnel Stages</h3>
            <p className="text-slate-400">Click on any stage in the funnel above to view detailed analytics. You can select multiple stages to compare data.</p>
          </div>
        )}
      </div>
    </div>
  );
}
