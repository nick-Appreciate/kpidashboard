/**
 * /api/admin/listing-coverage
 *
 *   GET — per-property breakdown of rehab-ready units vs active
 *         public listings. The source of truth for "should this unit
 *         be on the market right now?" is the rehabs table — units
 *         whose rehab_status is 'In Progress' or 'Complete' belong
 *         on every public feed. Units at 'Not Started', 'Notice',
 *         'Eviction', or 'Rented' are out of scope (work hasn't begun,
 *         tenant still in unit, or already leased).
 *
 * Built in response to the discovery that ~half of KC rehab-ready
 * units had no active af_listings record — they were invisible to
 * the public market. Cross-referencing with rehab status filters
 * out the units that legitimately shouldn't be listed yet (rehab
 * not started, notice tenant still occupying, etc.) so the gap
 * count reflects only actionable inventory.
 *
 * Each unit gets:
 *   - rehab_status        ('In Progress' | 'Complete')
 *   - days_vacant         (from rehabs.vacancy_start_date if set,
 *                          else from snapshot history)
 *   - bed_bath, sqft      (from latest rent_roll_snapshot)
 *   - rent_roll_status    (latest snapshot status, e.g. Vacant-Unrented)
 *   - listed              (true if matching active af_listings row)
 *   - listing_match_kind  ('address' | 'bed_bath' | null)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../../../lib/auth';

// Service-role client used ONLY for af_listings reads. The default
// public RLS policy on af_listings hides any listing where
// available_on IS NULL, which excludes a chunk of our actually-live
// inventory. This dashboard needs the full active set.
const adminSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// Rehab statuses that mean "this unit should be on the public market."
// Anything outside this set is filtered out of the coverage dashboard.
const LISTABLE_REHAB_STATUSES = new Set(['In Progress', 'Complete']);

interface RehabRow {
  id: string;
  property: string;
  unit: string;
  rehab_status: string;
  vacancy_start_date: string | null;
}

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

  // 2) Active rehabs — the source of truth for "listable inventory"
  const { data: rehabsData, error: rehabsErr } = await supabase
    .from('rehabs')
    .select('id, property, unit, rehab_status, vacancy_start_date')
    .eq('status', 'in_progress')
    .in('rehab_status', Array.from(LISTABLE_REHAB_STATUSES));
  if (rehabsErr) return NextResponse.json({ error: rehabsErr.message }, { status: 500 });
  const rehabs = (rehabsData || []) as RehabRow[];

  // 3) Latest snapshot — every unit so we can pull bed/bath/sqft + occupied count
  const { data: latestUnits, error: rrErr } = await supabase
    .from('rent_roll_snapshots')
    .select('property, unit, status, bed_bath, sqft, total_rent')
    .eq('snapshot_date', latestDate)
    .range(0, 9999);
  if (rrErr) return NextResponse.json({ error: rrErr.message }, { status: 500 });
  const allUnits = (latestUnits || []) as RentRollRow[];
  const unitByKey = new Map<string, RentRollRow>();
  for (const u of allUnits) unitByKey.set(`${u.property}||${u.unit}`, u);
  const occupiedByProperty = new Map<string, number>();
  for (const u of allUnits) {
    if (u.status === 'Current') {
      occupiedByProperty.set(u.property, (occupiedByProperty.get(u.property) || 0) + 1);
    }
  }

  // 4) All active af_listings — service role to bypass RLS.
  //    Also load af_unit_directory so we can resolve unit ↔ listing
  //    via the canonical rentable_uid → af_listings.id join.
  const [
    { data: listings, error: lErr },
    { data: unitDirRows },
  ] = await Promise.all([
    adminSupabase()
      .from('af_listings')
      .select('id, listing_id, address, rent, bedrooms, bathrooms, square_feet, available_on, default_photo_url, marketing_description, detail_page_url, first_seen_at, scraped_at')
      .is('inactive_since', null),
    supabase
      .from('af_unit_directory')
      .select('property_name, unit_name, rentable_uid'),
  ]);
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  const activeListings = (listings || []) as (ListingRow & { id?: string })[];
  const rentableUidByUnit = new Map<string, string>();
  for (const r of unitDirRows || []) {
    if (r.property_name && r.unit_name && r.rentable_uid) {
      rentableUidByUnit.set(`${r.property_name}||${r.unit_name}`, r.rentable_uid);
    }
  }

  // 5) History last 18 months — fallback days-vacant when rehabs row
  //    doesn't have vacancy_start_date (rare).
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

  // 6) Attribute each listing to a property
  const listingsByProperty = new Map<string, ListingRow[]>();
  for (const l of activeListings) {
    const property = inferPropertyFromAddress(l.address || '');
    if (!property) continue;
    const arr = listingsByProperty.get(property) || [];
    arr.push(l);
    listingsByProperty.set(property, arr);
  }

  // 7) Build per-property breakdown driven by the rehabs list
  const today = new Date();
  const propMap = new Map<string, {
    property: string;
    occupied: number;
    units: any[];
    active_listings: ListingRow[];
  }>();

  for (const r of rehabs) {
    if (!r.property || !r.unit) continue;
    const bucket = propMap.get(r.property) || {
      property: r.property,
      occupied: occupiedByProperty.get(r.property) || 0,
      units: [],
      active_listings: listingsByProperty.get(r.property) || [],
    };
    const rr = unitByKey.get(`${r.property}||${r.unit}`);
    const bb = rr?.bed_bath ?? null;
    const sqft = rr?.sqft ?? null;
    const rentRollStatus = rr?.status ?? null;

    // Prefer rehab.vacancy_start_date, fall back to last 'Current' snapshot
    const startDate = r.vacancy_start_date
      || lastCurrentByUnit.get(`${r.property}||${r.unit}`)
      || null;
    const daysVacant = startDate
      ? Math.max(0, Math.floor((today.getTime() - new Date(startDate).getTime()) / 86_400_000))
      : null;

    // Match: canonical rentable_uid join first, then address-substring,
    // then bed/bath. The first is authoritative — it's AppFolio telling
    // us "this unit's marketing listing is THIS UUID".
    const rentableUid = rentableUidByUnit.get(`${r.property}||${r.unit}`) ?? null;
    const directMatch = rentableUid
      ? (bucket.active_listings as Array<ListingRow & { id?: string }>).find(l => l.id === rentableUid) ?? null
      : null;
    const unitNum = (r.unit || '').replace(/[^0-9]/g, '');
    const addressMatch = !directMatch && bucket.active_listings.find(l =>
      unitNum && (l.address || '').toLowerCase().includes(unitNum)
    ) || null;
    const bbMatch = !directMatch && !addressMatch && bb
      ? bucket.active_listings.find(l => bedBathString(l.bedrooms, l.bathrooms) === bb) || null
      : null;
    const matched = directMatch || addressMatch || bbMatch;

    bucket.units.push({
      unit: r.unit,
      rehab_status: r.rehab_status,
      rent_roll_status: rentRollStatus,
      bed_bath: bb,
      sqft,
      days_vacant: daysVacant,
      last_occupied: lastCurrentByUnit.get(`${r.property}||${r.unit}`) || null,
      listed: !!matched,
      listing_match_kind: directMatch ? 'direct' : addressMatch ? 'address' : (bbMatch ? 'bed_bath' : null),
      listed_rent: matched?.rent ?? null,
      listing_url: matched?.detail_page_url ?? null,
      listing_photo: matched?.default_photo_url ?? null,
      listing_first_seen: matched?.first_seen_at ?? null,
    });
    propMap.set(r.property, bucket);
  }

  // 8) Sort + summarize
  const properties = Array.from(propMap.values())
    .map(p => {
      p.units.sort((a, b) => (a.unit || '').localeCompare(b.unit || '', undefined, {
        numeric: true, sensitivity: 'base',
      }));
      const listed_count = p.units.filter(u => u.listed).length;
      return {
        property: p.property,
        occupied: p.occupied,
        listable_count: p.units.length,
        listed_count,
        gap: p.units.length - listed_count,
        active_listings_count: p.active_listings.length,
        units: p.units,
      };
    })
    .sort((a, b) => b.gap - a.gap || a.property.localeCompare(b.property));

  const summary = {
    snapshot_date: latestDate,
    total_listable: properties.reduce((s, p) => s + p.listable_count, 0),
    total_listed:   properties.reduce((s, p) => s + p.listed_count, 0),
    total_gap:      properties.reduce((s, p) => s + p.gap, 0),
    total_active_listings: properties.reduce((s, p) => s + p.active_listings_count, 0),
  };

  return NextResponse.json({ summary, properties });
}

function emptySummary() {
  return {
    snapshot_date: null,
    total_listable: 0,
    total_listed: 0,
    total_gap: 0,
    total_active_listings: 0,
  };
}
