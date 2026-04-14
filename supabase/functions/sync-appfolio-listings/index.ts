import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts';

/**
 * Sync AppFolio Public Listings
 *
 * Pulls the public listings page and every detail page from
 * https://appreciateinc.appfolio.com/listings, parses each, and upserts to
 * Supabase (af_listings + af_listing_photos).
 *
 * The listings page is public — no auth required, no Playwright, runs
 * entirely in this edge function on an hourly cron. Listings that stop
 * appearing in the index get their `inactive_since` stamp set so the
 * public site hides them via RLS.
 *
 * Invoke:
 *   curl -X POST '<SUPABASE_URL>/functions/v1/sync-appfolio-listings' \
 *     -H 'Authorization: Bearer <ANON_KEY>'
 */

const BASE_URL = Deno.env.get('APPFOLIO_LISTINGS_BASE_URL') ||
  'https://appreciateinc.appfolio.com';
const INDEX_URL = `${BASE_URL}/listings`;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

interface ScrapedListing {
  id: string;
  listing_id: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number | null;
  longitude: number | null;
  rent: number | null;
  rent_range: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  available_on: string | null;
  pet_policy: string | null;
  application_url: string;
  detail_page_url: string;
  default_photo_url: string | null;
  marketing_description: string | null;
  application_fee: number | null;
  deposit: number | null;
  photos: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'AppreciateListingsSync/1.0 (+https://appreciate.io)' },
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return await res.text();
}

/** Extract `window.googleMap = new GoogleMap({markers: [...]})` JSON. */
function parseMarkers(html: string): Map<string, { lat: number; lng: number }> {
  const match = html.match(
    /new GoogleMap\(\{\s*container:[^,]+,\s*markers:\s*(\[[\s\S]*?\])\s*,\s*infoWindowTemplate/,
  );
  const byUuid = new Map<string, { lat: number; lng: number }>();
  if (!match) return byUuid;
  try {
    const markers = JSON.parse(match[1]) as Array<{
      latitude: number;
      longitude: number;
      detail_page_url: string;
    }>;
    for (const m of markers) {
      const uuid = m.detail_page_url?.split('/').pop();
      if (uuid) byUuid.set(uuid, { lat: m.latitude, lng: m.longitude });
    }
  } catch (err) {
    console.warn('[sync-listings] failed to parse markers JSON:', (err as Error).message);
  }
  return byUuid;
}

function parseAddress(raw: string): { address: string; city: string; state: string; zip: string } {
  // e.g. "2406 Whitegate Drive, Columbia, MO 65202"
  const parts = raw.split(',').map(s => s.trim());
  if (parts.length >= 3) {
    const tail = parts[parts.length - 1].split(/\s+/);
    return {
      address: parts.slice(0, -2).join(', '),
      city: parts[parts.length - 2],
      state: tail[0] || '',
      zip: tail.slice(1).join(' ') || '',
    };
  }
  return { address: raw, city: '', state: '', zip: '' };
}

function parseAvailableDate(raw: string): string | null {
  // "4/23/26" → "2026-04-23". AppFolio uses US format with 2- or 4-digit year.
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let y = parseInt(m[3]);
  if (y < 100) y = 2000 + y;
  const mo = String(m[1]).padStart(2, '0');
  const d = String(m[2]).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function parseBedBath(raw: string): { bedrooms: number | null; bathrooms: number | null } {
  const m = raw.match(/(\d+(?:\.\d+)?)\s*bd\s*\/\s*(\d+(?:\.\d+)?)\s*ba/i);
  if (!m) return { bedrooms: null, bathrooms: null };
  return { bedrooms: parseFloat(m[1]), bathrooms: parseFloat(m[2]) };
}

function parseMoney(raw: string): number | null {
  const m = raw.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

// ─── Parse the listings index page ────────────────────────────────────

function extractListingsFromIndex(
  html: string,
  coords: Map<string, { lat: number; lng: number }>,
): ScrapedListing[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];

  const results: ScrapedListing[] = [];
  const items = doc.querySelectorAll('.listing-item.js-listing-item');

  for (const node of items) {
    // deno-dom's Element type extends Node; querySelector is available.
    const el = node as unknown as HTMLElement;

    const detailLink = el.querySelector("a[href*='/listings/detail/']");
    const detailPath = detailLink?.getAttribute('href') || '';
    const uuid = detailPath.split('/').pop() || '';
    if (!uuid) continue;

    const idAttr = el.getAttribute('id') || '';
    const idMatch = idAttr.match(/listing_(\d+)/);
    const listing_id = idMatch ? parseInt(idMatch[1]) : 0;

    const addrText = el.querySelector('.js-listing-address')?.textContent?.trim() || '';
    const addr = parseAddress(addrText);

    // Read the label/value dl pairs in the quick-facts box
    const boxValues: Record<string, string> = {};
    for (const box of el.querySelectorAll('.detail-box__item')) {
      const bEl = box as unknown as HTMLElement;
      const label = bEl.querySelector('.detail-box__label')?.textContent?.trim() || '';
      const value = bEl.querySelector('.detail-box__value')?.textContent?.trim() || '';
      if (label) boxValues[label] = value;
    }

    const rent = parseMoney(boxValues['RENT'] || '');
    const sqftRaw = parseInt((boxValues['Square Feet'] || '').replace(/,/g, ''));
    const square_feet = Number.isFinite(sqftRaw) && sqftRaw > 0 ? sqftRaw : null;
    const { bedrooms, bathrooms } = parseBedBath(boxValues['Bed / Bath'] || '');
    const available_on = parseAvailableDate(boxValues['Available'] || '');

    const petRaw = el.querySelector('.js-listing-pet-policy')?.textContent?.trim() || '';
    const pet_policy = petRaw.replace(/^Pet Policy:\s*/, '') || null;

    const applyHref = el.querySelector('.js-listing-apply')?.getAttribute('href') || '';
    const application_url = applyHref.startsWith('http') ? applyHref : `${BASE_URL}${applyHref}`;

    const imgEl = el.querySelector('.js-listing-image');
    const default_photo_url = imgEl?.getAttribute('data-original') || null;

    const coord = coords.get(uuid);

    results.push({
      id: uuid,
      listing_id,
      address: addr.address,
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
      latitude: coord?.lat ?? null,
      longitude: coord?.lng ?? null,
      rent,
      rent_range: rent !== null ? `$${rent.toLocaleString()}` : null,
      bedrooms,
      bathrooms,
      square_feet,
      available_on,
      pet_policy,
      application_url,
      detail_page_url: detailPath,
      default_photo_url,
      marketing_description: null,
      application_fee: null,
      deposit: null,
      photos: default_photo_url ? [default_photo_url] : [],
    });
  }

  return results;
}

// ─── Enrich each listing with data from its detail page ───────────────

function enrichFromDetail(listing: ScrapedListing, html: string): void {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return;

  const desc = doc.querySelector('.listing-detail__description');
  if (desc) {
    // deno-dom lacks innerHTML on some node types; grab the raw HTML from the outer element
    // by walking children, or by serializing. Safer: use `textContent` but preserve <br> as
    // newlines first by replacing them in the raw HTML string we pulled.
    const rawHtml = (desc as unknown as HTMLElement).innerHTML ?? desc.textContent ?? '';
    const text = decodeHtml(
      rawHtml
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ''),
    ).trim().replace(/\n{3,}/g, '\n\n');
    listing.marketing_description = text || null;
  }

  // Rental Terms list items
  for (const li of doc.querySelectorAll('.js-show-rental-terms .list__item')) {
    const text = (li as unknown as HTMLElement).textContent?.trim() || '';
    const feeMatch = text.match(/Application Fee:\s*\$?([\d,]+(?:\.\d+)?)/i);
    const depMatch = text.match(/(?:Security )?Deposit:\s*\$?([\d,]+(?:\.\d+)?)/i);
    if (feeMatch) listing.application_fee = parseMoney(feeMatch[1]);
    if (depMatch) listing.deposit = parseMoney(depMatch[1]);
  }

  // Gallery photos — collect every images.cdn.appfolio.com /large.* or /original.* URL
  const photoSet = new Set<string>(listing.photos); // start with default photo if we had one
  for (const img of doc.querySelectorAll('img')) {
    const el = img as unknown as HTMLElement;
    for (const attr of ['src', 'data-original']) {
      const url = el.getAttribute(attr) || '';
      if (/images\.cdn\.appfolio\.com\/.+\/(large|original)\.[a-z]+/i.test(url)) {
        photoSet.add(url);
      }
    }
  }
  listing.photos = Array.from(photoSet);
}

// ─── Main sync ────────────────────────────────────────────────────────

async function run() {
  console.log(`[sync-listings] fetching index: ${INDEX_URL}`);
  const indexHtml = await fetchText(INDEX_URL);
  const coords = parseMarkers(indexHtml);
  console.log(`[sync-listings] markers parsed: ${coords.size} geocoded listings`);

  const listings = extractListingsFromIndex(indexHtml, coords);
  console.log(`[sync-listings] index listings: ${listings.length}`);

  // Fetch detail pages sequentially — at typical 5–15 listings, total HTTP
  // time is under ~10 seconds, well inside Supabase's 60s edge timeout.
  for (const l of listings) {
    try {
      const html = await fetchText(`${BASE_URL}${l.detail_page_url}`);
      enrichFromDetail(l, html);
    } catch (err) {
      console.warn(`[sync-listings] detail fetch failed ${l.id}:`, (err as Error).message);
    }
  }

  // Upsert listings
  const scrapedAt = new Date().toISOString();
  let upserted = 0;
  for (const l of listings) {
    const { error } = await supabase.from('af_listings').upsert(
      {
        id: l.id,
        listing_id: l.listing_id,
        address: l.address,
        city: l.city,
        state: l.state,
        zip: l.zip,
        latitude: l.latitude,
        longitude: l.longitude,
        rent: l.rent,
        rent_range: l.rent_range,
        bedrooms: l.bedrooms,
        bathrooms: l.bathrooms,
        square_feet: l.square_feet,
        available_on: l.available_on,
        application_fee: l.application_fee,
        deposit: l.deposit,
        pet_policy: l.pet_policy,
        marketing_description: l.marketing_description,
        application_url: l.application_url,
        detail_page_url: l.detail_page_url,
        default_photo_url: l.default_photo_url,
        scraped_at: scrapedAt,
        inactive_since: null,
      },
      { onConflict: 'id' },
    );
    if (error) {
      console.error(`[sync-listings] upsert failed ${l.id}:`, error.message);
    } else {
      upserted++;
    }
  }

  // Replace photos for each listing (simpler than per-row upserts)
  let photoCount = 0;
  for (const l of listings) {
    await supabase.from('af_listing_photos').delete().eq('listing_id', l.id);
    if (l.photos.length === 0) continue;
    const rows = l.photos.map((url, idx) => ({
      listing_id: l.id,
      photo_url: url,
      position: idx,
      scraped_at: scrapedAt,
    }));
    const { error } = await supabase.from('af_listing_photos').insert(rows);
    if (error) {
      console.error(`[sync-listings] photos insert failed ${l.id}:`, error.message);
    } else {
      photoCount += rows.length;
    }
  }

  // Mark listings that didn't show up in this index pass as inactive
  const activeIds = new Set(listings.map(l => l.id));
  const { data: dbRows } = await supabase
    .from('af_listings')
    .select('id')
    .is('inactive_since', null);

  const inactive = (dbRows || [])
    .map(r => r.id as string)
    .filter(id => !activeIds.has(id));

  if (inactive.length > 0) {
    await supabase
      .from('af_listings')
      .update({ inactive_since: scrapedAt })
      .in('id', inactive);
  }

  return {
    scraped: listings.length,
    upserted,
    photos: photoCount,
    inactivated: inactive.length,
  };
}

Deno.serve(async () => {
  try {
    const result = await run();
    console.log('[sync-listings] done:', result);
    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[sync-listings] fatal:', err);
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
