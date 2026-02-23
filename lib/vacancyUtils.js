/**
 * Shared utility functions for calculating vacancy-related dates and days
 * Used across the app for consistent logic
 */

/**
 * Calculate days vacant (positive) or days until vacant (negative)
 * 
 * @param {Object} unit - Unit object with status and date fields
 * @param {string} unit.status - Current status (e.g., 'Vacant-Unrented', 'Notice-Unrented', 'Evict')
 * @param {string} unit.source_type - Source type ('vacancy', 'notice', 'eviction')
 * @param {string} unit.move_out_date - Expected move-out date for notice units
 * @param {string} unit.vacancy_start_date - Date unit became vacant
 * @param {string} unit.eviction_start_date - Date eviction status was set
 * @param {string} unit.created_at - Fallback date if vacancy_start_date not set
 * @returns {Object} { days: number, isVacant: boolean, label: string }
 */
export function calculateVacancyDays(unit) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Determine if unit is currently vacant or pending vacancy
  const isVacant = unit.source_type === 'vacancy' || 
                   (unit.status && unit.status.startsWith('Vacant'));
  
  const isNotice = unit.source_type === 'notice' || 
                   (unit.status && unit.status.startsWith('Notice'));
  
  const isEviction = unit.source_type === 'eviction' || 
                     unit.status === 'Evict';

  if (isVacant) {
    // Unit is already vacant - show positive days vacant
    // Try vacancy_start_date, then created_at, then return null if neither exists
    const dateStr = unit.vacancy_start_date || unit.created_at;
    if (!dateStr) {
      return { days: null, isVacant: true, label: 'Vacancy start date unknown' };
    }
    
    const startDate = new Date(dateStr);
    if (isNaN(startDate.getTime())) {
      return { days: null, isVacant: true, label: 'Invalid vacancy date' };
    }
    startDate.setHours(0, 0, 0, 0);
    
    const daysVacant = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
    
    return {
      days: daysVacant,
      isVacant: true,
      label: `${daysVacant} days vacant`
    };
  }
  
  if (isNotice) {
    // Unit has notice - show negative days until move-out
    if (!unit.move_out_date) {
      return { days: null, isVacant: false, label: 'Move-out date unknown' };
    }
    
    const moveOutDate = new Date(unit.move_out_date);
    moveOutDate.setHours(0, 0, 0, 0);
    
    const daysUntilVacant = Math.ceil((moveOutDate - today) / (1000 * 60 * 60 * 24));
    
    if (daysUntilVacant >= 0) {
      // Still waiting for move-out
      return {
        days: -daysUntilVacant, // Negative to indicate future
        isVacant: false,
        label: `${daysUntilVacant} days until move-out`
      };
    } else {
      // Past move-out date - treat like vacant, show days past move-out
      return {
        days: Math.abs(daysUntilVacant), // Positive - days past move-out
        isVacant: true, // Treat as vacant for sorting/display
        label: `${Math.abs(daysUntilVacant)} days past move-out (notice)`
      };
    }
  }
  
  if (isEviction) {
    // Eviction - assume 45 days from eviction status change
    const EVICTION_DAYS = 45;
    
    // Use eviction_start_date if available, otherwise use created_at or today
    const evictionStartDate = unit.eviction_start_date 
      ? new Date(unit.eviction_start_date)
      : unit.created_at 
        ? new Date(unit.created_at)
        : today;
    evictionStartDate.setHours(0, 0, 0, 0);
    
    const expectedVacantDate = new Date(evictionStartDate);
    expectedVacantDate.setDate(expectedVacantDate.getDate() + EVICTION_DAYS);
    
    const daysUntilVacant = Math.ceil((expectedVacantDate - today) / (1000 * 60 * 60 * 24));
    
    if (daysUntilVacant >= 0) {
      // Still waiting for expected vacancy
      return {
        days: -daysUntilVacant, // Negative to indicate future
        isVacant: false,
        label: `~${daysUntilVacant} days until vacant (eviction)`
      };
    } else {
      // Past expected vacancy date - treat like vacant, show days past expected
      return {
        days: Math.abs(daysUntilVacant), // Positive - days past expected
        isVacant: true, // Treat as vacant for sorting/display
        label: `${Math.abs(daysUntilVacant)} days past expected vacancy (eviction)`
      };
    }
  }
  
  // Unknown status
  return { days: null, isVacant: false, label: 'Unknown status' };
}

/**
 * Get the expected vacant date for a unit
 * 
 * @param {Object} unit - Unit object
 * @returns {Date|null} Expected vacant date or null
 */
export function getExpectedVacantDate(unit) {
  const isVacant = unit.source_type === 'vacancy' || 
                   (unit.status && unit.status.startsWith('Vacant'));
  
  if (isVacant) {
    return null; // Already vacant
  }
  
  const isNotice = unit.source_type === 'notice' || 
                   (unit.status && unit.status.startsWith('Notice'));
  
  if (isNotice && unit.move_out_date) {
    return new Date(unit.move_out_date);
  }
  
  const isEviction = unit.source_type === 'eviction' || 
                     unit.status === 'Evict';
  
  if (isEviction) {
    const EVICTION_DAYS = 45;
    const evictionStartDate = unit.eviction_start_date 
      ? new Date(unit.eviction_start_date)
      : unit.created_at 
        ? new Date(unit.created_at)
        : new Date();
    
    const expectedDate = new Date(evictionStartDate);
    expectedDate.setDate(expectedDate.getDate() + EVICTION_DAYS);
    return expectedDate;
  }
  
  return null;
}

/**
 * Format days for display with appropriate styling info
 * 
 * @param {Object} unit - Unit object
 * @returns {Object} { displayValue: string, colorClass: string, tooltip: string }
 */
export function formatVacancyDays(unit) {
  const result = calculateVacancyDays(unit);
  
  if (result.days === null) {
    return {
      displayValue: '-',
      colorClass: 'text-gray-400',
      tooltip: result.label
    };
  }
  
  if (result.isVacant) {
    // Vacant - show positive number in red
    return {
      displayValue: String(result.days),
      colorClass: 'text-red-600 font-medium',
      tooltip: result.label
    };
  }
  
  // Not yet vacant - show days until vacant (as positive number) in black
  const daysUntil = Math.abs(result.days);
  return {
    displayValue: String(daysUntil),
    colorClass: 'text-gray-900 font-medium',
    tooltip: result.label
  };
}
