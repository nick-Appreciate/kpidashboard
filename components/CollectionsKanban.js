'use client';

import { useState, useEffect, useRef } from 'react';
import { LogoLoader } from './Logo';
import JustCallDialer, { useJustCall } from './JustCallDialer';
import DarkSelect from './DarkSelect';

const PhoneIcon = ({ className = "h-3 w-3" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const LockIcon = ({ className = "h-3 w-3" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
  </svg>
);

// Alternating teal / dark column scheme
// teal columns: teal header + teal-tinted bg, dark cards
// dark columns: dark header + dark bg, teal-tinted cards
const STAGE_CONFIG = {
  needs_contacted: { label: 'Needs Contacted', variant: 'teal' },
  balance_letter:  { label: 'Balance Letter',  variant: 'dark' },
  notice:          { label: 'Notice',          variant: 'teal' },
  reservation_of_rights: { label: 'Reservation of Rights', variant: 'dark' },
  eviction:        { label: 'Eviction',        variant: 'teal' },
  current:         { label: 'Current',         variant: 'dark' },
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
            : 'bg-surface-raised border border-[var(--glass-border)] text-slate-500 hover:border-blue-400 hover:text-blue-400'
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
function CollectionCard({ item, variant, onDragStart, onDragEnd, onClick, onCall, onContactClick, getAgingBadge, formatCurrency, formatDate, isDragging }) {
  const aging = getAgingBadge(item);
  const isLocked = item.af_eviction || LOCKED_STAGES.includes(item.stage);

  // Card colors: dark cards in teal columns, teal-tinted cards in dark columns
  const cardBase = variant === 'dark'
    ? 'bg-accent/10 border-accent/15'
    : 'bg-surface-raised/80 border-[var(--glass-border)]';
  const cardHover = variant === 'dark'
    ? 'hover:border-accent/30'
    : 'hover:border-[var(--glass-border-hover)]';

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
      className={`rounded border p-2 transition-all mb-1 ${
        isLocked
          ? `${cardBase} cursor-not-allowed opacity-80`
          : `${cardBase} cursor-grab ${cardHover}`
      } ${isDragging ? 'opacity-50 ring-2 ring-accent' : ''}`}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-slate-100 text-xs truncate">
            {item.name || 'Unknown'}
          </div>
          <div className="text-xs text-slate-400 truncate">
            Unit {item.unit}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-bold text-slate-100 text-sm">
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
                  ? 'bg-red-500/15 text-red-400'
                  : 'bg-orange-500/15 text-orange-400'
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
            className="text-xs px-1.5 py-0.5 bg-green-500/15 text-green-400 rounded hover:bg-green-500/25 inline-flex items-center gap-0.5"
          >
            <PhoneIcon />
          </button>
        )}
        {tenantUrl && (
          <a
            href={tenantUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs px-1.5 py-0.5 bg-accent/15 text-accent rounded hover:bg-accent/25"
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
          <span className={`text-xs ml-auto ${item.stage === 'current' ? 'text-green-400' : 'text-purple-400'}`}>
            <LockIcon />
          </span>
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
  const [sortByBalance, setSortByBalance] = useState(false);
  const [agingFilter, setAgingFilter] = useState('all'); // 'all', '0-30', '60-90', '90+'
  const [contactPrompt, setContactPrompt] = useState(null); // { item, contactNumber }
  const [contactNoteInput, setContactNoteInput] = useState('');
  const [dragOverStage, setDragOverStage] = useState(null);
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
      <div className="min-h-screen flex items-center justify-center">
        <LogoLoader text="Loading collections..." />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen p-6 flex items-center justify-center">
        <div className="glass-card p-8 max-w-md">
          <p className="text-red-400 mb-4">Error: {error}</p>
          <button onClick={fetchData} className="w-full btn-accent py-2 px-4 rounded-lg">
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

  const handleDragOver = (e, stage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (stage && dragOverStage !== stage) setDragOverStage(stage);
  };

  const handleDragLeave = (e, stage) => {
    // Only clear if actually leaving the column (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverStage(null);
    }
  };

  const handleDrop = async (e, targetStage) => {
    e.preventDefault();
    setDragOverStage(null);

    // Prevent dropping into locked stages
    if (LOCKED_STAGES.includes(targetStage)) {
      setDraggedItem(null);
      return;
    }

    if (draggedItem && draggedItem.stage !== targetStage) {
      const movedItem = draggedItem;
      const previousStage = movedItem.stage;

      // Optimistic update — move card instantly in local state
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map(item =>
            item.occupancy_id === movedItem.occupancy_id
              ? { ...item, stage: targetStage }
              : item
          ),
        };
      });
      setDraggedItem(null);

      // Sync with backend in background
      try {
        const res = await fetch('/api/collections', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ occupancy_id: movedItem.occupancy_id, stage: targetStage, notes: '' })
        });
        if (!res.ok) throw new Error('Failed to update stage');
      } catch (err) {
        console.error('Error updating stage:', err);
        // Revert on failure
        setData(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map(item =>
              item.occupancy_id === movedItem.occupancy_id
                ? { ...item, stage: previousStage }
                : item
            ),
          };
        });
      }
      return;
    }
    setDraggedItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverStage(null);
  };

  // Filter items by region selection, then by large balances if enabled
  let filteredItems = items;
  if (selectedFilter === 'region_kansas_city') {
    filteredItems = filteredItems.filter(item => isKCProperty(item.property_name));
  } else if (selectedFilter === 'region_columbia') {
    filteredItems = filteredItems.filter(item => !isKCProperty(item.property_name));
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

  // Sort each stage: either by balance (high→low) or grouped by property
  STAGES.forEach(stage => {
    if (sortByBalance) {
      itemsByStage[stage].sort((a, b) =>
        parseFloat(b.amount_receivable || 0) - parseFloat(a.amount_receivable || 0)
      );
    } else {
      itemsByStage[stage].sort((a, b) => {
        const propCompare = (a.property_name || '').localeCompare(b.property_name || '');
        if (propCompare !== 0) return propCompare;
        return parseFloat(b.amount_receivable || 0) - parseFloat(a.amount_receivable || 0);
      });
    }
  });

  // Get unique properties in a stage for grouping
  const getPropertiesInStage = (stageItems) => {
    const props = [...new Set(stageItems.map(i => i.property_name))].sort();
    return props;
  };

  // Build DarkSelect options for property filter
  const propertyOptions = [
    { value: 'all', label: 'Portfolio' },
    { group: 'Regions', options: [
      { value: 'region_kansas_city', label: 'Kansas City' },
      { value: 'region_columbia', label: 'Columbia' },
    ]},
    { group: 'Properties', options: properties.map(prop => ({
      value: prop, label: prop,
    }))},
  ];

  return (
    <div className="h-screen p-4 flex flex-col overflow-hidden">
      <div className="max-w-full mx-auto flex flex-col flex-1 min-h-0 w-full">
        {/* Header */}
        <div className="bg-[rgba(10,14,26,0.92)] backdrop-blur-[16px] rounded-lg border border-[var(--glass-border)] flex-shrink-0 mb-2">
          <div className="flex items-center gap-4 h-10 px-4">
            <h1 className="text-sm font-semibold text-slate-100 whitespace-nowrap">Collections</h1>
            <span className="text-xs text-slate-400">
              {filteredItems.length} accounts · {formatCurrency(filteredItems.reduce((sum, i) => sum + parseFloat(i.amount_receivable || 0), 0))} total
            </span>
            <div className="flex items-center gap-2 flex-1 justify-end">
              <button
                onClick={() => setSortByBalance(!sortByBalance)}
                className={`text-xs px-2 py-1 rounded transition-colors ${
                  sortByBalance
                    ? 'bg-accent text-surface-base'
                    : 'bg-white/5 text-slate-400 hover:bg-white/10'
                }`}
              >
                Sort $
              </button>
              <div className="flex rounded-lg border border-[var(--glass-border)] overflow-hidden h-[26px]">
                {[
                  { value: 'all', label: 'All' },
                  { value: '0-30', label: '0-30' },
                  { value: '60-90', label: '60-90' },
                  { value: '90+', label: '90+' },
                ].map((opt, idx) => (
                  <button
                    key={opt.value}
                    onClick={() => setAgingFilter(opt.value)}
                    className={`px-2 text-[11px] font-medium transition-colors ${
                      agingFilter === opt.value
                        ? 'bg-accent text-surface-base'
                        : 'bg-white/5 text-slate-400 hover:bg-white/10'
                    } ${idx > 0 ? 'border-l border-[var(--glass-border)]' : ''}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <DarkSelect
                value={selectedFilter}
                onChange={setSelectedFilter}
                options={propertyOptions}
                compact
                className="w-36"
              />
              <button
                onClick={fetchData}
                disabled={loading}
                className="text-xs text-slate-500 hover:text-accent transition-colors"
              >
                {loading ? '...' : '\u21BB'}
              </button>
            </div>
          </div>
        </div>

        {/* Column Headers — pinned row */}
        <div className="grid grid-cols-6 gap-2 flex-shrink-0">
          {STAGES.map(stage => {
            const config = STAGE_CONFIG[stage];
            const stageItems = itemsByStage[stage];
            const stageTotal = stageItems.reduce((sum, i) => sum + parseFloat(i.amount_receivable || 0), 0);
            const isLockedStage = LOCKED_STAGES.includes(stage);
            const isTeal = config.variant === 'teal';
            const headerBg = isTeal ? 'bg-accent' : 'bg-surface-raised';
            const headerText = isTeal ? 'text-surface-base' : 'text-accent-light';
            const countBadge = isTeal ? 'bg-white/20 text-surface-base' : 'bg-accent/15 text-accent';

            return (
              <div key={stage} className={`${headerBg} ${headerText} px-2 py-1.5 rounded-lg`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs">
                    {config.label}
                    {isLockedStage && <LockIcon className="h-3 w-3 inline ml-1" />}
                  </span>
                  <span className={`text-xs ${countBadge} px-1.5 py-0.5 rounded-full`}>
                    {stageItems.length}
                  </span>
                </div>
                <div className="text-xs opacity-80">
                  {formatCurrency(stageTotal)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Kanban Board — unified scroll for all columns */}
        <div className="flex-1 overflow-y-auto dark-scrollbar min-h-0 mt-2">
          <div className="grid grid-cols-6 gap-2 min-h-full">
            {STAGES.map(stage => {
              const config = STAGE_CONFIG[stage];
              const stageItems = itemsByStage[stage];
              const stageProperties = getPropertiesInStage(stageItems);
              const isLockedStage = LOCKED_STAGES.includes(stage);
              const isTeal = config.variant === 'teal';
              const colBg = isTeal ? 'bg-accent/[0.06]' : 'bg-white/[0.03]';
              const isDragTarget = dragOverStage === stage && !isLockedStage && draggedItem?.stage !== stage;

              return (
                <div
                  key={stage}
                  className={`${colBg} rounded-lg p-1.5 space-y-1 min-w-0 transition-colors ${isLockedStage ? 'opacity-90' : ''} ${isDragTarget ? 'ring-2 ring-accent/50 bg-accent/[0.12]' : ''}`}
                  onDragOver={isLockedStage ? undefined : (e) => handleDragOver(e, stage)}
                  onDragLeave={isLockedStage ? undefined : (e) => handleDragLeave(e, stage)}
                  onDrop={isLockedStage ? undefined : (e) => handleDrop(e, stage)}
                >
                  {stageItems.length === 0 ? (
                    <div className={`text-center text-xs py-4 ${isDragTarget ? 'text-accent' : 'text-slate-500'}`}>
                      {isLockedStage ? 'Auto-populated' : 'Drop here'}
                    </div>
                  ) : sortByBalance ? (
                    stageItems.map(item => (
                      <CollectionCard
                        key={item.occupancy_id}
                        item={item}
                        variant={config.variant}
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
                  ) : (
                    stageProperties.map(propName => {
                      const propItems = stageItems.filter(i => i.property_name === propName);
                      return (
                        <div key={propName} className="mb-2">
                          <div className="text-xs font-medium text-slate-400 px-1 py-0.5 bg-white/5 rounded mb-1 truncate" title={propName}>
                            {propName} ({propItems.length})
                          </div>
                          {propItems.map(item => (
                            <CollectionCard
                              key={item.occupancy_id}
                              item={item}
                              variant={config.variant}
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
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedItem && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => { setSelectedItem(null); setItemDetails(null); }}
        >
          <div
            className="glass-card max-w-2xl w-full max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className={`${STAGE_CONFIG[selectedItem.stage].variant === 'teal' ? 'bg-accent' : 'bg-surface-raised'} ${STAGE_CONFIG[selectedItem.stage].variant === 'teal' ? 'text-white' : 'text-accent-light'} p-4`}>
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
            <div className="p-4 overflow-y-auto dark-scrollbar" style={{ maxHeight: 'calc(90vh - 120px)' }}>
              {detailsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
                </div>
              ) : (
                <>
                  {/* Key Metrics */}
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-white/5 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-slate-100">
                        {formatCurrency(selectedItem.amount_receivable)}
                      </div>
                      <div className="text-xs text-slate-400">Balance Due</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-slate-100">
                        {formatCurrency(selectedItem.rent)}
                      </div>
                      <div className="text-xs text-slate-400">Monthly Rent</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-slate-100">
                        {selectedItem.balance_over_rent}x
                      </div>
                      <div className="text-xs text-slate-400">Months Behind</div>
                    </div>
                  </div>

                  {/* Transactions - Last 3 months */}
                  {itemDetails?.transactions && itemDetails.transactions.length > 0 && (
                    <div className="bg-white/5 rounded-lg p-4 mb-4">
                      <h3 className="font-semibold text-slate-100 mb-2">Transactions (Last 3 Months)</h3>
                      <div className="overflow-x-auto max-h-64 overflow-y-auto dark-scrollbar">
                        <table className="w-full text-xs">
                          <thead className="dark-thead">
                            <tr>
                              <th className="text-left py-1 px-2">Date</th>
                              <th className="text-left py-1 px-2">Payer</th>
                              <th className="text-left py-1 px-2">Description</th>
                              <th className="text-right py-1 px-2">Charges</th>
                              <th className="text-right py-1 px-2">Payments</th>
                            </tr>
                          </thead>
                          <tbody>
                            {itemDetails.transactions.map((txn, idx) => (
                              <tr key={idx} className="border-b border-[var(--glass-border)] last:border-0">
                                <td className="py-1 px-2 text-slate-500 whitespace-nowrap">{txn.date}</td>
                                <td className="py-1 px-2 text-slate-400">{txn.payer || ''}</td>
                                <td className="py-1 px-2 text-slate-300">{txn.description}</td>
                                <td className="py-1 px-2 text-right text-red-400">
                                  {txn.type === 'charge' ? `$${txn.amount.toFixed(2)}` : ''}
                                </td>
                                <td className="py-1 px-2 text-right text-green-400">
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
                    <div className="bg-white/5 rounded-lg p-4 mb-4">
                      <h3 className="font-semibold text-slate-100 mb-2">Outstanding by Account</h3>
                      <div className="space-y-2">
                        {itemDetails.glBreakdown.map((gl, idx) => (
                          <div key={idx} className="flex justify-between items-center text-sm">
                            <div>
                              <span className="font-medium text-slate-200">{gl.account_name}</span>
                              <span className="text-slate-500 text-xs ml-2">({gl.account_number})</span>
                            </div>
                            <span className={`font-semibold ${gl.outstanding > 0 ? 'text-red-400' : 'text-green-400'}`}>
                              ${gl.outstanding.toFixed(2)}
                            </span>
                          </div>
                        ))}
                        <div className="border-t border-white/10 pt-2 mt-2 flex justify-between items-center font-semibold">
                          <span className="text-slate-100">Total Outstanding</span>
                          <span className="text-red-400">
                            ${itemDetails.glBreakdown.reduce((sum, gl) => sum + gl.outstanding, 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {selectedItem.af_eviction && (
                    <div className="flex items-center gap-2 p-2 bg-purple-500/10 rounded mb-4">
                      <span className="text-purple-400"><LockIcon className="h-4 w-4" /></span>
                      <span className="text-purple-300 text-sm font-medium">
                        Locked - Eviction Status in AppFolio
                      </span>
                    </div>
                  )}

                  {/* Aging Breakdown */}
                  <div className="bg-white/5 rounded-lg p-4 mb-4">
                    <h3 className="font-semibold text-slate-100 mb-2">Aging Breakdown</h3>
                    <div className="grid grid-cols-4 gap-2 text-sm">
                      <div className="text-center">
                        <div className="font-semibold text-blue-400">
                          {formatCurrency(selectedItem.days_0_to_30)}
                        </div>
                        <div className="text-xs text-slate-400">0-30 days</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold text-yellow-400">
                          {formatCurrency(selectedItem.days_30_to_60)}
                        </div>
                        <div className="text-xs text-slate-400">30-60 days</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold text-orange-400">
                          {formatCurrency(selectedItem.days_60_to_90)}
                        </div>
                        <div className="text-xs text-slate-400">60-90 days</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold text-red-400">
                          {formatCurrency(selectedItem.days_90_plus)}
                        </div>
                        <div className="text-xs text-slate-400">90+ days</div>
                      </div>
                    </div>
                  </div>

                  {/* Stage History */}
                  {itemDetails?.stage && (
                    <div className="bg-white/5 rounded-lg p-4 mb-4">
                      <h3 className="font-semibold text-slate-100 mb-2">Collection History</h3>
                      <div className="space-y-2 text-sm">
                        {[1, 2, 3].map(n => {
                          const date = itemDetails.stage[`contact_${n}_date`];
                          const notes = itemDetails.stage[`contact_${n}_notes`];
                          if (!date) return null;
                          return (
                            <div key={n}>
                              <div className="flex justify-between">
                                <span className="text-slate-400">Contact {n}:</span>
                                <span className="text-slate-200">{formatDate(date)}</span>
                              </div>
                              {notes && (
                                <div className="text-xs text-slate-500 pl-4">{notes}</div>
                              )}
                            </div>
                          );
                        })}
                        {itemDetails.stage.balance_letter_entered_at && (
                          <div className="flex justify-between">
                            <span className="text-slate-400">Balance Letter:</span>
                            <span className="text-slate-200">{formatDate(itemDetails.stage.balance_letter_entered_at)}</span>
                          </div>
                        )}
                        {itemDetails.stage.notice_entered_at && (
                          <div className="flex justify-between">
                            <span className="text-slate-400">
                              Notice ({itemDetails.stage.notice_type || 'N/A'}):
                            </span>
                            <span className="text-slate-200">{formatDate(itemDetails.stage.notice_entered_at)}</span>
                          </div>
                        )}
                        {itemDetails.stage.reservation_of_rights_entered_at && (
                          <div className="flex justify-between">
                            <span className="text-slate-400">Reservation of Rights:</span>
                            <span className="text-slate-200">{formatDate(itemDetails.stage.reservation_of_rights_entered_at)}</span>
                          </div>
                        )}
                        {itemDetails.stage.eviction_started_at && (
                          <div className="flex justify-between">
                            <span className="text-slate-400">Eviction Started:</span>
                            <span className="text-slate-200">{formatDate(itemDetails.stage.eviction_started_at)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Payment History */}
                  {itemDetails?.ledger && itemDetails.ledger.length > 0 && (
                    <div className="bg-white/5 rounded-lg p-4 mb-4">
                      <h3 className="font-semibold text-slate-100 mb-2">Recent Transactions</h3>
                      <div className="space-y-1 text-sm max-h-48 overflow-y-auto dark-scrollbar">
                        {itemDetails.ledger.map((entry, idx) => (
                          <div key={idx} className="flex justify-between py-1 border-b border-[var(--glass-border)] last:border-0">
                            <div className="flex-1">
                              <span className="text-slate-400">{formatDate(entry.date)}</span>
                              <span className="text-slate-500 mx-2">·</span>
                              <span className="text-slate-300 truncate">{entry.description}</span>
                            </div>
                            <div className={entry.credit ? 'text-green-400' : 'text-red-400'}>
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
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setContactPrompt(null)}
        >
          <div
            className="glass-card w-full max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-slate-100 mb-1">
              Contact {contactPrompt.contactNumber}
            </h3>
            <p className="text-sm text-slate-400 mb-3">
              {contactPrompt.item.name} - Unit {contactPrompt.item.unit}
            </p>
            <textarea
              value={contactNoteInput}
              onChange={(e) => setContactNoteInput(e.target.value)}
              placeholder="Enter note about this contact..."
              className="w-full dark-input px-3 py-2 text-sm resize-none"
              rows={3}
              autoFocus
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setContactPrompt(null)}
                className="flex-1 px-3 py-1.5 text-sm border border-[var(--glass-border)] rounded-lg text-slate-400 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={() => saveContactNote(contactPrompt.item, contactPrompt.contactNumber, contactNoteInput)}
                className="flex-1 px-3 py-1.5 text-sm btn-accent rounded-lg"
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
