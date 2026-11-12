import { createClient } from 'jsr:@supabase/supabase-js@2';

// Lead engine — our own prospect messaging, independent of AppFolio's
// automations. Every message it sends (or decides not to send) is a row in
// lead_outbox, so the Speed to Lead timeline shows exactly what each
// prospect received and why.
//
// Modes (POST/GET ?mode=…):
//   poll       every 30s (pg_cron). Pull today's AppFolio guest cards (≈4s),
//              upsert into leasing_reports, queue an instant text for each new
//              lead, then send whatever is due.
//   web        ?id=<web_inquiry_id>. Called by /api/listings/inquiry the moment
//              a prospect submits our website form — instant text in seconds.
//   sequences  every 5 min. Tour reminders (day before + 2h before), no-show
//              rebook, post-tour "ready to apply?".
//   send       just drain due outbox rows.
//
// Safety:
//   - lead_engine_settings.enabled=false stops everything.
//   - dry_run=true composes and logs messages as status 'dry_run', never sends.
//   - Leads received before settings.live_since are never auto-texted, so
//     turning the engine on doesn't blast the backlog.
//   - One instant text per phone per 14 days; opted-out numbers never texted.
//   - Non-instant texts wait for 8am–9pm Central.

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const AF_DB = Deno.env.get('APPFOLIO_DATABASE') || 'appreciateinc';
const AF_AUTH = 'Basic ' + btoa(`${Deno.env.get('APPFOLIO_CLIENT_ID')}:${Deno.env.get('APPFOLIO_CLIENT_SECRET')}`);
const JC_AUTH = `${Deno.env.get('JUSTCALL_API_KEY')}:${Deno.env.get('JUSTCALL_API_SECRET')}`;
const LISTINGS_URL = 'appreciate.io/listings';
const SITE = 'https://appreciate.io';

interface Person {
  locale?: string; guest_card_id?: string | null; leasing_report_id?: string | null;
  name?: string | null; phone?: string | null; email?: string | null;
}
const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newToken(len = 7): string {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return [...b].map((x) => TOKEN_ALPHABET[x % TOKEN_ALPHABET.length]).join('');
}

/**
 * Personal tour link: appreciate.io/t/<token> opens straight to live tour
 * times (the property manager's AppFolio calendar) for the unit the lead asked
 * about — or any live listing at the same property — with their guest card and
 * contact info attached, so booking is two taps. null if nothing is listed.
 */
async function tourLink(property: string | null, unit: string | null, person: Person = {}): Promise<string | null> {
  if (!property) return null;
  const { data } = await supabase.from('af_listing_unit_public').select('rentable_uid, unit_name').eq('property_name', property);
  const uids = (data || []).map((r: any) => String(r.rentable_uid));
  if (!uids.length) return null;
  const { data: live } = await supabase.from('af_listings').select('id').in('id', uids).is('inactive_since', null);
  const liveSet = new Set((live || []).map((r: any) => String(r.id)));
  const match = (data || []).find((r: any) => unit && r.unit_name === unit && liveSet.has(String(r.rentable_uid)))
    || (data || []).find((r: any) => liveSet.has(String(r.rentable_uid)));
  if (!match) return null;

  // AppFolio names are "Last, First".
  const raw = String(person.name || '').trim();
  const [first, last] = raw.includes(',')
    ? [raw.split(',').slice(1).join(' ').trim(), raw.split(',')[0].trim()]
    : [raw.split(/\s+/)[0] || '', raw.split(/\s+/).slice(1).join(' ')];
  for (let i = 0; i < 3; i++) {
    const token = newToken();
    const { error } = await supabase.from('tour_links').insert({
      token, listing_id: String(match.rentable_uid), property_name: property,
      guest_card_id: person.guest_card_id || null, leasing_report_id: person.leasing_report_id || null,
      first_name: first || null, last_name: last || null, phone_norm: phone10(person.phone), email: person.email || null,
      locale: person.locale === 'es' ? 'es' : 'en',
    });
    if (!error) return `${SITE.replace('https://', '')}/t/${token}`;
    if (error.code !== '23505') throw new Error(`tour link: ${error.message}`);
  }
  return null;
}
function tourLine(link: string | null, es: boolean): string {
  if (link) return es
    ? `Elige una hora para tu visita aquí: ${link} (o responde con el día y la hora que prefieras).`
    : `Grab a tour time here: ${link} (or just reply with a day and time).`;
  return es
    ? '¿Cuándo te gustaría verlo? Responde con un día y hora que te funcione.'
    : 'When would you like to come see it? Reply with a day and time that works for you.';
}

const INSTANT_WINDOW_MIN = 30;   // only text leads that arrived in the last 30 min
const INSTANT_REPEAT_DAYS = 14;  // one instant text per phone per 14 days

interface Settings {
  enabled: boolean; dry_run: boolean; live_since: string; from_number: string;
  instant_template_en: string; instant_template_es: string;
  booked_template_en: string; booked_template_es: string;
}
interface OutboxRow {
  kind: string; dedupe_key: string; phone_norm: string | null; email?: string | null;
  leasing_report_id?: string | null; web_inquiry_id?: string | null; showing_id?: string | null;
  property_name?: string | null; lead_name?: string | null; body: string | null;
  send_after?: string; status?: string; skip_reason?: string | null;
}

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

function phone10(v: unknown): string | null {
  if (!v) return null;
  const d = String(v).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  return d.length === 10 ? d : null;
}
function firstName(name: string | null | undefined): string {
  // AppFolio stores guest-card names as "Last, First".
  const raw = String(name || '').trim();
  const given = raw.includes(',') ? raw.split(',').slice(1).join(' ').trim() : raw;
  const f = given.split(/\s+/)[0] || '';
  if (!f) return 'there';
  return f.charAt(0).toUpperCase() + f.slice(1).toLowerCase();
}
function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
function centralParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}
const inQuietHours = (d = new Date()) => { const h = centralParts(d).hour; return h < 8 || h >= 21; };
// "today at 3:00 PM" / "tomorrow at 9:30 AM" / "on Mon, Nov 16 at 2:00 PM" (Central).
function fmtShowing(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
  const day = centralParts(d).date;
  if (day === centralParts(new Date()).date) return `today at ${time}`;
  if (day === centralParts(new Date(Date.now() + 86_400_000)).date) return `tomorrow at ${time}`;
  return `on ${d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}

async function getSettings(): Promise<Settings> {
  const { data, error } = await supabase.from('lead_engine_settings').select('enabled, dry_run, live_since, from_number, instant_template_en, instant_template_es, booked_template_en, booked_template_es').eq('id', 1).single();
  if (error) throw new Error(`settings: ${error.message}`);
  return data as Settings;
}

// ---------- AppFolio fast poll ----------

async function pollAppFolio(): Promise<number> {
  const now = new Date();
  const today = centralParts(now).date;
  // Just after midnight, also re-read yesterday so a 11:59pm lead isn't missed.
  const from = centralParts(new Date(now.getTime() - 60 * 60_000)).date;
  const res = await fetch(`https://${AF_DB}.appfolio.com/api/v2/reports/guest_cards.json`, {
    method: 'POST',
    headers: { Authorization: AF_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ guest_card_statuses: 'all', received_on_from: from, received_on_to: today, paginate_results: true }),
  });
  if (!res.ok) throw new Error(`AppFolio guest_cards ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const rows: any[] = Array.isArray(body) ? body : (body.results || []);
  const seen = new Set<string>();
  const records = rows.filter((r) => r.name && r.property_name && r.received).filter((r) => {
    const k = `${r.property_name}|${r.name}|${r.received}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  }).map((r) => ({
    // Same mapping as sync-appfolio syncGuestCards, so both writers agree.
    name: r.name, property: r.property_name, email: r.email_address || null, phone: r.phone_number || null,
    inquiry_received: r.received, last_activity_date: r.last_activity_date || null, last_activity_at: r.last_activity_date || null,
    last_activity_type: r.last_activity_type || null, status: r.status || null, notes: r.notes || null,
    source: r.source || null, unit: r.unit || null,
    guest_card_id: r.guest_card_id ? String(r.guest_card_id) : null,
    guest_card_uuid: r.guest_card_uuid ? String(r.guest_card_uuid) : null,
    inquiry_id: r.inquiry_id ? String(r.inquiry_id) : null,
    updated_at: new Date().toISOString(),
  }));
  if (records.length) {
    const { error } = await supabase.from('leasing_reports').upsert(records, { onConflict: 'name,property,inquiry_received' });
    if (error) throw new Error(`leasing_reports upsert: ${error.message}`);
  }
  return records.length;
}

// ---------- Queueing ----------

async function optedOut(phone: string): Promise<boolean> {
  const { data } = await supabase.from('sms_opt_outs').select('phone_norm').eq('phone_norm', phone).maybeSingle();
  return !!data;
}
async function recentlyTexted(phone: string): Promise<boolean> {
  const since = new Date(Date.now() - INSTANT_REPEAT_DAYS * 86_400_000).toISOString();
  const { data } = await supabase.from('lead_outbox').select('id').eq('kind', 'instant').eq('phone_norm', phone)
    .in('status', ['pending', 'sent', 'dry_run']).gte('created_at', since).limit(1);
  return (data?.length || 0) > 0;
}

// Insert; the (kind, dedupe_key) unique constraint makes concurrent pollers safe.
async function enqueue(row: OutboxRow): Promise<boolean> {
  const { error } = await supabase.from('lead_outbox').insert({ status: 'pending', send_after: new Date().toISOString(), ...row });
  if (error) {
    if (error.code === '23505') return false; // already queued
    throw new Error(`enqueue: ${error.message}`);
  }
  return true;
}

async function queueInstant(s: Settings, lead: {
  phone: string | null; name: string; property: string | null; locale?: string;
  leasing_report_id?: string | null; web_inquiry_id?: string | null; email?: string | null; received: string;
  unit?: string | null;
}): Promise<string> {
  const phone = phone10(lead.phone);
  const es = lead.locale === 'es';
  const day = centralParts(new Date(lead.received)).date;
  const dedupe_key = `${phone || lead.email || lead.name}|${day}`;

  // Cheap checks first — the poll sees each recent lead every 30s.
  const { data: existing } = await supabase.from('lead_outbox').select('id').eq('kind', 'instant').eq('dedupe_key', dedupe_key).limit(1);
  if (existing?.length) return 'dup';
  const base: OutboxRow = {
    kind: 'instant', dedupe_key, phone_norm: phone, email: lead.email || null,
    leasing_report_id: lead.leasing_report_id || null, web_inquiry_id: lead.web_inquiry_id || null,
    property_name: lead.property, lead_name: lead.name, body: null,
  };
  const skip = async (reason: string) => (await enqueue({ ...base, status: 'skipped', skip_reason: reason })) ? 'skipped' : 'dup';
  if (!phone) return skip('no valid phone');
  if (await optedOut(phone)) return skip('opted out');
  // A website visitor who unticked "text me" also lands in AppFolio a minute
  // later; respect their choice when the poll sees that guest card.
  if (!lead.web_inquiry_id) {
    const { data: web } = await supabase.from('web_inquiries').select('id').eq('phone_norm', phone).eq('sms_consent', false)
      .gte('created_at', new Date(Date.now() - 86_400_000).toISOString()).limit(1);
    if (web?.length) return skip('declined texts on website');
  }
  if (await recentlyTexted(phone)) return 'dup';

  // Only now mint the personal tour link and compose the text.
  let gcid: string | null = null;
  if (lead.leasing_report_id) {
    const { data: lrow } = await supabase.from('leasing_reports').select('guest_card_id').eq('id', lead.leasing_report_id).maybeSingle();
    gcid = lrow?.guest_card_id ?? null;
  }
  const link = await tourLink(lead.property, lead.unit ?? null, {
    locale: lead.locale, guest_card_id: gcid, leasing_report_id: lead.leasing_report_id, name: lead.name, phone, email: lead.email,
  });
  const body = fill(es ? s.instant_template_es : s.instant_template_en, {
    first: firstName(lead.name), property: lead.property || 'our apartments', listings: LISTINGS_URL, tour_line: tourLine(link, es),
  }).replace(/\s{2,}/g, ' ').trim();
  return (await enqueue({ ...base, body })) ? 'queued' : 'dup';
}

async function queueNewAppFolioLeads(s: Settings): Promise<Record<string, number>> {
  const floor = new Date(Math.max(Date.now() - INSTANT_WINDOW_MIN * 60_000, new Date(s.live_since).getTime())).toISOString();
  const { data, error } = await supabase.from('leasing_reports')
    .select('id, name, property, unit, phone, email, inquiry_received').gte('inquiry_received', floor).order('inquiry_received');
  if (error) throw new Error(error.message);
  const tally: Record<string, number> = {};
  for (const l of data || []) {
    const r = await queueInstant(s, { phone: l.phone, name: l.name, property: l.property, unit: l.unit, email: l.email, leasing_report_id: l.id, received: l.inquiry_received });
    tally[r] = (tally[r] || 0) + 1;
  }
  return tally;
}

async function queueWebInquiry(s: Settings, id: string): Promise<string> {
  const { data: w, error } = await supabase.from('web_inquiries')
    .select('id, first_name, last_name, phone, email, property_name, listing_address, locale, sms_consent, created_at, showing_start, showing_status').eq('id', id).single();
  if (error || !w) throw new Error(`web inquiry ${id} not found`);
  if (!w.sms_consent) return 'no consent';
  if (w.showing_status === 'booked' && w.showing_start) {
    const phone = phone10(w.phone);
    if (!phone) return 'no phone';
    const es = w.locale === 'es';
    const when = new Date(w.showing_start).toLocaleString(es ? 'es-US' : 'en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const body = fill(es ? s.booked_template_es : s.booked_template_en, { first: firstName(w.first_name), property: w.property_name || w.listing_address || 'the property', when });
    const row: OutboxRow = { kind: 'tour_booked', dedupe_key: w.id, phone_norm: phone, email: w.email, web_inquiry_id: w.id, property_name: w.property_name, lead_name: w.first_name, body };
    if (await optedOut(phone)) { row.status = 'skipped'; row.skip_reason = 'opted out'; }
    return (await enqueue(row)) ? 'queued' : 'dup';
  }
  return queueInstant(s, {
    phone: w.phone, name: w.first_name, property: w.property_name || w.listing_address, locale: w.locale,
    web_inquiry_id: w.id, email: w.email, received: w.created_at,
  });
}

// ---------- Tour sequences ----------

const ACTIVE_SHOWING = ['Scheduled', 'Confirmation Pending', 'Prospect Confirmed'];
const TPL = {
  tour_reminder_day: 'Hi {first}, this is Appreciate Leasing — just a reminder of your tour of {property} {when}. Reply YES to confirm or let us know if you need a different time. Reply STOP to opt out.',
  tour_reminder_2h: 'Hi {first}, see you soon! Your tour of {property} is at {time}. Questions or running late? Reply here or call (816) 765-0427.',
  no_show: 'Hi {first}, sorry we missed you at {property} today! Want to pick a new time? {rebook}',
  post_tour: 'Hi {first}, thanks for touring {property}! If you liked it, you can apply in about 10 minutes at {listings} — units go fast. Any questions, just reply here.',
};

async function queueSequences(s: Settings): Promise<Record<string, number>> {
  const now = Date.now();
  const floor = new Date(Math.max(now - 48 * 3600e3, new Date(s.live_since).getTime() - 48 * 3600e3)).toISOString();
  const { data, error } = await supabase.from('showings')
    .select('showing_id, guest_card_id, guest_card_name, phone, email, property, showing_time, status, rental_application_id')
    .gte('showing_time', floor).lte('showing_time', new Date(now + 30 * 3600e3).toISOString());
  if (error) throw new Error(error.message);
  const tally: Record<string, number> = {};
  const add = async (kind: keyof typeof TPL, sh: any, sendAfter: Date) => {
    const phone = phone10(sh.phone);
    // Never reach back before go-live (no reminders for tours booked pre-launch that already passed).
    if (sendAfter.getTime() < new Date(s.live_since).getTime()) return;
    const link = kind === 'no_show' && phone10(sh.phone)
      ? await tourLink(sh.property, null, { guest_card_id: sh.guest_card_id ? String(sh.guest_card_id) : null, name: sh.guest_card_name, phone: sh.phone, email: sh.email })
      : null;
    const body = fill(TPL[kind], {
      rebook: link ? `Grab one here: ${link}` : 'Reply with a day and time that works and we\'ll get you on the schedule.',
      first: firstName(sh.guest_card_name), property: sh.property || 'the property',
      when: fmtShowing(sh.showing_time), time: new Date(sh.showing_time).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }),
      listings: LISTINGS_URL,
    });
    const row: OutboxRow = {
      kind, dedupe_key: String(sh.showing_id), showing_id: String(sh.showing_id), phone_norm: phone, email: sh.email,
      property_name: sh.property, lead_name: sh.guest_card_name, body, send_after: sendAfter.toISOString(),
    };
    if (!phone) { row.status = 'skipped'; row.skip_reason = 'no valid phone'; }
    else if (await optedOut(phone)) { row.status = 'skipped'; row.skip_reason = 'opted out'; }
    if (await enqueue(row)) tally[kind] = (tally[kind] || 0) + 1;
  };
  for (const sh of data || []) {
    if (!sh.showing_id || !sh.showing_time) continue;
    const t = new Date(sh.showing_time).getTime();
    if (ACTIVE_SHOWING.includes(sh.status) && t > now) {
      if (t - now > 3 * 3600e3) await add('tour_reminder_day', sh, new Date(Math.max(now, t - 24 * 3600e3)));
      await add('tour_reminder_2h', sh, new Date(Math.max(now, t - 2 * 3600e3)));
    }
    // Follow-ups only for tours that happened after go-live (no backlog blast).
    const postLaunch = t >= new Date(s.live_since).getTime();
    if (postLaunch && sh.status === 'No Show' && t < now) await add('no_show', sh, new Date(Math.max(now, t + 30 * 60_000)));
    if (postLaunch && /^Completed/.test(sh.status || '') && t < now && !sh.rental_application_id) await add('post_tour', sh, new Date(Math.max(now, t + 60 * 60_000)));
  }
  return tally;
}

// ---------- Sending ----------

async function sendJustCall(from: string, to10: string, body: string): Promise<string> {
  const res = await fetch('https://api.justcall.io/v2.1/texts/new', {
    method: 'POST',
    headers: { Authorization: JC_AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ justcall_number: `+${from}`, contact_number: `+1${to10}`, body }),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`JustCall ${res.status}: ${txt.slice(0, 300)}`);
  let id = '';
  try { const j = JSON.parse(txt); const d = Array.isArray(j.data) ? j.data[0] : j.data; id = String(d?.id ?? j.id ?? ''); } catch { /* keep raw */ }
  return id || txt.slice(0, 100);
}

async function drain(s: Settings): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('lead_outbox')
    .select('id, kind, phone_norm, body, send_after').eq('status', 'pending').lte('send_after', new Date().toISOString())
    .order('send_after').limit(25);
  if (error) throw new Error(error.message);
  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1; };
  for (const m of data || []) {
    // Responses to a fresh inquiry go any time; everything else waits for 8am–9pm Central.
    if (m.kind !== 'instant' && inQuietHours()) { bump('held_quiet_hours'); continue; }
    // A reminder that's no longer timely is skipped rather than sent late.
    if (m.kind === 'tour_reminder_2h' && Date.now() - new Date(m.send_after).getTime() > 2 * 3600e3) {
      await supabase.from('lead_outbox').update({ status: 'skipped', skip_reason: 'too late' }).eq('id', m.id); bump('skipped'); continue;
    }
    // Claim the row so an overlapping run can't send it twice.
    const { data: claimed } = await supabase.from('lead_outbox').update({ status: 'sending', attempts: 1 })
      .eq('id', m.id).eq('status', 'pending').select('id');
    if (!claimed?.length) continue;
    if (s.dry_run) {
      await supabase.from('lead_outbox').update({ status: 'dry_run', sent_at: new Date().toISOString() }).eq('id', m.id); bump('dry_run'); continue;
    }
    if (!m.phone_norm || await optedOut(m.phone_norm)) {
      await supabase.from('lead_outbox').update({ status: 'skipped', skip_reason: 'opted out or no phone' }).eq('id', m.id); bump('skipped'); continue;
    }
    try {
      const ext = await sendJustCall(s.from_number, m.phone_norm, m.body);
      await supabase.from('lead_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), external_id: ext }).eq('id', m.id); bump('sent');
    } catch (e: any) {
      await supabase.from('lead_outbox').update({ status: 'failed', error: String(e?.message || e).slice(0, 500) }).eq('id', m.id); bump('failed');
    }
  }
  return tally;
}

// Deployed with verify_jwt=false (pg_cron's vault key is a publishable key that
// fails JWT verification), so the function authenticates callers itself:
// the service-role key (our Next.js routes) or the vault-held shared secret
// (pg_cron, header x-lead-engine-secret).
async function authorized(req: Request): Promise<boolean> {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (bearer && srk && bearer === srk) return true;
  // Also accept any service-role credential (legacy JWT or sb_secret_ key):
  // only service_role may execute lead_engine_secret_ok, so a clean call proves it.
  if (bearer) {
    const probe = createClient(Deno.env.get('SUPABASE_URL')!, bearer, { auth: { persistSession: false } });
    const { error } = await probe.rpc('lead_engine_secret_ok', { p: '' });
    if (!error) return true;
  }
  const secret = req.headers.get('x-lead-engine-secret');
  if (!secret) return false;
  const { data } = await supabase.rpc('lead_engine_secret_ok', { p: secret });
  return data === true;
}

Deno.serve(async (req: Request) => {
  if (!(await authorized(req))) return json({ error: 'unauthorized' }, 401);
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') || 'poll';
  const t0 = Date.now();
  try {
    const s = await getSettings();
    if (!s.enabled) return json({ ok: true, disabled: true });
    const out: Record<string, unknown> = { mode, dry_run: s.dry_run };
    if (mode === 'poll') {
      out.polled = await pollAppFolio();
      out.queued = await queueNewAppFolioLeads(s);
    } else if (mode === 'web') {
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'id required' }, 400);
      out.queued = await queueWebInquiry(s, id);
    } else if (mode === 'test') {
      // Send one real instant text to a given number even while dry_run is on,
      // so the team can see exactly what prospects receive. Never touches leads.
      const to = phone10(url.searchParams.get('to'));
      if (!to) return json({ error: 'to must be a 10-digit number' }, 400);
      if (await optedOut(to)) return json({ error: 'number has opted out' }, 400);
      const property = url.searchParams.get('property') || 'Oakwood Gardens';
      const link = await tourLink(property, null, { name: url.searchParams.get('first') || null, phone: to });
      const body = fill(s.instant_template_en, { first: url.searchParams.get('first') || 'there', property, tour_line: tourLine(link, false) })
        .replace(/\s{2,}/g, ' ').trim();
      const { data: row, error } = await supabase.from('lead_outbox').insert({
        kind: 'test', dedupe_key: `${to}|${Date.now()}`, phone_norm: to, property_name: property, lead_name: 'Test', body, status: 'sending',
      }).select('id').single();
      if (error) throw new Error(error.message);
      try {
        const ext = await sendJustCall(s.from_number, to, body);
        await supabase.from('lead_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), external_id: ext }).eq('id', row.id);
        return json({ ok: true, sent_to: to, body, justcall_id: ext });
      } catch (e: any) {
        await supabase.from('lead_outbox').update({ status: 'failed', error: String(e?.message || e).slice(0, 500) }).eq('id', row.id);
        throw e;
      }
    } else if (mode === 'sequences') {
      out.queued = await queueSequences(s);
    } else if (mode !== 'send') {
      return json({ error: `unknown mode ${mode}` }, 400);
    }
    out.sent = await drain(s);
    out.ms = Date.now() - t0;
    return json(out);
  } catch (e: any) {
    console.error('lead-engine', mode, e?.message || e);
    return json({ error: e?.message || String(e), mode }, 500);
  }
});
