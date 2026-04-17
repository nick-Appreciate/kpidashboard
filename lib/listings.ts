import { supabase } from './supabase';
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
}

export interface Property {
  key: string;
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

function rowToListing(row: any, photos: string[]): Listing {
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
  };
}

/** Fetch every active listing + its photos. Server components should use this. */
export async function fetchActiveListings(): Promise<Listing[]> {
  const [{ data: listingRows, error: le }, { data: photoRows, error: pe }] =
    await Promise.all([
      supabase
        .from('af_listings')
        .select('*')
        .is('inactive_since', null)
        .order('available_on', { ascending: true, nullsFirst: false }),
      supabase
        .from('af_listing_photos')
        .select('listing_id, photo_url, position')
        .order('position', { ascending: true }),
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

  return (listingRows || []).map(row =>
    rowToListing(row, photosByListing.get(row.id) || []),
  );
}

/** Fetch one listing by id + its photos. Returns null if not found or inactive. */
export async function fetchListingById(id: string): Promise<Listing | null> {
  const [{ data: listing, error: le }, { data: photos, error: pe }] =
    await Promise.all([
      supabase
        .from('af_listings')
        .select('*')
        .eq('id', id)
        .is('inactive_since', null)
        .maybeSingle(),
      supabase
        .from('af_listing_photos')
        .select('photo_url, position')
        .eq('listing_id', id)
        .order('position', { ascending: true }),
    ]);

  if (le || !listing) return null;
  if (pe) console.error('[listings] fetch photos failed:', pe.message);

  return rowToListing(listing, (photos || []).map(p => p.photo_url));
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
    const key = `${l.latitude.toFixed(5)}_${l.longitude.toFixed(5)}`;
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
    properties.push({
      key,
      address: sorted[0].address,
      city: sorted[0].city,
      state: sorted[0].state,
      zip: sorted[0].zip,
      latitude: sorted[0].latitude,
      longitude: sorted[0].longitude,
      photos: sorted[0].photos,
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
