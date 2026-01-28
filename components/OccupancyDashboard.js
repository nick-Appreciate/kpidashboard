'use client';

import { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import Link from 'next/link';

export default function OccupancyDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProperty, setSelectedProperty] = useState('all');
  
  const occupancyChartRef = useRef(null);
  const statusChartRef = useRef(null);
  const leaseChartRef = useRef(null);
  const delinquencyChartRef = useRef(null);
  
  useEffect(() => {
    fetchStats();
  }, [selectedProperty]);
  
  useEffect(() => {
    if (stats) {
      updateCharts();
    }
  }, [stats]);
  
  const fetchStats = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedProperty !== 'all') {
        params.append('property', selectedProperty);
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
  
  const updateCharts = () => {
    // Occupancy Trend Chart
    if (occupancyChartRef.current && stats.occupancyTrend?.length > 0) {
      const ctx = occupancyChartRef.current.getContext('2d');
      if (occupancyChartRef.current.chart) occupancyChartRef.current.chart.destroy();
      
      occupancyChartRef.current.chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: stats.occupancyTrend.map(d => {
            const [year, month, day] = d.date.split('-');
            return `${month}/${day}`;
          }),
          datasets: [{
            label: 'Occupancy Rate (%)',
            data: stats.occupancyTrend.map(d => parseFloat(d.occupancyRate)),
            borderColor: '#10b981',
            backgroundColor: '#10b98120',
            fill: true,
            tension: 0.4
          }]
        },
        options: {
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
  };
  
  if (loading && !stats) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-500 to-teal-600 p-4 md:p-8 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-500 to-teal-600 p-4 md:p-8 flex items-center justify-center">
        <div className="bg-white rounded-xl p-6 max-w-md">
          <p className="text-red-600 mb-4">Error: {error}</p>
          <button 
            onClick={fetchStats}
            className="w-full bg-emerald-600 text-white py-2 px-4 rounded-lg hover:bg-emerald-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  
  const summary = stats?.summary || {};
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-500 to-teal-600 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-emerald-600 mb-2">
                Occupancy Dashboard
              </h1>
              <p className="text-gray-600">
                Property occupancy and lease health analytics
                {stats?.latestSnapshotDate && (
                  <span className="text-gray-400 text-sm ml-2">
                    • Data as of: {new Date(stats.latestSnapshotDate).toLocaleDateString()}
                  </span>
                )}
              </p>
            </div>
            <Link 
              href="/"
              className="mt-4 md:mt-0 inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              ← Leasing Dashboard
            </Link>
          </div>
        </div>
        
        {!stats?.hasData ? (
          <div className="bg-white rounded-2xl shadow-xl p-12 text-center">
            <div className="text-6xl mb-4">📊</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">No Data Available</h2>
            <p className="text-gray-600">Rent roll data will be automatically imported via email.</p>
          </div>
        ) : (
          <>
            {/* Property Filter */}
            <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Property</label>
              <select
                value={selectedProperty}
                onChange={(e) => setSelectedProperty(e.target.value)}
                className="w-full md:w-64 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
              >
                <option value="all">All Properties</option>
                {stats.properties?.map(prop => (
                  <option key={prop} value={prop}>{prop}</option>
                ))}
              </select>
            </div>
            
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
              <div className="bg-white rounded-xl shadow-lg p-4">
                <div className="text-3xl font-bold text-emerald-600">{summary.occupancyRate}%</div>
                <div className="text-sm text-gray-600">Occupancy Rate</div>
              </div>
              <div className="bg-white rounded-xl shadow-lg p-4">
                <div className="text-3xl font-bold text-gray-800">{summary.totalUnits}</div>
                <div className="text-sm text-gray-600">Total Units</div>
              </div>
              <div className="bg-white rounded-xl shadow-lg p-4">
                <div className="text-3xl font-bold text-green-600">{summary.occupiedUnits}</div>
                <div className="text-sm text-gray-600">Occupied</div>
              </div>
              <div className="bg-white rounded-xl shadow-lg p-4">
                <div className="text-3xl font-bold text-red-600">{summary.vacantUnits}</div>
                <div className="text-sm text-gray-600">Vacant</div>
              </div>
              <div className="bg-white rounded-xl shadow-lg p-4">
                <div className="text-3xl font-bold text-orange-600">{summary.noticeUnits}</div>
                <div className="text-sm text-gray-600">On Notice</div>
              </div>
              <div className="bg-white rounded-xl shadow-lg p-4">
                <div className="text-3xl font-bold text-red-700">{summary.evictUnits}</div>
                <div className="text-sm text-gray-600">Eviction</div>
              </div>
            </div>
            
            {/* Financial Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="text-2xl font-bold text-emerald-600">${summary.totalRent?.toLocaleString()}</div>
                <div className="text-sm text-gray-600">Total Monthly Rent</div>
              </div>
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="text-2xl font-bold text-red-600">${summary.totalPastDue?.toLocaleString()}</div>
                <div className="text-sm text-gray-600">Total Past Due</div>
              </div>
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="text-2xl font-bold text-gray-800">{summary.totalSqft?.toLocaleString()} sqft</div>
                <div className="text-sm text-gray-600">Total Square Footage</div>
              </div>
            </div>
            
            {/* Occupancy Trend - Full Width */}
            <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b-2">Occupancy Trend</h2>
              <canvas ref={occupancyChartRef}></canvas>
            </div>
            
            {/* Other Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              <div className="bg-white rounded-2xl shadow-xl p-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b-2">Unit Status Distribution</h2>
                <canvas ref={statusChartRef}></canvas>
              </div>
              
              <div className="bg-white rounded-2xl shadow-xl p-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b-2">Lease Expirations</h2>
                <canvas ref={leaseChartRef}></canvas>
              </div>
              
              <div className="bg-white rounded-2xl shadow-xl p-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b-2">Delinquency by Property</h2>
                <canvas ref={delinquencyChartRef}></canvas>
              </div>
            </div>
            
            {/* Property Stats Table */}
            <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b-2">Property Breakdown</h2>
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
                      <tr key={idx} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-2 font-medium">{prop.property}</td>
                        <td className="text-right py-3 px-2">{prop.totalUnits}</td>
                        <td className="text-right py-3 px-2">{prop.occupiedUnits}</td>
                        <td className="text-right py-3 px-2">
                          <span className={`px-2 py-1 rounded ${parseFloat(prop.occupancyRate) >= 90 ? 'bg-green-100 text-green-800' : parseFloat(prop.occupancyRate) >= 80 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
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
  );
}
