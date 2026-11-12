/**
 * POST /api/listings/inquiry
 *
 * "Schedule a tour" / "Ask a question" from a public listing page. In one
 * request, so the prospect hears from us within seconds:
 *   1. record the inquiry in web_inquiries (our system of record),
 *   2. create the AppFolio guest card and, when the prospect picked a tour
 *      time, book the showing on the property manager's AppFolio calendar
 *      (lib/appfolioShowings.ts — AppFolio's own public scheduler API),
 *   3. ask the lead-engine edge function to text the prospect now (a booking
 *      confirmation when a tour was booked).
 *
 * If the chosen slot was taken in the meantime we return 409 with the
 * inquiry_id; the client shows fresh times and resubmits with inquiry_id +
 * the new slot, reusing the same guest card.
 *
 * Public endpoint (no auth), like /api/listings/prequal: uses the service role
 * internally because RLS doesn't allow anon INSERT. The listing is looked up
 * server-side from listing_id, so the client can't spoof property details.
 *
 * Body: { listing_id, first_name, last_name?, phone?, email?, move_in?,
 *         message?, wants_tour?, sms_consent?, marketing_consent?, locale?,
 *         slot_time?, slot_agent_id?, inquiry_id? (retry after 409),
 *         website? (honeypot — must be empty) }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { bookShowing, createGuestCard, getAvailability } from '../../../../lib/appfolioShowings';

export const dynamic = 'force-dynamic';

const adminSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const clean = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
function phone10(v: string): string | null {
  const d = v.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  return d.length === 10 ? d : null;
}
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function triggerInstantText(id: string): Promise<void> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/lead-engine?mode=web&id=${id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`lead-engine ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  // Honeypot: real visitors never see or fill this field.
  if (clean(body.website)) return NextResponse.json({ ok: true });

  const listing_id = clean(body.listing_id, 64);
  const first_name = clean(body.first_name, 80);
  const last_name = clean(body.last_name, 80);
  const email = clean(body.email, 160).toLowerCase();
  const phoneRaw = clean(body.phone, 40);
  const phone_norm = phoneRaw ? phone10(phoneRaw) : null;
  const message = clean(body.message, 2000);
  const locale = body.locale === 'es' ? 'es' : 'en';
  const slotTime = clean(body.slot_time, 40);
  const slotAgent = Number(body.slot_agent_id);
  const retryId = clean(body.inquiry_id, 64);
  const wantsSlot = !!slotTime;

  if (!isUuid(listing_id)) return NextResponse.json({ error: 'listing_id is required' }, { status: 400 });
  if (!first_name) return NextResponse.json({ error: 'first_name is required' }, { status: 400 });
  if (phoneRaw && !phone_norm) return NextResponse.json({ error: 'phone must be a 10-digit US number' }, { status: 400 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'email is invalid' }, { status: 400 });
  if (!phone_norm && !email) return NextResponse.json({ error: 'phone or email is required' }, { status: 400 });
  if (wantsSlot && (isNaN(new Date(slotTime).getTime()) || !Number.isFinite(slotAgent))) {
    return NextResponse.json({ error: 'invalid tour time' }, { status: 400 });
  }

  let move_in = clean(body.move_in, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(move_in)) move_in = '';

  const sb = adminSupabase();
  const [{ data: listing }, { data: ident }] = await Promise.all([
    sb.from('af_listings').select('id, address, city, state').eq('id', listing_id).maybeSingle(),
    sb.from('af_listing_unit_public').select('property_name').eq('rentable_uid', listing_id).maybeSingle(),
  ]);
  if (!listing) return NextResponse.json({ error: 'Unknown listing' }, { status: 404 });

  // Retry after a taken slot: reuse the inquiry + guest card from the first try.
  let inquiryId: string | null = null;
  let guestCardId: string | null = null;

  // Personal tour link from one of our texts: the prospect's AppFolio guest
  // card is already known, so book against it instead of creating another.
  const tourToken = clean(body.tour_token, 32);
  if (tourToken) {
    const { data: link } = await sb.from('tour_links').select('token, listing_id, guest_card_id').eq('token', tourToken).maybeSingle();
    if (link && link.listing_id === listing_id && link.guest_card_id) guestCardId = String(link.guest_card_id);
  }
  if (isUuid(retryId)) {
    const { data: prev } = await sb.from('web_inquiries').select('id, appfolio_guest_card_id, listing_id').eq('id', retryId).maybeSingle();
    if (prev && prev.listing_id === listing_id) { inquiryId = prev.id; guestCardId = prev.appfolio_guest_card_id; }
  }

  if (!inquiryId) {
    const { data: row, error } = await sb.from('web_inquiries').insert({
      listing_id,
      listing_address: [listing.address, listing.city, listing.state].filter(Boolean).join(', '),
      property_name: ident?.property_name || null,
      first_name, last_name: last_name || null, email: email || null,
      phone: phoneRaw || null, phone_norm,
      move_in: move_in || null, message: message || null,
      wants_tour: body.wants_tour !== false,
      sms_consent: !!phone_norm && body.sms_consent !== false,
      marketing_consent: !!phone_norm && body.marketing_consent === true,
      locale,
      tour_token: tourToken || null,
      appfolio_guest_card_id: guestCardId,
      appfolio_status: guestCardId ? 'existing' : null,
      user_agent: req.headers.get('user-agent')?.slice(0, 300) || null,
    }).select('id').single();
    if (error || !row) {
      console.error('web inquiry insert failed:', error?.message);
      return NextResponse.json({ error: 'Could not record inquiry' }, { status: 500 });
    }
    inquiryId = row.id;
  }

  // 1. AppFolio guest card (so leasing sees the lead in AppFolio too).
  if (!guestCardId) {
    try {
      guestCardId = await createGuestCard({
        listingUid: listing_id, firstName: first_name, lastName: last_name || '-',
        email, phone: phone_norm || '', source: 'Website',
      });
      await sb.from('web_inquiries').update({ appfolio_status: 'created', appfolio_guest_card_id: guestCardId, appfolio_error: null }).eq('id', inquiryId);
    } catch (e: any) {
      console.error('AppFolio guest card failed:', e?.message || e);
      await sb.from('web_inquiries').update({ appfolio_status: 'failed', appfolio_error: String(e?.message || e).slice(0, 500) }).eq('id', inquiryId);
    }
  }

  // 2. Book the tour on the property manager's AppFolio calendar.
  let booked = false;
  if (wantsSlot) {
    if (!guestCardId) {
      await sb.from('web_inquiries').update({ showing_status: 'failed', showing_error: 'no guest card' }).eq('id', inquiryId);
    } else {
      let durationMin = 30;
      try { durationMin = (await getAvailability(listing_id, slotTime.slice(0, 10))).durationMin; } catch { /* default */ }
      const r = await bookShowing({ listingUid: listing_id, guestCardId, startAt: slotTime, agentId: slotAgent, durationMin });
      if (r.ok) {
        booked = true;
        await sb.from('web_inquiries').update({ showing_status: 'booked', showing_start: new Date(slotTime).toISOString(), showing_agent_id: slotAgent, showing_error: null }).eq('id', inquiryId);
        if (tourToken) await sb.from('tour_links').update({ booked_at: new Date().toISOString() }).eq('token', tourToken);
      } else {
        await sb.from('web_inquiries').update({ showing_status: r.slotTaken ? 'slot_taken' : 'failed', showing_error: r.error }).eq('id', inquiryId);
        if (r.slotTaken) {
          return NextResponse.json({ ok: false, slot_taken: true, inquiry_id: inquiryId }, { status: 409 });
        }
        console.error('showing booking failed:', r.error);
      }
    }
  }

  // 3. Instant text — a booking confirmation if booked, else "when can you come?".
  if (phone_norm) {
    try { await triggerInstantText(inquiryId!); } catch (e) { console.error('instant text trigger failed:', e); }
  }

  return NextResponse.json({
    ok: true,
    booked,
    showing_start: booked ? new Date(slotTime).toISOString() : null,
    texted: !!phone_norm,
  });
}
