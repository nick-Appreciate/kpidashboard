'use client';

import { useState, useEffect, useMemo } from 'react';
import { LogoLoader } from './Logo';
import DarkSelect from './DarkSelect';

const INSPECTION_TYPES = [
  'S8 - RFT',
  'S8 - 1st Annual',
  'S8 - Reinspection',
  'S8 - Abatement Cure',
  'Rental License',
  'HUD'
];

const getInspectionColor = (type) => {
  const colorMap = {
    'S8 - RFT': 'bg-blue-500',
    'S8 - 1st Annual': 'bg-green-500',
    'S8 - Reinspection': 'bg-orange-500',
    'S8 - Abatement Cure': 'bg-red-500',
    'Rental License': 'bg-purple-500',
    'HUD': 'bg-teal-500',
  };
  return colorMap[type] || 'bg-gray-500';
};

const getStatusColor = (status) => {
  const colorMap = {
    'pending': 'bg-amber-500/15 text-amber-400',
    'passed': 'bg-emerald-500/15 text-emerald-400',
    'failed': 'bg-red-500/15 text-red-400',
  };
  return colorMap[status] || 'bg-gray-500/15 text-gray-400';
};

const formatDateCentral = (dateStr) => {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

const getTodayCentral = () => {
  const now = new Date();
  const centralStr = now.toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
  const [month, day, year] = centralStr.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

export default function InspectionsDashboard() {
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [viewMode, setViewMode] = useState('month');
  const [selectedProperty, setSelectedProperty] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState(null);
  const [showReinspectionModal, setShowReinspectionModal] = useState(false);
  const [reinspectionForm, setReinspectionForm] = useState({ date: '', time: '12:00' });
  const [newInspectionForm, setNewInspectionForm] = useState({
    type: 'S8 - 1st Annual',
    property_name: '',
    unit_name: '',
    date: '',
    time: '12:00'
  });
  const [availableUnits, setAvailableUnits] = useState([]);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editUnits, setEditUnits] = useState([]);
  const [loadingEditUnits, setLoadingEditUnits] = useState(false);
  // When the user clicks "+N more" on a calendar day (or the day chip itself),
  // we surface all inspections for that day in a list modal. Each row in the
  // list opens the existing single-inspection detail modal.
  const [selectedDayInspections, setSelectedDayInspections] = useState(null);
  // Confirm-before-delete modal. Holds the inspection pending deletion; null
  // when the modal is closed. We use an in-app modal rather than window.confirm()
  // so the confirmation matches the rest of the app's dark glass styling.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Fetch units when property changes in new inspection form
  useEffect(() => {
    const fetchUnits = async () => {
      if (!newInspectionForm.property_name) {
        setAvailableUnits([]);
        return;
      }
      setLoadingUnits(true);
      try {
        const response = await fetch(`/api/units?property=${encodeURIComponent(newInspectionForm.property_name)}`);
        const data = await response.json();
        setAvailableUnits(data.units || []);
      } catch (err) {
        console.error('Error fetching units:', err);
        setAvailableUnits([]);
      } finally {
        setLoadingUnits(false);
      }
    };
    fetchUnits();
  }, [newInspectionForm.property_name]);

  // Fetch units when property changes in edit form
  useEffect(() => {
    const fetchEditUnits = async () => {
      if (!editForm.property_name) {
        setEditUnits([]);
        return;
      }
      setLoadingEditUnits(true);
      try {
        const response = await fetch(`/api/units?property=${encodeURIComponent(editForm.property_name)}`);
        const data = await response.json();
        setEditUnits(data.units || []);
      } catch (err) {
        console.error('Error fetching units:', err);
        setEditUnits([]);
      } finally {
        setLoadingEditUnits(false);
      }
    };
    fetchEditUnits();
  }, [editForm.property_name]);

  // Escape key handler to close modals
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        if (isEditing) {
          setIsEditing(false);
        } else if (showAddModal) {
          setShowAddModal(false);
        } else if (showReinspectionModal) {
          setShowReinspectionModal(false);
        } else if (selectedInspection) {
          setSelectedInspection(null);
        }
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isEditing, showAddModal, showReinspectionModal, selectedInspection]);

  const fetchInspections = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/inspections');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch inspections');
      }

      setInspections(data.inspections || []);
    } catch (err) {
      console.error('Error fetching inspections:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInspections();
  }, []);

  const properties = useMemo(() => {
    const props = new Set(inspections.map(i => i.property_name).filter(Boolean));
    return ['all', ...Array.from(props).sort()];
  }, [inspections]);

  const filteredInspections = useMemo(() => {
    const hilltopGone = new Date() >= new Date('2026-04-22T00:00:00');
    return inspections.filter(i => {
      if (selectedProperty === 'all') return true;
      if (selectedProperty === 'farquhar') {
        return i.property_name !== 'Glen Oaks' && !(hilltopGone && i.property_name === 'Hilltop Townhomes');
      }
      return i.property_name === selectedProperty;
    });
  }, [inspections, selectedProperty]);

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDay = firstDay.getDay();

    const days = [];
    for (let i = 0; i < startDay; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  };

  const getInspectionsForDay = (day) => {
    if (!day) return [];
    const dayStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return filteredInspections.filter(i => i.date === dayStr);
  };

  const previousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const updateInspectionStatus = async (id, status) => {
    try {
      const response = await fetch('/api/inspections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status })
      });

      if (!response.ok) {
        throw new Error('Failed to update inspection');
      }

      const updated = await response.json();
      setInspections(prev => prev.map(i => i.id === id ? updated : i));
      setSelectedInspection(null);
    } catch (err) {
      console.error('Error updating inspection:', err);
      alert(err.message);
    }
  };

  // Request deletion — opens the in-app confirm modal. The actual API call
  // happens in confirmDeleteInspection() once the user confirms.
  const requestDeleteInspection = (inspection) => {
    setPendingDelete(inspection);
  };

  const confirmDeleteInspection = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setDeleting(true);
    try {
      const response = await fetch(`/api/inspections?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const j = await response.json().catch(() => ({}));
        throw new Error(j.error || `Failed to delete inspection (HTTP ${response.status})`);
      }
      setInspections(prev => prev.filter(i => i.id !== id));
      // Close any modals that were showing this inspection
      setSelectedInspection(null);
      setSelectedDayInspections(prev => {
        if (!prev) return null;
        const remaining = prev.inspections.filter(i => i.id !== id);
        return remaining.length === 0 ? null : { ...prev, inspections: remaining };
      });
      setPendingDelete(null);
    } catch (err) {
      console.error('Error deleting inspection:', err);
      alert(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const startEditing = () => {
    setEditForm({
      type: selectedInspection.type,
      property_name: selectedInspection.property_name,
      unit_name: selectedInspection.unit_name || '',
      date: selectedInspection.date,
      time: selectedInspection.time
    });
    setIsEditing(true);
  };

  const saveInspectionEdit = async () => {
    try {
      const response = await fetch('/api/inspections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedInspection.id,
          type: editForm.type,
          property_name: editForm.property_name,
          unit_name: editForm.unit_name || null,
          date: editForm.date,
          time: editForm.time
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update inspection');
      }

      const updated = await response.json();
      setInspections(prev => prev.map(i => i.id === selectedInspection.id ? updated : i));
      setSelectedInspection(updated);
      setIsEditing(false);
    } catch (err) {
      console.error('Error updating inspection:', err);
      alert(err.message);
    }
  };

  const createReinspection = async () => {
    if (!selectedInspection || !reinspectionForm.date || !reinspectionForm.time) {
      alert('Please select a date and time for the re-inspection');
      return;
    }

    try {
      const response = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'S8 - Reinspection',
          date: reinspectionForm.date,
          time: reinspectionForm.time,
          property_name: selectedInspection.property_name,
          unit_name: selectedInspection.unit_name,
          parent_inspection_id: selectedInspection.id,
          duration: 60
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create re-inspection');
      }

      const newInspection = await response.json();
      setInspections(prev => [...prev, newInspection]);
      setShowReinspectionModal(false);
      setReinspectionForm({ date: '', time: '12:00' });
      setSelectedInspection(null);
    } catch (err) {
      console.error('Error creating re-inspection:', err);
      alert(err.message);
    }
  };

  const createNewInspection = async () => {
    if (!newInspectionForm.type || !newInspectionForm.property_name || !newInspectionForm.date || !newInspectionForm.time) {
      alert('Please fill in all required fields (Type, Property, Date, Time)');
      return;
    }

    try {
      const response = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: newInspectionForm.type,
          date: newInspectionForm.date,
          time: newInspectionForm.time,
          property_name: newInspectionForm.property_name,
          unit_name: newInspectionForm.unit_name || null,
          duration: 60
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create inspection');
      }

      const inspection = await response.json();
      setInspections(prev => [...prev, inspection]);
      setShowAddModal(false);
      setNewInspectionForm({
        type: 'S8 - 1st Annual',
        property_name: '',
        unit_name: '',
        date: '',
        time: '12:00'
      });
    } catch (err) {
      console.error('Error creating inspection:', err);
      alert(err.message);
    }
  };

  const todayStr = getTodayCentral();
  const days = getDaysInMonth(currentMonth);

  const upcomingInspections = useMemo(() => {
    return filteredInspections
      .filter(i => i.date >= todayStr && i.status === 'pending')
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
      .slice(0, 10);
  }, [filteredInspections, todayStr]);

  const stats = useMemo(() => {
    const pending = filteredInspections.filter(i => i.status === 'pending' && i.date >= todayStr).length;
    const passed = filteredInspections.filter(i => i.status === 'passed').length;
    const thisMonth = filteredInspections.filter(i => {
      const inspDate = new Date(i.date);
      return inspDate.getMonth() === currentMonth.getMonth() &&
             inspDate.getFullYear() === currentMonth.getFullYear();
    }).length;
    return { pending, passed, thisMonth };
  }, [filteredInspections, todayStr, currentMonth]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LogoLoader />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-400">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-full mx-auto">
        {/* Header */}
        <div className="bg-[rgba(10,14,26,0.92)] backdrop-blur-[16px] rounded-lg border border-[var(--glass-border)] p-4 mb-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-accent rounded-lg">
                <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-100">Inspections Dashboard</h1>
                <p className="text-sm text-slate-400">Manage and schedule property inspections</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <DarkSelect
                value={selectedProperty}
                onChange={setSelectedProperty}
                className="w-48"
                options={[
                  ...properties.map(p => ({ value: p, label: p === 'all' ? 'All Properties' : p })),
                  { value: 'farquhar', label: 'Farquhar' },
                ]}
              />

              <div className="flex border border-[var(--glass-border)] rounded-lg">
                <button
                  onClick={() => setViewMode('month')}
                  className={`px-3 py-2 text-sm ${viewMode === 'month' ? 'bg-accent text-surface-base' : 'bg-white/5 text-slate-400'} rounded-l-lg`}
                >
                  Month
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-2 text-sm ${viewMode === 'list' ? 'bg-accent text-surface-base' : 'bg-white/5 text-slate-400'} rounded-r-lg`}
                >
                  List
                </button>
              </div>

              <button
                onClick={() => setShowAddModal(true)}
                className="btn-accent px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                New Inspection
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-4 mt-4 flex-wrap">
            <div className="px-4 py-2 bg-amber-500/10 rounded-lg">
              <span className="text-amber-400 font-medium">{stats.pending} Upcoming</span>
            </div>
            <div className="px-4 py-2 bg-emerald-500/10 rounded-lg">
              <span className="text-emerald-400 font-medium">{stats.passed} Passed</span>
            </div>
            <div className="px-4 py-2 bg-indigo-500/10 rounded-lg">
              <span className="text-indigo-400 font-medium">{stats.thisMonth} This Month</span>
            </div>
          </div>
        </div>

        {viewMode === 'month' ? (
          /* Calendar View */
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-100">
                {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Chicago' })}
              </h2>
              <div className="flex gap-2">
                <button onClick={previousMonth} className="p-2 hover:bg-white/10 rounded-lg text-slate-300">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button onClick={nextMonth} className="p-2 hover:bg-white/10 rounded-lg text-slate-300">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center font-medium text-slate-400 py-2 text-sm">
                  {day}
                </div>
              ))}

              {days.map((day, index) => {
                const dayInspections = getInspectionsForDay(day);
                const isToday = day && `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}` === todayStr;

                return (
                  <div
                    key={index}
                    className={`min-h-[120px] p-2 border border-[var(--glass-border)] rounded-lg ${
                      day ? 'hover:bg-white/5 bg-white/[0.03]' : 'bg-white/[0.02]'
                    } ${isToday ? 'ring-2 ring-accent bg-accent/10' : ''}`}
                  >
                    {day && (
                      <>
                        <div className="flex items-center justify-between mb-2">
                          <div className={`text-sm font-medium ${isToday ? 'text-accent font-bold' : 'text-slate-300'}`}>
                            {day.getDate()}
                          </div>
                          {dayInspections.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setSelectedDayInspections({ date: day, inspections: dayInspections })}
                              className="text-[10px] text-slate-500 hover:text-accent font-medium px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors"
                              title="View all inspections this day"
                            >
                              {dayInspections.length} total
                            </button>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {dayInspections.slice(0, 3).map(inspection => (
                            <div
                              key={inspection.id}
                              onClick={() => setSelectedInspection(inspection)}
                              className={`${getInspectionColor(inspection.type)} text-white text-xs px-2.5 py-1.5 rounded-md cursor-pointer hover:opacity-90 hover:shadow-md transition-all`}
                            >
                              <div className="font-medium truncate">{inspection.time}</div>
                              <div className="truncate opacity-90">{inspection.property_name}</div>
                              {inspection.unit_name && (
                                <div className="truncate text-[10px] opacity-80 font-medium">Unit {inspection.unit_name}</div>
                              )}
                            </div>
                          ))}
                          {dayInspections.length > 3 && (
                            <button
                              type="button"
                              onClick={() => setSelectedDayInspections({ date: day, inspections: dayInspections })}
                              className="w-full text-left text-xs text-accent hover:text-accent-light font-medium px-2.5 py-1.5 rounded-md hover:bg-white/5 transition-colors"
                            >
                              +{dayInspections.length - 3} more →
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* List View */
          <div className="glass-card overflow-hidden">
            <div className="p-4 border-b border-[var(--glass-border)]">
              <h2 className="text-lg font-bold text-slate-100">Upcoming Inspections</h2>
            </div>
            <div className="divide-y divide-[var(--glass-border)]">
              {upcomingInspections.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  No upcoming inspections
                </div>
              ) : (
                upcomingInspections.map(inspection => (
                  <div
                    key={inspection.id}
                    onClick={() => setSelectedInspection(inspection)}
                    className="p-4 hover:bg-white/5 cursor-pointer flex items-center justify-between"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-3 h-3 rounded-full ${getInspectionColor(inspection.type)}`} />
                      <div>
                        <div className="font-medium text-slate-100">
                          {inspection.property_name}
                          {inspection.unit_name && <span className="text-slate-500"> - Unit {inspection.unit_name}</span>}
                        </div>
                        <div className="text-sm text-slate-500">
                          {inspection.type} -- {formatDateCentral(inspection.date)} at {inspection.time}
                        </div>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(inspection.status)}`}>
                      {inspection.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Inspection Type Legend */}
        <div className="glass-card p-4 mt-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Inspection Types</h3>
          <div className="flex flex-wrap gap-3">
            {INSPECTION_TYPES.map(type => (
              <div key={type} className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${getInspectionColor(type)}`} />
                <span className="text-sm text-slate-400">{type}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Day Inspection List Modal — shown when "+N more" or "N total" is clicked
            on a calendar day. Lists every inspection for that day, each clickable
            to open the single-inspection detail modal underneath. */}
        {selectedDayInspections && !selectedInspection && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-40" onClick={() => setSelectedDayInspections(null)}>
            <div className="glass-card max-w-lg w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="bg-surface-overlay px-6 py-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-100">
                    {selectedDayInspections.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </h3>
                  <p className="text-sm text-slate-400">
                    {selectedDayInspections.inspections.length} inspection{selectedDayInspections.inspections.length === 1 ? '' : 's'}
                  </p>
                </div>
                <button onClick={() => setSelectedDayInspections(null)} className="text-slate-400 hover:text-slate-200">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto divide-y divide-[var(--glass-border)]">
                {selectedDayInspections.inspections.map(inspection => (
                  <div
                    key={inspection.id}
                    className="p-4 hover:bg-white/5 flex items-center gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedInspection(inspection)}
                      className="flex-1 flex items-center gap-3 text-left"
                    >
                      <div className={`w-3 h-3 rounded-full shrink-0 ${getInspectionColor(inspection.type)}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-100">{inspection.time}</span>
                          <span className="text-xs text-slate-500">{inspection.type}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getStatusColor(inspection.status)}`}>
                            {inspection.status}
                          </span>
                        </div>
                        <div className="text-sm text-slate-300 truncate">
                          {inspection.property_name}
                          {inspection.unit_name && <span className="text-slate-500"> — Unit {inspection.unit_name}</span>}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => requestDeleteInspection(inspection)}
                      className="shrink-0 p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors"
                      title="Delete inspection"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Inspection Details Modal */}
        {selectedInspection && !isEditing && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSelectedInspection(null)}>
            <div className="glass-card max-w-lg w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* Header with color band */}
              <div className={`${getInspectionColor(selectedInspection.type)} px-6 py-4`}>
                <div className="flex items-center justify-between">
                  <div className="text-white">
                    <h3 className="text-lg font-bold">{selectedInspection.type}</h3>
                    <p className="text-white/80 text-sm">{formatDateCentral(selectedInspection.date)} at {selectedInspection.time}</p>
                  </div>
                  <button onClick={() => setSelectedInspection(null)} className="text-white/80 hover:text-white">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="p-6">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-white/5 rounded-lg p-3">
                    <label className="text-xs text-slate-500 uppercase tracking-wide">Property</label>
                    <p className="font-semibold text-slate-100 mt-1">{selectedInspection.property_name}</p>
                  </div>

                  <div className="bg-white/5 rounded-lg p-3">
                    <label className="text-xs text-slate-500 uppercase tracking-wide">Unit</label>
                    <p className="font-semibold text-slate-100 mt-1">{selectedInspection.unit_name || '--'}</p>
                  </div>

                  <div className="bg-white/5 rounded-lg p-3">
                    <label className="text-xs text-slate-500 uppercase tracking-wide">Status</label>
                    <p className={`inline-block px-2 py-0.5 rounded text-sm font-medium mt-1 ${getStatusColor(selectedInspection.status)}`}>
                      {selectedInspection.status}
                    </p>
                  </div>

                  <div className="bg-white/5 rounded-lg p-3">
                    <label className="text-xs text-slate-500 uppercase tracking-wide">Duration</label>
                    <p className="font-semibold text-slate-100 mt-1">{selectedInspection.duration || 60} min</p>
                  </div>
                </div>

                {selectedInspection.attachment_url && (
                  <div className="mb-4">
                    <a
                      href={selectedInspection.attachment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-accent hover:text-accent-light text-sm font-medium"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      View Attachment
                    </a>
                  </div>
                )}

                {/* Edit Button */}
                <button
                  onClick={startEditing}
                  className="w-full mb-3 px-4 py-2 border border-[var(--glass-border)] text-slate-300 rounded-lg hover:bg-white/5 flex items-center justify-center gap-2 font-medium"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit Details
                </button>
              </div>

              <div className="px-6 pb-6 space-y-3">
                <div className="flex gap-2">
                  {selectedInspection.status === 'pending' && (
                    <>
                      <button
                        onClick={() => updateInspectionStatus(selectedInspection.id, 'passed')}
                        className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium"
                      >
                        Mark Passed
                      </button>
                      <button
                        onClick={() => updateInspectionStatus(selectedInspection.id, 'failed')}
                        className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
                      >
                        Mark Failed
                      </button>
                    </>
                  )}
                  {selectedInspection.status !== 'pending' && (
                    <button
                      onClick={() => updateInspectionStatus(selectedInspection.id, 'pending')}
                      className="flex-1 px-4 py-2.5 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 font-medium"
                    >
                      Reset to Pending
                    </button>
                  )}
                </div>

                <button
                  onClick={() => setShowReinspectionModal(true)}
                  className="w-full px-4 py-2.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center justify-center gap-2 font-medium"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Schedule Re-Inspection
                </button>

                <button
                  onClick={() => requestDeleteInspection(selectedInspection)}
                  className="w-full px-4 py-2.5 border border-rose-500/40 text-rose-300 rounded-lg hover:bg-rose-500/10 flex items-center justify-center gap-2 font-medium"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                  </svg>
                  Delete Inspection
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Inspection Modal */}
        {selectedInspection && isEditing && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setIsEditing(false)}>
            <div className="glass-card max-w-lg w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="bg-surface-overlay px-6 py-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white">Edit Inspection</h3>
                  <button onClick={() => setIsEditing(false)} className="text-white/80 hover:text-white">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Inspection Type</label>
                  <DarkSelect
                    value={editForm.type}
                    onChange={(val) => setEditForm(prev => ({ ...prev, type: val }))}
                    searchable={false}
                    options={INSPECTION_TYPES.map(type => ({ value: type, label: type }))}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Property</label>
                  <DarkSelect
                    value={editForm.property_name}
                    onChange={(val) => setEditForm(prev => ({ ...prev, property_name: val, unit_name: '' }))}
                    placeholder="Select a property..."
                    options={[
                      { value: '', label: 'Select a property...' },
                      ...properties.filter(p => p !== 'all').map(p => ({ value: p, label: p })),
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Unit</label>
                  <DarkSelect
                    value={editForm.unit_name}
                    onChange={(val) => setEditForm(prev => ({ ...prev, unit_name: val }))}
                    disabled={!editForm.property_name || loadingEditUnits}
                    placeholder={loadingEditUnits ? 'Loading...' : 'Select a unit...'}
                    options={[
                      { value: '', label: loadingEditUnits ? 'Loading...' : 'Select a unit...' },
                      ...editUnits.map(unit => ({ value: unit, label: unit })),
                    ]}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Date</label>
                    <input
                      type="date"
                      value={editForm.date}
                      onChange={(e) => setEditForm(prev => ({ ...prev, date: e.target.value }))}
                      className="dark-input w-full px-3 py-2 rounded-lg focus:ring-2 focus:ring-accent focus:border-accent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Time</label>
                    <input
                      type="time"
                      value={editForm.time}
                      onChange={(e) => setEditForm(prev => ({ ...prev, time: e.target.value }))}
                      className="dark-input w-full px-3 py-2 rounded-lg focus:ring-2 focus:ring-accent focus:border-accent"
                    />
                  </div>
                </div>
              </div>

              <div className="px-6 pb-6 flex gap-3">
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex-1 px-4 py-2.5 border border-[var(--glass-border)] text-slate-400 rounded-lg hover:bg-white/5 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={saveInspectionEdit}
                  className="flex-1 px-4 py-2.5 bg-accent text-surface-base rounded-lg hover:bg-accent-light font-medium"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Re-Inspection Modal */}
        {showReinspectionModal && selectedInspection && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowReinspectionModal(false)}>
            <div className="glass-card max-w-md w-full mx-4 p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-100">Schedule Re-Inspection</h3>
                <button onClick={() => setShowReinspectionModal(false)} className="text-slate-400 hover:text-slate-200">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
                  <p className="text-sm text-orange-400">
                    Creating re-inspection for <strong>{selectedInspection.property_name}</strong>
                    {selectedInspection.unit_name && <span> - Unit {selectedInspection.unit_name}</span>}
                  </p>
                  <p className="text-xs text-orange-400/70 mt-1">
                    Linked to: {selectedInspection.type} on {formatDateCentral(selectedInspection.date)}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Date</label>
                  <input
                    type="date"
                    value={reinspectionForm.date}
                    onChange={(e) => setReinspectionForm(prev => ({ ...prev, date: e.target.value }))}
                    className="dark-input w-full px-3 py-2 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Time</label>
                  <input
                    type="time"
                    value={reinspectionForm.time}
                    onChange={(e) => setReinspectionForm(prev => ({ ...prev, time: e.target.value }))}
                    className="dark-input w-full px-3 py-2 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex gap-2">
                <button
                  onClick={() => setShowReinspectionModal(false)}
                  className="flex-1 px-4 py-2 border border-[var(--glass-border)] text-slate-400 rounded-lg hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  onClick={createReinspection}
                  className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                >
                  Create Re-Inspection
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal — replaces window.confirm() so the dialog
            matches the rest of the app's dark glass styling. z-60 so it lands
            above the day-list modal (z-40) and detail modal (z-50). */}
        {pendingDelete && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60]" onClick={() => !deleting && setPendingDelete(null)}>
            <div className="glass-card max-w-md w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="bg-rose-500/10 px-6 py-4 border-b border-rose-500/20">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-10 h-10 rounded-full bg-rose-500/15 flex items-center justify-center">
                    <svg className="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-slate-100">Delete inspection?</h3>
                    <p className="text-sm text-slate-400 mt-0.5">This cannot be undone.</p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Type</span>
                  <span className="text-slate-200 font-medium text-right">{pendingDelete.type}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">When</span>
                  <span className="text-slate-200 font-medium text-right">
                    {formatDateCentral(pendingDelete.date)} at {pendingDelete.time}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Property</span>
                  <span className="text-slate-200 font-medium text-right">
                    {pendingDelete.property_name}
                    {pendingDelete.unit_name && <span className="text-slate-500"> — Unit {pendingDelete.unit_name}</span>}
                  </span>
                </div>
              </div>

              <div className="px-6 pb-6 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPendingDelete(null)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 border border-[var(--glass-border)] text-slate-300 rounded-lg hover:bg-white/5 font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteInspection}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 bg-rose-600 text-white rounded-lg hover:bg-rose-700 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      Deleting…
                    </>
                  ) : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* New Inspection Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
            <div className="glass-card max-w-md w-full mx-4 p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-100">New Inspection</h3>
                <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-200">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Inspection Type *</label>
                  <DarkSelect
                    value={newInspectionForm.type}
                    onChange={(val) => setNewInspectionForm(prev => ({ ...prev, type: val }))}
                    searchable={false}
                    options={INSPECTION_TYPES.map(type => ({ value: type, label: type }))}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Property *</label>
                  <DarkSelect
                    value={newInspectionForm.property_name}
                    onChange={(val) => setNewInspectionForm(prev => ({ ...prev, property_name: val, unit_name: '' }))}
                    placeholder="Select a property..."
                    options={[
                      { value: '', label: 'Select a property...' },
                      ...properties.filter(p => p !== 'all').map(p => ({ value: p, label: p })),
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Unit (optional)</label>
                  <DarkSelect
                    value={newInspectionForm.unit_name}
                    onChange={(val) => setNewInspectionForm(prev => ({ ...prev, unit_name: val }))}
                    disabled={!newInspectionForm.property_name || loadingUnits}
                    placeholder={loadingUnits ? 'Loading units...' : newInspectionForm.property_name ? 'Select a unit...' : 'Select property first'}
                    options={[
                      { value: '', label: loadingUnits ? 'Loading units...' : newInspectionForm.property_name ? 'Select a unit...' : 'Select property first' },
                      ...availableUnits.map(unit => ({ value: unit, label: unit })),
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Date *</label>
                  <input
                    type="date"
                    value={newInspectionForm.date}
                    onChange={(e) => setNewInspectionForm(prev => ({ ...prev, date: e.target.value }))}
                    className="dark-input w-full px-3 py-2 rounded-lg focus:ring-2 focus:ring-accent focus:border-accent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Time *</label>
                  <input
                    type="time"
                    value={newInspectionForm.time}
                    onChange={(e) => setNewInspectionForm(prev => ({ ...prev, time: e.target.value }))}
                    className="dark-input w-full px-3 py-2 rounded-lg focus:ring-2 focus:ring-accent focus:border-accent"
                  />
                </div>
              </div>

              <div className="mt-6 flex gap-2">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 border border-[var(--glass-border)] text-slate-400 rounded-lg hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  onClick={createNewInspection}
                  className="flex-1 px-4 py-2 bg-accent text-surface-base rounded-lg hover:bg-accent-light"
                >
                  Create Inspection
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
