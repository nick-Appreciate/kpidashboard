import { supabase } from './supabase';
import { fetchAllRows } from './supabase-paging';
import { DEFAULT_LOCALE, getDictionary, type Locale } from './i18n';

// Types that mirror the af_listings + af_listing_photos tables, shaped for
// the public site's UI. Kept deliberately separate from the Supabase row
// types so UI components don't leak DB column quirks.

export interface Listing {
  id: string;
  listing_id: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  rent: number;
  rent_range: string;
  bedrooms: number;
  bathrooms: number;
  square_feet: number;
  available_on: string | null;
  application_fee: number;
  deposit: number;
  pet_policy: string;
  marketing_description: string | null;
  application_url: string;
  default_photo_url: string | null;
  photos: string[];
  /**
   * Resolved via af_listing_unit_public (rentable_uid = af_listings.id).
   * AppFolio's public scrape exposes only an address, so this is the only
   * way to know that 2602 Delavan and 2625 Farrow are one community.
   */
  property_name: string | null;
  unit_name: string | null;
}

export interface Property {
  key: string;
  /** Property name when we can resolve one, else the first address. */
  name: string;
  /** Every distinct street address under this property, in display order. */
  addresses: string[];
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  photos: string[];
  units: Listing[];
  minRent: number;
  maxRent: number;
  nextAvailable: string;
}

// ─── Fetch helpers (anon client + public-select RLS) ─────────────────

type UnitIdentity = { property_name: string | null; unit_name: string | null };

function rowToListing(
  row: any,
  photos: string[],
  identity: UnitIdentity = { property_name: null, unit_name: null },
): Listing {
  const rent = Number(row.rent ?? 0);
  return {
    id: row.id,
    listing_id: row.listing_id ?? 0,
    address: row.address ?? '',
    city: row.city ?? '',
    state: row.state ?? '',
    zip: row.zip ?? '',
    latitude: Number(row.latitude ?? 0),
    longitude: Number(row.longitude ?? 0),
    rent,
    rent_range: row.rent_range ?? (rent ? `$${rent.toLocaleString()}` : ''),
    bedrooms: Number(row.bedrooms ?? 0),
    bathrooms: Number(row.bathrooms ?? 0),
    square_feet: Number(row.square_feet ?? 0),
    available_on: row.available_on ?? null,
    application_fee: Number(row.application_fee ?? 0),
    deposit: Number(row.deposit ?? 0),
    pet_policy: row.pet_policy ?? '',
    marketing_description: row.marketing_description ?? null,
    application_url: row.application_url ?? '',
    default_photo_url: row.default_photo_url ?? null,
    photos,
    property_name: identity.property_name,
    unit_name: identity.unit_name,
  };
}

/**
 * rentable_uid -> property identity. af_listing_unit_public exists precisely
 * for this: af_unit_directory itself is authenticated-only, and the public
 * site runs on the anon key.
 */
async function fetchUnitIdentities(): Promise<Map<string, UnitIdentity>> {
  const { data, error } = await fetchAllRows<{
    rentable_uid: string;
    property_name: string | null;
    unit_name: string | null;
  }>(() =>
    supabase.from('af_listing_unit_public').select('rentable_uid, property_name, unit_name'),
  );
  const map = new Map<string, UnitIdentity>();
  if (error) {
    // Non-fatal: listings still render, they just group by address.
    console.error('[listings] fetch unit identities failed:', error.message);
    return map;
  }
  for (const r of data || []) {
    if (r.rentable_uid) {
      map.set(String(r.rentable_uid), {
        property_name: r.property_name || null,
        unit_name: r.unit_name || null,
      });
    }
  }
  return map;
}

/** Fetch every active listing + its photos. Server components should use this. */
export async function fetchActiveListings(): Promise<Listing[]> {
  // Photos routinely exceed 1000 rows once we're past ~65 listings — page both.
  const [{ data: listingRows, error: le }, { data: photoRows, error: pe }, identities] =
    await Promise.all([
      fetchAllRows<any>(() =>
        supabase
          .from('af_listings')
          .select('*')
          .is('inactive_since', null)
          .order('available_on', { ascending: true, nullsFirst: false }),
      ),
      fetchAllRows<{ listing_id: string; photo_url: string; position: number }>(() =>
        supabase
          .from('af_listing_photos')
          .select('listing_id, photo_url, position')
          .order('position', { ascending: true }),
      ),
      fetchUnitIdentities(),
    ]);

  if (le) {
    console.error('[listings] fetch listings failed:', le.message);
    return [];
  }
  if (pe) {
    console.error('[listings] fetch photos failed:', pe.message);
  }

  // Group photos by listing_id in position order
  const photosByListing = new Map<string, string[]>();
  for (const p of photoRows || []) {
    const arr = photosByListing.get(p.listing_id) || [];
    arr.push(p.photo_url);
    photosByListing.set(p.listing_id, arr);
  }

  const listings = (listingRows || []).map(row =>
    rowToListing(row, photosByListing.get(row.id) || [], identities.get(String(row.id)) ?? {
      property_name: null,
      unit_name: null,
    }),
  );
  return cleanListings(listings);
}

/** Same grouping key groupByProperty uses: the property, else the building's coordinates. */
function propertyKey(l: Listing): string {
  return l.property_name
    ? `p:${l.property_name}`
    : `c:${l.latitude.toFixed(5)}_${l.longitude.toFixed(5)}`;
}

/**
 * Fixes AppFolio's listing feed for display:
 *  - AppFolio appends the company logo to every listing's photos. Any photo
 *    shared by listings at 3+ different properties is branding, not the
 *    unit, so it's dropped (it showed as a cropped "APPRECIATE" tile).
 *  - The marketing description is written per property, but AppFolio leaves
 *    it blank on some unit listings; those borrow a sibling unit's copy.
 */
function cleanListings(listings: Listing[]): Listing[] {
  const propsByPhoto = new Map<string, Set<string>>();
  const descByProperty = new Map<string, string>();
  for (const l of listings) {
    const key = propertyKey(l);
    for (const url of l.photos) {
      if (!propsByPhoto.has(url)) propsByPhoto.set(url, new Set());
      propsByPhoto.get(url)!.add(key);
    }
    if (l.marketing_description?.trim() && !descByProperty.has(key)) {
      descByProperty.set(key, l.marketing_description);
    }
  }
  const isBranding = (url: string | null) => !!url && (propsByPhoto.get(url)?.size ?? 0) >= 3;
  // default_photo_url is AppFolio's medium-size copy of a photo; match on the image id.
  const brandingIds = new Set(
    Array.from(propsByPhoto.keys()).filter(isBranding).map(u => u.split('/images/')[1]?.split('/')[0]),
  );
  return listings.map(l => {
    const photos = l.photos.filter(u => !isBranding(u));
    const defaultId = l.default_photo_url?.split('/images/')[1]?.split('/')[0];
    return {
      ...l,
      photos,
      default_photo_url: defaultId && brandingIds.has(defaultId) ? photos[0] ?? null : l.default_photo_url,
      marketing_description: l.marketing_description?.trim()
        ? l.marketing_description
        : descByProperty.get(propertyKey(l)) ?? null,
    };
  });
}

/**
 * One active listing by id, or null if not found or inactive. Built from the
 * full set because cleaning needs every listing (see cleanListings).
 */
export async function fetchListingById(id: string): Promise<Listing | null> {
  const listings = await fetchActiveListings();
  return listings.find(l => l.id === id) ?? null;
}

// ─── Grouping ────────────────────────────────────────────────────────

/**
 * Group units into properties using lat/lng as the key. Units at the same
 * building share identical coordinates (AppFolio's public scrape doesn't
 * expose a property_id, so this is the best available proxy).
 */
export function groupByProperty(listings: Listing[]): Property[] {
  const byKey = new Map<string, Listing[]>();
  for (const l of listings) {
    // Prefer the real property, so a community spread across several street
    // addresses reads as one place. Coordinates are the fallback for anything
    // that didn't resolve — they only group units in the same building.
    const key = l.property_name
      ? `p:${l.property_name}`
      : `c:${l.latitude.toFixed(5)}_${l.longitude.toFixed(5)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(l);
  }

  const properties: Property[] = [];
  for (const [key, units] of Array.from(byKey.entries())) {
    const sorted = [...units].sort((a, b) => {
      // Listings with no available_on fall to the end
      if (!a.available_on && !b.available_on) return 0;
      if (!a.available_on) return 1;
      if (!b.available_on) return -1;
      return a.available_on.localeCompare(b.available_on);
    });
    const rents = sorted.map(u => u.rent).filter(r => r > 0);
    const addresses = Array.from(new Set(sorted.map(u => u.address).filter(Boolean)));
    properties.push({
      key,
      name: sorted[0].property_name || sorted[0].address,
      addresses,
      address: sorted[0].address,
      city: sorted[0].city,
      state: sorted[0].state,
      zip: sorted[0].zip,
      latitude: sorted[0].latitude,
      longitude: sorted[0].longitude,
      // The card shows the unit with the most photos, not just the soonest
      // available one — a new listing often has only an exterior shot.
      photos: sorted.reduce((best, u) => (u.photos.length > best.length ? u.photos : best), sorted[0].photos),
      units: sorted,
      minRent: rents.length ? Math.min(...rents) : 0,
      maxRent: rents.length ? Math.max(...rents) : 0,
      nextAvailable: sorted[0].available_on ?? '',
    });
  }

  return properties;
}

// ─── Misc helpers ────────────────────────────────────────────────────

export function getFullAddress(l: Pick<Listing, 'address' | 'city' | 'state' | 'zip'>): string {
  return `${l.address}, ${l.city}, ${l.state} ${l.zip}`;
}

/** How far in the future an "available_on" date is still treated as "now". */
const AVAILABLE_NOW_WINDOW_DAYS = 3;

/**
 * Format an availability date for display.
 *
 *  - null / empty                       → "Call for availability"
 *  - today, past, or within 3 days      → "Available now" (AppFolio often
 *                                         marks units as available a few days
 *                                         out for cleaning/turnover, but
 *                                         prospective tenants should read
 *                                         them as move-in ready)
 *  - >3 days in the future              → "Available <date>" per `format`
 */
export function formatAvailability(
  available_on: string | null,
  format: 'short' | 'long' = 'short',
  locale: Locale = DEFAULT_LOCALE,
): string {
  const t = getDictionary(locale).availability;
  if (!available_on) return t.callForAvailability;

  // Compare as YYYY-MM-DD strings to avoid timezone pitfalls — we only care
  // about calendar day. Build threshold = today + N days in local time.
  const now = new Date();
  const threshold = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + AVAILABLE_NOW_WINDOW_DAYS,
  );
  const thresholdStr = `${threshold.getFullYear()}-${String(threshold.getMonth() + 1).padStart(2, '0')}-${String(threshold.getDate()).padStart(2, '0')}`;
  if (available_on <= thresholdStr) return t.availableNow;

  const d = new Date(available_on + 'T12:00:00');
  const opts: Intl.DateTimeFormatOptions =
    format === 'long'
      ? { month: 'long', day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric' };
  const bcp47 = locale === 'es' ? 'es-US' : 'en-US';
  return t.availablePrefix + d.toLocaleDateString(bcp47, opts);
}

export const TENANT_PORTAL_URL = 'https://appreciateinc.appfolio.com/connect';

// Leasing line shown as a call-to-action across the public site. Kept here
// so the number lives in exactly one place — the display form and the tel:
// form have to stay in sync, and they won't if they're inlined per component.
export const LEASING_PHONE = '(816) 765-0427';
export const LEASING_PHONE_TEL = 'tel:+18167650427';
