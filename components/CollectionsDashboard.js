'use client';

import { useState, useEffect, useMemo } from 'react';
import { LogoLoader } from './Logo';

export default function CollectionsDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProperty, setSelectedProperty] = useState('all');
  const [selectedAgingBuckets, setSelectedAgingBuckets] = useState([]);
  
  useEffect(() => {
    fetchData();
  }, [selectedProperty]);
  
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
  
  const getAgingColor = (item) => {
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
  
  // Sort items within each property by aging (oldest first)
  Object.keys(groupedByProperty).forEach(property => {
    groupedByProperty[property].sort((a, b) => {
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
                                <span className="font-semibold text-slate-900">{item.name || 'Unknown'}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full text-white ${agingBadge.color}`}>
                                  {agingBadge.label}
                                </span>
                                {item.in_collections && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500 text-white">
                                    In Collections
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-slate-600">
                                {item.unit && <span>Unit {item.unit}</span>}
                              </div>
                              <div className="text-xs text-slate-500 mt-1">
                                {item.phone_numbers && <span>📞 {item.phone_numbers}</span>}
                                {item.primary_tenant_email && <span className="ml-3">✉️ {item.primary_tenant_email}</span>}
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
      </div>
    </div>
  );
}
