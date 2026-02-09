'use client';

import { useState, useEffect, useRef } from 'react';
import { LogoLoader } from './Logo';
import Chart from 'chart.js/auto';
import JustCallDialer, { useJustCall } from './JustCallDialer';

export default function CollectionsDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProperty, setSelectedProperty] = useState('all');
  const [selectedAgingBuckets, setSelectedAgingBuckets] = useState([]);
  const trendChartRef = useRef(null);
  const trendChartInstance = useRef(null);
  const { makeCall, openDialer } = useJustCall();
  
  useEffect(() => {
    fetchData();
  }, [selectedProperty]);
  
  // Render trend chart when data changes
  useEffect(() => {
    if (!data?.trend || !trendChartRef.current) return;
    
    // Destroy existing chart
    if (trendChartInstance.current) {
      trendChartInstance.current.destroy();
    }
    
    const trend = data.trend;
    const labels = trend.map(d => {
      const date = new Date(d.date + 'T00:00:00');
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    
    const ctx = trendChartRef.current.getContext('2d');
    trendChartInstance.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '0-30 Days',
            data: trend.map(d => d.days_0_30),
            borderColor: 'rgb(59, 130, 246)',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.3,
            fill: false
          },
          {
            label: '30-60 Days',
            data: trend.map(d => d.days_30_60),
            borderColor: 'rgb(234, 179, 8)',
            backgroundColor: 'rgba(234, 179, 8, 0.1)',
            tension: 0.3,
            fill: false
          },
          {
            label: '60-90 Days',
            data: trend.map(d => d.days_60_90),
            borderColor: 'rgb(249, 115, 22)',
            backgroundColor: 'rgba(249, 115, 22, 0.1)',
            tension: 0.3,
            fill: false
          },
          {
            label: '90+ Days',
            data: trend.map(d => d.days_90_plus),
            borderColor: 'rgb(239, 68, 68)',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            tension: 0.3,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const value = context.parsed.y;
                return `${context.dataset.label}: $${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(value) {
                return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
              }
            }
          }
        }
      }
    });
    
    return () => {
      if (trendChartInstance.current) {
        trendChartInstance.current.destroy();
      }
    };
  }, [data?.trend]);
  
  const toggleAgingBucket = (bucket) => {
    setSelectedAgingBuckets(prev => 
      prev.includes(bucket) 
        ? prev.filter(b => b !== bucket)
        : [...prev, bucket]
    );
  };
  
  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedProperty !== 'all') params.append('property', selectedProperty);
      
      const res = await fetch(`/api/collections?${params}`);
      const result = await res.json();
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      setData(result);
      setError(null);
    } catch (err) {
      console.error('Error fetching collections:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount || 0);
  };
  
  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };
  
  // Format phone number for JustCall (ensure it has country code)
  const formatPhoneForJustCall = (phone) => {
    if (!phone) return null;
    // Clean the phone number - remove non-digits except +
    let cleaned = phone.replace(/[^\d+]/g, '');
    // If it doesn't start with +, assume US and add +1
    if (!cleaned.startsWith('+')) {
      // Remove leading 1 if present to avoid +11
      if (cleaned.startsWith('1') && cleaned.length === 11) {
        cleaned = '+' + cleaned;
      } else {
        cleaned = '+1' + cleaned;
      }
    }
    return cleaned;
  };
  
  // Open JustCall dialer with contact info (uses embedded SDK)
  const openJustCallDialer = (item) => {
    const phone = formatPhoneForJustCall(item.phone_numbers);
    if (!phone) {
      alert('No phone number available for this contact');
      return;
    }
    
    // Use embedded dialer SDK
    makeCall(phone, item.name || 'Unknown');
  };
  
  // Check if tenant has moved out
  const isMovedOut = (item) => {
    if (item.move_out) {
      const moveOutDate = new Date(item.move_out);
      if (moveOutDate <= new Date()) return true;
    }
    if (item.tenant_status && item.tenant_status !== 'Current') return true;
    return false;
  };
  
  const getAgingColor = (item) => {
    // Moved out tenants get a distinct gray/purple color
    if (isMovedOut(item)) return 'bg-purple-50 border-purple-300 text-purple-800';
    
    if (parseFloat(item.days_90_plus || 0) > 0) return 'bg-red-100 border-red-300 text-red-800';
    if (parseFloat(item.days_60_to_90 || 0) > 0) return 'bg-orange-100 border-orange-300 text-orange-800';
    if (parseFloat(item.days_30_to_60 || 0) > 0) return 'bg-yellow-100 border-yellow-300 text-yellow-800';
    if (parseFloat(item.days_0_to_30 || 0) > 0) return 'bg-blue-100 border-blue-300 text-blue-800';
    return 'bg-slate-100 border-slate-300 text-slate-800';
  };
  
  const getAgingBadge = (item) => {
    if (parseFloat(item.days_90_plus || 0) > 0) return { label: '90+ Days', color: 'bg-red-500' };
    if (parseFloat(item.days_60_to_90 || 0) > 0) return { label: '60-90 Days', color: 'bg-orange-500' };
    if (parseFloat(item.days_30_to_60 || 0) > 0) return { label: '30-60 Days', color: 'bg-yellow-500' };
    if (parseFloat(item.days_0_to_30 || 0) > 0) return { label: '0-30 Days', color: 'bg-blue-500' };
    return { label: 'Current', color: 'bg-slate-500' };
  };
  
  if (loading && !data) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <LogoLoader text="Loading collections..." />
      </div>
    );
  }
  
  if (error && !data) {
    return (
      <div className="min-h-screen bg-slate-100 p-6 md:p-8 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 max-w-md">
          <p className="text-red-600 mb-4">Error: {error}</p>
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
  
  const { items: allItems = [], summary = {}, properties = [] } = data || {};
  
  // Get the PRIMARY aging bucket for a tenant (highest/oldest only)
  const getPrimaryAgingBucket = (item) => {
    if (parseFloat(item.days_90_plus || 0) > 0) return '90+';
    if (parseFloat(item.days_60_to_90 || 0) > 0) return '60-90';
    if (parseFloat(item.days_30_to_60 || 0) > 0) return '30-60';
    if (parseFloat(item.days_0_to_30 || 0) > 0) return '0-30';
    return 'current';
  };
  
  // Get aging score for sorting (higher = older debt)
  const getAgingScore = (item) => {
    const bucket = getPrimaryAgingBucket(item);
    switch (bucket) {
      case '90+': return 4;
      case '60-90': return 3;
      case '30-60': return 2;
      case '0-30': return 1;
      default: return 0;
    }
  };
  
  // Filter items based on selected aging buckets (using PRIMARY bucket only)
  const filteredItems = selectedAgingBuckets.length === 0 
    ? allItems 
    : allItems.filter(item => {
        const primaryBucket = getPrimaryAgingBucket(item);
        return selectedAgingBuckets.includes(primaryBucket);
      });
  
  // Group by property
  const groupedByProperty = filteredItems.reduce((acc, item) => {
    const property = item.property_name || 'Unknown';
    if (!acc[property]) acc[property] = [];
    acc[property].push(item);
    return acc;
  }, {});
  
  // Sort items within each property by aging (oldest first), with moved-out tenants at bottom
  Object.keys(groupedByProperty).forEach(property => {
    groupedByProperty[property].sort((a, b) => {
      // Moved-out tenants go to the bottom
      const aMovedOut = isMovedOut(a);
      const bMovedOut = isMovedOut(b);
      if (aMovedOut && !bMovedOut) return 1;
      if (!aMovedOut && bMovedOut) return -1;
      
      // Then sort by aging score (oldest first)
      const scoreA = getAgingScore(a);
      const scoreB = getAgingScore(b);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return parseFloat(b.amount_receivable || 0) - parseFloat(a.amount_receivable || 0);
    });
  });
  
  // Sort properties by total receivable
  const sortedProperties = Object.keys(groupedByProperty).sort((a, b) => {
    const totalA = groupedByProperty[a].reduce((sum, item) => sum + parseFloat(item.amount_receivable || 0), 0);
    const totalB = groupedByProperty[b].reduce((sum, item) => sum + parseFloat(item.amount_receivable || 0), 0);
    return totalB - totalA;
  });
  
  const totalFilteredItems = filteredItems.length;
  
  return (
    <div className="min-h-screen bg-slate-100 p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h1 className="text-2xl md:text-3xl font-semibold text-slate-800 mb-1">
            Collections
          </h1>
          <p className="text-slate-500 text-sm">
            Open receivables and delinquency tracking
          </p>
        </div>
        
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Receivable</p>
            <p className="text-xl font-bold text-slate-800">{formatCurrency(summary.totalReceivable)}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Accounts</p>
            <p className="text-xl font-bold text-slate-800">{summary.totalAccounts}</p>
          </div>
          <button 
            onClick={() => toggleAgingBucket('0-30')}
            className={`rounded-xl shadow-sm border-2 p-4 text-left transition-all ${
              selectedAgingBuckets.includes('0-30') 
                ? 'border-blue-500 bg-blue-100 ring-2 ring-blue-300' 
                : 'border-blue-200 bg-blue-50 hover:border-blue-400'
            }`}
          >
            <p className="text-xs text-blue-600 uppercase tracking-wide mb-1">0-30 Days</p>
            <p className="text-xl font-bold text-blue-700">{formatCurrency(summary.days0to30)}</p>
          </button>
          <button 
            onClick={() => toggleAgingBucket('30-60')}
            className={`rounded-xl shadow-sm border-2 p-4 text-left transition-all ${
              selectedAgingBuckets.includes('30-60') 
                ? 'border-yellow-500 bg-yellow-100 ring-2 ring-yellow-300' 
                : 'border-yellow-200 bg-yellow-50 hover:border-yellow-400'
            }`}
          >
            <p className="text-xs text-yellow-600 uppercase tracking-wide mb-1">30-60 Days</p>
            <p className="text-xl font-bold text-yellow-700">{formatCurrency(summary.days30to60)}</p>
          </button>
          <button 
            onClick={() => toggleAgingBucket('60-90')}
            className={`rounded-xl shadow-sm border-2 p-4 text-left transition-all ${
              selectedAgingBuckets.includes('60-90') 
                ? 'border-orange-500 bg-orange-100 ring-2 ring-orange-300' 
                : 'border-orange-200 bg-orange-50 hover:border-orange-400'
            }`}
          >
            <p className="text-xs text-orange-600 uppercase tracking-wide mb-1">60-90 Days</p>
            <p className="text-xl font-bold text-orange-700">{formatCurrency(summary.days60to90)}</p>
          </button>
          <button 
            onClick={() => toggleAgingBucket('90+')}
            className={`rounded-xl shadow-sm border-2 p-4 text-left transition-all ${
              selectedAgingBuckets.includes('90+') 
                ? 'border-red-500 bg-red-100 ring-2 ring-red-300' 
                : 'border-red-200 bg-red-50 hover:border-red-400'
            }`}
          >
            <p className="text-xs text-red-600 uppercase tracking-wide mb-1">90+ Days</p>
            <p className="text-xl font-bold text-red-700">{formatCurrency(summary.days90plus)}</p>
          </button>
        </div>
        
        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-600 mb-2">Property</label>
              <select
                value={selectedProperty}
                onChange={(e) => setSelectedProperty(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
              >
                <option value="all">All Properties</option>
                {properties.map(prop => (
                  <option key={prop} value={prop}>{prop}</option>
                ))}
              </select>
            </div>
            {selectedAgingBuckets.length > 0 && (
              <button
                onClick={() => setSelectedAgingBuckets([])}
                className="px-4 py-2 text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-100 transition"
              >
                Clear Filters ({selectedAgingBuckets.length})
              </button>
            )}
            <button
              onClick={fetchData}
              disabled={loading}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
        
        {/* Tape Feed - Grouped by Property */}
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-slate-800">
            Open Collections ({totalFilteredItems})
          </h2>
          
          {totalFilteredItems === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-500">
              No collections items found
            </div>
          ) : (
            sortedProperties.map(property => {
              const propertyItems = groupedByProperty[property];
              const propertyTotal = propertyItems.reduce((sum, item) => sum + parseFloat(item.amount_receivable || 0), 0);
              
              return (
                <div key={property} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  {/* Property Header */}
                  <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                    <div>
                      <h3 className="font-semibold text-slate-800">{property}</h3>
                      <p className="text-sm text-slate-500">{propertyItems.length} account{propertyItems.length !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500 uppercase">Total Due</p>
                      <p className="text-xl font-bold text-slate-800">{formatCurrency(propertyTotal)}</p>
                    </div>
                  </div>
                  
                  {/* Property Items */}
                  <div className="divide-y divide-slate-100">
                    {propertyItems.map((item, idx) => {
                      const agingBadge = getAgingBadge(item);
                      return (
                        <div 
                          key={item.id || idx}
                          className={`p-4 transition hover:bg-slate-50 ${getAgingColor(item)} border-l-4`}
                        >
                          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                {item.occupancy_id ? (
                                  <a 
                                    href={`https://appreciateinc.appfolio.com/occupancies/${item.occupancy_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                                    title="Open in AppFolio"
                                  >
                                    {item.name || 'Unknown'}
                                  </a>
                                ) : (
                                  <span className="font-semibold text-slate-900">{item.name || 'Unknown'}</span>
                                )}
                                <span className={`text-xs px-2 py-0.5 rounded-full text-white ${agingBadge.color}`}>
                                  {agingBadge.label}
                                </span>
                                {isMovedOut(item) && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500 text-white">
                                    Moved Out
                                  </span>
                                )}
                                {item.in_collections && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500 text-white">
                                    In Collections
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-slate-600">
                                {item.unit && <span>Unit {item.unit}</span>}
                              </div>
                              <div className="text-xs text-slate-500 mt-1 flex items-center gap-3">
                                {item.phone_numbers && (
                                  <button
                                    onClick={() => openJustCallDialer(item)}
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded-md transition-colors cursor-pointer"
                                    title="Click to call with JustCall"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                                    </svg>
                                    <span>{item.phone_numbers}</span>
                                  </button>
                                )}
                                {item.primary_tenant_email && (
                                  <a 
                                    href={`mailto:${item.primary_tenant_email}`}
                                    className="inline-flex items-center gap-1 hover:text-indigo-600 transition-colors"
                                  >
                                    ✉️ {item.primary_tenant_email}
                                  </a>
                                )}
                              </div>
                            </div>
                            
                            <div className="flex flex-wrap gap-4 text-sm">
                              <div className="text-center">
                                <p className="text-xs text-slate-500">Total Due</p>
                                <p className="font-bold text-lg text-slate-900">{formatCurrency(item.amount_receivable)}</p>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-slate-200 text-xs text-slate-500">
                            <span>Rent: {formatCurrency(item.rent)}</span>
                            <span>Deposit: {formatCurrency(item.deposit)}</span>
                            <span>Move In: {formatDate(item.move_in)}</span>
                            {item.last_payment && (
                              <span>Last Payment: {formatDate(item.last_payment)} ({formatCurrency(item.payment_amount)})</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
        
        {/* Collections Trend Chart */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mt-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-200">
            Collections Trend (Last 60 Days)
          </h2>
          {data?.trend && data.trend.length > 0 ? (
            <div style={{ height: '300px' }}>
              <canvas ref={trendChartRef}></canvas>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500">
              <p className="text-lg mb-2">No historical data yet</p>
              <p className="text-sm">This chart will populate as daily snapshots are collected over time.</p>
            </div>
          )}
        </div>
      </div>
      
      {/* JustCall Embedded Dialer */}
      <JustCallDialer />
    </div>
  );
}
