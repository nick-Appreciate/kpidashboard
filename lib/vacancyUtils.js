/**
 * Shared utility functions for calculating vacancy-related dates and days
 * Used across the app for consistent logic
 */

/**
 * Parse a date value as LOCAL midnight.
 *
 * `new Date('2026-09-30')` is parsed as UTC midnight, which in any timezone
 * behind UTC lands on the previous day once compared against a local-midnight
 * "today" — so every count here was off by one: vacancies read a day longer
 * than they were, notice countdowns a day shorter.
 */
function parseLocalDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

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
    
    const startDate = parseLocalDate(dateStr);
    if (!startDate) {
      return { days: null, isVacant: true, label: 'Invalid vacancy date' };
    }
    
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
    
    const moveOutDate = parseLocalDate(unit.move_out_date);
    if (!moveOutDate) {
      return { days: null, isVacant: false, label: 'Move-out date unknown' };
    }
    
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
    const evictionStartDate =
      parseLocalDate(unit.eviction_start_date) || parseLocalDate(unit.created_at) || today;
    
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
    return parseLocalDate(unit.move_out_date);
  }
  
  const isEviction = unit.source_type === 'eviction' || 
                     unit.status === 'Evict';
  
  if (isEviction) {
    const EVICTION_DAYS = 45;
    const evictionStartDate =
      parseLocalDate(unit.eviction_start_date) || parseLocalDate(unit.created_at) || new Date();
    
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
      colorClass: 'text-slate-500',
      tooltip: result.label
    };
  }

  if (result.isVacant) {
    // Already vacant - days elapsed.
    return {
      displayValue: String(result.days),
      colorClass: 'text-red-400 font-medium',
      tooltip: result.label
    };
  }

  // On notice or in eviction - counting down to move-out. Red as well: the
  // unit is about to stop earning, so it wants the same attention as one
  // that already has. The Status column is what distinguishes the two.
  //
  // These were previously light-theme classes (text-gray-900 on a near-black
  // background), which made the countdown effectively invisible.
  const daysUntil = Math.abs(result.days);
  return {
    displayValue: String(daysUntil),
    colorClass: 'text-red-400 font-medium',
    tooltip: result.label
  };
}
