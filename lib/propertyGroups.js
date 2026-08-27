// Shared property-grouping definitions used by every dashboard with a
// property selector. The dropdown options + the resolver that turns a
// selection (property name / region / farquhar / portfolio) into the
// concrete list of property names live here, so all consumers stay in sync.

// Substring matchers for the Kansas City named complexes. Case-insensitive
// fuzzy match because rent_roll/snapshots sometimes carry different name
// conventions than af_property_directory.
//
// SINGLE SOURCE OF TRUTH. When onboarding a new property to KC, add it here
// only — every dashboard/API is supposed to import from this file. If you
// find a file with its own private KC list, refactor it to import from here
// (see `filterRecordsByRegion` and `matchesKansasCity` below).
export const KC_PROPERTY_MATCHERS = [
  'hilltop',
  'oakwood',
  'glen oaks',
  'normandy',
  'maple manor',
  'ide lofts',
];

// Properties physically rolled up under Pioneer Apartments in DoorLoop
// (address-level records that AppFolio represents as a single complex).
export const PIONEER_DOORLOOP_ALIASES = ['2404 Whitegate Drive', '2406 Whitegate Drive', '2414 Whitegate Drive'];

// "Farquhar" portfolio = the properties owned by the Farquhar group.
// Glen Oaks was never part of it. Hilltop Townhomes was sold to another
// group on 2026-04-22 — we still manage Hilltop, so it appears in every
// other filter, but it's no longer part of Farquhar after that date.
export const FARQUHAR_EXCLUDED_ALWAYS = ['Glen Oaks'];
export const FARQUHAR_PROPERTY_CUTOFFS = {
  'Hilltop Townhomes': '2026-04-22',
};

/**
 * Has a Farquhar-cutoff property's cutoff date passed (relative to today)?
 * Used by simple "current snapshot" filters (rent-roll, collections, etc.)
 * that don't want to do per-period reasoning.
 */
function isPastCutoffToday(propertyName, today = new Date()) {
  const cutoff = FARQUHAR_PROPERTY_CUTOFFS[propertyName];
  if (!cutoff) return false;
  return today >= new Date(cutoff + 'T00:00:00');
}

/**
 * The set of properties currently in the Farquhar portfolio (today).
 * Drops always-excluded properties + any cutoff property whose cutoff has passed.
 */
export function farquharPropertiesToday(availableProperties = [], today = new Date()) {
  return availableProperties.filter(p => {
    if (FARQUHAR_EXCLUDED_ALWAYS.includes(p)) return false;
    if (isPastCutoffToday(p, today)) return false;
    return true;
  });
}

/**
 * Resolve a property selection (the value coming out of the dropdown) into
 * the concrete list of property names that should be queried, OR `null` to
 * mean "no filter / all properties".
 *
 * For Farquhar, returns ALL Farquhar properties (even those past their
 * cutoff) — the cutoff is applied per-period in get_churn_metrics via
 * `cutoff_dates`. Use farquharPropertiesToday() instead when you want a
 * "current snapshot" filter.
 */
export function resolvePropertySelection(selection, availableProperties = []) {
  if (!selection || selection === 'portfolio' || selection === 'all') return null;

  if (selection === 'region_kansas_city') {
    return availableProperties.filter(p =>
      KC_PROPERTY_MATCHERS.some(kc => p.toLowerCase().includes(kc))
    );
  }
  if (selection === 'region_columbia') {
    return availableProperties.filter(p =>
      !KC_PROPERTY_MATCHERS.some(kc => p.toLowerCase().includes(kc))
    );
  }
  if (selection === 'farquhar') {
    return availableProperties.filter(p => !FARQUHAR_EXCLUDED_ALWAYS.includes(p));
  }

  // Specific property: include the name itself plus any DoorLoop-side
  // address aliases that roll up into it.
  const list = [selection];
  if (selection === 'Pioneer Apartments') list.push(...PIONEER_DOORLOOP_ALIASES);
  return list;
}

/**
 * Per-property cutoff dates to pass to get_churn_metrics(cutoff_dates) when
 * the user selected Farquhar — null otherwise.
 */
export function cutoffDatesFor(selection) {
  if (selection === 'farquhar') return FARQUHAR_PROPERTY_CUTOFFS;
  return null;
}

/**
 * The standard preset options to render in a property dropdown, in display
 * order. Components that already have a "All Properties" option should
 * insert these after it.
 */
export const PRESET_PROPERTY_OPTIONS = [
  { value: 'farquhar',           label: 'Farquhar' },
  { value: 'region_kansas_city', label: 'Kansas City (region)' },
  { value: 'region_columbia',    label: 'Columbia (region)' },
];

// -----------------------------------------------------------------------
// Region-membership helpers used by API routes and client components to
// filter arbitrary record lists by region without re-implementing the
// (property|unit) fuzzy match and the Farquhar cutoff dance.
// -----------------------------------------------------------------------

const FARQUHAR_HILLTOP_CUTOFF = new Date('2026-04-22T00:00:00');

/**
 * Case-insensitive KC substring match against a property name, unit label,
 * or any string that might contain either. Accepts `null`/`undefined` and
 * returns false for those, so callers don't have to null-check.
 */
export function matchesKansasCity(propOrUnit) {
  if (!propOrUnit) return false;
  const s = String(propOrUnit).toLowerCase();
  return KC_PROPERTY_MATCHERS.some(kc => s.includes(kc));
}

/**
 * Should a record with these (property, unit) values be considered part of
 * the Farquhar portfolio at the given moment? Glen Oaks was never part of
 * Farquhar; Hilltop is excluded after 2026-04-22.
 */
export function matchesFarquhar(propOrUnit, unit = '', today = new Date()) {
  const prop = String(propOrUnit || '').toLowerCase();
  const u    = String(unit         || '').toLowerCase();
  const isGlenOaks = prop.includes('glen oaks') || u.includes('glen oaks');
  if (isGlenOaks) return false;
  const isHilltop = prop.includes('hilltop') || u.includes('hilltop');
  if (isHilltop && today >= FARQUHAR_HILLTOP_CUTOFF) return false;
  return true;
}

/**
 * Filter an arbitrary record list by region. Each record is expected to
 * have at least one of `property` / `unit`; both are consulted for region
 * membership (unit-level records like rental_applications carry the
 * property name in the unit label).
 *
 * @param records  array of records with `property` and/or `unit` fields
 * @param region   'region_kansas_city' | 'region_columbia' | 'farquhar'
 *                 or any falsy value (returns records unchanged)
 * @param opts     { today?: Date, includeUnknown?: boolean }
 *                 includeUnknown (default true) keeps records with neither
 *                 property nor unit set (older imports without either)
 */
export function filterRecordsByRegion(records, region, opts = {}) {
  if (!region) return records;
  const today          = opts.today ?? new Date();
  const includeUnknown = opts.includeUnknown ?? true;
  return records.filter(r => {
    const prop = String(r?.property || '').toLowerCase();
    const unit = String(r?.unit     || '').toLowerCase();
    if (!prop && !unit) return includeUnknown;
    const matchesKC = matchesKansasCity(prop) || matchesKansasCity(unit);
    if (region === 'region_kansas_city') return matchesKC;
    if (region === 'region_columbia')    return !matchesKC;
    if (region === 'farquhar')           return matchesFarquhar(prop, unit, today);
    return true;
  });
}
