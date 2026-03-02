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
  balance_letter: {
    label: 'Balance Letter',
    color: 'bg-orange-500',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200'
  },
  notice: {
    label: 'Notice',
    color: 'bg-yellow-500',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200'
  },
  reservation_of_rights: {
    label: 'Reservation of Rights',
    color: 'bg-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200'
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

const STAGES = ['needs_contacted', 'balance_letter', 'notice', 'reservation_of_rights', 'eviction', 'current'];

// Locked stages that users cannot drag cards in/out of
// - 'eviction': Only units with status='Evict' in rent_roll_snapshots
// - 'current': Only units with balance <= 0
const LOCKED_STAGES = ['eviction', 'current'];

// Region definitions - matches rent-roll stats config
const REGION_PROPERTIES = {
  region_kansas_city: ['hilltop', 'oakwood', 'glen oaks', 'normandy', 'maple manor'],
};

const isKCProperty = (prop) => {
  return REGION_PROPERTIES.region_kansas_city.some(kc => prop?.toLowerCase().includes(kc));
};

// Contact button with hover tooltip
function ContactButton({ number, date, notes, onClick, formatDate }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const hasContact = !!date;

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onMouseEnter={() => hasContact && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`text-xs w-5 h-5 rounded-full flex items-center justify-center font-medium transition-colors ${
          hasContact
            ? 'bg-blue-500 text-white'
            : 'bg-white border border-slate-300 text-slate-400 hover:border-blue-400 hover:text-blue-500'
        }`}
        title={hasContact ? `Contact ${number}: ${formatDate(date)}` : `Log Contact ${number}`}
      >
        {number}
      </button>
      {showTooltip && hasContact && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-slate-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-50 max-w-48">
          <div className="font-medium">{formatDate(date)}</div>
          {notes && <div className="text-slate-300 truncate">{notes}</div>}
        </div>
      )}
    </div>
  );
}

// Compact card component for Kanban
function CollectionCard({ item, onDragStart, onDragEnd, onClick, onCall, onContactClick, getAgingBadge, formatCurrency, formatDate, isDragging }) {
  const aging = getAgingBadge(item);
  const isLocked = item.af_eviction || LOCKED_STAGES.includes(item.stage);

  const tenantUrl = item.occupancy_id
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
          <div className="flex items-center gap-0.5 justify-end">
            <span className={`${aging.color} text-white text-xs px-1 py-0.5 rounded`}>
              {aging.label}
            </span>
            {/* Notice type emblem */}
            {(item.stage === 'notice' || item.stage === 'reservation_of_rights') && item.stage_data?.notice_type && (
              <span className={`text-xs px-1 py-0.5 rounded font-semibold ${
                item.stage_data.notice_type === '3-day'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-orange-100 text-orange-700'
              }`}>
                {item.stage_data.notice_type === '3-day' ? '3-Day' : '10-Day'}
              </span>
            )}
          </div>
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
        {tenantUrl && (
          <a
            href={tenantUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200"
          >
            Tenant
          </a>
        )}
        {/* Contact buttons for needs_contacted, balance_letter, and notice cards */}
        {['needs_contacted', 'balance_letter', 'notice'].includes(item.stage) && onContactClick && (
          <div className="flex items-center gap-0.5 ml-auto">
            {[1, 2, 3].map(n => (
              <ContactButton
                key={n}
                number={n}
                date={item.stage_data?.[`contact_${n}_date`]}
                notes={item.stage_data?.[`contact_${n}_notes`]}
                onClick={() => onContactClick(item, n)}
                formatDate={formatDate}
              />
            ))}
          </div>
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
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [itemDetails, setItemDetails] = useState(null);
  const [noteInput, setNoteInput] = useState('');
  const [draggedItem, setDraggedItem] = useState(null);
  const [groupByProperty, setGroupByProperty] = useState(true);
  const [largeBalancesOnly, setLargeBalancesOnly] = useState(false);
  const [agingFilter, setAgingFilter] = useState('all'); // 'all', '0-30', '60-90', '90+'
  const [contactPrompt, setContactPrompt] = useState(null); // { item, contactNumber }
  const [contactNoteInput, setContactNoteInput] = useState('');
  const { makeCall } = useJustCall();

  useEffect(() => {
    fetchData();
  }, [selectedFilter]);

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
      // Only pass property param for specific property selections (not regions)
      if (selectedFilter !== 'all' && !selectedFilter.startsWith('region_')) {
        params.append('property', selectedFilter);
      }
      
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

  const fetchItemDetails = async (item) => {
    try {
      setDetailsLoading(true);
      const params = new URLSearchParams({
        occupancy_id: item.occupancy_id,
        property_name: item.property_name || '',
        unit: item.unit || ''
      });
      const res = await fetch(`/api/collections?${params}`);
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
    fetchItemDetails(item);
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

  const handleContactClick = (item, contactNumber) => {
    const dateField = `contact_${contactNumber}_date`;
    if (item.stage_data?.[dateField]) {
      // Already clicked - open detail modal to view notes
      openItemDetails(item);
      return;
    }
    // Open note prompt for new contact
    setContactPrompt({ item, contactNumber });
    setContactNoteInput('');
  };

  const saveContactNote = async (item, contactNumber, note) => {
    try {
      const dateField = `contact_${contactNumber}_date`;
      const notesField = `contact_${contactNumber}_notes`;

      await fetch('/api/collections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          occupancy_id: item.occupancy_id,
          [dateField]: new Date().toISOString(),
          [notesField]: note || ''
        })
      });

      setContactPrompt(null);
      setContactNoteInput('');
      await fetchData();
    } catch (err) {
      console.error('Error saving contact note:', err);
      alert('Failed to save contact note');
    }
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

  // Filter items by region selection, then by large balances if enabled
  let filteredItems = items;
  if (selectedFilter === 'region_kansas_city') {
    filteredItems = filteredItems.filter(item => isKCProperty(item.property_name));
  } else if (selectedFilter === 'region_columbia') {
    filteredItems = filteredItems.filter(item => !isKCProperty(item.property_name));
  }
  if (largeBalancesOnly) {
    filteredItems = filteredItems.filter(item => {
      const balance = parseFloat(item.amount_receivable || 0);
      const rent = parseFloat(item.rent || 0);
      return rent > 0 && balance > (rent / 4);
    });
  }
  if (agingFilter !== 'all') {
    filteredItems = filteredItems.filter(item => {
      const badge = getAgingBadge(item).label;
      return badge === agingFilter;
    });
  }

  // Group items by stage, then by property within each stage
  const itemsByStage = {};
  STAGES.forEach(stage => { itemsByStage[stage] = []; });
  filteredItems.forEach(item => {
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
                {filteredItems.length} accounts · {formatCurrency(filteredItems.reduce((sum, i) => sum + parseFloat(i.amount_receivable || 0), 0))} total
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
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={largeBalancesOnly}
                  onChange={(e) => setLargeBalancesOnly(e.target.checked)}
                  className="rounded"
                />
                Large Balances Only
              </label>
              <div className="flex items-center border border-slate-300 rounded overflow-hidden text-xs">
                {[
                  { value: 'all', label: 'All' },
                  { value: '0-30', label: '0-30' },
                  { value: '60-90', label: '60-90' },
                  { value: '90+', label: '90+' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setAgingFilter(opt.value)}
                    className={`px-2 py-1 transition-colors ${
                      agingFilter === opt.value
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-50'
                    } ${opt.value !== 'all' ? 'border-l border-slate-300' : ''}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <select
                value={selectedFilter}
                onChange={(e) => setSelectedFilter(e.target.value)}
                className="px-2 py-1 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="all">Portfolio</option>
                <optgroup label="Regions">
                  <option value="region_kansas_city">Kansas City</option>
                  <option value="region_columbia">Columbia</option>
                </optgroup>
                <optgroup label="Properties">
                  {properties.map(prop => (
                    <option key={prop} value={prop}>{prop}</option>
                  ))}
                </optgroup>
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
        <div className="grid grid-cols-6 gap-2" style={{ minHeight: 'calc(100vh - 180px)' }}>
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
                              onContactClick={handleContactClick}
                              getAgingBadge={getAgingBadge}
                              formatCurrency={formatCurrency}
                              formatDate={formatDate}
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
                        onContactClick={handleContactClick}
                        getAgingBadge={getAgingBadge}
                        formatCurrency={formatCurrency}
                        formatDate={formatDate}
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

                  {/* Transactions - Last 3 months, separate charge/payment rows */}
                  {itemDetails?.transactions && itemDetails.transactions.length > 0 && (
                    <div className="bg-slate-50 rounded-lg p-4 mb-4">
                      <h3 className="font-semibold text-slate-800 mb-2">Transactions (Last 3 Months)</h3>
                      <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-100 sticky top-0">
                            <tr>
                              <th className="text-left py-1 px-2 font-medium text-slate-600">Date</th>
                              <th className="text-left py-1 px-2 font-medium text-slate-600">Payer</th>
                              <th className="text-left py-1 px-2 font-medium text-slate-600">Description</th>
                              <th className="text-right py-1 px-2 font-medium text-slate-600">Charges</th>
                              <th className="text-right py-1 px-2 font-medium text-slate-600">Payments</th>
                            </tr>
                          </thead>
                          <tbody>
                            {itemDetails.transactions.map((txn, idx) => (
                              <tr key={idx} className="border-b border-slate-200 last:border-0">
                                <td className="py-1 px-2 text-slate-500 whitespace-nowrap">{txn.date}</td>
                                <td className="py-1 px-2 text-slate-600">{txn.payer || ''}</td>
                                <td className="py-1 px-2 text-slate-700">{txn.description}</td>
                                <td className="py-1 px-2 text-right text-red-600">
                                  {txn.type === 'charge' ? `$${txn.amount.toFixed(2)}` : ''}
                                </td>
                                <td className="py-1 px-2 text-right text-green-600">
                                  {txn.type === 'payment' ? `$${txn.amount.toFixed(2)}` : ''}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Outstanding by GL Account */}
                  {itemDetails?.glBreakdown && itemDetails.glBreakdown.length > 0 && (
                    <div className="bg-slate-50 rounded-lg p-4 mb-4">
                      <h3 className="font-semibold text-slate-800 mb-2">Outstanding by Account</h3>
                      <div className="space-y-2">
                        {itemDetails.glBreakdown.map((gl, idx) => (
                          <div key={idx} className="flex justify-between items-center text-sm">
                            <div>
                              <span className="font-medium text-slate-700">{gl.account_name}</span>
                              <span className="text-slate-400 text-xs ml-2">({gl.account_number})</span>
                            </div>
                            <span className={`font-semibold ${gl.outstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              ${gl.outstanding.toFixed(2)}
                            </span>
                          </div>
                        ))}
                        <div className="border-t pt-2 mt-2 flex justify-between items-center font-semibold">
                          <span className="text-slate-800">Total Outstanding</span>
                          <span className="text-red-600">
                            ${itemDetails.glBreakdown.reduce((sum, gl) => sum + gl.outstanding, 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {selectedItem.af_eviction && (
                    <div className="flex items-center gap-2 p-2 bg-purple-100 rounded mb-4">
                      <span className="text-purple-600">🔒</span>
                      <span className="text-purple-700 text-sm font-medium">
                        Locked - Eviction Status in AppFolio
                      </span>
                    </div>
                  )}

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
                        {[1, 2, 3].map(n => {
                          const date = itemDetails.stage[`contact_${n}_date`];
                          const notes = itemDetails.stage[`contact_${n}_notes`];
                          if (!date) return null;
                          return (
                            <div key={n}>
                              <div className="flex justify-between">
                                <span className="text-slate-600">Contact {n}:</span>
                                <span>{formatDate(date)}</span>
                              </div>
                              {notes && (
                                <div className="text-xs text-slate-500 pl-4">{notes}</div>
                              )}
                            </div>
                          );
                        })}
                        {itemDetails.stage.balance_letter_entered_at && (
                          <div className="flex justify-between">
                            <span className="text-slate-600">Balance Letter:</span>
                            <span>{formatDate(itemDetails.stage.balance_letter_entered_at)}</span>
                          </div>
                        )}
                        {itemDetails.stage.notice_entered_at && (
                          <div className="flex justify-between">
                            <span className="text-slate-600">
                              Notice ({itemDetails.stage.notice_type || 'N/A'}):
                            </span>
                            <span>{formatDate(itemDetails.stage.notice_entered_at)}</span>
                          </div>
                        )}
                        {itemDetails.stage.reservation_of_rights_entered_at && (
                          <div className="flex justify-between">
                            <span className="text-slate-600">Reservation of Rights:</span>
                            <span>{formatDate(itemDetails.stage.reservation_of_rights_entered_at)}</span>
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

                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Contact Note Prompt */}
      {contactPrompt && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setContactPrompt(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-slate-800 mb-1">
              Contact {contactPrompt.contactNumber}
            </h3>
            <p className="text-sm text-slate-500 mb-3">
              {contactPrompt.item.name} - Unit {contactPrompt.item.unit}
            </p>
            <textarea
              value={contactNoteInput}
              onChange={(e) => setContactNoteInput(e.target.value)}
              placeholder="Enter note about this contact..."
              className="w-full border border-slate-300 rounded-lg p-2 text-sm resize-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              rows={3}
              autoFocus
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setContactPrompt(null)}
                className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => saveContactNote(contactPrompt.item, contactPrompt.contactNumber, contactNoteInput)}
                className="flex-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <JustCallDialer />
    </div>
  );
}
