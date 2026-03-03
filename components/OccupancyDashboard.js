'use client';

import { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import Link from 'next/link';
import { DARK_CHART_DEFAULTS, DARK_DOUGHNUT_DEFAULTS, CHART_COLORS } from '../lib/chartTheme';
import DarkSelect from './DarkSelect';

export default function OccupancyDashboard() {
  const [stats, setStats] = useState(null);
  const [projections, setProjections] = useState(null);
  const [loading, setLoading] = useState(true);
  const [groupByProperty, setGroupByProperty] = useState(false);
  const [error, setError] = useState(null);
  const [selectedProperty, setSelectedProperty] = useState('portfolio');
  const [dateRange, setDateRange] = useState('all_time');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [occupiedOverride, setOccupiedOverride] = useState(null); // Temporary override for occupied count
  const [pctEditing, setPctEditing] = useState(null); // Local text while editing percentage input
  
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
  const netChangeChartRef = useRef(null);
  const statusChartRef = useRef(null);
  const leaseChartRef = useRef(null);
  const delinquencyChartRef = useRef(null);
  const healthyLeaseChartRef = useRef(null);
  const renewalsChartRef = useRef(null);
  const headerRef = useRef(null);
  
  // Update dates when preset changes
  useEffect(() => {
    const range = getDateRangeFromPreset(dateRange);
    if (range) {
      setStartDate(range.start);
      setEndDate(range.end);
    }
  }, [dateRange]);
  
  useEffect(() => {
    fetchStats();
    fetchProjections();
  }, [selectedProperty, startDate, endDate]);
  
  useEffect(() => {
    if (stats) {
      updateCharts();
    }
  }, [stats, selectedProperty, occupiedOverride]);
  
  useEffect(() => {
    if (projections && stats && !loading) {
      // Small delay to ensure canvas elements are mounted after conditional render
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
      if (startDate) {
        params.append('startDate', startDate);
      }
      if (endDate) {
        params.append('endDate', endDate);
      }
      
      const res = await fetch(`/api/rent-roll/stats?${params}`);
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      setStats(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching stats:', err);
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };
  
  const fetchProjections = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedProperty !== 'portfolio' && selectedProperty !== 'all') {
        if (selectedProperty.startsWith('region_')) {
          params.append('region', selectedProperty);
        } else {
          params.append('property', selectedProperty);
        }
      }
      
      const res = await fetch(`/api/rent-roll/projections?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.error) {
        setProjections(data);
      }
    } catch (err) {
      console.error('Error fetching projections:', err);
    }
  };
  
  const updateProjectionCharts = () => {
    // Projected Occupancy Chart
    const projectionCanvas = document.getElementById('projectionChart');
    if (projectionCanvas && projections?.projections?.length > 0) {
      const ctx = projectionCanvas.getContext('2d');
      if (projectionCanvas.chart) projectionCanvas.chart.destroy();
      
      // If user has overridden occupied count, adjust projections starting from that value
      let adjustedProjections = projections.projections;
      if (occupiedOverride !== null && stats?.summary?.totalUnits > 0) {
        const totalUnits = stats.summary.totalUnits;
        const originalOccupied = stats.summary.occupiedUnits;
        const occupiedDiff = occupiedOverride - originalOccupied;
        
        // Adjust all projection points by the difference
        adjustedProjections = projections.projections.map(d => {
          const originalRate = parseFloat(d.occupancyRate);
          const adjustedOccupied = Math.round((originalRate / 100) * totalUnits) + occupiedDiff;
          const adjustedRate = Math.max(0, Math.min(100, (adjustedOccupied / totalUnits) * 100));
          return { ...d, occupancyRate: adjustedRate.toFixed(1) };
        });
      }
      
      projectionCanvas.chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: adjustedProjections.map(d => {
            const [year, month, day] = d.date.split('-');
            return `${month}/${day}`;
          }),
          datasets: [{
            label: 'Projected Occupancy (%)',
            data: adjustedProjections.map(d => parseFloat(d.occupancyRate)),
            borderColor: '#8b5cf6',
            backgroundColor: '#8b5cf620',
            fill: true,
            tension: 0.4,
            borderDash: [5, 5]
          }]
        },
        options: {
          ...DARK_CHART_DEFAULTS,
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              beginAtZero: false,
              min: 75,
              max: 100,
              ticks: { callback: v => v + '%' }
            }
          }
        }
      });
    }

    // Net Change by Week Chart
    const netChangeCanvas = document.getElementById('netChangeChart');
    if (netChangeCanvas && projections?.netChangeByWeek?.length > 0) {
      const ctx = netChangeCanvas.getContext('2d');
      if (netChangeCanvas.chart) netChangeCanvas.chart.destroy();
      
      // Store reference for tooltip callback
      const weeklyData = projections.netChangeByWeek;
      
      netChangeCanvas.chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: weeklyData.map(d => d.weekLabel),
          datasets: [
            {
              label: 'Move-ins',
              data: weeklyData.map(d => d.moveIns),
              backgroundColor: '#10b981'
            },
            {
              label: 'Move-outs',
              data: weeklyData.map(d => -d.moveOuts),
              backgroundColor: '#ef4444'
            }
          ]
        },
        options: {
          ...DARK_CHART_DEFAULTS,
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: { display: true, position: 'top' },
            tooltip: {
              enabled: true,
              mode: 'index',
              intersect: false,
              bodyFont: { size: 11 },
              footerFont: { size: 10, weight: 'normal' },
              footerColor: '#ccc',
              callbacks: {
                label: (context) => {
                  const value = context.raw;
                  const label = context.dataset.label;
                  return `${label}: ${Math.abs(value)}`;
                },
                footer: function(tooltipItems) {
                  const dataIndex = tooltipItems[0].dataIndex;
                  const weekData = weeklyData[dataIndex];
                  if (!weekData) return '';
                  
                  const lines = [];
                  
                  if (weekData.moveInDetails && weekData.moveInDetails.length > 0) {
                    lines.push('Move-ins:');
                    weekData.moveInDetails.slice(0, 5).forEach(d => {
                      const dateStr = new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      lines.push(`  ${d.unit} - ${d.tenant} (${dateStr})`);
                    });
                  }
                  
                  if (weekData.moveOutDetails && weekData.moveOutDetails.length > 0) {
                    if (lines.length > 0) lines.push('');
                    lines.push('Move-outs:');
                    weekData.moveOutDetails.slice(0, 5).forEach(d => {
                      const dateStr = new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      const typeStr = d.type === 'Eviction' ? ' [Evict]' : d.type === 'Notice' ? ' [Notice]' : '';
                      lines.push(`  ${d.unit} - ${d.tenant}${typeStr} (${dateStr})`);
                    });
                  }
                  
                  return lines.length > 0 ? lines : '';
                }
              }
            }
          },
          scales: {
            x: { stacked: true },
            y: { 
              stacked: true,
              ticks: { 
                callback: v => v >= 0 ? `+${v}` : v
              }
            }
          }
        }
      });
    }
  };
  
  // Color palette for multi-property charts
  const propertyColors = [
    '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', 
    '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
    '#14b8a6', '#a855f7', '#eab308', '#22c55e', '#0ea5e9'
  ];
  
  // Helper: aggregate daily data points into weekly (one per week, using last value in each week)
  const aggregateWeekly = (dataPoints, dateKey = 'date', valueKey = 'occupancyRate') => {
    if (!dataPoints || dataPoints.length === 0) return [];
    const weekMap = {};
    dataPoints.forEach(d => {
      const date = new Date(d[dateKey] + 'T00:00:00');
      // Get the Monday of the week
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(date);
      monday.setDate(diff);
      const weekKey = monday.toISOString().split('T')[0];
      // Keep the last (most recent) entry per week
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
    
    // Status Distribution Chart
    if (statusChartRef.current && stats.statusDistribution?.length > 0) {
      const ctx = statusChartRef.current.getContext('2d');
      if (statusChartRef.current.chart) statusChartRef.current.chart.destroy();
      
      const colors = {
        'Current': '#10b981',
        'Vacant-Unrented': '#ef4444',
        'Vacant-Rented': '#f59e0b',
        'Notice-Unrented': '#f97316',
        'Notice-Rented': '#eab308',
        'Evict': '#dc2626'
      };
      
      statusChartRef.current.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: stats.statusDistribution.map(s => s.status),
          datasets: [{
            data: stats.statusDistribution.map(s => s.count),
            backgroundColor: stats.statusDistribution.map(s => colors[s.status] || '#6b7280')
          }]
        },
        options: {
          ...DARK_DOUGHNUT_DEFAULTS,
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: { position: 'right' }
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
          ...DARK_CHART_DEFAULTS,
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
      });
    }
    
    // Delinquency Chart
    if (delinquencyChartRef.current && stats.delinquencyStats?.length > 0) {
      const ctx = delinquencyChartRef.current.getContext('2d');
      if (delinquencyChartRef.current.chart) delinquencyChartRef.current.chart.destroy();
      
      const topDelinquent = stats.delinquencyStats.slice(0, 10);
      
      delinquencyChartRef.current.chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: topDelinquent.map(d => d.property.length > 20 ? d.property.substring(0, 20) + '...' : d.property),
          datasets: [{
            label: 'Past Due Amount ($)',
            data: topDelinquent.map(d => d.amount),
            backgroundColor: '#ef4444'
          }]
        },
        options: {
          ...DARK_CHART_DEFAULTS,
          responsive: true,
          maintainAspectRatio: true,
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: {
              beginAtZero: true,
              ticks: { callback: v => '$' + v.toLocaleString() }
            }
          }
        }
      });
    }
    
    // Healthy Lease Rate Chart
    if (document.getElementById('healthyLeaseChart')) {
      const ctx = document.getElementById('healthyLeaseChart').getContext('2d');
      if (window.healthyLeaseChart && window.healthyLeaseChart.destroy) {
        window.healthyLeaseChart.destroy();
      }
      
      // Check if we should show multi-property view
      const showMultiPropertyHealthy = selectedProperty === 'all' && stats.healthyLeaseTrendByProperty;
      
      let healthyChartData;
      if (showMultiPropertyHealthy) {
        // Aggregate each property's daily data into weekly
        const weeklyHealthyByProperty = {};
        Object.entries(stats.healthyLeaseTrendByProperty).forEach(([property, data]) => {
          weeklyHealthyByProperty[property] = aggregateWeekly(data, 'date', 'healthyLeaseRate');
        });

        // Get all unique week dates across all properties
        const allWeekDates = [...new Set(
          Object.values(weeklyHealthyByProperty).flatMap(arr => arr.map(d => d._weekKey))
        )].sort();

        // Create a dataset for each property
        const datasets = Object.entries(weeklyHealthyByProperty).map(([property, data], idx) => {
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
        // Single line (portfolio or single property) - aggregate to weekly
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
      
      window.healthyLeaseChart = new Chart(ctx, {
        type: 'line',
        data: healthyChartData,
        options: {
          ...DARK_CHART_DEFAULTS,
          responsive: true,
          maintainAspectRatio: true,
          interaction: {
            mode: 'nearest',
            intersect: true
          },
          plugins: {
            legend: {
              display: showMultiPropertyHealthy,
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
    }
    
    // Renewals by Month Chart
    if (renewalsChartRef.current && stats.leaseHealthDetails?.renewalsByMonth?.length > 0) {
      const ctx = renewalsChartRef.current.getContext('2d');
      if (renewalsChartRef.current.chart) renewalsChartRef.current.chart.destroy();
      
      const renewalData = stats.leaseHealthDetails.renewalsByMonth;
      
      renewalsChartRef.current.chart = new Chart(ctx, {
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
    }
  };
  
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
  
  if (error) {
    return (
      <div className="min-h-screen p-6 md:p-8 flex items-center justify-center">
        <div className="glass-card p-6 max-w-md">
          <p className="text-rose-400 mb-4">Error: {error}</p>
          <button
            onClick={fetchStats}
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
            
            {/* Projections Section */}
            {projections && (
              <>
                {/* Projection Summary Cards */}
                <div className="glass-card p-6 mb-6">
                  <h2 className="text-xl font-semibold text-violet-300 mb-4 pb-2 border-b-2 border-violet-500/20">
                    📊 Occupancy Projections
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4">
                      <div className="text-sm text-violet-400 font-medium mb-2">Next 30 Days</div>
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-emerald-400 font-bold">+{projections.summary?.next30Days?.moveIns || 0}</span>
                          <span className="text-slate-500 text-sm ml-1">in</span>
                        </div>
                        <div>
                          <span className="text-rose-400 font-bold">-{projections.summary?.next30Days?.moveOuts || 0}</span>
                          <span className="text-slate-500 text-sm ml-1">out</span>
                        </div>
                        <div className={`font-bold ${(projections.summary?.next30Days?.netChange || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          Net: {(projections.summary?.next30Days?.netChange || 0) >= 0 ? '+' : ''}{projections.summary?.next30Days?.netChange || 0}
                        </div>
                      </div>
                    </div>
                    <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4">
                      <div className="text-sm text-violet-400 font-medium mb-2">Next 60 Days</div>
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-emerald-400 font-bold">+{projections.summary?.next60Days?.moveIns || 0}</span>
                          <span className="text-slate-500 text-sm ml-1">in</span>
                        </div>
                        <div>
                          <span className="text-rose-400 font-bold">-{projections.summary?.next60Days?.moveOuts || 0}</span>
                          <span className="text-slate-500 text-sm ml-1">out</span>
                        </div>
                        <div className={`font-bold ${(projections.summary?.next60Days?.netChange || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          Net: {(projections.summary?.next60Days?.netChange || 0) >= 0 ? '+' : ''}{projections.summary?.next60Days?.netChange || 0}
                        </div>
                      </div>
                    </div>
                    <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4">
                      <div className="text-sm text-violet-400 font-medium mb-2">Next 90 Days</div>
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-emerald-400 font-bold">+{projections.summary?.next90Days?.moveIns || 0}</span>
                          <span className="text-slate-500 text-sm ml-1">in</span>
                        </div>
                        <div>
                          <span className="text-rose-400 font-bold">-{projections.summary?.next90Days?.moveOuts || 0}</span>
                          <span className="text-slate-500 text-sm ml-1">out</span>
                        </div>
                        <div className={`font-bold ${(projections.summary?.next90Days?.netChange || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          Net: {(projections.summary?.next90Days?.netChange || 0) >= 0 ? '+' : ''}{projections.summary?.next90Days?.netChange || 0}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Projection Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                  <div className="glass-card p-6">
                    <h2 className="text-xl font-semibold text-violet-300 mb-4 pb-2 border-b-2 border-violet-500/20">
                      Projected Occupancy (Next 12 Weeks)
                    </h2>
                    <canvas id="projectionChart"></canvas>
                  </div>
                  
                  <div className="glass-card p-6">
                    <h2 className="text-xl font-semibold text-violet-300 mb-4 pb-2 border-b-2 border-violet-500/20">
                      Net Change by Week
                    </h2>
                    <canvas id="netChangeChart"></canvas>
                  </div>
                </div>
                
                {/* Upcoming Move-ins and Move-outs */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                  <div className="glass-card p-6">
                    <h2 className="text-xl font-semibold text-emerald-300 mb-4 pb-2 border-b-2 border-emerald-500/20">
                      🏠 Upcoming Move-ins ({projections.upcomingMoveIns?.length || 0})
                    </h2>
                    <div className="max-h-64 overflow-y-auto">
                      {projections.upcomingMoveIns?.length > 0 ? (
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 z-10 bg-surface-raised">
                            <tr className="border-b">
                              <th className="text-left py-2 px-2">Date</th>
                              <th className="text-left py-2 px-2">Property</th>
                              <th className="text-left py-2 px-2">Unit</th>
                              <th className="text-right py-2 px-2">Rent</th>
                            </tr>
                          </thead>
                          <tbody>
                            {projections.upcomingMoveIns.map((event, idx) => (
                              <tr key={idx} className="border-b hover:bg-emerald-500/5">
                                <td className="py-2 px-2">{new Date(event.event_date).toLocaleDateString()}</td>
                                <td className="py-2 px-2">{event.property}</td>
                                <td className="py-2 px-2">{event.unit}</td>
                                <td className="py-2 px-2 text-right">${event.rent?.toLocaleString() || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="text-slate-500 text-center py-4">No upcoming move-ins scheduled</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="glass-card p-6">
                    <h2 className="text-xl font-semibold text-rose-400 mb-4 pb-2 border-b-2 border-rose-500/20">
                      📦 Upcoming Move-outs ({projections.upcomingMoveOuts?.length || 0})
                    </h2>
                    <div className="max-h-64 overflow-y-auto">
                      {projections.upcomingMoveOuts?.length > 0 ? (
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 z-10 bg-surface-raised">
                            <tr className="border-b">
                              <th className="text-left py-2 px-2">Date</th>
                              <th className="text-left py-2 px-2">Property</th>
                              <th className="text-left py-2 px-2">Unit</th>
                              <th className="text-left py-2 px-2">Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {projections.upcomingMoveOuts.map((event, idx) => (
                              <tr key={idx} className="border-b hover:bg-rose-500/5">
                                <td className="py-2 px-2">{new Date(event.event_date).toLocaleDateString()}</td>
                                <td className="py-2 px-2">{event.property}</td>
                                <td className="py-2 px-2">{event.unit}</td>
                                <td className="py-2 px-2">
                                  <span className={`px-2 py-1 rounded text-xs ${event.event_type === 'Notice' ? 'bg-orange-500/15 text-orange-800' : 'bg-rose-500/15 text-red-800'}`}>
                                    {event.event_type}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="text-slate-500 text-center py-4">No upcoming move-outs scheduled</p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
            
            {/* Healthy Lease Rate Chart */}
            <div className="glass-card p-6 mb-6">
              <h2 className="text-xl font-semibold text-amber-700 mb-4 pb-2 border-b-2 border-amber-500/20">
                Healthy Lease Rate Trend
              </h2>
              <p className="text-sm text-slate-400 mb-4">
                Percentage of units with healthy leases (not expiring within 60 days, not evicting)
              </p>
              <div className="text-3xl font-bold text-amber-600 mb-4">
                {summary.healthyLeaseRate || 0}%
              </div>
              <canvas id="healthyLeaseChart"></canvas>
            </div>
            
            {/* Bad Leases Tape Feed */}
            <div className="glass-card p-6 mb-6">
              <div className="flex justify-between items-center mb-4 pb-2 border-b-2 border-amber-500/20">
                <h2 className="text-xl font-semibold text-amber-700">
                  Bad Leases Detail
                </h2>
                <button
                  onClick={() => setGroupByProperty(!groupByProperty)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    groupByProperty 
                      ? 'bg-amber-600 text-white hover:bg-amber-700' 
                      : 'bg-surface-overlay text-slate-200 hover:bg-white/10'
                  }`}
                >
                  {groupByProperty ? 'Grouped by Property' : 'Group by Type'}
                </button>
              </div>
              <p className="text-sm text-slate-400 mb-4">
                Units requiring attention (excluding vacant units)
              </p>
              
              <div className="max-h-[600px] overflow-y-auto">
                {(() => {
                  const allBadLeases = [];
                  
                  stats.leaseHealthDetails?.badLeasesByReason?.evictions?.forEach(lease => 
                    allBadLeases.push({ ...lease, type: 'eviction', color: 'red', priority: 1 })
                  );
                  stats.leaseHealthDetails?.badLeasesByReason?.monthToMonth?.forEach(lease => 
                    allBadLeases.push({ ...lease, type: 'monthToMonth', color: 'orange', priority: 2 })
                  );
                  stats.leaseHealthDetails?.badLeasesByReason?.expiringWithin60Days?.forEach(lease => 
                    allBadLeases.push({ ...lease, type: 'expiring', color: 'yellow', priority: 3 })
                  );
                  
                  if (allBadLeases.length === 0) {
                    return (
                      <div className="text-center py-8 text-slate-500">
                        <div className="text-2xl mb-2">🎉</div>
                        <p>No bad leases found!</p>
                      </div>
                    );
                  }
                  
                  if (groupByProperty) {
                    const groupedByProperty = allBadLeases.reduce((acc, lease) => {
                      if (!acc[lease.property]) acc[lease.property] = [];
                      acc[lease.property].push(lease);
                      return acc;
                    }, {});
                    
                    return Object.entries(groupedByProperty).map(([property, leases]) => (
                      <div key={property} className="mb-4">
                        <div className="bg-gray-800 text-white px-3 py-2 rounded-t-lg flex justify-between items-center">
                          <span className="font-semibold">{property}</span>
                          <span className="bg-gray-600 px-2 py-0.5 rounded text-xs">{leases.length} units</span>
                        </div>
                        <div className="border border-[var(--glass-border)] border-t-0 rounded-b-lg overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-surface-raised/80 text-xs text-slate-400">
                              <tr>
                                <th className="px-2 py-2 text-left font-medium">Unit</th>
                                <th className="px-2 py-2 text-left font-medium">Tenant</th>
                                <th className="px-2 py-2 text-left font-medium">Issue</th>
                                <th className="px-2 py-2 text-center font-medium">Days Left</th>
                                <th className="px-2 py-2 text-center font-medium">Renewal</th>
                                <th className="px-2 py-2 text-right font-medium">Rent</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {leases.sort((a, b) => a.priority - b.priority).map((lease, idx) => (
                                <tr key={idx} className={`${
                                  lease.color === 'red' ? 'bg-rose-500/5 hover:bg-rose-500/10' : 
                                  lease.color === 'orange' ? 'bg-orange-500/5 hover:bg-orange-500/50/10' : 
                                  'bg-amber-500/5 hover:bg-amber-500/10'
                                } transition-colors`}>
                                  <td className="px-2 py-2 font-medium">{lease.unit}</td>
                                  <td className="px-2 py-2 text-slate-200 truncate max-w-[120px]" title={lease.tenantName || 'No renewal sent'}>
                                    {lease.tenantName || <span className="text-slate-500 italic text-xs">No renewal</span>}
                                  </td>
                                  <td className="px-2 py-2">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                      lease.color === 'red' ? 'bg-rose-500/20 text-red-800' : 
                                      lease.color === 'orange' ? 'bg-orange-500/20 text-orange-800' : 
                                      'bg-amber-500/20 text-yellow-800'
                                    }`}>
                                      {lease.type === 'eviction' ? '⚠️ Evict' : 
                                       lease.type === 'monthToMonth' ? '📅 MTM' : 
                                       '⏰ Expiring'}
                                    </span>
                                  </td>
                                  <td className="px-2 py-2 text-center text-xs font-medium">
                                    {lease.daysUntilExpiration !== null && lease.daysUntilExpiration !== undefined ? (
                                      <span className={lease.daysUntilExpiration < 0 ? 'text-rose-400' : lease.daysUntilExpiration <= 30 ? 'text-amber-400' : 'text-slate-400'}>
                                        {lease.daysUntilExpiration}
                                      </span>
                                    ) : '-'}
                                  </td>
                                  <td className="px-2 py-2 text-center">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                      lease.renewalStatus === 'Renewed' ? 'bg-emerald-500/15 text-emerald-300' :
                                      lease.renewalStatus === 'Pending' ? 'bg-blue-500/15 text-blue-400' :
                                      lease.renewalStatus === 'Did Not Renew' ? 'bg-rose-500/15 text-rose-400' :
                                      lease.renewalStatus === 'Canceled by User' ? 'bg-slate-500/15 text-slate-200' :
                                      lease.renewalStatus === 'Not sent' ? 'bg-violet-500/15 text-violet-300' :
                                      'bg-slate-500/15 text-slate-500'
                                    }`}>
                                      {lease.renewalStatus === 'Renewed' ? '✓' :
                                       lease.renewalStatus === 'Pending' ? '⏳' :
                                       lease.renewalStatus === 'Did Not Renew' ? '✗' :
                                       lease.renewalStatus === 'Canceled by User' ? '—' :
                                       lease.renewalStatus === 'Not sent' ? '📭' : '?'}
                                      <span className="ml-1 hidden sm:inline">
                                        {lease.renewalStatus}
                                      </span>
                                    </span>
                                  </td>
                                  <td className="px-2 py-2 text-right font-medium text-slate-200">
                                    {lease.rent ? `$${Number(lease.rent).toLocaleString()}` : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ));
                  } else {
                    const typeGroups = [
                      { key: 'eviction', label: 'Evictions', color: 'red', icon: '⚠️', leases: allBadLeases.filter(l => l.type === 'eviction') },
                      { key: 'monthToMonth', label: 'Month-to-Month', color: 'orange', icon: '📅', leases: allBadLeases.filter(l => l.type === 'monthToMonth') },
                      { key: 'expiring', label: 'Expiring Soon', color: 'yellow', icon: '⏰', leases: allBadLeases.filter(l => l.type === 'expiring') }
                    ].filter(g => g.leases.length > 0);
                    
                    return typeGroups.map(group => (
                      <div key={group.key} className="mb-4">
                        <div className={`px-3 py-2 rounded-t-lg flex justify-between items-center ${
                          group.color === 'red' ? 'bg-rose-500 text-white' :
                          group.color === 'orange' ? 'bg-orange-500/50 text-white' :
                          'bg-amber-500/50 text-white'
                        }`}>
                          <span className="font-semibold">{group.icon} {group.label}</span>
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            group.color === 'red' ? 'bg-rose-600' :
                            group.color === 'orange' ? 'bg-orange-600' :
                            'bg-yellow-600'
                          }`}>{group.leases.length} units</span>
                        </div>
                        <div className="border border-[var(--glass-border)] border-t-0 rounded-b-lg overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-surface-raised/80 text-xs text-slate-400">
                              <tr>
                                <th className="px-2 py-2 text-left font-medium">Property</th>
                                <th className="px-2 py-2 text-left font-medium">Unit</th>
                                <th className="px-2 py-2 text-left font-medium">Tenant</th>
                                <th className="px-2 py-2 text-center font-medium">Days Left</th>
                                <th className="px-2 py-2 text-center font-medium">Renewal</th>
                                <th className="px-2 py-2 text-right font-medium">Rent</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {group.leases.map((lease, idx) => (
                                <tr key={idx} className={`${
                                  group.color === 'red' ? 'bg-rose-500/5 hover:bg-rose-500/10' : 
                                  group.color === 'orange' ? 'bg-orange-500/5 hover:bg-orange-500/50/10' : 
                                  'bg-amber-500/5 hover:bg-amber-500/10'
                                } transition-colors`}>
                                  <td className="px-2 py-2 text-slate-200 truncate max-w-[140px]" title={lease.property}>
                                    {lease.property}
                                  </td>
                                  <td className="px-2 py-2 font-medium">{lease.unit}</td>
                                  <td className="px-2 py-2 text-slate-200 truncate max-w-[120px]" title={lease.tenantName || 'No renewal sent'}>
                                    {lease.tenantName || <span className="text-slate-500 italic text-xs">No renewal</span>}
                                  </td>
                                  <td className="px-2 py-2 text-center text-xs font-medium">
                                    {lease.daysUntilExpiration !== null && lease.daysUntilExpiration !== undefined ? (
                                      <span className={lease.daysUntilExpiration < 0 ? 'text-rose-400' : lease.daysUntilExpiration <= 30 ? 'text-amber-400' : 'text-slate-400'}>
                                        {lease.daysUntilExpiration}
                                      </span>
                                    ) : '-'}
                                  </td>
                                  <td className="px-2 py-2 text-center">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                      lease.renewalStatus === 'Renewed' ? 'bg-emerald-500/15 text-emerald-300' :
                                      lease.renewalStatus === 'Pending' ? 'bg-blue-500/15 text-blue-400' :
                                      lease.renewalStatus === 'Did Not Renew' ? 'bg-rose-500/15 text-rose-400' :
                                      lease.renewalStatus === 'Canceled by User' ? 'bg-slate-500/15 text-slate-200' :
                                      lease.renewalStatus === 'Not sent' ? 'bg-violet-500/15 text-violet-300' :
                                      'bg-slate-500/15 text-slate-500'
                                    }`}>
                                      {lease.renewalStatus === 'Renewed' ? '✓' :
                                       lease.renewalStatus === 'Pending' ? '⏳' :
                                       lease.renewalStatus === 'Did Not Renew' ? '✗' :
                                       lease.renewalStatus === 'Canceled by User' ? '—' :
                                       lease.renewalStatus === 'Not sent' ? '📭' : '?'}
                                      <span className="ml-1 hidden sm:inline">
                                        {lease.renewalStatus}
                                      </span>
                                    </span>
                                  </td>
                                  <td className="px-2 py-2 text-right font-medium text-slate-200">
                                    {lease.rent ? `$${Number(lease.rent).toLocaleString()}` : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ));
                  }
                })()}
              </div>
              
              {/* Upcoming Expirations */}
              {stats.leaseHealthDetails?.upcomingExpirations?.length > 0 && (
                <div className="mt-6 pt-6 border-t border-[var(--glass-border)]">
                  <div className="px-3 py-2 rounded-t-lg flex justify-between items-center bg-blue-500 text-white">
                    <span className="font-semibold">📆 Upcoming Expirations (61-90 days)</span>
                    <span className="px-2 py-0.5 rounded text-xs bg-blue-600">{stats.leaseHealthDetails.upcomingExpirations.length} units</span>
                  </div>
                  <div className="border border-[var(--glass-border)] border-t-0 rounded-b-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-raised/80 text-xs text-slate-400">
                        <tr>
                          <th className="px-2 py-2 text-left font-medium">Property</th>
                          <th className="px-2 py-2 text-left font-medium">Unit</th>
                          <th className="px-2 py-2 text-left font-medium">Tenant</th>
                          <th className="px-2 py-2 text-center font-medium">Days Left</th>
                          <th className="px-2 py-2 text-center font-medium">Renewal</th>
                          <th className="px-2 py-2 text-right font-medium">Rent</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {stats.leaseHealthDetails.upcomingExpirations.map((lease, idx) => (
                          <tr key={idx} className="bg-blue-500/5 hover:bg-blue-500/50/10 transition-colors">
                            <td className="px-2 py-2 text-slate-200 truncate max-w-[140px]" title={lease.property}>
                              {lease.property}
                            </td>
                            <td className="px-2 py-2 font-medium">{lease.unit}</td>
                            <td className="px-2 py-2 text-slate-200 truncate max-w-[120px]" title={lease.tenantName || 'No renewal sent'}>
                              {lease.tenantName || <span className="text-slate-500 italic text-xs">No renewal</span>}
                            </td>
                            <td className="px-2 py-2 text-center text-xs font-medium">
                              {lease.daysUntilExpiration !== null && lease.daysUntilExpiration !== undefined ? (
                                <span className={lease.daysUntilExpiration < 0 ? 'text-rose-400' : lease.daysUntilExpiration <= 30 ? 'text-amber-400' : 'text-blue-400'}>
                                  {lease.daysUntilExpiration}
                                </span>
                              ) : '-'}
                            </td>
                            <td className="px-2 py-2 text-center">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                lease.renewalStatus === 'Renewed' ? 'bg-emerald-500/15 text-emerald-300' :
                                lease.renewalStatus === 'Pending' ? 'bg-blue-500/15 text-blue-400' :
                                lease.renewalStatus === 'Did Not Renew' ? 'bg-rose-500/15 text-rose-400' :
                                lease.renewalStatus === 'Canceled by User' ? 'bg-slate-500/15 text-slate-200' :
                                lease.renewalStatus === 'Not sent' ? 'bg-violet-500/15 text-violet-300' :
                                'bg-slate-500/15 text-slate-500'
                              }`}>
                                {lease.renewalStatus === 'Renewed' ? '✓' :
                                 lease.renewalStatus === 'Pending' ? '⏳' :
                                 lease.renewalStatus === 'Did Not Renew' ? '✗' :
                                 lease.renewalStatus === 'Canceled by User' ? '—' :
                                 lease.renewalStatus === 'Not sent' ? '📭' : '?'}
                                <span className="ml-1 hidden sm:inline">
                                  {lease.renewalStatus}
                                </span>
                              </span>
                            </td>
                            <td className="px-2 py-2 text-right font-medium text-slate-200">
                              {lease.rent ? `$${Number(lease.rent).toLocaleString()}` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              
              {/* Recent Renewals */}
              {stats.leaseHealthDetails?.recentRenewals?.length > 0 && (
                <div className="mt-6 pt-6 border-t border-[var(--glass-border)]">
                  <div className="px-3 py-2 rounded-t-lg flex justify-between items-center bg-emerald-500 text-white">
                    <span className="font-semibold">🔄 Recent Renewals (Last 60 Days + Future)</span>
                    <span className="px-2 py-0.5 rounded text-xs bg-emerald-600">{stats.leaseHealthDetails.recentRenewals.length} renewals</span>
                  </div>
                  <div className="border border-[var(--glass-border)] border-t-0 rounded-b-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-raised/80 text-xs text-slate-400">
                        <tr>
                          <th className="px-2 py-2 text-left font-medium">Property</th>
                          <th className="px-2 py-2 text-left font-medium">Unit</th>
                          <th className="px-2 py-2 text-left font-medium">Tenant</th>
                          <th className="px-2 py-2 text-center font-medium">Lease Start</th>
                          <th className="px-2 py-2 text-right font-medium">Rent</th>
                          <th className="px-2 py-2 text-right font-medium">Change</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {stats.leaseHealthDetails.recentRenewals.map((renewal, idx) => (
                          <tr key={idx} className="bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors">
                            <td className="px-2 py-2 text-slate-200 truncate max-w-[140px]" title={renewal.property}>
                              {renewal.property}
                            </td>
                            <td className="px-2 py-2 font-medium">{renewal.unit}</td>
                            <td className="px-2 py-2 text-slate-200 truncate max-w-[120px]" title={renewal.tenantName || ''}>
                              {renewal.tenantName || <span className="text-slate-500 italic text-xs">-</span>}
                            </td>
                            <td className="px-2 py-2 text-center text-xs">
                              <span className={renewal.daysFromToday > 0 ? 'text-blue-400 font-medium' : 'text-slate-400'}>
                                {new Date(renewal.leaseStart).toLocaleDateString()}
                                {renewal.daysFromToday > 0 && <span className="ml-1 text-cyan-400">(+{renewal.daysFromToday}d)</span>}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-right font-medium text-slate-200">
                              {renewal.rent ? `$${Number(renewal.rent).toLocaleString()}` : '-'}
                            </td>
                            <td className="px-2 py-2 text-right text-xs">
                              {renewal.percentDifference !== null && renewal.percentDifference !== undefined ? (
                                <span className={Number(renewal.percentDifference) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                  {Number(renewal.percentDifference) >= 0 ? '+' : ''}{Number(renewal.percentDifference).toFixed(1)}%
                                </span>
                              ) : renewal.dollarDifference !== null && renewal.dollarDifference !== undefined ? (
                                <span className={Number(renewal.dollarDifference) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                  {Number(renewal.dollarDifference) >= 0 ? '+' : ''}${Number(renewal.dollarDifference).toLocaleString()}
                                </span>
                              ) : (
                                <span className="text-slate-500">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            
            {/* Other Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              <div className="glass-card p-6">
                <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">Unit Status Distribution</h2>
                <canvas ref={statusChartRef}></canvas>
              </div>
              
              <div className="glass-card p-6">
                <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">Lease Expirations</h2>
                <canvas ref={leaseChartRef}></canvas>
              </div>
              
              <div className="glass-card p-6">
                <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">Delinquency by Property</h2>
                <canvas ref={delinquencyChartRef}></canvas>
              </div>
            </div>
            
            {/* Renewals by Month Chart */}
            <div className="glass-card p-6 mb-6">
              <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">🔄 Renewals by Month (Last 12 Months)</h2>
              <canvas ref={renewalsChartRef}></canvas>
            </div>
            
            {/* Property Stats Table */}
            <div className="glass-card p-6 mb-6">
              <h2 className="text-lg font-semibold text-slate-100 mb-4 pb-2 border-b border-[var(--glass-border)]">Property Breakdown</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-2">Property</th>
                      <th className="text-right py-3 px-2">Total Units</th>
                      <th className="text-right py-3 px-2">Occupied</th>
                      <th className="text-right py-3 px-2">Occupancy %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.propertyStats?.map((prop, idx) => (
                      <tr key={idx} className="border-b hover:bg-surface-raised/80">
                        <td className="py-3 px-2 font-medium">{prop.property}</td>
                        <td className="text-right py-3 px-2">{prop.totalUnits}</td>
                        <td className="text-right py-3 px-2">{prop.occupiedUnits}</td>
                        <td className="text-right py-3 px-2">
                          <span className={`px-2 py-1 rounded ${parseFloat(prop.occupancyRate) >= 90 ? 'bg-emerald-500/15 text-green-800' : parseFloat(prop.occupancyRate) >= 80 ? 'bg-amber-500/15 text-yellow-800' : 'bg-rose-500/15 text-red-800'}`}>
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
