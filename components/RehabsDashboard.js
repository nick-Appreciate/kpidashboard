'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { LogoLoader } from './Logo';
import { formatVacancyDays, calculateVacancyDays } from '../lib/vacancyUtils';
import RehabsChart from './RehabsChart';

export default function RehabsDashboard() {
  const [rehabs, setRehabs] = useState([]);
  const [newVacancies, setNewVacancies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProperty, setSelectedProperty] = useState('all');
  const [properties, setProperties] = useState([]);
  const [editingRehab, setEditingRehab] = useState(null);
  const [totalUnits, setTotalUnits] = useState(0);
  
  // Toggle Ready for Move-In status (persisted to database)
  const toggleReadyForMoveIn = async (unitId) => {
    const unit = rehabs.find(r => r.id === unitId);
    if (!unit) return;
    
    const newValue = !unit.ready_for_movein;
    
    // Optimistic update
    setRehabs(prev => prev.map(r => 
      r.id === unitId ? { ...r, ready_for_movein: newValue } : r
    ));
    
    // Persist to database
    await updateRehabField(unitId, 'ready_for_movein', newValue);
  };
  
  // Column sorting
  const [sortColumn, setSortColumn] = useState('property');
  const [sortDirection, setSortDirection] = useState('asc');
  
  const toggleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };
  
  const getSortIcon = (column) => {
    if (sortColumn !== column) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  };
  
  // Onboarding modal state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingUnit, setOnboardingUnit] = useState(null);
  const [onboardingForm, setOnboardingForm] = useState({
    contractor: '',
    goal_completion_date: '',
    pest_control_needed: false,
    surface_restoration_needed: false,
    junk_removal_needed: false
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchRehabs();
  }, [selectedProperty]);

  const fetchRehabs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedProperty && selectedProperty !== 'all') {
        params.append('property', selectedProperty);
      }
      
      const response = await fetch(`/api/rehabs?${params}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch rehabs');
      }
      
      setRehabs(data.rehabs || []);
      setNewVacancies(data.newVacancies || []);
      setTotalUnits(data.totalUnits || 0);
      
      // Extract unique properties
      const allProps = new Set([
        ...data.rehabs.map(r => r.property),
        ...data.newVacancies.map(v => v.property)
      ]);
      setProperties([...allProps].sort());
      
    } catch (err) {
      console.error('Error fetching rehabs:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openOnboarding = (vacancy) => {
    setOnboardingUnit(vacancy);
    setOnboardingForm({
      contractor: '',
      goal_completion_date: '',
      rehab_status: 'Not Started',
      pest_control_needed: false,
      surface_restoration_needed: false,
      junk_removal_needed: false
    });
    setShowOnboarding(true);
  };

  const handleOnboardingSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const response = await fetch('/api/rehabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property: onboardingUnit.property,
          unit: onboardingUnit.unit,
          contractor: onboardingForm.contractor,
          goal_completion_date: onboardingForm.goal_completion_date || null,
          rehab_status: onboardingForm.rehab_status,
          pest_control_needed: onboardingForm.pest_control_needed,
          surface_restoration_needed: onboardingForm.surface_restoration_needed,
          junk_removal_needed: onboardingForm.junk_removal_needed,
          source_type: onboardingUnit.source_type,
          move_out_date: onboardingUnit.move_out_date
        })
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create rehab');
      }
      
      setShowOnboarding(false);
      setOnboardingUnit(null);
      fetchRehabs();
      
    } catch (err) {
      console.error('Error creating rehab:', err);
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateRehabField = async (rehabId, field, value) => {
    // Save scroll position before update
    const scrollY = window.scrollY;
    
    try {
      const response = await fetch('/api/rehabs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: rehabId,
          [field]: value
        })
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update');
      }
      
      const updatedRehab = await response.json();
      setRehabs(prev => prev.map(r => r.id === rehabId ? updatedRehab : r));
      
      // Restore scroll position after React re-render
      requestAnimationFrame(() => {
        window.scrollTo(0, scrollY);
      });
      
    } catch (err) {
      console.error('Error updating rehab:', err);
      alert(err.message);
    }
  };

  const getDaysVacant = (rehab) => {
    const startDate = rehab.vacancy_start_date ? new Date(rehab.vacancy_start_date) : new Date(rehab.created_at);
    const today = new Date();
    return Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
  };

  const getDaysUntilMoveOut = (rehab) => {
    if (!rehab.move_out_date) return null;
    const moveOut = new Date(rehab.move_out_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((moveOut - today) / (1000 * 60 * 60 * 24));
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case 'Complete':
        return 'bg-green-500 text-white';
      case 'Supervisor Onboard':
        return 'bg-purple-300 text-purple-900';
      case 'In Progress':
        return 'bg-yellow-300 text-yellow-900';
      case 'Waiting':
        return 'bg-red-400 text-white';
      case 'Back Burner':
        return 'bg-orange-300 text-orange-900';
      case 'Not Started':
        return 'bg-red-500 text-white';
      default:
        return 'bg-gray-200 text-gray-700';
    }
  };

  const getOccupancyStatus = (rehab) => {
    if (rehab.source_type === 'notice') return 'Notice';
    if (rehab.source_type === 'eviction') return 'Eviction';
    return 'Vacant';
  };

  const getChecklistItems = (rehab) => {
    const items = [
      { key: 'vendor_key', label: 'Rehab Key', completed: rehab.vendor_key_completed, excluded: rehab.vendor_key_excluded },
      { key: 'utilities', label: 'Utilities', completed: rehab.utilities_completed, excluded: rehab.utilities_excluded },
      { key: 'junk_removal', label: 'Junk', completed: rehab.junk_removal_completed, excluded: rehab.junk_removal_excluded },
      { key: 'pest_control', label: 'Pest', completed: rehab.pest_control_completed, excluded: rehab.pest_control_excluded },
      { key: 'surface_restoration', label: 'Surface', completed: rehab.surface_restoration_completed, excluded: rehab.surface_restoration_excluded },
      { key: 'cleaned', label: 'Clean', completed: rehab.cleaned_completed, excluded: rehab.cleaned_excluded },
      { key: 'leasing_signoff', label: 'Final Walkthrough', completed: rehab.leasing_signoff_completed, excluded: rehab.leasing_signoff_excluded },
      { key: 'tenant_key', label: 'Tenant Key', completed: rehab.tenant_key_completed, excluded: rehab.tenant_key_excluded },
    ];
    return items;
  };

  const getChecklistProgress = (rehab) => {
    const items = getChecklistItems(rehab);
    if (items.length === 0) return { completed: 0, total: 0, percent: 0 };
    const activeItems = items.filter(i => !i.excluded);
    const completed = activeItems.filter(i => i.completed).length;
    const total = activeItems.length;
    return { completed, total, percent: total > 0 ? Math.round((completed / total) * 100) : 0 };
  };

  const cycleChecklistState = async (rehabId, itemKey, currentCompleted, currentExcluded) => {
    if (!currentCompleted && !currentExcluded) {
      await updateRehabField(rehabId, `${itemKey}_completed`, true);
    } else if (currentCompleted && !currentExcluded) {
      await updateRehabField(rehabId, `${itemKey}_completed`, false);
      await updateRehabField(rehabId, `${itemKey}_excluded`, true);
    } else {
      await updateRehabField(rehabId, `${itemKey}_excluded`, false);
    }
  };

  if (loading && rehabs.length === 0) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <LogoLoader size={64} text="Loading rehabs..." />
      </div>
    );
  }

  // Status order for sorting
  const statusOrder = ['Not Started', 'Supervisor Onboard', 'Back Burner', 'Waiting', 'In Progress', 'Complete'];
  
  // Filter rehabs by selected property
  const filteredRehabs = selectedProperty === 'all' 
    ? rehabs 
    : rehabs.filter(r => r.property === selectedProperty);
  
  // All units for the table view (newVacancies are now auto-created as rehabs with 'Not Started' status)
  const allUnits = filteredRehabs
    .filter(r => r.status === 'in_progress')
    .sort((a, b) => {
      let comparison = 0;
      
      switch (sortColumn) {
        case 'unit':
          comparison = (a.unit || '').localeCompare(b.unit || '');
          break;
        case 'property':
          comparison = (a.property || '').localeCompare(b.property || '');
          break;
        case 'occupancy':
          comparison = getOccupancyStatus(a).localeCompare(getOccupancyStatus(b));
          break;
        case 'days':
          // Use calculateVacancyDays which returns negative for days until move-out, positive for days vacant
          const vacancyResultA = calculateVacancyDays(a);
          const vacancyResultB = calculateVacancyDays(b);
          // For vacant units: days is positive (days vacant)
          // For notice/eviction: days is negative (days until move-out)
          // null values go to the end
          const daysA = vacancyResultA.days !== null ? vacancyResultA.days : -99999;
          const daysB = vacancyResultB.days !== null ? vacancyResultB.days : -99999;
          comparison = daysA - daysB;
          break;
        case 'contractor':
          comparison = (a.contractor || 'zzz').localeCompare(b.contractor || 'zzz');
          break;
        case 'status':
          // Sort by status, but within Complete status, sort ready_for_movein first
          const statusA = statusOrder.indexOf(a.rehab_status || 'Not Started');
          const statusB = statusOrder.indexOf(b.rehab_status || 'Not Started');
          if (statusA !== statusB) {
            comparison = statusA - statusB;
          } else if (a.rehab_status === 'Complete' && b.rehab_status === 'Complete') {
            // Within Complete, ready_for_movein ALWAYS comes first (not affected by sort direction)
            // Return early to bypass the sort direction flip
            const readyComparison = (b.ready_for_movein ? 1 : 0) - (a.ready_for_movein ? 1 : 0);
            if (readyComparison !== 0) {
              return readyComparison; // Always put ready first, regardless of sort direction
            }
            comparison = 0;
          } else {
            comparison = 0;
          }
          break;
        case 'checklist':
          const progressA = getChecklistProgress(a).percent;
          const progressB = getChecklistProgress(b).percent;
          comparison = progressA - progressB;
          break;
        default:
          comparison = (a.property || '').localeCompare(b.property || '');
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });

  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="max-w-full mx-auto">
        {/* Compact Header */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold text-slate-800">🔧 Rehabs</h1>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={selectedProperty}
                onChange={(e) => setSelectedProperty(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="all">All Properties</option>
                {properties.map(prop => (
                  <option key={prop} value={prop}>{prop}</option>
                ))}
              </select>
              <button
                onClick={fetchRehabs}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded text-sm hover:bg-slate-200"
              >
                Refresh
              </button>
            </div>
          </div>
          
          {/* Status Counters */}
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
            {(() => {
              const allItems = filteredRehabs.filter(r => r.status === 'in_progress');
              const statusCounts = {};
              const totalCount = allItems.length;
              statusOrder.forEach(s => { statusCounts[s] = 0; });
              allItems.forEach(item => {
                const status = item.rehab_status || 'Not Started';
                statusCounts[status] = (statusCounts[status] || 0) + 1;
              });
              return statusOrder.map(status => {
                const count = statusCounts[status];
                const percent = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
                return (
                  <div 
                    key={status}
                    className={`px-2 py-1 rounded text-xs font-medium ${getStatusStyle(status)}`}
                  >
                    {status}: {count}{count > 0 && ` (${percent}%)`}
                  </div>
                );
              });
            })()}
            <div className="px-2 py-1 rounded text-xs font-medium bg-slate-200 text-slate-700">
              {(() => {
                const inRehabCount = filteredRehabs.filter(r => r.status === 'in_progress').length;
                const percent = totalUnits > 0 ? ((inRehabCount / totalUnits) * 100).toFixed(1) : 0;
                return `In Rehab: ${inRehabCount}/${totalUnits} (${percent}%)`;
              })()}
            </div>
          </div>
        </div>

        {/* Spreadsheet Table */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-blue-100 text-blue-900 text-xs">
                  <th 
                    className="px-1 py-2 text-left font-semibold border-r border-blue-200 w-16 cursor-pointer hover:bg-blue-200"
                    onClick={() => toggleSort('unit')}
                  >
                    Unit {getSortIcon('unit')}
                  </th>
                  <th 
                    className="px-1 py-2 text-left font-semibold border-r border-blue-200 w-24 cursor-pointer hover:bg-blue-200"
                    onClick={() => toggleSort('property')}
                  >
                    Property {getSortIcon('property')}
                  </th>
                  <th 
                    className="px-1 py-2 text-center font-semibold border-r border-blue-200 w-16 cursor-pointer hover:bg-blue-200"
                    onClick={() => toggleSort('occupancy')}
                  >
                    Occ {getSortIcon('occupancy')}
                  </th>
                  <th 
                    className="px-1 py-2 text-center font-semibold border-r border-blue-200 w-12 cursor-pointer hover:bg-blue-200"
                    onClick={() => toggleSort('days')}
                  >
                    Days {getSortIcon('days')}
                  </th>
                  <th 
                    className="px-1 py-2 text-center font-semibold border-r border-blue-200 w-16 cursor-pointer hover:bg-blue-200"
                    onClick={() => toggleSort('contractor')}
                  >
                    Cont {getSortIcon('contractor')}
                  </th>
                  <th 
                    className="px-1 py-2 text-center font-semibold border-r border-blue-200 w-28 cursor-pointer hover:bg-blue-200"
                    onClick={() => toggleSort('status')}
                  >
                    Status {getSortIcon('status')}
                  </th>
                  <th 
                    className="px-1 py-2 text-center font-semibold border-r border-blue-200 w-48 cursor-pointer hover:bg-blue-200"
                    onClick={() => toggleSort('checklist')}
                  >
                    Checklist {getSortIcon('checklist')}
                  </th>
                  <th className="px-1 py-2 text-center font-semibold w-14">Action</th>
                </tr>
              </thead>
              <tbody>
                {allUnits.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                      No units requiring rehab
                    </td>
                  </tr>
                ) : (
                  allUnits.map((unit, idx) => (
                    <tr 
                      key={unit.id || `new-${idx}`} 
                      className={`border-b border-gray-100 hover:bg-blue-50 ${unit.ready_for_movein ? 'bg-green-100' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                    >
                      <td className="px-1 py-1.5 border-r border-gray-100 font-medium text-gray-800 text-xs truncate max-w-[64px]" title={unit.unit}>
                        {unit.unit}
                      </td>
                      <td className="px-1 py-1.5 border-r border-gray-100 text-gray-600 text-xs truncate max-w-[96px]" title={unit.property}>
                        {unit.property}
                      </td>
                      <td className="px-1 py-1.5 border-r border-gray-100 text-center">
                        <span className={`text-xs ${unit.source_type === 'vacancy' ? 'text-red-600' : unit.source_type === 'notice' ? 'text-orange-600' : 'text-gray-600'}`}>
                          {getOccupancyStatus(unit)}
                        </span>
                      </td>
                      <td className="px-1 py-1.5 border-r border-gray-100 text-center text-xs">
                        {(() => {
                          const vacancyInfo = formatVacancyDays(unit);
                          return (
                            <span className={vacancyInfo.colorClass} title={vacancyInfo.tooltip}>
                              {vacancyInfo.displayValue}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-1 py-1.5 border-r border-gray-100 text-center">
                        <select
                          value={unit.contractor || ''}
                          onChange={(e) => updateRehabField(unit.id, 'contractor', e.target.value)}
                          className="w-full px-0 py-0.5 text-xs border-0 bg-transparent focus:ring-1 focus:ring-blue-500 rounded"
                        >
                          <option value="">-</option>
                          <option value="Jose">Jose</option>
                          <option value="Stephen">Stephen</option>
                        </select>
                      </td>
                      <td className="px-1 py-1 border-r border-gray-100">
                        <select
                          value={unit.rehab_status || 'Not Started'}
                          onChange={(e) => updateRehabField(unit.id, 'rehab_status', e.target.value)}
                          className={`w-full px-1 py-1 text-xs border-0 rounded text-center font-medium ${getStatusStyle(unit.rehab_status || 'Not Started')}`}
                        >
                          <option value="Not Started">Not Started</option>
                          <option value="Supervisor Onboard">Supervisor Onboard</option>
                          <option value="Back Burner">Back Burner</option>
                          <option value="Waiting">Waiting</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Complete">Complete</option>
                        </select>
                      </td>
                      <td className="px-2 py-1 border-r border-gray-100">
                        <div className="flex items-center gap-1.5">
                          {getChecklistItems(unit).map(item => (
                            <button
                              key={item.key}
                              onClick={() => cycleChecklistState(unit.id, item.key, item.completed, item.excluded)}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                item.excluded
                                  ? 'bg-red-400 text-white line-through opacity-60'
                                  : item.completed 
                                    ? 'bg-green-500 text-white' 
                                    : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                              }`}
                              title={`${item.label}: ${item.excluded ? 'Excluded (not counted)' : item.completed ? 'Complete' : 'Pending'} - Click to cycle`}
                            >
                              {item.label}
                            </button>
                          ))}
                          <span className="text-xs text-gray-500 ml-1 font-medium">
                            {getChecklistProgress(unit).completed}/{getChecklistProgress(unit).total}
                          </span>
                          <button
                            onClick={() => toggleReadyForMoveIn(unit.id)}
                            className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                              unit.ready_for_movein
                                ? 'bg-green-600 text-white border-green-600'
                                : 'bg-white text-green-600 border-green-500 hover:bg-green-50'
                            }`}
                            title={unit.ready_for_movein ? 'Click to unmark' : 'Mark as Ready for Move-In'}
                          >
                            ✓ Ready
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={() => setEditingRehab(unit)}
                          className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Rehabs Chart */}
      <RehabsChart rehabs={filteredRehabs} selectedProperty={selectedProperty} />

      {/* Edit Modal */}
      {editingRehab && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
            <h3 className="text-xl font-semibold text-gray-800 mb-2">Edit Rehab</h3>
            <p className="text-gray-600 mb-4">
              <span className="font-medium">{editingRehab.unit}</span> at {editingRehab.property}
            </p>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contractor</label>
                  <select
                    value={editingRehab.contractor || ''}
                    onChange={(e) => {
                      updateRehabField(editingRehab.id, 'contractor', e.target.value);
                      setEditingRehab(prev => ({ ...prev, contractor: e.target.value }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="">Select contractor</option>
                    <option value="Jose">Jose</option>
                    <option value="Stephen">Stephen</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={editingRehab.rehab_status || 'Not Started'}
                    onChange={(e) => {
                      updateRehabField(editingRehab.id, 'rehab_status', e.target.value);
                      setEditingRehab(prev => ({ ...prev, rehab_status: e.target.value }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="Not Started">Not Started</option>
                    <option value="Supervisor Onboard">Supervisor Onboard</option>
                    <option value="Back Burner">Back Burner</option>
                    <option value="Waiting">Waiting</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Complete">Complete</option>
                  </select>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Goal Completion Date</label>
                <input
                  type="date"
                  value={editingRehab.goal_completion_date || ''}
                  onChange={(e) => {
                    updateRehabField(editingRehab.id, 'goal_completion_date', e.target.value);
                    setEditingRehab(prev => ({ ...prev, goal_completion_date: e.target.value }));
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              
              <div className="text-sm text-gray-600 space-y-1">
                <div><span className="font-medium">Days Vacant:</span> {getDaysVacant(editingRehab)}</div>
                <div><span className="font-medium">Source:</span> {editingRehab.source_type || 'Unknown'}</div>
                {editingRehab.move_out_date && (
                  <div><span className="font-medium">Move Out:</span> {new Date(editingRehab.move_out_date).toLocaleDateString()}</div>
                )}
              </div>
            </div>
            
            <div className="flex gap-3 pt-6">
              <button
                onClick={() => setEditingRehab(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Modal */}
      {showOnboarding && onboardingUnit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-semibold text-gray-800 mb-2">Setup Rehab</h3>
            <p className="text-gray-600 mb-4">
              <span className="font-medium">{onboardingUnit.unit}</span> at {onboardingUnit.property}
            </p>
            
            <form onSubmit={handleOnboardingSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Assigned Contractor
                </label>
                <select
                  value={onboardingForm.contractor}
                  onChange={(e) => setOnboardingForm(prev => ({ ...prev, contractor: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                >
                  <option value="">Select contractor</option>
                  <option value="Jose">Jose</option>
                  <option value="Stephen">Stephen</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Goal Completion Date
                </label>
                <input
                  type="date"
                  value={onboardingForm.goal_completion_date}
                  onChange={(e) => setOnboardingForm(prev => ({ ...prev, goal_completion_date: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  value={onboardingForm.rehab_status}
                  onChange={(e) => setOnboardingForm(prev => ({ ...prev, rehab_status: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                >
                  <option value="Not Started">Not Started</option>
                  <option value="Supervisor Onboard">Supervisor Onboard</option>
                  <option value="Back Burner">Back Burner</option>
                  <option value="Waiting">Waiting</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Complete">Complete</option>
                </select>
              </div>
              
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowOnboarding(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium disabled:opacity-50"
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Start Rehab'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
