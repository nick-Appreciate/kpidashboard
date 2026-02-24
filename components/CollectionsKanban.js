'use client';

import { useState, useEffect, useRef } from 'react';
import { LogoLoader } from './Logo';
import JustCallDialer, { useJustCall } from './JustCallDialer';

const STAGE_CONFIG = {
  needs_contacted: { 
    label: 'Needs Contacted', 
    color: 'bg-red-500', 
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200'
  },
  contact_1: { 
    label: 'Contact 1', 
    color: 'bg-orange-500', 
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200'
  },
  contact_2: { 
    label: 'Contact 2', 
    color: 'bg-yellow-500', 
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200'
  },
  eviction: { 
    label: 'Eviction', 
    color: 'bg-purple-500', 
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200'
  },
  current: { 
    label: 'Current', 
    color: 'bg-green-500', 
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200'
  }
};

const STAGES = ['needs_contacted', 'contact_1', 'contact_2', 'eviction', 'current'];

// Locked stages that users cannot drag cards in/out of
// - 'eviction': Only units with status='Evict' in rent_roll_snapshots
// - 'current': Only units with balance <= 0
const LOCKED_STAGES = ['eviction', 'current'];

// Compact card component for Kanban
function CollectionCard({ item, onDragStart, onDragEnd, onClick, onCall, getAgingBadge, formatCurrency, isDragging }) {
  const aging = getAgingBadge(item);
  // Lock cards in eviction (if af_eviction) OR in paid stage
  const isLocked = item.af_eviction || LOCKED_STAGES.includes(item.stage);
  
  // AppFolio URLs using exact format provided:
  // https://appreciateinc.appfolio.com/occupancies/{occupancy_id}/selected_tenant/{tenant_id}ledger
  // Fallback to occupancy page if no tenant_id
  const ledgerUrl = item.occupancy_id
    ? (item.tenant_id 
        ? `https://appreciateinc.appfolio.com/occupancies/${item.occupancy_id}/selected_tenant/${item.tenant_id}ledger`
        : `https://appreciateinc.appfolio.com/occupancies/${item.occupancy_id}`)
    : null;
  
  return (
    <div
      draggable={!isLocked}
      onDragStart={(e) => !isLocked && onDragStart(e, item)}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`bg-white rounded shadow-sm border p-2 transition-all mb-1 ${
        isLocked 
          ? (item.stage === 'current' ? 'border-green-300 bg-green-50' : 'border-purple-300 bg-purple-50') + ' cursor-not-allowed' 
          : 'border-slate-200 cursor-grab hover:shadow-md hover:border-slate-300'
      } ${isDragging ? 'opacity-50 ring-2 ring-indigo-400' : ''}`}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-slate-800 text-xs truncate">
            {item.name || 'Unknown'}
          </div>
          <div className="text-xs text-slate-500 truncate">
            Unit {item.unit}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-bold text-slate-900 text-sm">
            {formatCurrency(item.amount_receivable)}
          </div>
          <span className={`${aging.color} text-white text-xs px-1 py-0.5 rounded`}>
            {aging.label}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 mt-1">
        {item.phone_numbers && (
          <button
            onClick={(e) => { e.stopPropagation(); onCall(item); }}
            className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded hover:bg-green-200"
          >
            📞
          </button>
        )}
        {ledgerUrl && (
          <a
            href={ledgerUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200"
          >
            AppFolio
          </a>
        )}
        {isLocked && (
          <span className={`text-xs ml-auto ${item.stage === 'current' ? 'text-green-600' : 'text-purple-600'}`}>🔒</span>
        )}
      </div>
    </div>
  );
}

export default function CollectionsKanban() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProperty, setSelectedProperty] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [itemDetails, setItemDetails] = useState(null);
  const [noteInput, setNoteInput] = useState('');
  const [draggedItem, setDraggedItem] = useState(null);
  const [groupByProperty, setGroupByProperty] = useState(true);
  const { makeCall } = useJustCall();

  useEffect(() => {
    fetchData();
  }, [selectedProperty]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && selectedItem) {
        setSelectedItem(null);
        setItemDetails(null);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [selectedItem]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedProperty !== 'all') params.append('property', selectedProperty);
      
      const res = await fetch(`/api/collections?${params}`);
      const result = await res.json();
      
      if (result.error) throw new Error(result.error);
      
      setData(result);
      setError(null);
    } catch (err) {
      console.error('Error fetching collections:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchItemDetails = async (occupancyId) => {
    try {
      setDetailsLoading(true);
      const res = await fetch(`/api/collections?occupancy_id=${occupancyId}`);
      const result = await res.json();
      setItemDetails(result);
    } catch (err) {
      console.error('Error fetching details:', err);
    } finally {
      setDetailsLoading(false);
    }
  };

  const updateStage = async (occupancyId, newStage, notes = '') => {
    try {
      const res = await fetch('/api/collections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ occupancy_id: occupancyId, stage: newStage, notes })
      });
      
      if (!res.ok) throw new Error('Failed to update stage');
      
      // Refresh data
      await fetchData();
      setNoteInput('');
    } catch (err) {
      console.error('Error updating stage:', err);
      alert('Failed to update stage');
    }
  };

  const openItemDetails = (item) => {
    setSelectedItem(item);
    fetchItemDetails(item.occupancy_id);
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
      day: 'numeric'
    });
  };

  const formatPhoneForJustCall = (phone) => {
    if (!phone) return null;
    let cleaned = phone.replace(/[^\d+]/g, '');
    if (!cleaned.startsWith('+')) {
      if (cleaned.startsWith('1') && cleaned.length === 11) {
        cleaned = '+' + cleaned;
      } else {
        cleaned = '+1' + cleaned;
      }
    }
    return cleaned;
  };

  const handleCall = (item) => {
    const phone = formatPhoneForJustCall(item.phone_numbers);
    if (!phone) {
      alert('No phone number available');
      return;
    }
    makeCall(phone, item.name || 'Unknown');
  };

  const getAgingBadge = (item) => {
    if (parseFloat(item.days_90_plus || 0) > 0) return { label: '90+', color: 'bg-red-600' };
    if (parseFloat(item.days_60_to_90 || 0) > 0) return { label: '60-90', color: 'bg-orange-500' };
    if (parseFloat(item.days_30_to_60 || 0) > 0) return { label: '30-60', color: 'bg-yellow-500' };
    return { label: '0-30', color: 'bg-blue-500' };
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
      <div className="min-h-screen bg-slate-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 max-w-md">
          <p className="text-red-600 mb-4">Error: {error}</p>
          <button onClick={fetchData} className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { items = [], summary = {}, properties = [] } = data || {};

  // Drag and drop handlers
  const handleDragStart = (e, item) => {
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e, targetStage) => {
    e.preventDefault();
    
    // Prevent dropping into locked stages
    if (LOCKED_STAGES.includes(targetStage)) {
      setDraggedItem(null);
      return;
    }
    
    if (draggedItem && draggedItem.stage !== targetStage) {
      await updateStage(draggedItem.occupancy_id, targetStage);
    }
    setDraggedItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };

  // Group items by stage, then by property within each stage
  const itemsByStage = {};
  STAGES.forEach(stage => { itemsByStage[stage] = []; });
  items.forEach(item => {
    if (itemsByStage[item.stage]) {
      itemsByStage[item.stage].push(item);
    }
  });

  // Sort each stage by property then amount
  STAGES.forEach(stage => {
    itemsByStage[stage].sort((a, b) => {
      if (groupByProperty) {
        const propCompare = (a.property_name || '').localeCompare(b.property_name || '');
        if (propCompare !== 0) return propCompare;
      }
      return parseFloat(b.amount_receivable || 0) - parseFloat(a.amount_receivable || 0);
    });
  });

  // Get unique properties in a stage for grouping
  const getPropertiesInStage = (stageItems) => {
    const props = [...new Set(stageItems.map(i => i.property_name))].sort();
    return props;
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="max-w-full mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">💰 Collections</h1>
              <p className="text-sm text-slate-500">
                {summary.totalAccounts} accounts · {formatCurrency(summary.totalReceivable)} total
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={groupByProperty}
                  onChange={(e) => setGroupByProperty(e.target.checked)}
                  className="rounded"
                />
                Group by Property
              </label>
              <select
                value={selectedProperty}
                onChange={(e) => setSelectedProperty(e.target.value)}
                className="px-2 py-1 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="all">All Properties</option>
                {properties.map(prop => (
                  <option key={prop} value={prop}>{prop}</option>
                ))}
              </select>
              <button
                onClick={fetchData}
                disabled={loading}
                className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-sm hover:bg-slate-200"
              >
                ↻
              </button>
            </div>
          </div>
        </div>

        {/* Kanban Board */}
        <div className="grid grid-cols-5 gap-2" style={{ minHeight: 'calc(100vh - 180px)' }}>
          {STAGES.map(stage => {
            const config = STAGE_CONFIG[stage];
            const stageItems = itemsByStage[stage];
            const stageTotal = stageItems.reduce((sum, i) => sum + parseFloat(i.amount_receivable || 0), 0);
            const stageProperties = groupByProperty ? getPropertiesInStage(stageItems) : [];
            
            const isLockedStage = LOCKED_STAGES.includes(stage);
            
            return (
              <div 
                key={stage}
                className={`${config.bgColor} rounded-lg border ${config.borderColor} flex flex-col min-w-0 ${isLockedStage ? 'opacity-90' : ''}`}
                onDragOver={isLockedStage ? undefined : handleDragOver}
                onDrop={isLockedStage ? undefined : (e) => handleDrop(e, stage)}
              >
                {/* Column Header */}
                <div className={`${config.color} text-white px-2 py-1.5 rounded-t-lg`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs">
                      {config.label}
                      {isLockedStage && <span className="ml-1">🔒</span>}
                    </span>
                    <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded-full">
                      {stageItems.length}
                    </span>
                  </div>
                  <div className="text-xs opacity-90">
                    {formatCurrency(stageTotal)}
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                  {stageItems.length === 0 ? (
                    <div className="text-center text-slate-400 text-xs py-4">
                      {isLockedStage ? 'Auto-populated' : 'Drop here'}
                    </div>
                  ) : groupByProperty ? (
                    stageProperties.map(propName => {
                      const propItems = stageItems.filter(i => i.property_name === propName);
                      return (
                        <div key={propName} className="mb-2">
                          <div className="text-xs font-medium text-slate-600 px-1 py-0.5 bg-white/50 rounded mb-1 truncate" title={propName}>
                            {propName} ({propItems.length})
                          </div>
                          {propItems.map(item => (
                            <CollectionCard
                              key={item.occupancy_id}
                              item={item}
                              onDragStart={handleDragStart}
                              onDragEnd={handleDragEnd}
                              onClick={() => openItemDetails(item)}
                              onCall={handleCall}
                              getAgingBadge={getAgingBadge}
                              formatCurrency={formatCurrency}
                              isDragging={draggedItem?.occupancy_id === item.occupancy_id}
                            />
                          ))}
                        </div>
                      );
                    })
                  ) : (
                    stageItems.map(item => (
                      <CollectionCard
                        key={item.occupancy_id}
                        item={item}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onClick={() => openItemDetails(item)}
                        onCall={handleCall}
                        getAgingBadge={getAgingBadge}
                        formatCurrency={formatCurrency}
                        isDragging={draggedItem?.occupancy_id === item.occupancy_id}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedItem && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => { setSelectedItem(null); setItemDetails(null); }}
        >
          <div 
            className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className={`${STAGE_CONFIG[selectedItem.stage].color} text-white p-4`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">{selectedItem.name}</h2>
                  <p className="text-sm opacity-90">
                    {selectedItem.property_name} · Unit {selectedItem.unit}
                  </p>
                </div>
                <button 
                  onClick={() => { setSelectedItem(null); setItemDetails(null); }}
                  className="text-white/80 hover:text-white text-2xl"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 120px)' }}>
              {detailsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
              ) : (
                <>
                  {/* Key Metrics */}
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-slate-800">
                        {formatCurrency(selectedItem.amount_receivable)}
                      </div>
                      <div className="text-xs text-slate-500">Balance Due</div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-slate-800">
                        {formatCurrency(selectedItem.rent)}
                      </div>
                      <div className="text-xs text-slate-500">Monthly Rent</div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-slate-800">
                        {selectedItem.balance_over_rent}x
                      </div>
                      <div className="text-xs text-slate-500">Months Behind</div>
                    </div>
                  </div>

                  {/* Contact Info */}
                  <div className="bg-slate-50 rounded-lg p-4 mb-4">
                    <h3 className="font-semibold text-slate-800 mb-2">Contact Info</h3>
                    <div className="space-y-2 text-sm">
                      {selectedItem.phone_numbers && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">📞</span>
                          <button
                            onClick={() => handleCall(selectedItem)}
                            className="text-indigo-600 hover:underline"
                          >
                            {selectedItem.phone_numbers}
                          </button>
                        </div>
                      )}
                      {selectedItem.primary_tenant_email && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">✉️</span>
                          <a 
                            href={`mailto:${selectedItem.primary_tenant_email}`}
                            className="text-indigo-600 hover:underline"
                          >
                            {selectedItem.primary_tenant_email}
                          </a>
                        </div>
                      )}
                      {selectedItem.occupancy_id && (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500">🔗</span>
                            <a 
                              href={`https://appreciateinc.appfolio.com/occupancies/${selectedItem.occupancy_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 hover:underline"
                            >
                              View Occupancy
                            </a>
                          </div>
                          {selectedItem.tenant_id && (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500">📄</span>
                              <a 
                                href={`https://appreciateinc.appfolio.com/occupancies/${selectedItem.occupancy_id}/selected_tenant/${selectedItem.tenant_id}ledger`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-indigo-600 hover:underline"
                              >
                                View Tenant Ledger
                              </a>
                            </div>
                          )}
                        </>
                      )}
                      {selectedItem.af_eviction && (
                        <div className="flex items-center gap-2 mt-2 p-2 bg-purple-100 rounded">
                          <span className="text-purple-600">🔒</span>
                          <span className="text-purple-700 text-sm font-medium">
                            Locked - Eviction Status in AppFolio
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Aging Breakdown */}
                  <div className="bg-slate-50 rounded-lg p-4 mb-4">
                    <h3 className="font-semibold text-slate-800 mb-2">Aging Breakdown</h3>
                    <div className="grid grid-cols-4 gap-2 text-sm">
                      <div className="text-center">
                        <div className="font-semibold text-blue-600">
                          {formatCurrency(selectedItem.days_0_to_30)}
                        </div>
                        <div className="text-xs text-slate-500">0-30 days</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold text-yellow-600">
                          {formatCurrency(selectedItem.days_30_to_60)}
                        </div>
                        <div className="text-xs text-slate-500">30-60 days</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold text-orange-600">
                          {formatCurrency(selectedItem.days_60_to_90)}
                        </div>
                        <div className="text-xs text-slate-500">60-90 days</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold text-red-600">
                          {formatCurrency(selectedItem.days_90_plus)}
                        </div>
                        <div className="text-xs text-slate-500">90+ days</div>
                      </div>
                    </div>
                  </div>

                  {/* Stage History */}
                  {itemDetails?.stage && (
                    <div className="bg-slate-50 rounded-lg p-4 mb-4">
                      <h3 className="font-semibold text-slate-800 mb-2">Collection History</h3>
                      <div className="space-y-2 text-sm">
                        {itemDetails.stage.contact_1_date && (
                          <div className="flex justify-between">
                            <span className="text-slate-600">Contact 1:</span>
                            <span>{formatDate(itemDetails.stage.contact_1_date)}</span>
                          </div>
                        )}
                        {itemDetails.stage.contact_1_notes && (
                          <div className="text-xs text-slate-500 pl-4">
                            {itemDetails.stage.contact_1_notes}
                          </div>
                        )}
                        {itemDetails.stage.contact_2_date && (
                          <div className="flex justify-between">
                            <span className="text-slate-600">Contact 2:</span>
                            <span>{formatDate(itemDetails.stage.contact_2_date)}</span>
                          </div>
                        )}
                        {itemDetails.stage.contact_2_notes && (
                          <div className="text-xs text-slate-500 pl-4">
                            {itemDetails.stage.contact_2_notes}
                          </div>
                        )}
                        {itemDetails.stage.eviction_started_at && (
                          <div className="flex justify-between">
                            <span className="text-slate-600">Eviction Started:</span>
                            <span>{formatDate(itemDetails.stage.eviction_started_at)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Payment History */}
                  {itemDetails?.ledger && itemDetails.ledger.length > 0 && (
                    <div className="bg-slate-50 rounded-lg p-4 mb-4">
                      <h3 className="font-semibold text-slate-800 mb-2">Recent Transactions</h3>
                      <div className="space-y-1 text-sm max-h-48 overflow-y-auto">
                        {itemDetails.ledger.map((entry, idx) => (
                          <div key={idx} className="flex justify-between py-1 border-b border-slate-200 last:border-0">
                            <div className="flex-1">
                              <span className="text-slate-600">{formatDate(entry.date)}</span>
                              <span className="text-slate-400 mx-2">·</span>
                              <span className="text-slate-700 truncate">{entry.description}</span>
                            </div>
                            <div className={entry.credit ? 'text-green-600' : 'text-red-600'}>
                              {entry.credit ? '+' : ''}{formatCurrency(entry.credit ? entry.credit : -(entry.debit || 0))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Stage Actions */}
                  <div className="border-t border-slate-200 pt-4">
                    <h3 className="font-semibold text-slate-800 mb-3">Move to Stage</h3>
                    <div className="flex flex-wrap gap-2">
                      {STAGES.filter(s => s !== selectedItem.stage).map(stage => (
                        <button
                          key={stage}
                          onClick={() => {
                            updateStage(selectedItem.occupancy_id, stage, noteInput);
                            setSelectedItem(null);
                            setItemDetails(null);
                          }}
                          className={`px-4 py-2 rounded-lg text-white text-sm font-medium ${STAGE_CONFIG[stage].color} hover:opacity-90`}
                        >
                          {STAGE_CONFIG[stage].label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      placeholder="Add a note (optional)..."
                      className="w-full mt-3 px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none"
                      rows={2}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <JustCallDialer />
    </div>
  );
}
