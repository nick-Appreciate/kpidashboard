'use client';

import { useState, useEffect, useRef } from 'react';
import useSWR from 'swr';
import Chart from 'chart.js/auto';
import Link from 'next/link';
import { DARK_CHART_DEFAULTS, CHART_COLORS } from '../lib/chartTheme';
import DarkSelect from './DarkSelect';
import { fetcher } from '../lib/swr';

// Helper: aggregate daily data points into weekly (one per week, using last value in each week)
const aggregateWeekly = (dataPoints, dateKey = 'date', valueKey = 'occupancyRate') => {
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

export default function OccupancyDashboard() {
  const [selectedProperty, setSelectedProperty] = useState('portfolio');
  const [dateRange, setDateRange] = useState('all_time');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [occupiedOverride, setOccupiedOverride] = useState(null); // Temporary override for occupied count
  const [pctEditing, setPctEditing] = useState(null); // Local text while editing percentage input
  const [selectedExpirationRange, setSelectedExpirationRange] = useState(null); // Filter from chart click
  
  // Calculate date range based on preset
  const getDateRangeFromPreset = (preset) => {
    const today = new Date();
    const formatDate = (date) => date.toISOString().split('T')[0];
    
    switch (preset) {
      case 'today':
        return { start: formatDate(today), end: formatDate(today) };
      case 'last_week': {
        const lastWeekStart = new Date(today);
        lastWeekStart.setDate(today.getDate() - 7);
        return { start: formatDate(lastWeekStart), end: formatDate(today) };
      }
      case 'last_month': {
        const lastMonthStart = new Date(today);
        lastMonthStart.setMonth(today.getMonth() - 1);
        return { start: formatDate(lastMonthStart), end: formatDate(today) };
      }
      case 'last_quarter': {
        const lastQuarterStart = new Date(today);
        lastQuarterStart.setMonth(today.getMonth() - 3);
        return { start: formatDate(lastQuarterStart), end: formatDate(today) };
      }
      case 'last_year': {
        const lastYearStart = new Date(today);
        lastYearStart.setFullYear(today.getFullYear() - 1);
        return { start: formatDate(lastYearStart), end: formatDate(today) };
      }
      case 'all_time':
        return { start: '', end: '' };
      case 'custom':
        return null; // Don't change dates for custom
      default:
        return { start: '', end: '' };
    }
  };
  
  const occupancyChartRef = useRef(null);
  const projectionChartRef = useRef(null);
  const leaseChartRef = useRef(null);
  const evictionChartRef = useRef(null);
  const healthyLeaseCanvasRef = useRef(null);
  const healthyLeaseChartRef = useRef(null);
  const healthyLeaseRenderedRef = useRef(null);
  const headerRef = useRef(null);
  
  // Update dates when preset changes
  useEffect(() => {
    const range = getDateRangeFromPreset(dateRange);
    if (range) {
      setStartDate(range.start);
      setEndDate(range.end);
    }
  }, [dateRange]);

  // Build SWR cache keys from current filters
  const buildStatsKey = () => {
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
    return `/api/rent-roll/stats?${params}`;
  };

  const buildProjectionsKey = () => {
    const params = new URLSearchParams();
    if (selectedProperty !== 'portfolio' && selectedProperty !== 'all') {
      if (selectedProperty.startsWith('region_')) {
        params.append('region', selectedProperty);
      } else {
        params.append('property', selectedProperty);
      }
    }
    return `/api/rent-roll/projections?${params}`;
  };

  // SWR data fetching — cached across navigations, deduped, background revalidation
  const { data: stats, error, isLoading: loading, isValidating } = useSWR(buildStatsKey(), fetcher, {
    revalidateOnMount: true,
  });
  const { data: projections } = useSWR(buildProjectionsKey(), fetcher, {
    revalidateOnMount: true,
  });

  useEffect(() => {
    if (stats) {
      updateCharts();
    }
  }, [stats, selectedProperty, occupiedOverride]);

  useEffect(() => {
    if (projections && stats && !loading) {
      const timer = setTimeout(() => {
        updateProjectionCharts();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [projections, stats, loading, occupiedOverride, selectedProperty]);


  // Define region mappings - KC properties, Columbia is everything else
  const KC_PROPERTIES = ['hilltop', 'oakwood', 'glen oaks', 'normandy', 'maple manor'];

  const getPropertiesForSelection = (selection) => {
    if (selection === 'region_kansas_city') {
      return stats?.properties?.filter(prop =>
        KC_PROPERTIES.some(kc => prop.toLowerCase().includes(kc))
      ) || [];
    } else if (selection === 'region_columbia') {
      return stats?.properties?.filter(prop =>
        !KC_PROPERTIES.some(kc => prop.toLowerCase().includes(kc))
      ) || [];
    }
    return selection;
  };
  
  const updateProjectionCharts = () => {
    // Unified Occupancy Projections Chart (mixed line + bar)
    const projectionCanvas = document.getElementById('projectionChart');
    if (!projectionCanvas || !projections?.projections?.length || !projections?.netChangeByWeek?.length) return;

    const ctx = projectionCanvas.getContext('2d');
    if (projectionCanvas.chart) projectionCanvas.chart.destroy();

    // If user has overridden occupied count, adjust projections starting from that value
    let adjustedProjections = projections.projections;
    if (occupiedOverride !== null && stats?.summary?.totalUnits > 0) {
      const totalUnits = stats.summary.totalUnits;
      const originalOccupied = stats.summary.occupiedUnits;
      const occupiedDiff = occupiedOverride - originalOccupied;
      adjustedProjections = projections.projections.map(d => {
        const originalRate = parseFloat(d.occupancyRate);
        const adjustedOccupied = Math.round((originalRate / 100) * totalUnits) + occupiedDiff;
        const adjustedRate = Math.max(0, Math.min(100, (adjustedOccupied / totalUnits) * 100));
        return { ...d, occupancyRate: adjustedRate.toFixed(1) };
      });
    }

    // Combine trailing + "today" + forward weekly data
    const trailingWeeks = projections.trailingNetChangeByWeek || [];
    const forwardWeeks = projections.netChangeByWeek;
    // Insert a "Today" marker between trailing and forward
    const todayMarker = { weekLabel: 'Today', moveIns: 0, moveOuts: 0, netChange: 0, isToday: true };
    const weeklyData = [...trailingWeeks, todayMarker, ...forwardWeeks];

    // Labels
    const labels = weeklyData.map(d => d.weekLabel);

    // Build occupancy line data: trailing projections + today's actual + forward projections
    const trailingProjs = projections.trailingProjections || [];
    const currentRate = parseFloat(projections.currentOccupancy?.occupancyRate || 0);
    const todayIndex = trailingWeeks.length; // index of the "Today" point
    const occupancyByWeek = weeklyData.map((week, i) => {
      if (i < trailingWeeks.length) {
        // Trailing week — use trailing projection data
        if (trailingProjs[i]) return parseFloat(trailingProjs[i].occupancyRate);
        return null;
      }
      if (i === todayIndex) {
        // Today — use actual current occupancy
        return currentRate;
      }
      // Forward week — use forward projection data
      const forwardIdx = i - todayIndex - 1;
      if (adjustedProjections[forwardIdx]) return parseFloat(adjustedProjections[forwardIdx].occupancyRate);
      return null;
    });

    // Find the max absolute value for move events to set bar y-axis range
    const maxMoveValue = Math.max(
      ...weeklyData.map(d => Math.max(d.moveIns, d.moveOuts)),
      1
    );

    // Index of "today" point (for styling: solid trailing, dashed forward)

    projectionCanvas.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'line',
            label: 'Occupancy %',
            data: occupancyByWeek,
            borderColor: '#8b5cf6',
            backgroundColor: '#8b5cf620',
            fill: true,
            tension: 0.4,
            segment: {
              borderDash: ctx => ctx.p0DataIndex >= todayIndex ? [5, 5] : undefined
            },
            borderWidth: 2,
            pointRadius: occupancyByWeek.map((_, i) => i === todayIndex ? 6 : 4),
            pointBackgroundColor: occupancyByWeek.map((_, i) => i === todayIndex ? '#f1f5f9' : '#8b5cf6'),
            pointBorderColor: '#1e293b',
            pointBorderWidth: 2,
            yAxisID: 'y',
            order: 0
          },
          {
            type: 'bar',
            label: 'Move-ins',
            data: weeklyData.map(d => d.moveIns),
            backgroundColor: weeklyData.map(d => d.isTrailing ? '#10b98140' : '#10b98180'),
            borderColor: weeklyData.map(d => d.isTrailing ? '#10b98180' : '#10b981'),
            borderWidth: 1,
            borderRadius: 3,
            yAxisID: 'y1',
            order: 1
          },
          {
            type: 'bar',
            label: 'Move-outs',
            data: weeklyData.map(d => -d.moveOuts),
            backgroundColor: weeklyData.map(d => d.isTrailing ? '#ef444440' : '#ef444480'),
            borderColor: weeklyData.map(d => d.isTrailing ? '#ef444480' : '#ef4444'),
            borderWidth: 1,
            borderRadius: 3,
            yAxisID: 'y1',
            order: 1
          }
        ]
      },
      options: {
        ...DARK_CHART_DEFAULTS,
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 2.5,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: '#94a3b8',
              font: { size: 11 },
              boxWidth: 12,
              padding: 16,
              usePointStyle: true,
              pointStyleWidth: 12
            }
          },
          tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#f1f5f9',
            bodyColor: '#cbd5e1',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            padding: 12,
            bodyFont: { size: 11 },
            footerFont: { size: 10, weight: 'normal' },
            footerColor: '#94a3b8',
            callbacks: {
              label: (context) => {
                if (context.dataset.label === 'Occupancy %') {
                  return `  Occupancy: ${context.parsed.y?.toFixed(1)}%`;
                }
                const value = Math.abs(context.raw);
                if (value === 0) return null;
                const label = context.dataset.label;
                return `  ${label}: ${value}`;
              },
              footer: function(tooltipItems) {
                const dataIndex = tooltipItems[0]?.dataIndex;
                const week = weeklyData[dataIndex];
                if (!week) return '';

                const lines = [];
                const net = week.moveIns - week.moveOuts;
                if (net !== 0 || week.moveIns > 0 || week.moveOuts > 0) {
                  lines.push(`Net: ${net >= 0 ? '+' : ''}${net}`);
                }

                if (week.moveInDetails?.length > 0) {
                  lines.push('');
                  lines.push('Move-ins:');
                  week.moveInDetails.slice(0, 5).forEach(d => {
                    const dateStr = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    lines.push(`  ${d.unit} ${d.property} - ${d.tenant} (${dateStr})`);
                  });
                  if (week.moveInDetails.length > 5) lines.push(`  +${week.moveInDetails.length - 5} more`);
                }

                if (week.moveOutDetails?.length > 0) {
                  lines.push('');
                  lines.push('Move-outs:');
                  week.moveOutDetails.slice(0, 5).forEach(d => {
                    const dateStr = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    const typeStr = d.type === 'Eviction' ? ' [Evict]' : d.type === 'Notice' ? ' [Notice]' : '';
                    lines.push(`  ${d.unit} ${d.property}${typeStr} - ${d.tenant} (${dateStr})`);
                  });
                  if (week.moveOutDetails.length > 5) lines.push(`  +${week.moveOutDetails.length - 5} more`);
                }

                return lines;
              }
            }
          }
        },
        scales: {
          y: {
            type: 'linear',
            position: 'left',
            beginAtZero: false,
            min: 75,
            max: 100,
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#8b5cf6',
              callback: v => v + '%',
              font: { size: 11 }
            },
            title: {
              display: true,
              text: 'Occupancy %',
              color: '#8b5cf6',
              font: { size: 11 }
            }
          },
          y1: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            min: -(maxMoveValue + 1),
            max: maxMoveValue + 1,
            ticks: {
              color: '#64748b',
              stepSize: 1,
              callback: v => {
                const abs = Math.abs(v);
                if (abs !== Math.floor(abs)) return '';
                return v >= 0 ? `+${abs}` : `-${abs}`;
              },
              font: { size: 11 }
            },
            title: {
              display: true,
              text: 'Move-ins / Move-outs',
              color: '#64748b',
              font: { size: 11 }
            }
          },
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#64748b',
              font: { size: 11 },
              maxRotation: 45,
              minRotation: 0
            }
          }
        }
      }
    });
  };
  
  // Color palette for multi-property charts
  const propertyColors = [
    '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
    '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
    '#14b8a6', '#a855f7', '#eab308', '#22c55e', '#0ea5e9'
  ];

  const updateCharts = () => {
    // Occupancy Trend Chart
    if (occupancyChartRef.current && stats.occupancyTrend?.length > 0) {
      const ctx = occupancyChartRef.current.getContext('2d');
      if (occupancyChartRef.current.chart) occupancyChartRef.current.chart.destroy();
      
      // Check if we should show multi-property view
      const showMultiProperty = selectedProperty === 'all' && stats.propertyTrends;
      
      let chartData;
      if (showMultiProperty) {
        // Aggregate each property's daily data into weekly
        const weeklyPropertyTrends = {};
        Object.entries(stats.propertyTrends).forEach(([property, data]) => {
          weeklyPropertyTrends[property] = aggregateWeekly(data);
        });

        // Get all unique week dates across all properties
        const allWeekDates = [...new Set(
          Object.values(weeklyPropertyTrends).flatMap(arr => arr.map(d => d._weekKey))
        )].sort();

        // Create a dataset for each property
        const datasets = Object.entries(weeklyPropertyTrends).map(([property, data], idx) => {
          const color = propertyColors[idx % propertyColors.length];
          const dataMap = Object.fromEntries(data.map(d => [d._weekKey, parseFloat(d.occupancyRate)]));
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

        chartData = {
          labels: allWeekDates.map(d => formatWeekLabel(d)),
          datasets
        };
      } else {
        // Single line (portfolio or single property)
        // Aggregate daily data into weekly data points
        const weeklyTrend = aggregateWeekly(stats.occupancyTrend);

        // Adjust the latest data point if user has overridden occupied count
        let trendData = weeklyTrend.map(d => parseFloat(d.occupancyRate));
        if (occupiedOverride !== null && stats?.summary?.totalUnits > 0 && trendData.length > 0) {
          const adjustedRate = (occupiedOverride / stats.summary.totalUnits) * 100;
          trendData[trendData.length - 1] = parseFloat(adjustedRate.toFixed(1));
        }

        chartData = {
          labels: weeklyTrend.map(d => formatWeekLabel(d.date)),
          datasets: [{
            label: 'Occupancy Rate (%)',
            data: trendData,
            borderColor: '#10b981',
            backgroundColor: '#10b98120',
            fill: true,
            tension: 0.4
          }]
        };
      }
      
      occupancyChartRef.current.chart = new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: {
          ...DARK_CHART_DEFAULTS,
          responsive: true,
          maintainAspectRatio: true,
          aspectRatio: 3.5,
          interaction: {
            mode: 'nearest',
            intersect: true
          },
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
              beginAtZero: false,
              min: 50,
              max: 100,
              ticks: { callback: v => v + '%' }
            },
            x: {
              ticks: {
                autoSkip: false,
                maxRotation: 45,
                minRotation: 45
              }
            }
          }
        }
      });
    }
    
    // Lease Expiration Chart
    if (leaseChartRef.current && stats.leaseExpirations) {
      const ctx = leaseChartRef.current.getContext('2d');
      if (leaseChartRef.current.chart) leaseChartRef.current.chart.destroy();

      const le = stats.leaseExpirations;
      leaseChartRef.current.chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Expired', '0-30 Days', '31-60 Days', '61-90 Days', '90+ Days', 'No End Date'],
          datasets: [{
            label: 'Units',
            data: [le.expired, le.within30Days, le.within60Days, le.within90Days, le.beyond90Days, le.noLeaseEnd],
            backgroundColor: ['#dc2626', '#ef4444', '#f97316', '#f59e0b', '#10b981', '#6b7280']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { color: '#64748b' } }, x: { ticks: { color: '#64748b' } } },
          onClick: (event, elements) => {
            if (elements.length > 0) {
              const rangeKeys = ['expired', '0-30', '31-60', '61-90', '90+', 'noEnd'];
              const idx = elements[0].index;
              const key = rangeKeys[idx];
              setSelectedExpirationRange(prev => prev === key ? null : key);
            } else {
              setSelectedExpirationRange(null);
            }
          }
        }
      });
    }

    // Evictions by Property Chart
    if (evictionChartRef.current && stats.units?.length > 0) {
      const ctx = evictionChartRef.current.getContext('2d');
      if (evictionChartRef.current.chart) evictionChartRef.current.chart.destroy();

      const evictionUnits = stats.units.filter(u => u.status === 'Evict');
      const evictionsByProp = {};
      const evictionDetailsByProp = {};
      evictionUnits.forEach(u => {
        const prop = u.property || 'Unknown';
        evictionsByProp[prop] = (evictionsByProp[prop] || 0) + 1;
        if (!evictionDetailsByProp[prop]) evictionDetailsByProp[prop] = [];
        evictionDetailsByProp[prop].push({ unit: u.unit, tenant: u.tenant_name || 'Unknown' });
      });

      const evictionEntries = Object.entries(evictionsByProp).sort((a, b) => b[1] - a[1]);
      const evictionDetails = evictionEntries.map(([prop]) => evictionDetailsByProp[prop]);

      if (evictionEntries.length > 0) {
        evictionChartRef.current.chart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: evictionEntries.map(([prop]) => prop.length > 25 ? prop.substring(0, 25) + '...' : prop),
            datasets: [{
              label: 'Evictions',
              data: evictionEntries.map(([, count]) => count),
              backgroundColor: '#ef4444',
              borderColor: '#dc2626',
              borderWidth: 1,
              borderRadius: 3
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
                  title: (items) => items[0]?.label || '',
                  label: () => '',
                  afterBody: (items) => {
                    const idx = items[0]?.dataIndex;
                    if (idx == null || !evictionDetails[idx]) return [];
                    return evictionDetails[idx].map(d => `  ${d.unit} - ${d.tenant}`);
                  }
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: { stepSize: 1, color: '#64748b' },
                grid: { color: 'rgba(255, 255, 255, 0.05)' }
              },
              x: {
                ticks: { color: '#64748b', font: { size: 10 }, maxRotation: 45, minRotation: 0 },
                grid: { display: false }
              }
            }
          }
        });
      }
    }

  };

  // --- Healthy Lease Rate Trend Chart ---
  useEffect(() => {
    if (healthyLeaseChartRef.current) {
      healthyLeaseChartRef.current.destroy();
      healthyLeaseChartRef.current = null;
    }
    if (!healthyLeaseCanvasRef.current || !stats) return;

    const weeklyHealthy = aggregateWeekly(stats.healthyLeaseTrend || [], 'date', 'healthyLeaseRate');
    if (weeklyHealthy.length === 0) return;

    const healthyChartData = {
      labels: weeklyHealthy.map(d => formatWeekLabel(d.date)),
      datasets: [{
        label: 'Healthy Lease Rate (%)',
        data: weeklyHealthy.map(d => parseFloat(d.healthyLeaseRate)),
        borderColor: '#10b981',
        backgroundColor: '#10b98120',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2
      }]
    };

    const dataKey = JSON.stringify(healthyChartData.datasets.map(ds => ds.data));
    if (healthyLeaseRenderedRef.current === dataKey) return;
    healthyLeaseRenderedRef.current = dataKey;

    healthyLeaseChartRef.current = new Chart(healthyLeaseCanvasRef.current.getContext('2d'), {
      type: 'line',
      data: healthyChartData,
      options: {
        ...DARK_CHART_DEFAULTS,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.parsed.y}%`
            }
          }
        },
        scales: {
          y: {
            min: Math.max(0, Math.floor(Math.min(...weeklyHealthy.map(d => parseFloat(d.healthyLeaseRate))) / 5) * 5 - 5),
            max: 100,
            ticks: { callback: v => v + '%', color: '#64748b', font: { size: 10 } },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          },
          x: {
            ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 8 },
            grid: { display: false }
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
  }, [stats]);

  if (loading && !stats) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Loading occupancy data...</p>
        </div>
      </div>
    );
  }
  
  if (error && !stats) {
    return (
      <div className="min-h-screen p-6 md:p-8 flex items-center justify-center">
        <div className="glass-card p-6 max-w-md">
          <p className="text-rose-400 mb-4">Error: {error.message || String(error)}</p>
          <button
            onClick={() => window.location.reload()}
            className="btn-accent w-full"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  
  const summary = stats?.summary || {};
  
  // Calculate effective values based on override
  const effectiveOccupied = occupiedOverride !== null ? occupiedOverride : summary.occupiedUnits;
  const effectiveVacant = summary.totalUnits - effectiveOccupied;
  const effectiveOccupancyRate = summary.totalUnits > 0 
    ? ((effectiveOccupied / summary.totalUnits) * 100).toFixed(1) 
    : 0;

  return (
    <div className="min-h-screen">
      {/* Fixed header */}
      <div ref={headerRef} className="sticky-header">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-4 h-10 px-6 border-b border-[var(--glass-border)]">
            <h1 className="text-sm font-semibold text-slate-100 whitespace-nowrap">
              Occupancy Dashboard
            </h1>
            {stats?.hasData && (
              <div className="flex items-center gap-2 flex-1 justify-end flex-wrap">
                {/* Occupancy widget — inline editable */}
                {selectedProperty !== 'all' && (
                  <>
                    <div className="flex items-center gap-1 bg-surface-overlay/80 rounded-lg px-2 py-1 border border-[var(--glass-border)]">
                      <input
                        type="number"
                        value={effectiveOccupied}
                        onChange={(e) => {
                          if (e.target.value === '') { setOccupiedOverride(0); return; }
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val) && val >= 0 && val <= summary.totalUnits) {
                            setOccupiedOverride(val);
                          }
                        }}
                        className="w-9 bg-transparent text-xs font-bold text-emerald-400 text-center border-b border-dashed border-emerald-500/30 focus:border-emerald-400 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        min="0"
                        max={summary.totalUnits}
                        title="Occupied units"
                      />
                      <span className="text-slate-500 text-xs">/</span>
                      <input
                        type="number"
                        value={effectiveVacant}
                        onChange={(e) => {
                          if (e.target.value === '') { setOccupiedOverride(summary.totalUnits); return; }
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val) && val >= 0 && val <= summary.totalUnits) {
                            setOccupiedOverride(summary.totalUnits - val);
                          }
                        }}
                        className="w-8 bg-transparent text-xs font-bold text-rose-400 text-center border-b border-dashed border-rose-500/30 focus:border-rose-400 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        min="0"
                        max={summary.totalUnits}
                        title="Vacant units"
                      />
                      <span className="text-slate-500 text-[10px]">(</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={pctEditing !== null ? pctEditing : parseFloat(effectiveOccupancyRate)}
                        onFocus={(e) => setPctEditing(e.target.value)}
                        onChange={(e) => {
                          const text = e.target.value;
                          // Allow only digits and one decimal point
                          if (text !== '' && !/^\d*\.?\d*$/.test(text)) return;
                          setPctEditing(text);
                          if (text === '' || text.endsWith('.')) return;
                          const rate = parseFloat(text);
                          if (!isNaN(rate) && rate >= 0 && rate <= 100) {
                            setOccupiedOverride(Math.round((rate / 100) * summary.totalUnits));
                          }
                        }}
                        onBlur={() => setPctEditing(null)}
                        className="w-10 bg-transparent text-xs font-bold text-emerald-400 text-center border-b border-dashed border-emerald-500/30 focus:border-emerald-400 focus:outline-none"
                        title="Occupancy rate %"
                      />
                      <span className="text-slate-500 text-[10px]">%)</span>
                      {occupiedOverride !== null && (
                        <button
                          onClick={() => setOccupiedOverride(null)}
                          className="text-slate-500 hover:text-accent text-[10px] ml-0.5"
                          title="Reset to actual"
                        >
                          ↺
                        </button>
                      )}
                    </div>
                    {/* Notice & Eviction */}
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-accent font-semibold" title="On Notice">{summary.noticeUnits}</span>
                      <span className="text-slate-500">notice</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-white font-semibold" title="Eviction">{summary.evictUnits}</span>
                      <span className="text-slate-500">eviction</span>
                    </div>
                  </>
                )}
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
                    { group: 'Properties', options: (stats.properties || []).map(prop => ({
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
          {dateRange === 'custom' && stats?.hasData && (
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

      {/* Content with spacer for fixed header */}
      <div className="px-6 md:px-8 pb-6 md:pb-8">
        <div className="max-w-7xl mx-auto">

        {!stats?.hasData ? (
          <div className="glass-card p-12 text-center">
            <div className="text-6xl mb-4">📊</div>
            <h2 className="text-2xl font-bold text-slate-100 mb-2">No Data Available</h2>
            <p className="text-slate-400">Rent roll data will be automatically synced from AppFolio.</p>
          </div>
        ) : (
          <>
            {/* Occupancy Trend - Full Width */}
            <div className="glass-card p-6 mb-6">
              <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">Occupancy Trend (Historical)</h2>
              <canvas ref={occupancyChartRef}></canvas>
            </div>
            
            {/* Occupancy Projections — Unified Chart */}
            {projections && (
              <div className="glass-card p-6 mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 pb-2 border-b border-[var(--glass-border)]">
                  <h2 className="text-lg font-semibold text-slate-100">Occupancy Projections</h2>
                  <div className="flex items-center gap-4 text-xs flex-wrap">
                    {[
                      { label: 'Past 30d', data: projections.trailingSummary },
                      { label: '0-30d', data: projections.summary?.days0_30 },
                      { label: '30-60d', data: projections.summary?.days30_60 },
                      { label: '60-90d', data: projections.summary?.days60_90 },
                    ].map(({ label, data }) => {
                      const net = data?.netChange || 0;
                      return (
                        <div key={label} className="flex items-center gap-1.5 bg-surface-overlay/60 rounded-lg px-2.5 py-1 border border-[var(--glass-border)]">
                          <span className="text-slate-500 font-medium">{label}</span>
                          <span className="text-emerald-400 font-semibold">+{data?.moveIns || 0}</span>
                          <span className="text-slate-600">/</span>
                          <span className="text-rose-400 font-semibold">-{data?.moveOuts || 0}</span>
                          <span className={`font-bold ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            ({net >= 0 ? '+' : ''}{net})
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <canvas id="projectionChart"></canvas>
              </div>
            )}
            
            {/* Lease Expirations + Healthy Rate */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="glass-card p-6">
                <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">Lease Expirations</h2>
                <div className="h-64">
                  <canvas ref={leaseChartRef}></canvas>
                </div>
              </div>
              <div className="glass-card p-6 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold text-slate-100">Healthy Lease Rate</h2>
                  <span className="text-2xl font-bold text-emerald-400">{summary.healthyLeaseRate || 0}%</span>
                </div>
                <div className="flex-1">
                  <canvas ref={healthyLeaseCanvasRef}></canvas>
                </div>
              </div>
            </div>
            
            {/* Evictions by Property + Move Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Evictions by Property */}
              <div className="glass-card p-6">
                <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">Evictions by Property</h2>
                {stats.units?.filter(u => u.status === 'Evict').length > 0 ? (
                  <canvas ref={evictionChartRef}></canvas>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <p>No active evictions</p>
                  </div>
                )}
              </div>

              {/* Move-In / Move-Out Activity */}
              <div className="glass-card p-6">
                <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">Move-In / Move-Out Activity</h2>
                <div className="space-y-4 max-h-[400px] overflow-y-auto">
                  {/* Trailing (Past 30 Days) */}
                  {projections?.trailingSummary && (projections.trailingSummary.moveIns > 0 || projections.trailingSummary.moveOuts > 0) && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-slate-300">Past 30 Days</span>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-emerald-400 font-semibold">+{projections.trailingSummary.moveIns} in</span>
                          <span className="text-slate-600">/</span>
                          <span className="text-rose-400 font-semibold">-{projections.trailingSummary.moveOuts} out</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {projections.trailingSummary.moveInDetails?.map((d, i) => (
                          <div key={`ti-${i}`} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-emerald-500/10">
                            <span className="text-emerald-400 font-medium w-4 text-center">+</span>
                            <span className="text-slate-300 font-medium">{d.unit}</span>
                            <span className="text-slate-500 truncate flex-1">{d.property}</span>
                            <span className="text-slate-500">{new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          </div>
                        ))}
                        {projections.trailingSummary.moveOutDetails?.map((d, i) => (
                          <div key={`to-${i}`} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-rose-500/10">
                            <span className="text-rose-400 font-medium w-4 text-center">-</span>
                            <span className="text-slate-300 font-medium">{d.unit}</span>
                            <span className="text-slate-500 truncate flex-1">{d.property}{d.type === 'Eviction' ? ' [Evict]' : d.type === 'Notice' ? ' [Notice]' : ''}</span>
                            <span className="text-slate-500">{new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Next 30 Days */}
                  {projections?.summary?.days0_30 && (projections.summary.days0_30.moveIns > 0 || projections.summary.days0_30.moveOuts > 0) && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-slate-300">Next 30 Days</span>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-emerald-400 font-semibold">+{projections.summary.days0_30.moveIns} in</span>
                          <span className="text-slate-600">/</span>
                          <span className="text-rose-400 font-semibold">-{projections.summary.days0_30.moveOuts} out</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {projections.upcomingMoveIns?.filter(e => {
                          const d = new Date(e.event_date);
                          return d <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                        }).map((d, i) => (
                          <div key={`fi-${i}`} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-emerald-500/10">
                            <span className="text-emerald-400 font-medium w-4 text-center">+</span>
                            <span className="text-slate-300 font-medium">{d.unit}</span>
                            <span className="text-slate-500 truncate flex-1">{d.property}</span>
                            <span className="text-slate-500">{new Date(d.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          </div>
                        ))}
                        {projections.upcomingMoveOuts?.filter(e => {
                          const d = new Date(e.event_date);
                          return d <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                        }).map((d, i) => (
                          <div key={`fo-${i}`} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-rose-500/10">
                            <span className="text-rose-400 font-medium w-4 text-center">-</span>
                            <span className="text-slate-300 font-medium">{d.unit}</span>
                            <span className="text-slate-500 truncate flex-1">{d.property}{d.event_type === 'Eviction' ? ' [Evict]' : d.event_type === 'Notice' ? ' [Notice]' : ''}</span>
                            <span className="text-slate-500">{new Date(d.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 30-60 Days */}
                  {projections?.summary?.days30_60 && (projections.summary.days30_60.moveIns > 0 || projections.summary.days30_60.moveOuts > 0) && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-slate-300">30-60 Days</span>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-emerald-400 font-semibold">+{projections.summary.days30_60.moveIns} in</span>
                          <span className="text-slate-600">/</span>
                          <span className="text-rose-400 font-semibold">-{projections.summary.days30_60.moveOuts} out</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {projections.upcomingMoveIns?.filter(e => {
                          const d = new Date(e.event_date);
                          return d > new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) && d <= new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
                        }).map((d, i) => (
                          <div key={`mi30-${i}`} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-emerald-500/10">
                            <span className="text-emerald-400 font-medium w-4 text-center">+</span>
                            <span className="text-slate-300 font-medium">{d.unit}</span>
                            <span className="text-slate-500 truncate flex-1">{d.property}</span>
                            <span className="text-slate-500">{new Date(d.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          </div>
                        ))}
                        {projections.upcomingMoveOuts?.filter(e => {
                          const d = new Date(e.event_date);
                          return d > new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) && d <= new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
                        }).map((d, i) => (
                          <div key={`mo30-${i}`} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-rose-500/10">
                            <span className="text-rose-400 font-medium w-4 text-center">-</span>
                            <span className="text-slate-300 font-medium">{d.unit}</span>
                            <span className="text-slate-500 truncate flex-1">{d.property}{d.event_type === 'Eviction' ? ' [Evict]' : d.event_type === 'Notice' ? ' [Notice]' : ''}</span>
                            <span className="text-slate-500">{new Date(d.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 60-90 Days */}
                  {projections?.summary?.days60_90 && (projections.summary.days60_90.moveIns > 0 || projections.summary.days60_90.moveOuts > 0) && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-slate-300">60-90 Days</span>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-emerald-400 font-semibold">+{projections.summary.days60_90.moveIns} in</span>
                          <span className="text-slate-600">/</span>
                          <span className="text-rose-400 font-semibold">-{projections.summary.days60_90.moveOuts} out</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {projections.upcomingMoveIns?.filter(e => {
                          const d = new Date(e.event_date);
                          return d > new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) && d <= new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
                        }).map((d, i) => (
                          <div key={`mi60-${i}`} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-emerald-500/10">
                            <span className="text-emerald-400 font-medium w-4 text-center">+</span>
                            <span className="text-slate-300 font-medium">{d.unit}</span>
                            <span className="text-slate-500 truncate flex-1">{d.property}</span>
                            <span className="text-slate-500">{new Date(d.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          </div>
                        ))}
                        {projections.upcomingMoveOuts?.filter(e => {
                          const d = new Date(e.event_date);
                          return d > new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) && d <= new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
                        }).map((d, i) => (
                          <div key={`mo60-${i}`} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-rose-500/10">
                            <span className="text-rose-400 font-medium w-4 text-center">-</span>
                            <span className="text-slate-300 font-medium">{d.unit}</span>
                            <span className="text-slate-500 truncate flex-1">{d.property}{d.event_type === 'Eviction' ? ' [Evict]' : d.event_type === 'Notice' ? ' [Notice]' : ''}</span>
                            <span className="text-slate-500">{new Date(d.event_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!projections && (
                    <div className="text-center py-8 text-slate-500">
                      <p>Loading activity data...</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            
            {/* Property Stats Table */}
            <div className="glass-card p-6 mb-6">
              <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">Property Breakdown</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-surface-raised text-xs uppercase tracking-wider text-slate-400">
                    <tr className="border-b border-white/5">
                      <th className="text-left py-3 px-2 font-medium">Property</th>
                      <th className="text-right py-3 px-2 font-medium">Total Units</th>
                      <th className="text-right py-3 px-2 font-medium">Occupied</th>
                      <th className="text-right py-3 px-2 font-medium">Occupancy %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.propertyStats?.map((prop, idx) => (
                      <tr key={idx} className="border-b hover:bg-surface-raised/80">
                        <td className="py-3 px-2 font-medium">{prop.property}</td>
                        <td className="text-right py-3 px-2">{prop.totalUnits}</td>
                        <td className="text-right py-3 px-2">{prop.occupiedUnits}</td>
                        <td className="text-right py-3 px-2">
                          <span className={`px-2 py-1 rounded font-medium ${parseFloat(prop.occupancyRate) >= 95 ? 'bg-emerald-500/20 text-emerald-400' : parseFloat(prop.occupancyRate) >= 90 ? 'bg-emerald-500/15 text-emerald-300' : parseFloat(prop.occupancyRate) >= 80 ? 'bg-amber-500/20 text-amber-300' : parseFloat(prop.occupancyRate) >= 70 ? 'bg-orange-500/20 text-orange-300' : 'bg-rose-500/20 text-rose-400'}`}>
                            {prop.occupancyRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
