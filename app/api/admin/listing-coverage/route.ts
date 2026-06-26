/**
 * /api/admin/listing-coverage
 *
 *   GET — per-property breakdown of vacant units vs active public
 *         listings. Surfaces the gap between what's vacant in
 *         rent_roll_snapshots and what's actually live on the
 *         AppFolio listings feed (af_listings).
 *
 * Built in response to the discovery that 14 of 27 KC vacant units
 * had no active af_listings record — they were invisible to the
 * public market. A daily check of this view should keep that gap
 * from re-opening as units come off rehab.
 *
 * Each vacant unit gets:
 *   - days_vacant         (since last 'Current' snapshot, or null if
 *                          never occupied in our 18-month window)
 *   - bed_bath, sqft      (so the user can see what they're listing)
 *   - listed              (true if at least one active af_listings row
 *                          matches by property + bed/bath, OR if the
 *                          address contains the unit number)
 *   - listing_match_kind  ('address' | 'bed_bath' | null) — surfaces
 *                          how confident the match is
 *
 * The per-property summary also includes a count of active listings
 * at that property that DON'T match any vacant unit — those are
 * either occupied units still showing as listed (stale) or listings
 * for units we don't have rent_roll coverage on.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';

interface RentRollRow {
  property: string;
  unit: string;
  status: string;
  bed_bath: string | null;
  sqft: number | null;
  total_rent: number | null;
}

interface ListingRow {
  listing_id: string | null;
  address: string;
  rent: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  available_on: string | null;
  default_photo_url: string | null;
  marketing_description: string | null;
  detail_page_url: string | null;
  first_seen_at: string | null;
  scraped_at: string | null;
}

// AppFolio listings address fragments → property name map.
// Used to attribute af_listings rows to a rent_roll property.
const PROPERTY_ADDRESS_HINTS: Array<{ contains: string[]; property: string }> = [
  { contains: ['delavan', 'farrow'],                  property: 'Hilltop Townhomes' },
  { contains: ['n 58th', 'north 58th'],               property: 'Glen Oaks' },
  { contains: ['maple'],                              property: 'Maple Manor Apartments' },
  { contains: ['wood ave', 'wood avenue'],            property: 'Oakwood Gardens' },
  { contains: ['n 77th', 'north 77th'],               property: 'Normandy Apartments' },
  { contains: ['pioneer'],                            property: 'Pioneer Apartments' },
];

function inferPropertyFromAddress(address: string): string | null {
  const lower = (address || '').toLowerCase();
  for (const hint of PROPERTY_ADDRESS_HINTS) {
    if (hint.contains.some(needle => lower.includes(needle))) return hint.property;
  }
  return null;
}

function bedBathString(b: number | null, ba: number | null): string | null {
  if (b == null || ba == null) return null;
  return `${b}/${ba.toFixed(2)}`;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  // 1) Latest rent-roll snapshot date
  const { data: latestSnap, error: lsErr } = await supabase
    .from('rent_roll_snapshots')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: false })
    .limit(1);
  if (lsErr) return NextResponse.json({ error: lsErr.message }, { status: 500 });
  const latestDate = latestSnap?.[0]?.snapshot_date;
  if (!latestDate) return NextResponse.json({ properties: [], summary: emptySummary() });

  // 2) Latest snapshot — every unit so we can count occupied vs vacant per property
  const { data: latestUnits, error: rrErr } = await supabase
    .from('rent_roll_snapshots')
    .select('property, unit, status, bed_bath, sqft, total_rent')
    .eq('snapshot_date', latestDate)
    .range(0, 9999);
  if (rrErr) return NextResponse.json({ error: rrErr.message }, { status: 500 });
  const allUnits = (latestUnits || []) as RentRollRow[];

  // 3) All active listings
  const { data: listings, error: lErr } = await supabase
    .from('af_listings')
    .select('listing_id, address, rent, bedrooms, bathrooms, square_feet, available_on, default_photo_url, marketing_description, detail_page_url, first_seen_at, scraped_at')
    .is('inactive_since', null);
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  const activeListings = (listings || []) as ListingRow[];

  // 4) History last 18 months for days-vacant computation
  const eighteenAgo = new Date();
  eighteenAgo.setMonth(eighteenAgo.getMonth() - 18);
  const since = eighteenAgo.toISOString().slice(0, 10);
  const { data: hist, error: hErr } = await supabase
    .from('rent_roll_snapshots')
    .select('property, unit, snapshot_date, status')
    .gte('snapshot_date', since)
    .eq('status', 'Current')
    .range(0, 99999);
  if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });
  const lastCurrentByUnit = new Map<string, string>();
  for (const r of hist || []) {
    const key = `${r.property}||${r.unit}`;
    const prev = lastCurrentByUnit.get(key);
    if (!prev || r.snapshot_date > prev) lastCurrentByUnit.set(key, r.snapshot_date);
  }

  // 5) Attribute each listing to a property + (where possible) a unit
  const listingsByProperty = new Map<string, ListingRow[]>();
  for (const l of activeListings) {
    const property = inferPropertyFromAddress(l.address || '');
    if (!property) continue;
    const arr = listingsByProperty.get(property) || [];
    arr.push(l);
    listingsByProperty.set(property, arr);
  }

  // 6) Build per-unit vacant rows with listing match
  const today = new Date();
  const vacantStatuses = new Set(['Vacant-Unrented', 'Notice-Unrented']);
  const propMap = new Map<string, {
    property: string;
    occupied: number;
    vacant_units: any[];
    active_listings: ListingRow[];
  }>();

  for (const u of allUnits) {
    if (!u.property) continue;
    const bucket = propMap.get(u.property) || {
      property: u.property,
      occupied: 0,
      vacant_units: [],
      active_listings: listingsByProperty.get(u.property) || [],
    };
    if (u.status === 'Current') bucket.occupied++;
    if (vacantStatuses.has(u.status)) {
      const lastCurrent = lastCurrentByUnit.get(`${u.property}||${u.unit}`);
      const daysVacant = lastCurrent
        ? Math.max(0, Math.floor((today.getTime() - new Date(lastCurrent).getTime()) / 86_400_000))
        : null;
      const bb = u.bed_bath; // already "B/BA" format
      // address match (e.g. "2625F" → "2625 Farrow")
      const unitNum = (u.unit || '').replace(/[^0-9]/g, '');
      const addressMatch = bucket.active_listings.find(l =>
        unitNum && (l.address || '').toLowerCase().includes(unitNum)
      ) || null;
      // bed/bath fallback match
      const bbMatch = !addressMatch && bb
        ? bucket.active_listings.find(l => bedBathString(l.bedrooms, l.bathrooms) === bb) || null
        : null;
      const matched = addressMatch || bbMatch;
      bucket.vacant_units.push({
        unit: u.unit,
        status: u.status,
        bed_bath: bb,
        sqft: u.sqft,
        days_vacant: daysVacant,
        last_occupied: lastCurrent || null,
        listed: !!matched,
        listing_match_kind: addressMatch ? 'address' : (bbMatch ? 'bed_bath' : null),
        listed_rent: matched?.rent ?? null,
        listing_url: matched?.detail_page_url ?? null,
        listing_photo: matched?.default_photo_url ?? null,
        listing_first_seen: matched?.first_seen_at ?? null,
      });
    }
    propMap.set(u.property, bucket);
  }

  // 7) Sort + summarize
  const properties = Array.from(propMap.values())
    .filter(p => p.vacant_units.length > 0 || p.active_listings.length > 0)
    .map(p => {
      p.vacant_units.sort((a, b) => (b.days_vacant ?? -1) - (a.days_vacant ?? -1));
      const listed_count = p.vacant_units.filter(u => u.listed).length;
      return {
        property: p.property,
        occupied: p.occupied,
        vacant_count: p.vacant_units.length,
        listed_count,
        gap: p.vacant_units.length - listed_count,
        active_listings_count: p.active_listings.length,
        vacant_units: p.vacant_units,
      };
    })
    .sort((a, b) => b.gap - a.gap);

  const summary = {
    snapshot_date: latestDate,
    total_vacant:   properties.reduce((s, p) => s + p.vacant_count, 0),
    total_listed:   properties.reduce((s, p) => s + p.listed_count, 0),
    total_gap:      properties.reduce((s, p) => s + p.gap, 0),
    total_active_listings: properties.reduce((s, p) => s + p.active_listings_count, 0),
  };

  return NextResponse.json({ summary, properties });
}

function emptySummary() {
  return { snapshot_date: null, total_vacant: 0, total_listed: 0, total_gap: 0, total_active_listings: 0 };
}
