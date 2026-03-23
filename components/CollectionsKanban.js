'use client';

import { useState, useEffect, useRef } from 'react';
import { LogoLoader } from './Logo';
import JustCallDialer, { useJustCall } from './JustCallDialer';
import DarkSelect from './DarkSelect';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, ReferenceLine } from 'recharts';

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
  needs_contacted: { label: 'Needs Contacted', variant: 'teal', tooltip: 'New delinquent tenants with a balance ≤ 1x monthly rent and before the 9th of the month.' },
  balance_letter:  { label: 'Balance Letter',  variant: 'dark', tooltip: 'Tenants with a balance ≤ 1x monthly rent after the 9th of the month. A balance letter should be sent.' },
  notice:          { label: 'Notice',          variant: 'teal', tooltip: 'Tenants with a balance > 1x monthly rent. A 3-day (KC) or 10-day notice is required before further action.' },
  reservation_of_rights: { label: 'Reservation of Rights', variant: 'dark', tooltip: 'Tenants whose notice period has expired and balance is still > 1x monthly rent. Moves to Paid if balance drops below 1x rent.' },
  eviction:        { label: 'Eviction',        variant: 'teal', tooltip: 'Tenants with an active eviction status in AppFolio. Automatically locked to this stage while eviction is active.' },
  current:         { label: 'Paid',             variant: 'dark', tooltip: 'Previously delinquent tenants who have paid their balance down to $0 or below, or dropped below 1x monthly rent from Notice/Reservation.' },
  file_for_collections: { label: 'File for Collections', variant: 'teal', tooltip: 'Moved-out tenants (Notice-Unrented or similar status) who still have an outstanding balance.' },
};

const STAGES = ['needs_contacted', 'balance_letter', 'notice', 'reservation_of_rights', 'eviction', 'current', 'file_for_collections'];

// Locked stages that users cannot drag cards in/out of
// - 'current': Only units with balance <= 0
const LOCKED_STAGES = ['current', 'file_for_collections'];

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

// Phone picker modal for units with multiple phone numbers
function PhonePickerModal({ item, phones, onCall, onClose, formatPhoneForJustCall }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-sm p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-slate-100 mb-1">
          Call {item.name || 'Tenant'}
        </h3>
        <p className="text-sm text-slate-400 mb-3">
          {item.property_name} · Unit {item.unit}
        </p>
        <div className="space-y-2">
          {phones.map((entry, idx) => (
            <button
              key={idx}
              onClick={() => {
                const formatted = formatPhoneForJustCall(entry.phone);
                if (formatted) {
                  onCall(formatted, entry.name);
                  onClose();
                }
              }}
              className="w-full flex items-center justify-between p-2.5 rounded-lg bg-white/5 border border-[var(--glass-border)] hover:border-green-500/50 hover:bg-green-500/10 transition-colors group"
            >
              <div className="text-left">
                <div className="text-sm font-medium text-slate-200 group-hover:text-green-300">
                  {entry.name}
                </div>
                <div className="text-xs text-slate-400">{entry.phone}</div>
              </div>
              <PhoneIcon className="h-4 w-4 text-green-400" />
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="w-full mt-3 px-3 py-1.5 text-sm border border-[var(--glass-border)] rounded-lg text-slate-400 hover:bg-white/5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Interpolate sparse data: for each day, fill missing values from nearest known points
function interpolateMonthData(points, allDays, valueKey) {
  if (points.length === 0) return {};
  const known = {};
  points.forEach(p => { known[p.day] = p[valueKey]; });
  const knownDays = points.map(p => p.day).sort((a, b) => a - b);
  const result = {};
  allDays.forEach(day => {
    if (known[day] !== undefined) {
      result[day] = known[day];
      return;
    }
    // Find nearest lower and upper known points
    let lower = null, upper = null;
    for (const kd of knownDays) {
      if (kd <= day) lower = kd;
      if (kd >= day && upper === null) upper = kd;
    }
    if (lower !== null && upper !== null && lower !== upper) {
      // Linear interpolation between two known points
      const ratio = (day - lower) / (upper - lower);
      result[day] = Math.round(known[lower] + ratio * (known[upper] - known[lower]));
    }
    // Do NOT extrapolate before first or after last known data point
  });
  return result;
}

// Info tooltip for column headers
function StageTooltip({ text, variant }) {
  const [show, setShow] = useState(false);
  const isTeal = variant === 'teal';
  return (
    <span className="relative inline-block ml-1">
      <span
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold cursor-help ${
          isTeal ? 'bg-white/25 text-surface-base' : 'bg-accent/20 text-accent'
        }`}
      >
        ?
      </span>
      {show && (
        <div className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1.5 w-52 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-lg leading-relaxed">
          {text}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 -mb-px border-4 border-transparent border-b-slate-800"></div>
        </div>
      )}
    </span>
  );
}

// Compact card component for Kanban
function CollectionCard({ item, variant, onClick, onCall, onContactClick, getAgingBadge, formatCurrency, formatDate }) {
  const aging = getAgingBadge(item);

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
      onClick={onClick}
      className={`rounded border p-2 transition-all duration-200 mb-1 ${cardBase} cursor-pointer ${cardHover} hover:-translate-y-0.5`}
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
        {/* Contact buttons for all non-paid stages */}
        {item.stage !== 'current' && onContactClick && (
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
  const [sortByBalance, setSortByBalance] = useState(false);
  const [agingFilter, setAgingFilter] = useState('all'); // 'all', '0-30', '60-90', '90+'
  const [chartStatusFilter, setChartStatusFilter] = useState('all'); // 'all', 'current', 'evict'
  const [contactPrompt, setContactPrompt] = useState(null); // { item, contactNumber }
  const [contactNoteInput, setContactNoteInput] = useState('');
  const [phonePicker, setPhonePicker] = useState(null); // { item, phones }
  const [chartData, setChartData] = useState(null);
  const [chartsExpanded, setChartsExpanded] = useState(false);
  const [dailyChartData, setDailyChartData] = useState(null);
  const [todayDay, setTodayDay] = useState(null);
  const [statusChartData, setStatusChartData] = useState(null);
  const [statusTypes, setStatusTypes] = useState([]);
  const { makeCall } = useJustCall();

  useEffect(() => {
    fetchData();
    fetchChartData();
    fetchDailyChartData();
    fetchStatusChartData();
  }, [selectedFilter, chartStatusFilter]);

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

  const fetchChartData = async () => {
    try {
      const params = new URLSearchParams({ chart: 'true' });
      if (selectedFilter !== 'all' && !selectedFilter.startsWith('region_')) {
        params.append('property', selectedFilter);
      }
      if (chartStatusFilter !== 'all') params.append('status_filter', chartStatusFilter);
      const res = await fetch(`/api/collections?${params}`);
      const result = await res.json();
      if (result.chartData) setChartData(result.chartData);
    } catch (err) {
      console.error('Error fetching chart data:', err);
    }
  };

  const fetchDailyChartData = async () => {
    try {
      const params = new URLSearchParams({ daily_chart: 'true' });
      if (selectedFilter !== 'all' && !selectedFilter.startsWith('region_')) {
        params.append('property', selectedFilter);
      }
      if (chartStatusFilter !== 'all') params.append('status_filter', chartStatusFilter);
      const res = await fetch(`/api/collections?${params}`);
      const result = await res.json();
      if (result.dailyChart) {
        setDailyChartData(result.dailyChart);
        setTodayDay(result.todayDay);
      }
    } catch (err) {
      console.error('Error fetching daily chart data:', err);
    }
  };

  const fetchStatusChartData = async () => {
    try {
      const params = new URLSearchParams({ status_chart: 'true' });
      if (selectedFilter !== 'all' && !selectedFilter.startsWith('region_')) {
        params.append('property', selectedFilter);
      }
      const res = await fetch(`/api/collections?${params}`);
      const result = await res.json();
      if (result.statusChart) {
        setStatusChartData(result.statusChart);
        setStatusTypes(result.statuses || []);
        if (result.todayDay) setTodayDay(result.todayDay);
      }
    } catch (err) {
      console.error('Error fetching status chart data:', err);
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
    const phones = item.tenant_phones || [];
    if (phones.length === 0) {
      // Fallback to legacy single phone_numbers field
      const phone = formatPhoneForJustCall(item.phone_numbers);
      if (!phone) {
        alert('No phone number available');
        return;
      }
      makeCall(phone, item.name || 'Unknown');
      return;
    }
    if (phones.length === 1) {
      // Single number — call directly
      const phone = formatPhoneForJustCall(phones[0].phone);
      if (phone) makeCall(phone, phones[0].name || item.name || 'Unknown');
      return;
    }
    // Multiple numbers — show picker
    setPhonePicker({ item, phones });
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
      <div className="max-w-full mx-auto flex flex-col flex-1 min-h-0 w-full overflow-hidden">
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
        <div className="grid grid-cols-7 gap-2 flex-shrink-0">
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
                    <StageTooltip text={config.tooltip} variant={config.variant} />
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
          <div className="grid grid-cols-7 gap-2 min-h-full">
            {STAGES.map(stage => {
              const config = STAGE_CONFIG[stage];
              const stageItems = itemsByStage[stage];
              const stageProperties = getPropertiesInStage(stageItems);
              const isTeal = config.variant === 'teal';
              const colBg = isTeal ? 'bg-accent/[0.06]' : 'bg-white/[0.03]';

              return (
                <div
                  key={stage}
                  className={`${colBg} rounded-lg p-1.5 space-y-1 min-w-0`}
                >
                  {stageItems.length === 0 ? (
                    <div className="text-center text-xs py-4 text-slate-500">
                      No accounts
                    </div>
                  ) : sortByBalance ? (
                    stageItems.map(item => (
                      <CollectionCard
                        key={item.occupancy_id}
                        item={item}
                        variant={config.variant}
                        onClick={() => openItemDetails(item)}
                        onCall={handleCall}
                        onContactClick={handleContactClick}
                        getAgingBadge={getAgingBadge}
                        formatCurrency={formatCurrency}
                        formatDate={formatDate}

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
                              onClick={() => openItemDetails(item)}
                              onCall={handleCall}
                              onContactClick={handleContactClick}
                              getAgingBadge={getAgingBadge}
                              formatCurrency={formatCurrency}
                              formatDate={formatDate}
      
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

        {/* Collections Analytics — pinned bottom */}
        {(chartData?.length > 0 || dailyChartData?.length > 0) && (
          <div className="flex-shrink-0 mt-2">
            <button
              onClick={() => setChartsExpanded(!chartsExpanded)}
              className="w-full flex items-center justify-between bg-[rgba(10,14,26,0.92)] backdrop-blur-[16px] rounded-lg border border-[var(--glass-border)] px-4 py-2 hover:border-[var(--glass-border-hover)] transition-colors"
            >
              <span className="text-sm font-semibold text-slate-100">Collections Analytics</span>
              <span className="text-slate-400 text-xs">{chartsExpanded ? '▲ Collapse' : '▼ Expand'}</span>
            </button>
            {chartsExpanded && (
              <div className="bg-[rgba(10,14,26,0.92)] backdrop-blur-[16px] rounded-b-lg border border-t-0 border-[var(--glass-border)] p-4 space-y-6 max-h-[60vh] overflow-y-auto dark-scrollbar">
                {/* Status Filter */}
                <div className="flex items-center justify-end">
                  <div className="flex rounded-lg border border-[var(--glass-border)] overflow-hidden h-[26px]">
                    {[
                      { value: 'all', label: 'All' },
                      { value: 'current', label: 'Current' },
                      { value: 'evict', label: 'Evictions' },
                    ].map((opt, idx) => (
                      <button
                        key={opt.value}
                        onClick={() => setChartStatusFilter(opt.value)}
                        className={`px-3 text-[11px] font-medium transition-colors ${
                          chartStatusFilter === opt.value
                            ? 'bg-accent text-surface-base'
                            : 'bg-white/5 text-slate-400 hover:bg-white/10'
                        } ${idx > 0 ? 'border-l border-[var(--glass-border)]' : ''}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Monthly Trend Chart */}
                {chartData && chartData.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-300 mb-2 uppercase tracking-wide">
                      Monthly Trend (12 Months)
                    </h4>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={chartData}
                          margin={{ top: 5, right: 20, bottom: 5, left: 20 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                          <YAxis
                            yAxisId="left"
                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                            tickFormatter={(v) => `${v}%`}
                          />
                          <Tooltip
                            contentStyle={{ backgroundColor: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                            labelStyle={{ color: '#e2e8f0' }}
                            formatter={(value, name) => {
                              if (name === 'totalOutstanding') return [`$${value.toLocaleString()}`, 'Outstanding'];
                              if (name === 'pctOfCharges') return [`${value}%`, '% of Rent'];
                              return [value, name];
                            }}
                          />
                          <Bar yAxisId="left" dataKey="totalOutstanding" fill="rgba(56,189,248,0.4)" stroke="rgb(56,189,248)" strokeWidth={1} radius={[4, 4, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="pctOfCharges" stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 3 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-slate-400 justify-center">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 bg-sky-400/40 rounded-sm border border-sky-400"></span> Outstanding ($)</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-1.5 bg-amber-500 rounded"></span> % of Rent</span>
                    </div>
                  </div>
                )}

                {/* Daily Chart */}
                {dailyChartData && dailyChartData.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-300 mb-2 uppercase tracking-wide">
                      Daily Collections by Month
                    </h4>
                    {(() => {
                      const MONTH_COLORS = [
                        'rgb(56,189,248)', 'rgb(168,85,247)', 'rgb(251,146,60)',
                        'rgb(52,211,153)', 'rgb(251,113,133)', 'rgb(250,204,21)',
                        'rgb(147,51,234)', 'rgb(34,211,238)', 'rgb(244,114,182)',
                        'rgb(163,230,53)', 'rgb(249,115,22)', 'rgb(99,102,241)',
                      ];
                      // Only show months that actually have data points
                      const visibleMonths = dailyChartData.filter(m => m.points.length > 0);
                      const allDays = new Set();
                      visibleMonths.forEach(m => m.points.forEach(p => allDays.add(p.day)));
                      const sortedDays = [...allDays].sort((a, b) => a - b);

                      // Interpolate all months so every day has a value
                      const interpolated = visibleMonths.map(m => interpolateMonthData(m.points, sortedDays, 'outstanding'));

                      const merged = sortedDays.map(day => {
                        const row = { day };
                        visibleMonths.forEach((m, idx) => {
                          if (interpolated[idx][day] !== undefined) {
                            row[`outstanding_${idx}`] = interpolated[idx][day];
                          }
                        });
                        return row;
                      });

                      // Custom tooltip sorted by most recent month first
                      const DailyTooltip = ({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        // Sort entries by month index (0 = most recent)
                        const sorted = [...payload].sort((a, b) => {
                          const aIdx = parseInt(a.dataKey.split('_')[1]);
                          const bIdx = parseInt(b.dataKey.split('_')[1]);
                          return aIdx - bIdx;
                        });
                        return (
                          <div style={{ backgroundColor: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px 12px' }}>
                            <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 4 }}>Day {label}</div>
                            {sorted.map((entry, i) => {
                              const idx = parseInt(entry.dataKey.split('_')[1]);
                              return (
                                <div key={i} style={{ color: entry.color, fontSize: 12, lineHeight: '18px' }}>
                                  {visibleMonths[idx]?.label} Outstanding : ${entry.value?.toLocaleString()}
                                </div>
                              );
                            })}
                          </div>
                        );
                      };

                      return (
                        <>
                          <div className="h-56">
                            <ResponsiveContainer width="100%" height="100%">
                              <ComposedChart data={merged} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                <YAxis
                                  yAxisId="left"
                                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                                />
                                <YAxis
                                  yAxisId="right"
                                  orientation="right"
                                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                                  tickFormatter={(v) => `${v}%`}
                                />
                                <Tooltip content={<DailyTooltip />} />
                                {todayDay && (
                                  <ReferenceLine yAxisId="left" x={todayDay} stroke="white" strokeWidth={1.5} strokeDasharray="4 4" label={{ value: 'Today', fill: 'white', fontSize: 10, position: 'top' }} />
                                )}
                                {visibleMonths.map((m, idx) => (
                                  <Line
                                    key={`outstanding_${idx}`}
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey={`outstanding_${idx}`}
                                    stroke={MONTH_COLORS[idx]}
                                    strokeWidth={idx === 0 ? 2.5 : 1.5}
                                    strokeDasharray={idx === 0 ? undefined : '5 3'}
                                    dot={idx === 0 ? { fill: MONTH_COLORS[idx], r: 2 } : false}
                                    connectNulls
                                  />
                                ))}
                              </ComposedChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-xs text-slate-400 justify-center flex-wrap">
                            {visibleMonths.map((m, idx) => (
                              <span key={idx} className="flex items-center gap-1">
                                <span className="w-4 h-0.5 rounded" style={{ backgroundColor: MONTH_COLORS[idx], opacity: idx === 0 ? 1 : 0.7 }}></span>
                                {m.label}
                              </span>
                            ))}
                            {(
                              <span className="flex items-center gap-1">
                                <span className="w-4 h-0 border-t-2 border-dashed border-white"></span> Today
                              </span>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Evictions by Day Chart */}
                {statusChartData && statusChartData.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-300 mb-2 uppercase tracking-wide">
                      Evictions by Day
                    </h4>
                    {(() => {
                      const MONTH_COLORS = [
                        'rgb(56,189,248)', 'rgb(168,85,247)', 'rgb(251,146,60)',
                        'rgb(52,211,153)', 'rgb(251,113,133)', 'rgb(250,204,21)',
                        'rgb(147,51,234)', 'rgb(34,211,238)', 'rgb(244,114,182)',
                        'rgb(163,230,53)', 'rgb(249,115,22)', 'rgb(99,102,241)',
                      ];
                      const visibleMonths = statusChartData;
                      const allDays = new Set();
                      visibleMonths.forEach(m => m.points.forEach(p => allDays.add(p.day)));
                      const sortedDays = [...allDays].sort((a, b) => a - b);

                      // Extract eviction counts and interpolate
                      const evictPoints = visibleMonths.map(m =>
                        m.points.map(p => ({ day: p.day, value: p['Evict'] || 0 }))
                      );
                      const interpolatedEvict = evictPoints.map(pts =>
                        interpolateMonthData(pts.map(p => ({ day: p.day, value: p.value })), sortedDays, 'value')
                      );

                      const merged = sortedDays.map(day => {
                        const row = { day };
                        visibleMonths.forEach((m, idx) => {
                          if (interpolatedEvict[idx][day] !== undefined) {
                            row[`evict_${idx}`] = interpolatedEvict[idx][day];
                          }
                        });
                        return row;
                      });

                      const EvictTooltip = ({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const sorted = [...payload].sort((a, b) => {
                          const aIdx = parseInt(a.dataKey.split('_')[1]);
                          const bIdx = parseInt(b.dataKey.split('_')[1]);
                          return aIdx - bIdx;
                        });
                        return (
                          <div style={{ backgroundColor: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px 12px' }}>
                            <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 4 }}>Day {label}</div>
                            {sorted.map((entry, i) => {
                              const idx = parseInt(entry.dataKey.split('_')[1]);
                              return (
                                <div key={i} style={{ color: entry.color, fontSize: 12, lineHeight: '18px' }}>
                                  {visibleMonths[idx]?.label} Evictions : {entry.value}
                                </div>
                              );
                            })}
                          </div>
                        );
                      };

                      return (
                        <>
                          <div className="h-56">
                            <ResponsiveContainer width="100%" height="100%">
                              <ComposedChart data={merged} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
                                <Tooltip content={<EvictTooltip />} />
                                {todayDay && (
                                  <ReferenceLine x={todayDay} stroke="white" strokeWidth={1.5} strokeDasharray="4 4" label={{ value: 'Today', fill: 'white', fontSize: 10, position: 'top' }} />
                                )}
                                {visibleMonths.map((m, idx) => (
                                  <Line
                                    key={`evict_${idx}`}
                                    type="monotone"
                                    dataKey={`evict_${idx}`}
                                    stroke={MONTH_COLORS[idx]}
                                    strokeWidth={idx === 0 ? 2.5 : 1.5}
                                    strokeDasharray={idx === 0 ? undefined : '5 3'}
                                    dot={idx === 0 ? { fill: MONTH_COLORS[idx], r: 2 } : false}
                                    connectNulls
                                  />
                                ))}
                              </ComposedChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-xs text-slate-400 justify-center flex-wrap">
                            {visibleMonths.map((m, idx) => (
                              <span key={idx} className="flex items-center gap-1">
                                <span className="w-4 h-0.5 rounded" style={{ backgroundColor: MONTH_COLORS[idx], opacity: idx === 0 ? 1 : 0.7 }}></span>
                                {m.label}
                              </span>
                            ))}
                            <span className="flex items-center gap-1">
                              <span className="w-4 h-0 border-t-2 border-dashed border-white"></span> Today
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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

                  {/* Collection History — chronological, includes archived months */}
                  {(itemDetails?.stage || itemDetails?.noteHistory?.length > 0) && (
                    <div className="bg-white/5 rounded-lg p-4 mb-4">
                      <h3 className="font-semibold text-slate-100 mb-2">Collection History</h3>
                      <div className="space-y-2 text-sm max-h-64 overflow-y-auto dark-scrollbar">
                        {(() => {
                          // Build a flat list of all events with dates for sorting
                          const events = [];

                          // Archived months
                          (itemDetails?.noteHistory || []).forEach(archive => {
                            // Add archived contacts
                            [1, 2, 3].forEach(n => {
                              const date = archive[`contact_${n}_date`];
                              const notes = archive[`contact_${n}_notes`];
                              if (date) {
                                events.push({ date, label: `Contact ${n}`, notes, month: archive.month_year, archived: true });
                              }
                            });
                            // Add archived stage notes
                            if (archive.balance_letter_notes) {
                              events.push({ date: archive.archived_at, label: 'Balance Letter Note', notes: archive.balance_letter_notes, month: archive.month_year, archived: true });
                            }
                            if (archive.notice_notes) {
                              events.push({ date: archive.archived_at, label: 'Notice Note', notes: archive.notice_notes, month: archive.month_year, archived: true });
                            }
                            if (archive.reservation_of_rights_notes) {
                              events.push({ date: archive.archived_at, label: 'Reservation Note', notes: archive.reservation_of_rights_notes, month: archive.month_year, archived: true });
                            }
                            if (archive.eviction_notes) {
                              events.push({ date: archive.archived_at, label: 'Eviction Note', notes: archive.eviction_notes, month: archive.month_year, archived: true });
                            }
                          });

                          // Current month entries from stage data
                          const stage = itemDetails?.stage;
                          if (stage) {
                            [1, 2, 3].forEach(n => {
                              const date = stage[`contact_${n}_date`];
                              const notes = stage[`contact_${n}_notes`];
                              if (date) {
                                events.push({ date, label: `Contact ${n}`, notes });
                              }
                            });
                            if (stage.balance_letter_entered_at) {
                              events.push({ date: stage.balance_letter_entered_at, label: 'Balance Letter', notes: stage.balance_letter_notes });
                            }
                            if (stage.notice_entered_at) {
                              events.push({ date: stage.notice_entered_at, label: `Notice (${stage.notice_type || 'N/A'})`, notes: stage.notice_notes });
                            }
                            if (stage.reservation_of_rights_entered_at) {
                              events.push({ date: stage.reservation_of_rights_entered_at, label: 'Reservation of Rights', notes: stage.reservation_of_rights_notes });
                            }
                            if (stage.eviction_started_at) {
                              events.push({ date: stage.eviction_started_at, label: 'Eviction Started', notes: stage.eviction_notes });
                            }
                          }

                          // Sort chronologically — earliest first
                          events.sort((a, b) => new Date(a.date) - new Date(b.date));

                          if (events.length === 0) {
                            return <div className="text-slate-500 text-xs">No history yet</div>;
                          }

                          // Group by month for display
                          let lastMonth = null;
                          return events.map((evt, idx) => {
                            const evtMonth = evt.archived ? evt.month : new Date(evt.date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                            const showMonthHeader = evtMonth !== lastMonth;
                            lastMonth = evtMonth;
                            return (
                              <div key={idx}>
                                {showMonthHeader && (
                                  <div className="text-xs font-semibold text-accent mt-2 mb-1 first:mt-0">
                                    {evt.archived ? new Date(evt.month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : evtMonth}
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span className="text-slate-400">{evt.label}:</span>
                                  <span className="text-slate-200">{formatDate(evt.date)}</span>
                                </div>
                                {evt.notes && (
                                  <div className="text-xs text-slate-500 pl-4">{evt.notes}</div>
                                )}
                              </div>
                            );
                          });
                        })()}
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

      {/* Phone Picker Modal */}
      {phonePicker && (
        <PhonePickerModal
          item={phonePicker.item}
          phones={phonePicker.phones}
          onCall={(phone, name) => makeCall(phone, name)}
          onClose={() => setPhonePicker(null)}
          formatPhoneForJustCall={formatPhoneForJustCall}
        />
      )}

      <JustCallDialer />
    </div>
  );
}
