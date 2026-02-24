'use client';

import { useState, useEffect, useMemo } from 'react';
import { LogoLoader } from './Logo';

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
    'pending': 'bg-yellow-100 text-yellow-800',
    'passed': 'bg-green-100 text-green-800',
    'failed': 'bg-red-100 text-red-800',
  };
  return colorMap[status] || 'bg-gray-100 text-gray-800';
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
    return inspections.filter(i => {
      if (selectedProperty !== 'all' && i.property_name !== selectedProperty) return false;
      return true;
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
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <LogoLoader />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-red-600">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="max-w-full mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-600 rounded-lg">
                <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Inspections Dashboard</h1>
                <p className="text-sm text-slate-500">Manage and schedule property inspections</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <select
                value={selectedProperty}
                onChange={(e) => setSelectedProperty(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                {properties.map(p => (
                  <option key={p} value={p}>{p === 'all' ? 'All Properties' : p}</option>
                ))}
              </select>
              
              <div className="flex border rounded-lg">
                <button
                  onClick={() => setViewMode('month')}
                  className={`px-3 py-2 text-sm ${viewMode === 'month' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'} rounded-l-lg`}
                >
                  Month
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-2 text-sm ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'} rounded-r-lg`}
                >
                  List
                </button>
              </div>
              
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2 text-sm font-medium"
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
            <div className="px-4 py-2 bg-yellow-50 rounded-lg">
              <span className="text-yellow-800 font-medium">{stats.pending} Upcoming</span>
            </div>
            <div className="px-4 py-2 bg-green-50 rounded-lg">
              <span className="text-green-800 font-medium">{stats.passed} Passed</span>
            </div>
            <div className="px-4 py-2 bg-indigo-50 rounded-lg">
              <span className="text-indigo-800 font-medium">{stats.thisMonth} This Month</span>
            </div>
          </div>
        </div>

        {viewMode === 'month' ? (
          /* Calendar View */
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900">
                {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Chicago' })}
              </h2>
              <div className="flex gap-2">
                <button onClick={previousMonth} className="p-2 hover:bg-slate-100 rounded-lg">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button onClick={nextMonth} className="p-2 hover:bg-slate-100 rounded-lg">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center font-medium text-slate-500 py-2 text-sm">
                  {day}
                </div>
              ))}

              {days.map((day, index) => {
                const dayInspections = getInspectionsForDay(day);
                const isToday = day && `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}` === todayStr;

                return (
                  <div
                    key={index}
                    className={`min-h-[120px] p-2 border rounded-lg ${
                      day ? 'hover:bg-slate-50 bg-white' : 'bg-slate-50'
                    } ${isToday ? 'ring-2 ring-indigo-500 bg-indigo-50/30' : ''}`}
                  >
                    {day && (
                      <>
                        <div className={`text-sm font-medium mb-2 ${isToday ? 'text-indigo-600 font-bold' : 'text-slate-700'}`}>
                          {day.getDate()}
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
                            <div className="text-xs text-slate-500 font-medium">
                              +{dayInspections.length - 3} more
                            </div>
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
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b">
              <h2 className="text-lg font-bold text-slate-900">Upcoming Inspections</h2>
            </div>
            <div className="divide-y">
              {upcomingInspections.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  No upcoming inspections
                </div>
              ) : (
                upcomingInspections.map(inspection => (
                  <div
                    key={inspection.id}
                    onClick={() => setSelectedInspection(inspection)}
                    className="p-4 hover:bg-slate-50 cursor-pointer flex items-center justify-between"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-3 h-3 rounded-full ${getInspectionColor(inspection.type)}`} />
                      <div>
                        <div className="font-medium text-slate-900">
                          {inspection.property_name}
                          {inspection.unit_name && <span className="text-slate-500"> - Unit {inspection.unit_name}</span>}
                        </div>
                        <div className="text-sm text-slate-500">
                          {inspection.type} • {formatDateCentral(inspection.date)} at {inspection.time}
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
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mt-4">
          <h3 className="text-sm font-medium text-slate-700 mb-3">Inspection Types</h3>
          <div className="flex flex-wrap gap-3">
            {INSPECTION_TYPES.map(type => (
              <div key={type} className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${getInspectionColor(type)}`} />
                <span className="text-sm text-slate-600">{type}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Inspection Details Modal */}
        {selectedInspection && !isEditing && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedInspection(null)}>
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
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
                  <div className="bg-slate-50 rounded-lg p-3">
                    <label className="text-xs text-slate-500 uppercase tracking-wide">Property</label>
                    <p className="font-semibold text-slate-900 mt-1">{selectedInspection.property_name}</p>
                  </div>
                  
                  <div className="bg-slate-50 rounded-lg p-3">
                    <label className="text-xs text-slate-500 uppercase tracking-wide">Unit</label>
                    <p className="font-semibold text-slate-900 mt-1">{selectedInspection.unit_name || '—'}</p>
                  </div>
                  
                  <div className="bg-slate-50 rounded-lg p-3">
                    <label className="text-xs text-slate-500 uppercase tracking-wide">Status</label>
                    <p className={`inline-block px-2 py-0.5 rounded text-sm font-medium mt-1 ${getStatusColor(selectedInspection.status)}`}>
                      {selectedInspection.status}
                    </p>
                  </div>
                  
                  <div className="bg-slate-50 rounded-lg p-3">
                    <label className="text-xs text-slate-500 uppercase tracking-wide">Duration</label>
                    <p className="font-semibold text-slate-900 mt-1">{selectedInspection.duration || 60} min</p>
                  </div>
                </div>
                
                {selectedInspection.attachment_url && (
                  <div className="mb-4">
                    <a 
                      href={selectedInspection.attachment_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 text-sm font-medium"
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
                  className="w-full mb-3 px-4 py-2 border-2 border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 flex items-center justify-center gap-2 font-medium"
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
                        className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
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
              </div>
            </div>
          </div>
        )}

        {/* Edit Inspection Modal */}
        {selectedInspection && isEditing && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setIsEditing(false)}>
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="bg-slate-700 px-6 py-4">
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
                  <label className="block text-sm font-medium text-slate-700 mb-1">Inspection Type</label>
                  <select
                    value={editForm.type}
                    onChange={(e) => setEditForm(prev => ({ ...prev, type: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    {INSPECTION_TYPES.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Property</label>
                  <select
                    value={editForm.property_name}
                    onChange={(e) => setEditForm(prev => ({ ...prev, property_name: e.target.value, unit_name: '' }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="">Select a property...</option>
                    {properties.filter(p => p !== 'all').map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Unit</label>
                  <select
                    value={editForm.unit_name}
                    onChange={(e) => setEditForm(prev => ({ ...prev, unit_name: e.target.value }))}
                    disabled={!editForm.property_name || loadingEditUnits}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-100"
                  >
                    <option value="">{loadingEditUnits ? 'Loading...' : 'Select a unit...'}</option>
                    {editUnits.map(unit => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                    <input
                      type="date"
                      value={editForm.date}
                      onChange={(e) => setEditForm(prev => ({ ...prev, date: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Time</label>
                    <input
                      type="time"
                      value={editForm.time}
                      onChange={(e) => setEditForm(prev => ({ ...prev, time: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              <div className="px-6 pb-6 flex gap-3">
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={saveInspectionEdit}
                  className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Re-Inspection Modal */}
        {showReinspectionModal && selectedInspection && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowReinspectionModal(false)}>
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">Schedule Re-Inspection</h3>
                <button onClick={() => setShowReinspectionModal(false)} className="text-slate-400 hover:text-slate-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <p className="text-sm text-orange-800">
                    Creating re-inspection for <strong>{selectedInspection.property_name}</strong>
                    {selectedInspection.unit_name && <span> - Unit {selectedInspection.unit_name}</span>}
                  </p>
                  <p className="text-xs text-orange-600 mt-1">
                    Linked to: {selectedInspection.type} on {formatDateCentral(selectedInspection.date)}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={reinspectionForm.date}
                    onChange={(e) => setReinspectionForm(prev => ({ ...prev, date: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Time</label>
                  <input
                    type="time"
                    value={reinspectionForm.time}
                    onChange={(e) => setReinspectionForm(prev => ({ ...prev, time: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex gap-2">
                <button
                  onClick={() => setShowReinspectionModal(false)}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
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

        {/* New Inspection Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">New Inspection</h3>
                <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Inspection Type *</label>
                  <select
                    value={newInspectionForm.type}
                    onChange={(e) => setNewInspectionForm(prev => ({ ...prev, type: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    {INSPECTION_TYPES.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Property *</label>
                  <select
                    value={newInspectionForm.property_name}
                    onChange={(e) => setNewInspectionForm(prev => ({ ...prev, property_name: e.target.value, unit_name: '' }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="">Select a property...</option>
                    {properties.filter(p => p !== 'all').map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Unit (optional)</label>
                  <select
                    value={newInspectionForm.unit_name}
                    onChange={(e) => setNewInspectionForm(prev => ({ ...prev, unit_name: e.target.value }))}
                    disabled={!newInspectionForm.property_name || loadingUnits}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="">{loadingUnits ? 'Loading units...' : newInspectionForm.property_name ? 'Select a unit...' : 'Select property first'}</option>
                    {availableUnits.map(unit => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Date *</label>
                  <input
                    type="date"
                    value={newInspectionForm.date}
                    onChange={(e) => setNewInspectionForm(prev => ({ ...prev, date: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Time *</label>
                  <input
                    type="time"
                    value={newInspectionForm.time}
                    onChange={(e) => setNewInspectionForm(prev => ({ ...prev, time: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex gap-2">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={createNewInspection}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
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
