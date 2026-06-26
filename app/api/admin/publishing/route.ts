/**
 * /api/admin/publishing
 *
 *   GET  — list every rehab-ready unit with pre-formatted post copy
 *          for Facebook Marketplace and Craigslist, plus the latest
 *          posting log entry per (unit × channel) so the UI can show
 *          "posted N days ago" and "due for repost" badges.
 *
 *   POST — record a manual post in publishing_log.
 *          body: { property, unit, channel: 'fb_marketplace'|'craigslist'|'nextdoor', notes? }
 *
 * Built as part of C1 from the leasing audit. Routes around AppFolio's
 * partial syndication — FB Marketplace and Craigslist don't accept
 * AppFolio's feed, and ~13 of our syndication targets are dead-weight.
 * This dashboard arms the property manager with ready-to-paste posts
 * + open-the-form deep links so each channel is a 30-second job
 * instead of 10–15 minutes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';

type Channel = 'fb_marketplace' | 'craigslist' | 'nextdoor';

// Re-post freshness thresholds (in days). After this, the UI flags the
// channel as "due for repost." Tuned to each platform's freshness decay:
// FB Marketplace listings sink fast (~1 week visibility), Craigslist
// posts expire from search around 48 hrs, NextDoor stays useful longer.
const FRESHNESS_DAYS: Record<Channel, number> = {
  fb_marketplace: 7,
  craigslist: 2,
  nextdoor: 14,
};

const LISTABLE_REHAB_STATUSES = ['In Progress', 'Complete'];

interface RehabRow {
  property: string;
  unit: string;
  rehab_status: string;
  vacancy_start_date: string | null;
}

interface ListingRow {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  rent: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  available_on: string | null;
  application_fee: number | null;
  deposit: number | null;
  pet_policy: string | null;
  marketing_description: string | null;
  application_url: string | null;
  default_photo_url: string | null;
}

interface PostLogRow {
  property: string;
  unit: string;
  channel: Channel;
  posted_at: string;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const [{ data: rehabsData, error: rehabsErr }, { data: latestSnap }] = await Promise.all([
    supabase
      .from('rehabs')
      .select('property, unit, rehab_status, vacancy_start_date')
      .eq('status', 'in_progress')
      .in('rehab_status', LISTABLE_REHAB_STATUSES),
    supabase
      .from('rent_roll_snapshots')
      .select('snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1),
  ]);
  if (rehabsErr) return NextResponse.json({ error: rehabsErr.message }, { status: 500 });
  const rehabs = (rehabsData || []) as RehabRow[];
  const latestDate = latestSnap?.[0]?.snapshot_date;

  // Pull bed/bath/sqft fallback from rent_roll for units that aren't in af_listings
  let rentRollByUnit = new Map<string, any>();
  if (latestDate) {
    const { data: rrows } = await supabase
      .from('rent_roll_snapshots')
      .select('property, unit, bed_bath, sqft, total_rent')
      .eq('snapshot_date', latestDate);
    for (const r of rrows || []) rentRollByUnit.set(`${r.property}||${r.unit}`, r);
  }

  // af_listings (active) — same RLS-bypass note as listing-coverage:
  // available_on IS NULL hides some live listings under the user-scoped
  // client. We use requireAuth + service-role-less query here because
  // af_listings has authenticated SELECT permission too; if you find
  // missing listings later, swap to a service-role client.
  const { data: listings } = await supabase
    .from('af_listings')
    .select('id, address, city, state, zip, rent, bedrooms, bathrooms, square_feet, available_on, application_fee, deposit, pet_policy, marketing_description, application_url, default_photo_url')
    .is('inactive_since', null);
  const listingsByAddress = new Map<string, ListingRow>();
  for (const l of (listings || []) as ListingRow[]) {
    if (!l.address) continue;
    const key = l.address.toLowerCase().trim();
    if (!listingsByAddress.has(key)) listingsByAddress.set(key, l);
  }

  // Photos per listing — used in the UI grid + bulk-download proxy
  const listingIds = (listings || []).map(l => l.id).filter(Boolean);
  const photosByListing = new Map<string, string[]>();
  if (listingIds.length > 0) {
    const { data: photoRows } = await supabase
      .from('af_listing_photos')
      .select('listing_id, photo_url, position')
      .in('listing_id', listingIds)
      .order('position', { ascending: true });
    for (const p of photoRows || []) {
      if (!p.listing_id || !p.photo_url) continue;
      const arr = photosByListing.get(p.listing_id) || [];
      arr.push(p.photo_url);
      photosByListing.set(p.listing_id, arr);
    }
  }

  // Latest publishing log per (property, unit, channel)
  const { data: logRows } = await supabase
    .from('publishing_log')
    .select('property, unit, channel, posted_at')
    .order('posted_at', { ascending: false });
  const latestPostByKey = new Map<string, string>();
  for (const r of (logRows || []) as PostLogRow[]) {
    const key = `${r.property}||${r.unit}||${r.channel}`;
    if (!latestPostByKey.has(key)) latestPostByKey.set(key, r.posted_at);
  }

  const today = new Date();
  const out = rehabs.map(r => {
    // Match this rehab to an af_listing — prefer address-substring on unit
    const unitNum = (r.unit || '').replace(/[^0-9]/g, '');
    const listing = unitNum
      ? Array.from(listingsByAddress.values()).find(l => (l.address || '').toLowerCase().includes(unitNum)) ?? null
      : null;
    const rr = rentRollByUnit.get(`${r.property}||${r.unit}`);

    const bedrooms = listing?.bedrooms ?? parseBeds(rr?.bed_bath);
    const bathrooms = listing?.bathrooms ?? parseBaths(rr?.bed_bath);
    const sqft = listing?.square_feet ?? rr?.sqft ?? null;
    const rent = Number(listing?.rent ?? rr?.total_rent ?? 0);
    const address = listing?.address ?? `${r.property} #${r.unit}`;
    const city  = listing?.city ?? 'Kansas City';
    const state = listing?.state ?? 'KS';
    const availableOn = listing?.available_on ?? null;
    const applicationUrl = listing?.application_url ?? null;
    const description = listing?.marketing_description ?? null;
    const petPolicy = listing?.pet_policy ?? null;
    const photo = listing?.default_photo_url ?? null;

    const channels = (['fb_marketplace', 'craigslist', 'nextdoor'] as Channel[]).map(channel => {
      const key = `${r.property}||${r.unit}||${channel}`;
      const lastPosted = latestPostByKey.get(key) ?? null;
      const daysSince = lastPosted
        ? Math.floor((today.getTime() - new Date(lastPosted).getTime()) / 86_400_000)
        : null;
      const dueForRepost = daysSince == null || daysSince >= FRESHNESS_DAYS[channel];
      return {
        channel,
        last_posted: lastPosted,
        days_since: daysSince,
        due_for_repost: dueForRepost,
        threshold_days: FRESHNESS_DAYS[channel],
        ...buildPost(channel, {
          property: r.property,
          unit: r.unit,
          address, city, state,
          bedrooms, bathrooms, sqft, rent,
          availableOn, applicationUrl, description, petPolicy,
        }),
      };
    });

    const photos = (listing && photosByListing.get(listing.id)) || (photo ? [photo] : []);

    return {
      property: r.property,
      unit: r.unit,
      rehab_status: r.rehab_status,
      address, city, state,
      bedrooms, bathrooms, sqft, rent,
      available_on: availableOn,
      photo,
      photos,
      application_url: applicationUrl,
      has_listing: !!listing,
      channels,
    };
  });

  // Sort: properties with the most overdue posts first, then by property/unit
  out.sort((a, b) => {
    const aOverdue = a.channels.filter(c => c.due_for_repost).length;
    const bOverdue = b.channels.filter(c => c.due_for_repost).length;
    if (aOverdue !== bOverdue) return bOverdue - aOverdue;
    return a.property.localeCompare(b.property)
      || (a.unit || '').localeCompare(b.unit || '', undefined, { numeric: true });
  });

  return NextResponse.json({
    snapshot_date: latestDate,
    total_units: out.length,
    units: out,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const property = String(body.property || '').trim();
  const unit = String(body.unit || '').trim();
  const channel = String(body.channel || '').trim();
  const notes = body.notes ? String(body.notes).slice(0, 500) : null;
  if (!property || !unit) return NextResponse.json({ error: 'property and unit required' }, { status: 400 });
  if (!['fb_marketplace','craigslist','nextdoor'].includes(channel))
    return NextResponse.json({ error: 'invalid channel' }, { status: 400 });

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('publishing_log').insert({
    property, unit, channel, notes, posted_by: user?.id ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ─── Post-copy builders ──────────────────────────────────────────────

interface PostInputs {
  property: string;
  unit: string;
  address: string;
  city: string;
  state: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  rent: number;
  availableOn: string | null;
  applicationUrl: string | null;
  description: string | null;
  petPolicy: string | null;
}

function specsLine(p: PostInputs): string {
  const parts: string[] = [];
  if (p.bedrooms != null)  parts.push(`${p.bedrooms} BR`);
  if (p.bathrooms != null) parts.push(`${p.bathrooms} BA`);
  if (p.sqft != null)      parts.push(`${p.sqft.toLocaleString()} sqft`);
  return parts.join(' / ');
}

function availabilityPhrase(iso: string | null): string {
  if (!iso) return 'Available now';
  const d = new Date(iso + 'T00:00:00');
  if (d <= new Date()) return 'Available now';
  return `Available ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
}

function buildPost(channel: Channel, p: PostInputs) {
  if (channel === 'fb_marketplace') return buildFBMarketplace(p);
  if (channel === 'craigslist')     return buildCraigslist(p);
  return buildNextdoor(p);
}

function buildFBMarketplace(p: PostInputs) {
  const title = truncate(
    `${specsLine(p) || 'Rental'} — ${p.address} — $${p.rent.toLocaleString()}/mo`,
    100,
  );
  const lines = [
    `${specsLine(p)} rental at ${p.address}, ${p.city}, ${p.state}`,
    `$${p.rent.toLocaleString()}/month`,
    availabilityPhrase(p.availableOn),
    '',
    p.description?.trim() || 'Recently updated unit in a well-maintained property.',
  ];
  if (p.petPolicy) lines.push('', `Pets: ${p.petPolicy}`);
  if (p.applicationUrl) lines.push('', `Apply: ${p.applicationUrl}`);
  const body = lines.join('\n').slice(0, 3000);
  return {
    title,
    body,
    price: p.rent,
    open_url: 'https://www.facebook.com/marketplace/create/rental',
  };
}

function buildCraigslist(p: PostInputs) {
  const title = truncate(
    `${specsLine(p) || 'Rental'} at ${p.address} — $${p.rent.toLocaleString()}/mo — ${availabilityPhrase(p.availableOn)}`,
    70,
  );
  const lines = [
    `${specsLine(p)} at ${p.address}, ${p.city}, ${p.state}`,
    `Rent: $${p.rent.toLocaleString()}/month`,
    availabilityPhrase(p.availableOn),
    '',
    p.description?.trim() || 'Recently updated unit in a well-maintained property.',
  ];
  if (p.petPolicy) lines.push('', `Pet policy: ${p.petPolicy}`);
  if (p.applicationUrl) lines.push('', `Apply here: ${p.applicationUrl}`);
  const body = lines.join('\n');
  return {
    title,
    body,
    price: p.rent,
    open_url: craigslistAreaUrl(p.city, p.state),
  };
}

function buildNextdoor(p: PostInputs) {
  // Friendly neighborly tone; short.
  const title = `Rental available — ${p.address}`;
  const sentences = [
    `Hi neighbors — we have a ${specsLine(p)} unit at ${p.address} available.`,
    `${availabilityPhrase(p.availableOn)} for $${p.rent.toLocaleString()}/month.`,
    p.applicationUrl ? `Full listing + application: ${p.applicationUrl}` : '',
    'If you know someone looking, please share!',
  ].filter(Boolean);
  return {
    title,
    body: sentences.join(' '),
    price: p.rent,
    open_url: 'https://nextdoor.com/news_feed/post/',
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function craigslistAreaUrl(city: string, state: string): string {
  // Best-effort area routing. KCK/KCMO both post to the kansascity board's
  // KCK subarea (c/kck), Columbia MO posts to columbiamo. Fall back to a
  // generic post page if neither matches.
  const cityLower = (city || '').toLowerCase();
  const stateLower = (state || '').toLowerCase();
  if (cityLower.includes('kansas city')) return 'https://post.craigslist.org/c/kck';
  if (cityLower.includes('columbia') && stateLower === 'mo') return 'https://post.craigslist.org/c/cou';
  return 'https://accounts.craigslist.org/login/home';
}

function parseBeds(bedBath: string | null | undefined): number | null {
  if (!bedBath) return null;
  const m = String(bedBath).match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
function parseBaths(bedBath: string | null | undefined): number | null {
  if (!bedBath) return null;
  const m = String(bedBath).match(/\/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}
