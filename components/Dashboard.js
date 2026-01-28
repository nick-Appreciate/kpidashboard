'use client';

import { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

export default function Dashboard() {
  const [inquiries, setInquiries] = useState([]);
  const [stats, setStats] = useState(null);
  const [funnelData, setFunnelData] = useState(null);
  const [properties, setProperties] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [selectedProperty, setSelectedProperty] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedStage, setSelectedStage] = useState(null); // null = no stage selected, charts hidden
  const [stageStats, setStageStats] = useState(null);
  
  // Chart refs
  const statusChartRef = useRef(null);
  const weeklyChartRef = useRef(null);
  const dailyChartRef = useRef(null);
  const propertyChartRef = useRef(null);
  const leadTypeChartRef = useRef(null);
  const sourceChartRef = useRef(null);
  const unitTypeChartRef = useRef(null);
  
  // Fetch data
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000); // Every 5 minutes
    return () => clearInterval(interval);
  }, [selectedProperty, selectedStatus, startDate, endDate]);
  
  // Fetch stage-specific data when a stage is selected or filters change
  useEffect(() => {
    const fetchStageData = async () => {
      if (!selectedStage) {
        setStageStats(null);
        return;
      }
      
      try {
        const params = new URLSearchParams();
        params.append('stage', selectedStage);
        if (selectedProperty !== 'all') params.append('property', selectedProperty);
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        
        const res = await fetch(`/api/stage-stats?${params}`);
        const data = await res.json();
        setStageStats(data);
      } catch (err) {
        console.error('Error fetching stage data:', err);
      }
    };
    
    fetchStageData();
  }, [selectedStage, selectedProperty, startDate, endDate]);
  
  const handleStageClick = (stageName) => {
    // Map stage names to API stage values
    const stageMap = {
      'Inquiries': 'inquiries',
      'Showings Scheduled': 'showings_scheduled',
      'Showings Completed': 'showings_completed',
      'Applications': 'applications',
      'Tenants': 'tenants'
    };
    
    const stageKey = stageMap[stageName];
    
    // Toggle selection - if clicking same stage, deselect
    if (selectedStage === stageKey) {
      setSelectedStage(null);
    } else {
      setSelectedStage(stageKey);
    }
  };
  
  // Get display name for selected stage
  const getStageDisplayName = () => {
    const nameMap = {
      'inquiries': 'Inquiries',
      'showings_scheduled': 'Showings Scheduled',
      'showings_completed': 'Showings Completed',
      'applications': 'Applications',
      'tenants': 'Tenants'
    };
    return nameMap[selectedStage] || '';
  };
  
  const fetchData = async () => {
    try {
      setLoading(true);
      
      const params = new URLSearchParams();
      if (selectedProperty !== 'all') params.append('property', selectedProperty);
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
      
      setLastUpdated(new Date());
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
    if (!selectedStage || !stageStats) return;
    
    updateChartsWithData(stageStats, getStageDisplayName());
    
    return () => {
      [statusChartRef, weeklyChartRef, dailyChartRef, propertyChartRef, leadTypeChartRef, sourceChartRef, unitTypeChartRef].forEach(ref => {
        if (ref.current?.chart) {
          ref.current.chart.destroy();
        }
      });
    };
  }, [stageStats, selectedStage]);
  
  const updateChartsWithData = (data, stageName) => {
    const stageColor = {
      'Inquiries': '#667eea',
      'Showings Scheduled': '#8b5cf6',
      'Showings Completed': '#764ba2',
      'Applications': '#f093fb',
      'Tenants': '#43e97b'
    }[stageName] || '#667eea';

    if (weeklyChartRef.current && data.weeklyData?.length > 0) {
      const ctx = weeklyChartRef.current.getContext('2d');
      if (weeklyChartRef.current.chart) weeklyChartRef.current.chart.destroy();
      
      // Store details for tooltip
      const weeklyDetails = data.weeklyData.map(w => w.details || []);
      
      weeklyChartRef.current.chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: data.weeklyData.map(w => {
            const [year, month, day] = w.week.split('-').map(Number);
            const weekStart = new Date(year, month - 1, day);
            const weekEnd = new Date(year, month - 1, day + 6);
            return `${weekStart.getMonth() + 1}/${weekStart.getDate()} - ${weekEnd.getMonth() + 1}/${weekEnd.getDate()}`;
          }),
          datasets: [{
            label: `Weekly ${stageName}`,
            data: data.weeklyData.map(w => w.count),
            borderColor: stageColor,
            backgroundColor: `${stageColor}20`,
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { 
            legend: { display: false },
            tooltip: {
              callbacks: {
                afterBody: function(context) {
                  const idx = context[0].dataIndex;
                  const details = weeklyDetails[idx];
                  if (!details || details.length === 0) return '';
                  
                  const lines = details.slice(0, 10).map(d => `• ${d.name} (ID: ${d.id})`);
                  if (details.length > 10) {
                    lines.push(`... and ${details.length - 10} more`);
                  }
                  return lines;
                }
              }
            }
          },
          scales: { 
            y: { beginAtZero: true, ticks: { stepSize: 1 } },
            x: { 
              ticks: { maxRotation: 45, minRotation: 45 },
              title: { display: true, text: 'Week (Start - End)' }
            }
          }
        }
      });
    }
    
    if (dailyChartRef.current && data.dailyData?.length > 0) {
      const ctx = dailyChartRef.current.getContext('2d');
      if (dailyChartRef.current.chart) dailyChartRef.current.chart.destroy();
      
      // Store details for tooltip
      const dailyDetails = data.dailyData.map(d => d.details || []);
      
      dailyChartRef.current.chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: data.dailyData.map(d => {
            const [year, month, day] = d.inquiry_date.split('-').map(Number);
            return `${month}/${day}`;
          }),
          datasets: [{
            label: `Daily ${stageName}`,
            data: data.dailyData.map(d => d.count),
            backgroundColor: stageColor,
            borderColor: stageColor,
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { 
            legend: { display: false },
            tooltip: {
              callbacks: {
                afterBody: function(context) {
                  const idx = context[0].dataIndex;
                  const details = dailyDetails[idx];
                  if (!details || details.length === 0) return '';
                  
                  const lines = details.slice(0, 10).map(d => `• ${d.name} (ID: ${d.id})`);
                  if (details.length > 10) {
                    lines.push(`... and ${details.length - 10} more`);
                  }
                  return lines;
                }
              }
            }
          },
          scales: { 
            y: { beginAtZero: true, ticks: { stepSize: 1 } },
            x: { ticks: { maxRotation: 45, minRotation: 45 } }
          }
        }
      });
    }
    
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
            label: stageName,
            data: data.topProperties.map(p => p.count),
            backgroundColor: stageColor
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
      });
    }
    
    if (leadTypeChartRef.current && data.leadTypeDistribution?.length > 0) {
      const ctx = leadTypeChartRef.current.getContext('2d');
      if (leadTypeChartRef.current.chart) leadTypeChartRef.current.chart.destroy();
      
      leadTypeChartRef.current.chart = new Chart(ctx, {
        type: 'pie',
        data: {
          labels: data.leadTypeDistribution.map(l => l.lead_type),
          datasets: [{
            data: data.leadTypeDistribution.map(l => l.count),
            backgroundColor: ['#667eea', '#43e97b', '#f093fb', '#4facfe', '#764ba2', '#ff6b6b']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { position: 'bottom' } }
        }
      });
    }
    
    if (sourceChartRef.current && data.sourceDistribution?.length > 0) {
      const ctx = sourceChartRef.current.getContext('2d');
      if (sourceChartRef.current.chart) sourceChartRef.current.chart.destroy();
      
      sourceChartRef.current.chart = new Chart(ctx, {
        type: 'pie',
        data: {
          labels: data.sourceDistribution.map(s => s.source || 'Unknown'),
          datasets: [{
            data: data.sourceDistribution.map(s => s.count),
            backgroundColor: ['#f093fb', '#4facfe', '#43e97b', '#667eea', '#764ba2', '#ff6b6b', '#feca57', '#48dbfb']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { position: 'bottom' } }
        }
      });
    }
    
    if (statusChartRef.current && data.statusDistribution?.length > 0) {
      const ctx = statusChartRef.current.getContext('2d');
      if (statusChartRef.current.chart) statusChartRef.current.chart.destroy();
      
      statusChartRef.current.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: data.statusDistribution.map(s => s.status),
          datasets: [{
            data: data.statusDistribution.map(s => s.count),
            backgroundColor: ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b', '#ff6b6b', '#feca57']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { position: 'bottom' } }
        }
      });
    }
  };

  const updateCharts = () => {
    if (weeklyChartRef.current && stats.weeklyData?.length > 0) {
      const ctx = weeklyChartRef.current.getContext('2d');
      if (weeklyChartRef.current.chart) weeklyChartRef.current.chart.destroy();
      
      weeklyChartRef.current.chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: stats.weeklyData.map(w => {
            const [year, month, day] = w.week.split('-').map(Number);
            const weekStart = new Date(year, month - 1, day);
            const weekEnd = new Date(year, month - 1, day + 6);
            return `${weekStart.getMonth() + 1}/${weekStart.getDate()} - ${weekEnd.getMonth() + 1}/${weekEnd.getDate()}`;
          }),
          datasets: [{
            label: 'Weekly Inquiries',
            data: stats.weeklyData.map(w => w.count),
            borderColor: '#667eea',
            backgroundColor: 'rgba(102, 126, 234, 0.1)',
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { display: false } },
          scales: { 
            y: { beginAtZero: true, ticks: { stepSize: 1 } },
            x: { 
              ticks: { maxRotation: 45, minRotation: 45 },
              title: { display: true, text: 'Week (Start - End)' }
            }
          }
        }
      });
    }
    
    if (dailyChartRef.current && stats.dailyData?.length > 0) {
      const ctx = dailyChartRef.current.getContext('2d');
      if (dailyChartRef.current.chart) dailyChartRef.current.chart.destroy();
      
      dailyChartRef.current.chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: stats.dailyData.map(d => {
            const [year, month, day] = d.inquiry_date.split('-').map(Number);
            return `${month}/${day}`;
          }),
          datasets: [{
            label: 'Daily Inquiries',
            data: stats.dailyData.map(d => d.count),
            backgroundColor: '#43e97b',
            borderColor: '#38d170',
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { display: false } },
          scales: { 
            y: { beginAtZero: true, ticks: { stepSize: 1 } },
            x: { ticks: { maxRotation: 45, minRotation: 45 } }
          }
        }
      });
    }
    
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
            backgroundColor: '#48dbfb'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
      });
    }
    
    if (leadTypeChartRef.current && stats.leadTypeDistribution?.length > 0) {
      const ctx = leadTypeChartRef.current.getContext('2d');
      if (leadTypeChartRef.current.chart) leadTypeChartRef.current.chart.destroy();
      
      leadTypeChartRef.current.chart = new Chart(ctx, {
        type: 'pie',
        data: {
          labels: stats.leadTypeDistribution.map(l => l.lead_type),
          datasets: [{
            data: stats.leadTypeDistribution.map(l => l.count),
            backgroundColor: ['#667eea', '#43e97b', '#f093fb', '#4facfe']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { position: 'bottom' } }
        }
      });
    }
    
    if (sourceChartRef.current && stats.sourceDistribution?.length > 0) {
      const ctx = sourceChartRef.current.getContext('2d');
      if (sourceChartRef.current.chart) sourceChartRef.current.chart.destroy();
      
      sourceChartRef.current.chart = new Chart(ctx, {
        type: 'pie',
        data: {
          labels: stats.sourceDistribution.map(s => s.source || 'Unknown'),
          datasets: [{
            data: stats.sourceDistribution.map(s => s.count),
            backgroundColor: ['#f093fb', '#4facfe', '#43e97b', '#667eea', '#764ba2', '#ff6b6b', '#feca57', '#48dbfb']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { position: 'bottom' } }
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
            backgroundColor: '#48dbfb'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
      });
    }
  };
  
  if (loading && !stats) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600">
        <div className="bg-white rounded-2xl p-8 shadow-2xl">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }
  
  if (error && !stats) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600">
        <div className="bg-white rounded-2xl p-8 shadow-2xl max-w-md">
          <p className="text-red-600 mb-4">{error}</p>
          <button 
            onClick={fetchData}
            className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 transition"
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
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 to-purple-600 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8 mb-6">
          <h1 className="text-3xl md:text-4xl font-bold text-indigo-600 mb-2">
            Guest Card Inquiries Dashboard
          </h1>
          <p className="text-gray-600">
            Real-time property inquiry analytics
            {lastUpdated && (
              <span className="text-gray-400 text-sm ml-2">
                • Last updated: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        
        {/* Controls */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Property
              </label>
              <select
                value={selectedProperty}
                onChange={(e) => setSelectedProperty(e.target.value)}
                disabled={loading}
                className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none disabled:opacity-50"
              >
                <option value="all">All Properties</option>
                {properties.map(prop => (
                  <option key={prop} value={prop}>
                    {prop.substring(0, 50)}{prop.length > 50 ? '...' : ''}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Status
              </label>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                disabled={loading}
                className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none disabled:opacity-50"
              >
                <option value="all">All Statuses</option>
                {statuses.map(status => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="flex flex-col md:flex-row gap-4 mt-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={loading}
                className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none disabled:opacity-50"
              />
            </div>
            
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={loading}
                className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none disabled:opacity-50"
              />
            </div>
            
            <div className="flex items-end gap-2">
              <button
                onClick={() => { setStartDate(''); setEndDate(''); }}
                disabled={loading || (!startDate && !endDate)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear Dates
              </button>
              <button
                onClick={fetchData}
                disabled={loading}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>
        
        {/* Tenant Lifecycle Funnel */}
        {funnelData && funnelData.stages && (
          <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-2 pb-2 border-b-2">
              Tenant Lifecycle Funnel
            </h2>
            <p className="text-gray-500 text-sm mb-4">
              Click on any stage to view detailed analytics for that stage
            </p>
            {selectedStage && (
              <div className="mb-4 flex items-center gap-2">
                <span className="text-sm text-gray-600">Viewing:</span>
                <span className="px-3 py-1 rounded-full text-white text-sm font-medium" style={{
                  backgroundColor: {
                    'inquiries': '#667eea',
                    'showings_scheduled': '#8b5cf6',
                    'showings_completed': '#764ba2',
                    'applications': '#f093fb',
                    'tenants': '#43e97b'
                  }[selectedStage]
                }}>
                  {getStageDisplayName()}
                </span>
                <button 
                  onClick={() => setSelectedStage(null)}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Clear selection
                </button>
              </div>
            )}
            
            {/* Funnel Visualization with Fallout */}
            <div className="mb-8">
              {funnelData.stages.map((stage, idx) => {
                const widthPercent = Math.max(35, 100 - (idx * 14));
                const nextStage = funnelData.stages[idx + 1];
                const showFallout = stage.fallout && stage.fallout.count > 0;
                const stageKey = {
                  'Inquiries': 'inquiries',
                  'Showings Scheduled': 'showings_scheduled',
                  'Showings Completed': 'showings_completed',
                  'Applications': 'applications',
                  'Tenants': 'tenants'
                }[stage.name];
                const isSelected = selectedStage === stageKey;
                
                return (
                  <div key={stage.name}>
                    {/* Main Stage Row */}
                    <div className="flex items-center">
                      {/* Funnel Bar - Left Side */}
                      <div className="flex-1 flex justify-start pl-4 md:pl-8">
                        <div 
                          onClick={() => handleStageClick(stage.name)}
                          className={`py-4 px-5 text-white font-semibold rounded-xl transition-all cursor-pointer shadow-lg ${
                            isSelected 
                              ? 'ring-4 ring-offset-2 ring-gray-400 scale-[1.02]' 
                              : 'hover:scale-[1.02] hover:shadow-xl'
                          }`}
                          style={{ 
                            width: `${widthPercent}%`,
                            backgroundColor: stage.color,
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
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Fallout Section - Between Stages */}
                    {showFallout && idx < funnelData.stages.length - 1 && (
                      <div className="flex items-stretch my-1">
                        {/* Connector Line */}
                        <div className="w-16 md:w-24 flex justify-center">
                          <div className="w-0.5 bg-gray-300 h-full min-h-[60px]"></div>
                        </div>
                        
                        {/* Arrow pointing to fallout */}
                        <div className="flex items-center">
                          <div className="text-gray-400 text-lg mr-2">→</div>
                          
                          {/* Fallout Box */}
                          <div className="bg-red-50 border-l-4 border-red-400 rounded-r-lg p-3 shadow-sm max-w-xs">
                            <div className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1">
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
                                    <span className="text-gray-700">{reason.label}</span>
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
                    
                    {/* Simple connector for stages without fallout or last stage */}
                    {(!showFallout && idx < funnelData.stages.length - 1) && (
                      <div className="flex my-2">
                        <div className="w-16 md:w-24 flex justify-center">
                          <div className="text-gray-400 text-2xl">↓</div>
                        </div>
                      </div>
                    )}
                    
                    {/* Final stage fallout (Denied) */}
                    {showFallout && idx === funnelData.stages.length - 1 && (
                      <div className="flex items-center mt-2 ml-16 md:ml-24">
                        <div className="text-gray-400 text-lg mr-2">↳</div>
                        <div className="bg-red-50 border-l-4 border-red-400 rounded-r-lg p-3 shadow-sm">
                          <div className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1">
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
                                  <span className="text-gray-700">{reason.label}</span>
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
              <div className="text-center p-4 bg-indigo-50 rounded-xl">
                <p className="text-2xl md:text-3xl font-bold text-indigo-600">{funnelData.summary.overallConversion}%</p>
                <p className="text-xs md:text-sm text-gray-600 mt-1">Overall Conversion</p>
                <p className="text-xs text-gray-400">Inquiry → Tenant</p>
              </div>
              <div className="text-center p-4 bg-violet-50 rounded-xl">
                <p className="text-2xl md:text-3xl font-bold text-violet-600">
                  {funnelData.stages[1]?.conversionFromPrevious || 0}%
                </p>
                <p className="text-xs md:text-sm text-gray-600 mt-1">Scheduling Rate</p>
                <p className="text-xs text-gray-400">Inquiry → Scheduled</p>
              </div>
              <div className="text-center p-4 bg-purple-50 rounded-xl">
                <p className="text-2xl md:text-3xl font-bold text-purple-600">
                  {funnelData.summary.showingCompletionRate || 0}%
                </p>
                <p className="text-xs md:text-sm text-gray-600 mt-1">Completion Rate</p>
                <p className="text-xs text-gray-400">Scheduled → Completed</p>
              </div>
              <div className="text-center p-4 bg-pink-50 rounded-xl">
                <p className="text-2xl md:text-3xl font-bold text-pink-600">
                  {funnelData.stages[3]?.conversionFromPrevious || 0}%
                </p>
                <p className="text-xs md:text-sm text-gray-600 mt-1">Application Rate</p>
                <p className="text-xs text-gray-400">Completed → Applied</p>
              </div>
              <div className="text-center p-4 bg-green-50 rounded-xl">
                <p className="text-2xl md:text-3xl font-bold text-green-600">
                  {funnelData.summary.applicationApprovalRate || 0}%
                </p>
                <p className="text-xs md:text-sm text-gray-600 mt-1">Approval Rate</p>
                <p className="text-xs text-gray-400">Applied → Approved</p>
              </div>
            </div>
          </div>
        )}
        
        {/* Charts Section - Only visible when a stage is selected */}
        {selectedStage && stageStats && (
          <>
            {/* Stats Cards for Selected Stage */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="bg-white rounded-2xl shadow-xl p-6 hover:shadow-2xl transition">
                <p className="text-gray-500 text-sm uppercase tracking-wide mb-2">Total {getStageDisplayName()}</p>
                <p className="text-4xl font-bold" style={{ color: {
                  'inquiries': '#667eea',
                  'showings_scheduled': '#8b5cf6',
                  'showings_completed': '#764ba2',
                  'applications': '#f093fb',
                  'tenants': '#43e97b'
                }[selectedStage] }}>{stageStats?.total || 0}</p>
              </div>
              <div className="bg-white rounded-2xl shadow-xl p-6 hover:shadow-2xl transition">
                <p className="text-gray-500 text-sm uppercase tracking-wide mb-2">Properties</p>
                <p className="text-4xl font-bold text-indigo-600">{stageStats?.propertyCount || 0}</p>
              </div>
              <div className="bg-white rounded-2xl shadow-xl p-6 hover:shadow-2xl transition">
                <p className="text-gray-500 text-sm uppercase tracking-wide mb-2">Status Types</p>
                <p className="text-4xl font-bold text-indigo-600">{stageStats?.statusDistribution?.length || 0}</p>
              </div>
              <div className="bg-white rounded-2xl shadow-xl p-6 hover:shadow-2xl transition">
                <p className="text-gray-500 text-sm uppercase tracking-wide mb-2">Sources</p>
                <p className="text-4xl font-bold text-indigo-600">{stageStats?.sourceDistribution?.length || 0}</p>
              </div>
            </div>
            
            {/* Daily Chart - Full Width */}
            <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b-2">Daily {getStageDisplayName()}</h2>
              <canvas ref={dailyChartRef}></canvas>
            </div>
            
            {/* Weekly Chart - Full Width */}
            <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b-2">{getStageDisplayName()} Over Time (Weekly)</h2>
              <canvas ref={weeklyChartRef}></canvas>
            </div>
            
            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-2xl shadow-xl p-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b-2">Status Distribution</h2>
                <canvas ref={statusChartRef}></canvas>
              </div>
              
              <div className="bg-white rounded-2xl shadow-xl p-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b-2">Sources</h2>
                <canvas ref={sourceChartRef}></canvas>
              </div>
              
              {stageStats?.topProperties?.length > 0 && (
                <div className="bg-white rounded-2xl shadow-xl p-6">
                  <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b-2">Top Properties</h2>
                  <canvas ref={propertyChartRef}></canvas>
                </div>
              )}
              
              {stageStats?.leadTypeDistribution?.length > 0 && (
                <div className="bg-white rounded-2xl shadow-xl p-6">
                  <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b-2">Types</h2>
                  <canvas ref={leadTypeChartRef}></canvas>
                </div>
              )}
            </div>
          </>
        )}
        
        {/* Prompt to select a stage when none selected */}
        {!selectedStage && (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-6 text-center">
            <div className="text-gray-400 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">Select a Funnel Stage</h3>
            <p className="text-gray-500">Click on any stage in the funnel above to view detailed analytics and charts for that stage.</p>
          </div>
        )}
      </div>
    </div>
  );
}
