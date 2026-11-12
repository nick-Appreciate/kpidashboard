/**
 * GET /api/listings/availability?listing_id=<uid>&start=YYYY-MM-DD
 *
 * Open tour times for a listing, straight from the property manager's
 * AppFolio calendar (see lib/appfolioShowings.ts). Public: the same data
 * AppFolio's own public scheduler shows. `start` pages forward so prospects
 * can book past weekends, holidays or fully booked days.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAvailability } from '../../../../lib/appfolioShowings';

export const dynamic = 'force-dynamic';

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function GET(req: NextRequest) {
  const listing = req.nextUrl.searchParams.get('listing_id') || '';
  const start = req.nextUrl.searchParams.get('start') || undefined;
  if (!isUuid(listing)) return NextResponse.json({ error: 'listing_id is required' }, { status: 400 });
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) return NextResponse.json({ error: 'start must be YYYY-MM-DD' }, { status: 400 });
  try {
    const a = await getAvailability(listing, start);
    // Drop slots that are already past or starting within the next hour.
    const cutoff = Date.now() + 60 * 60_000;
    a.days = a.days.map((d) => ({ ...d, slots: d.slots.filter((s) => new Date(s.time).getTime() > cutoff) }));
    return NextResponse.json(a, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('availability failed:', e?.message || e);
    return NextResponse.json({ error: 'Could not load tour times' }, { status: 502 });
  }
}
