/**
 * AppFolio public showing scheduler, used server-side by our listing pages.
 *
 * These are the same unauthenticated endpoints AppFolio's own
 * /listings/showings/new page calls, so availability is exactly the property
 * manager's AppFolio calendar (existing showings and blocked time already
 * removed) and bookings land on that calendar. AppFolio re-checks the slot at
 * booking time and returns 422 if it was taken — that's our deconfliction.
 *
 *   GET  /listings/api/listings/:uid/availabilities?start_date=MM/DD/YYYY&find_first_available_date=bool
 *   POST /listings/api/guest_cards   → { guest_card_id }
 *   POST /listings/api/showings      → 201, or 422 { error } when the slot is gone
 *
 * Query params and bodies are snake_case (AppFolio's client converts
 * camelCase; camelCase params are silently ignored).
 */

const AF = 'https://appreciateinc.appfolio.com/listings/api';

export interface Slot { time: string; agentId: number }
export interface AvailabilityDay { date: string; slots: Slot[] }
export interface Availability {
  days: AvailabilityDay[];
  durationMin: number;
  futureExists: boolean;
  firstAvailableDate: string | null;
}

const toAfDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}`; };

async function afJson(path: string, init?: RequestInit) {
  const res = await fetch(`${AF}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, body };
}

/**
 * Open tour times starting at `startDate` (YYYY-MM-DD, Central). AppFolio
 * returns a few days per call; when they're all empty (weekend, holiday,
 * fully booked) we ask it to jump to the first available date.
 */
export async function getAvailability(listingUid: string, startDate?: string): Promise<Availability> {
  const fetchFrom = async (start: string | undefined, findFirst: boolean) => {
    const q = new URLSearchParams({ find_first_available_date: String(findFirst) });
    if (start) q.set('start_date', toAfDate(start));
    const r = await afJson(`/listings/${listingUid}/availabilities?${q}`);
    if (!r.ok) throw new Error(`availabilities ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body;
  };
  let b = await fetchFrom(startDate, false);
  const empty = (x: any) => !(x.availabilities_by_date || []).some((d: any) => d.timeslots?.length);
  if (empty(b) && b.future_availabilities_exist) b = await fetchFrom(startDate, true);
  return {
    days: (b.availabilities_by_date || []).map((d: any) => ({
      date: d.date,
      slots: (d.timeslots || [])
        .filter((t: any) => !t.available_showing_types || t.available_showing_types.includes('in-person'))
        .map((t: any) => ({ time: t.time, agentId: Number(t.agent_id) })),
    })),
    durationMin: Number(b.prospect_scheduled_showing_duration) || 30,
    futureExists: !!b.future_availabilities_exist,
    firstAvailableDate: b.first_available_date || null,
  };
}

export async function createGuestCard(p: {
  listingUid: string; firstName: string; lastName: string; email: string; phone: string; source?: string;
}): Promise<string> {
  const r = await afJson('/guest_cards', {
    method: 'POST',
    body: JSON.stringify({
      first_name: p.firstName, last_name: p.lastName, email_address: p.email, phone_number: p.phone,
      listable_uid: p.listingUid, source: p.source || 'Website', skip_cta_for_new_inquiries: true,
    }),
  });
  if (!r.ok || !r.body?.guest_card_id) throw new Error(`guest card ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  return String(r.body.guest_card_id);
}

export interface BookResult { ok: boolean; slotTaken?: boolean; error?: string }

export async function bookShowing(p: {
  listingUid: string; guestCardId: string; startAt: string; agentId: number; durationMin: number;
}): Promise<BookResult> {
  const start = new Date(p.startAt);
  const end = new Date(start.getTime() + p.durationMin * 60_000);
  // showing_type must be the listing's allowed_showing_type label ("In Person"),
  // not the availability API's "in-person" — the wrong value comes back as a
  // misleading "property is ineligible for scheduling" 422.
  const listing = await afJson(`/listings/${p.listingUid}`);
  const showingType = listing.body?.allowed_showing_type || 'In Person';
  const r = await afJson('/showings', {
    method: 'POST',
    body: JSON.stringify({
      start_at: start.toISOString(), end_at: end.toISOString(), assigned_user_id: p.agentId,
      listable_uid: p.listingUid, guest_card_id: Number(p.guestCardId), showing_type: showingType,
      from_idv: false, from_leasing_ai_agent: false,
    }),
  });
  if (r.ok) return { ok: true };
  const error = String(r.body?.error || JSON.stringify(r.body)).slice(0, 300);
  // Only a genuine conflict is "slot taken"; anything else is a booking failure.
  return { ok: false, slotTaken: r.status === 422 && /time block|unavailable|pick a different/i.test(error), error };
}
