import { createClient } from 'jsr:@supabase/supabase-js@2';

// Lead engine — our own prospect messaging, independent of AppFolio's
// automations. Every message it sends (or decides not to send) is a row in
// lead_outbox, so the Leasing Automations timeline shows exactly what each
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
  email_enabled: boolean; email_from: string; email_reply_to: string | null; email_footer: string;
  nurture_enabled: boolean; alerts_enabled: boolean;
  alert_mention: string | null; alert_mention_kinds: string[] | null;
}
interface OutboxRow {
  kind: string; dedupe_key: string; phone_norm: string | null; email?: string | null;
  leasing_report_id?: string | null; web_inquiry_id?: string | null; showing_id?: string | null;
  property_name?: string | null; lead_name?: string | null; body: string | null;
  send_after?: string; status?: string; skip_reason?: string | null;
  channel?: 'sms' | 'email'; subject?: string | null;
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
  const { data, error } = await supabase.from('lead_engine_settings').select('enabled, dry_run, live_since, from_number, instant_template_en, instant_template_es, booked_template_en, booked_template_es, email_enabled, email_from, email_reply_to, email_footer, nurture_enabled, alerts_enabled, alert_mention, alert_mention_kinds').eq('id', 1).single();
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
  if (!phone) {
    // No phone: email is the only channel (AppFolio's auto-response used to cover these).
    await skip('no valid phone');
    if (!lead.email) return 'skipped';
    const link = await tourLink(lead.property, lead.unit ?? null, {
      locale: lead.locale, leasing_report_id: lead.leasing_report_id, name: lead.name, email: lead.email,
    });
    return (await enqueue(emailRow(base, 'instant', lead.name, lead.property, link, es))) ? 'queued_email' : 'dup';
  }
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
  const queued = await enqueue({ ...base, body });
  if (queued && lead.email) await enqueue(emailRow(base, 'instant', lead.name, lead.property, link, es));
  return queued ? 'queued' : 'dup';
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
    const queued = await enqueue(row);
    if (queued) {
      await alert('tour_booked', w.id, phone,
        `:calendar: *Tour booked online* — ${w.first_name} ${w.last_name || ''} · ${w.property_name || w.listing_address || ''}\n` +
        `${fmtShowing(w.showing_start)} · ${fmtPhone(phone)}${links(phone)}`);
    }
    return queued ? 'queued' : 'dup';
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
    .select('id, kind, channel, phone_norm, email, subject, body, send_after, created_at, dedupe_key, leasing_report_id')
    .eq('status', 'pending').lte('send_after', new Date().toISOString())
    .order('send_after').limit(25);
  if (error) throw new Error(error.message);
  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1; };
  for (const m of data || []) {
    // Responses to a fresh inquiry go any time; everything else waits for 8am–9pm Central.
    // Direct replies to something the prospect just did go any time.
    const immediate = ['instant', 'instant_email', 'tour_booked', 'confirm_ack'].includes(m.kind);
    if (!immediate && inQuietHours()) { bump('held_quiet_hours'); continue; }
    // A reminder that's no longer timely is skipped rather than sent late.
    if (m.kind === 'tour_reminder_2h' && Date.now() - new Date(m.send_after).getTime() > 2 * 3600e3) {
      await supabase.from('lead_outbox').update({ status: 'skipped', skip_reason: 'too late' }).eq('id', m.id); bump('skipped'); continue;
    }
    // A follow-up held overnight is re-checked: if they replied or booked since, don't send.
    if (m.kind.startsWith('nurture')) {
      const why = await stopReason(m.phone_norm, m.email, m.created_at);
      if (why) { await supabase.from('lead_outbox').update({ status: 'skipped', skip_reason: why }).eq('id', m.id); bump('skipped'); continue; }
    }
    // Claim the row so an overlapping run can't send it twice.
    const { data: claimed } = await supabase.from('lead_outbox').update({ status: 'sending', attempts: 1 })
      .eq('id', m.id).eq('status', 'pending').select('id');
    if (!claimed?.length) continue;
    if (s.dry_run) {
      await supabase.from('lead_outbox').update({ status: 'dry_run', sent_at: new Date().toISOString() }).eq('id', m.id); bump('dry_run'); continue;
    }
    if (m.channel === 'email') {
      if (!s.email_enabled || !m.email) {
        await supabase.from('lead_outbox').update({ status: 'skipped', skip_reason: !m.email ? 'no email' : 'email sending not enabled yet' }).eq('id', m.id); bump('skipped'); continue;
      }
      try {
        const ext = await sendEmail(s, m.email, m.subject || 'Appreciate Leasing', m.body);
        await supabase.from('lead_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), external_id: ext }).eq('id', m.id); bump('sent_email');
      } catch (e: any) {
        await supabase.from('lead_outbox').update({ status: 'failed', error: String(e?.message || e).slice(0, 500) }).eq('id', m.id); bump('failed');
      }
      continue;
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

// ---------- Email ----------

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || '';
const LINK_RE = /(?:https?:\/\/)?(?:www\.)?appreciate\.io\/t\/[A-Za-z0-9]+/;

const EMAIL = {
  instant: {
    en: { subject: 'Your tour of {property}', lines: ['Hi {first},', 'Thanks for your interest in {property}! The fastest way to see it is to pick a tour time below — it takes about 15 minutes.', 'Questions about pets, parking or move-in costs? Just reply to this email or call us at (816) 765-0427.'] },
    es: { subject: 'Tu visita a {property}', lines: ['Hola {first},', '¡Gracias por tu interés en {property}! La forma más rápida de verlo es elegir una hora para tu visita aquí abajo; toma unos 15 minutos.', '¿Preguntas sobre mascotas, estacionamiento o costos de mudanza? Responde a este correo o llámanos al (816) 765-0427.'] },
  },
  nurture_2: {
    en: { subject: 'Still looking? Tour {property} this week', lines: ['Hi {first},', 'Units at {property} are leasing quickly. If you\'re still looking, grab a tour time that works for you — it only takes a minute to book.', 'Reply to this email with any questions.'] },
    es: { subject: '¿Sigues buscando? Visita {property} esta semana', lines: ['Hola {first},', 'Las unidades en {property} se están rentando rápido. Si sigues buscando, elige una hora para tu visita; agendar toma un minuto.', 'Responde a este correo con cualquier pregunta.'] },
  },
  nurture_4: {
    en: { subject: 'Checking in about {property}', lines: ['Hi {first},', 'Just checking in one last time. If you\'re still looking for a place, we\'d love to show you {property} — pick a time below or reply to this email.', 'If you\'ve already found a home, congratulations! You won\'t hear from us again about this inquiry.'] },
    es: { subject: 'Seguimiento sobre {property}', lines: ['Hola {first},', 'Una última nota. Si sigues buscando lugar, nos encantaría mostrarte {property}: elige una hora abajo o responde a este correo.', 'Si ya encontraste casa, ¡felicidades! No te escribiremos más sobre esta consulta.'] },
  },
} as const;

/** Compose an email outbox row (body = plain text; the link line becomes a button). */
function emailRow(base: OutboxRow, kind: keyof typeof EMAIL, name: string | null, property: string | null, link: string | null, es: boolean): OutboxRow {
  const t = EMAIL[kind][es ? 'es' : 'en'];
  const vars = { first: firstName(name), property: property || (es ? 'nuestros apartamentos' : 'our apartments') };
  const lines = t.lines.map((l) => fill(l, vars));
  if (link) lines.splice(2, 0, `${es ? 'Elegir hora' : 'Pick a tour time'}: https://${link.replace(/^https?:\/\//, '')}`);
  return { ...base, kind: `${kind}_email`, channel: 'email', phone_norm: base.phone_norm, subject: fill(t.subject, vars), body: lines.join('\n\n') };
}

function escapeHtml(x: string) { return x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }

async function sendEmail(s: Settings, to: string, subject: string, text: string): Promise<string> {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY not set');
  const paras = text.split('\n\n').map((p) => {
    const m = p.match(/^(.*?):\s*(https:\/\/\S+)$/);
    if (m) return `<p style="margin:24px 0"><a href="${m[2]}" style="background:#0A0A0A;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;display:inline-block">${escapeHtml(m[1])}</a></p>`;
    return `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`;
  }).join('');
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#0A0A0A;max-width:560px">${paras}<p style="margin:24px 0 0">— Appreciate Leasing<br>(816) 765-0427</p><p style="margin:28px 0 0;font-size:12px;color:#888">${escapeHtml(s.email_footer)}<br>You're receiving this because you inquired about a rental. Reply "unsubscribe" to stop.</p></div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: s.email_from, to: [to], subject, html,
      text: `${text}\n\n— Appreciate Leasing\n(816) 765-0427\n\n${s.email_footer}`,
      ...(s.email_reply_to ? { reply_to: s.email_reply_to } : {}),
      headers: s.email_reply_to ? { 'List-Unsubscribe': `<mailto:${s.email_reply_to}?subject=unsubscribe>` } : undefined,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  try { return String(JSON.parse(body).id || ''); } catch { return body.slice(0, 100); }
}

// ---------- Follow-up (nurture) sequence ----------
// Replaces AppFolio's "Lead Nurturing" Realm-X flow. Runs off our instant
// text: day 1, 2, 4 and 7 after it, stopping the moment the prospect replies,
// anyone on the team calls or texts them, a tour is booked, an application
// comes in, they're marked inactive, or they reply STOP. Never auto-inactivates.

const NURTURE = [
  { kind: 'nurture_1', afterH: 24, email: false,
    en: 'Hi {first}, it\'s Appreciate Leasing — still looking for a place? {property} is available. {tour}',
    es: 'Hola {first}, somos Appreciate Leasing. ¿Sigues buscando lugar? {property} está disponible. {tour}' },
  { kind: 'nurture_2', afterH: 48, email: true,
    en: '{first}, units at {property} are leasing quickly. Tours take about 15 minutes. {tour}',
    es: '{first}, las unidades en {property} se rentan rápido. La visita toma unos 15 minutos. {tour}' },
  { kind: 'nurture_3', afterH: 96, email: false,
    en: 'Hi {first}, any questions about {property}? Pets, parking, move-in costs — just reply here. {tour}',
    es: 'Hola {first}, ¿tienes preguntas sobre {property}? Mascotas, estacionamiento, costos de mudanza: responde aquí. {tour}' },
  { kind: 'nurture_4', afterH: 168, email: true,
    en: 'Hi {first}, last check-in from Appreciate Leasing. Still looking? {tour} Found a place? Congrats! Reply STOP and we won\'t text again.',
    es: 'Hola {first}, último mensaje de Appreciate Leasing. ¿Sigues buscando? {tour} ¿Ya encontraste lugar? ¡Felicidades! Responde STOP y no te escribiremos más.' },
] as const;

function nurtureTour(link: string | null, es: boolean) {
  if (link) return es ? `Elige una hora: ${link}` : `Grab a tour time: ${link}`;
  return es ? 'Responde con un día y hora para visitarlo.' : 'Reply with a day and time to come see it.';
}

/** Our own outbound texts show up in JustCall's log too — exclude them from "human" activity. */
async function ourTextIds(phone: string): Promise<Set<string>> {
  const { data } = await supabase.from('lead_outbox').select('external_id').eq('phone_norm', phone).not('external_id', 'is', null);
  return new Set((data || []).map((r: any) => String(r.external_id)));
}

/** Why a follow-up should stop (null = keep going). `since` = when our sequence started. */
async function stopReason(phone: string | null, email: string | null, since: string): Promise<string | null> {
  if (phone) {
    if (await optedOut(phone)) return 'opted out';
    const ours = await ourTextIds(phone);
    const { data: texts } = await supabase.from('justcall_texts').select('id, direction, agent_name').eq('contact_number_norm', phone).gt('sms_at', since);
    for (const t of texts || []) {
      if (/^incoming$/i.test(t.direction || '')) return 'prospect replied';
      if (t.agent_name && !ours.has(String(t.id))) return 'team texted';
    }
    const { count: calls } = await supabase.from('justcall_calls').select('id', { count: 'exact', head: true }).eq('contact_number_norm', phone).gt('call_at', since);
    if ((calls || 0) > 0) return 'call activity';
  }
  if (!phone && !email) return 'no contact info';
  const sinceMinus = new Date(new Date(since).getTime() - 86_400_000).toISOString();
  const { data: shows } = await supabase.from('showings').select('phone, email').gte('created_at', sinceMinus);
  if ((shows || []).some((x: any) => (phone && phone10(x.phone) === phone) || (email && x.email && x.email.toLowerCase() === email.toLowerCase()))) return 'tour scheduled';
  const { data: web } = await supabase.from('web_inquiries').select('id').eq('showing_status', 'booked').gte('created_at', since)
    .or([phone ? `phone_norm.eq.${phone}` : null, email ? `email.eq.${email}` : null].filter(Boolean).join(','));
  if (web?.length) return 'tour booked online';
  if (phone) {
    const { data: apps } = await supabase.from('rental_applications').select('phone_number').gte('received', since.slice(0, 10));
    if ((apps || []).some((a: any) => phone10(a.phone_number) === phone)) return 'applied';
  }
  // Marked inactive in AppFolio by the team (AppFolio's own nurture flow is off after go-live).
  const { data: lr } = await supabase.from('leasing_reports').select('phone, email, status, updated_at').gte('inquiry_received', sinceMinus);
  const mine = (lr || []).filter((l: any) => (phone && phone10(l.phone) === phone) || (email && l.email && l.email.toLowerCase() === email.toLowerCase()));
  if (mine.length && mine.every((l: any) => /inactive/i.test(l.status || ''))) return 'marked inactive';
  return null;
}

async function queueNurture(s: Settings): Promise<Record<string, number>> {
  const floor = new Date(Math.max(Date.now() - 8 * 86_400_000, new Date(s.live_since).getTime())).toISOString();
  const { data: starts } = await supabase.from('lead_outbox')
    .select('id, kind, phone_norm, email, body, created_at, leasing_report_id, web_inquiry_id, property_name, lead_name')
    .in('kind', ['instant', 'instant_email']).in('status', ['sent', 'dry_run']).gte('created_at', floor);
  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1; };
  // One sequence per lead: prefer the SMS instant; email-only leads run off instant_email.
  const seqs = new Map<string, any>();
  for (const r of starts || []) {
    const key = `${r.leasing_report_id || r.web_inquiry_id || r.phone_norm || r.email}`;
    if (!seqs.has(key) || r.kind === 'instant') seqs.set(key, r);
  }
  for (const r of seqs.values()) {
    const age = Date.now() - new Date(r.created_at).getTime();
    const { data: done } = await supabase.from('lead_outbox').select('kind').eq('dedupe_key', `seq:${r.id}`);
    const doneKinds = new Set((done || []).map((d: any) => d.kind));
    const step = NURTURE.find((n) => !doneKinds.has(n.kind) && !doneKinds.has(`${n.kind}_email`) && age >= n.afterH * 3600e3);
    if (!step) continue;
    // Only the next step, and never one whose time is long past (e.g. engine was off).
    const next = NURTURE[NURTURE.indexOf(step) + 1];
    if (next && age >= next.afterH * 3600e3) {
      await enqueue({ kind: step.kind, dedupe_key: `seq:${r.id}`, phone_norm: r.phone_norm, body: null, status: 'skipped', skip_reason: 'missed window' });
      continue;
    }
    const why = await stopReason(r.phone_norm, r.email, r.created_at);
    const base: OutboxRow = {
      kind: step.kind, dedupe_key: `seq:${r.id}`, phone_norm: r.phone_norm, email: r.email,
      leasing_report_id: r.leasing_report_id, web_inquiry_id: r.web_inquiry_id, property_name: r.property_name, lead_name: r.lead_name, body: null,
    };
    if (why) { await enqueue({ ...base, status: 'skipped', skip_reason: why }); bump(`stopped: ${why}`); continue; }
    let es = false;
    if (r.web_inquiry_id) {
      const { data: w } = await supabase.from('web_inquiries').select('locale').eq('id', r.web_inquiry_id).maybeSingle();
      es = w?.locale === 'es';
    }
    const link = (r.body || '').match(LINK_RE)?.[0] || null;
    const vars = { first: firstName(r.lead_name), property: r.property_name || (es ? 'nuestros apartamentos' : 'our apartments'), tour: nurtureTour(link, es) };
    if (r.phone_norm && r.kind === 'instant') {
      if (await enqueue({ ...base, body: fill(es ? step.es : step.en, vars) })) bump(step.kind);
    }
    if (r.email && (step.email || !r.phone_norm)) {
      const ek = (step.kind === 'nurture_4' ? 'nurture_4' : 'nurture_2') as keyof typeof EMAIL;
      const row = emailRow(base, ek, r.lead_name, r.property_name, link, es);
      if (await enqueue({ ...row, kind: `${step.kind}_email` })) bump(`${step.kind}_email`);
    }
  }
  return tally;
}

// ---------- Slack alerts (#leasing) ----------

const SLACK_URL = Deno.env.get('SLACK_LEASING_WEBHOOK_URL') || '';
const DASH = 'https://www.appreciate.io/leasing/automations';
const fmtPhone = (p: string) => `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;
const links = (phone: string | null) => phone ? `\n<${DASH}?q=${phone}|Open in Leasing Automations>` : `\n<${DASH}|Open Leasing Automations>`;

async function alert(kind: string, key: string, phone: string | null, text: string) {
  const { error } = await supabase.from('lead_alerts').insert({ kind, dedupe_key: key, phone_norm: phone, text });
  if (error && error.code !== '23505') console.error('alert insert', error.message);
}

async function flushAlerts(s: Settings): Promise<Record<string, number>> {
  const { data } = await supabase.from('lead_alerts').select('id, kind, text').eq('status', 'pending').order('created_at').limit(20);
  const tally: Record<string, number> = {};
  if (!data?.length) return tally;
  if (!SLACK_URL) { tally.waiting_for_webhook = data.length; return tally; }
  for (const a of data) {
    const { data: claimed } = await supabase.from('lead_alerts').update({ status: 'sending' }).eq('id', a.id).eq('status', 'pending').select('id');
    if (!claimed?.length) continue;
    // @mention whoever owns follow-up on the alerts that need someone to act.
    const mention = s.alert_mention && (s.alert_mention_kinds || []).includes(a.kind) ? `${s.alert_mention} ` : '';
    const res = await fetch(SLACK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: mention + a.text }) });
    if (res.ok) { await supabase.from('lead_alerts').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', a.id); tally.sent = (tally.sent || 0) + 1; }
    else { await supabase.from('lead_alerts').update({ status: 'failed', error: `${res.status} ${(await res.text()).slice(0, 200)}` }).eq('id', a.id); tally.failed = (tally.failed || 0) + 1; }
  }
  return tally;
}

interface KnownLead { name: string; property: string | null; unit: string | null; received: string }

/** Is this phone a prospect (inquired in the last 60 days)? */
async function findLead(phone: string): Promise<KnownLead | null> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data: web } = await supabase.from('web_inquiries').select('first_name, last_name, property_name, listing_address, created_at')
    .eq('phone_norm', phone).gte('created_at', since).order('created_at', { ascending: false }).limit(1);
  const last4 = phone.slice(-4);
  const { data: lr } = await supabase.from('leasing_reports').select('name, property, unit, phone, inquiry_received')
    .gte('inquiry_received', since).ilike('phone', `%${last4}%`).order('inquiry_received', { ascending: false });
  const l = (lr || []).find((x: any) => phone10(x.phone) === phone);
  if (l) {
    const raw = String(l.name || '');
    const name = raw.includes(',') ? `${raw.split(',').slice(1).join(' ').trim()} ${raw.split(',')[0].trim()}` : raw;
    return { name, property: l.property, unit: l.unit, received: l.inquiry_received };
  }
  if (web?.[0]) return { name: `${web[0].first_name} ${web[0].last_name || ''}`.trim(), property: web[0].property_name || web[0].listing_address, unit: null, received: web[0].created_at };
  return null;
}

const YES_RE = /^\s*(yes|yep|yeah|yea|y|si|sí|confirm(ed)?|confirmo|ok|okay|👍)\b/i;

/** A text or call from JustCall just landed (via justcall-webhook). */
async function handleInbound(s: Settings, type: string, id: string): Promise<string> {
  if (type === 'sms') {
    const { data: t } = await supabase.from('justcall_texts').select('id, contact_number_norm, direction, body, sms_at').eq('id', id).maybeSingle();
    if (!t || !/^incoming$/i.test(t.direction || '') || !t.contact_number_norm) return 'ignored';
    const phone = t.contact_number_norm;
    const lead = await findLead(phone);
    if (!lead) return 'not a lead';
    const who = `${lead.name} · ${[lead.property, lead.unit].filter(Boolean).join(' ')}`;
    const word = String(t.body || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE'].includes(word)) {
      await alert('opted_out', String(t.id), phone, `:no_bell: *${who}* replied STOP — no more automated texts. ${fmtPhone(phone)}${links(phone)}`);
      return 'opt-out alert';
    }
    if (YES_RE.test(t.body || '')) {
      // Confirm their next tour, if they have one coming up.
      const { data: shows } = await supabase.from('showings').select('showing_id, phone, showing_time, status, property')
        .gte('showing_time', new Date(Date.now() - 2 * 3600e3).toISOString()).lte('showing_time', new Date(Date.now() + 5 * 86_400_000).toISOString()).order('showing_time');
      const sh = (shows || []).find((x: any) => phone10(x.phone) === phone && !/cancel|no show|completed/i.test(x.status || ''));
      if (sh) {
        const { error } = await supabase.from('showing_confirmations').insert({ showing_id: String(sh.showing_id), phone_norm: phone, message: t.body, justcall_text_id: String(t.id) });
        if (!error) {
          await enqueue({ kind: 'confirm_ack', dedupe_key: String(sh.showing_id), phone_norm: phone, property_name: sh.property, lead_name: lead.name,
            body: `Great, you're confirmed! See you ${fmtShowing(sh.showing_time)} at ${sh.property}. Reply here if anything changes.` });
          await alert('tour_confirmed', String(sh.showing_id), phone, `:white_check_mark: *${who}* confirmed their tour ${fmtShowing(sh.showing_time)}. ${fmtPhone(phone)}${links(phone)}`);
          return 'confirmed';
        }
      }
    }
    await alert('prospect_reply', String(t.id), phone, `:speech_balloon: *Text from ${who}*\n> ${String(t.body || '(media)').slice(0, 300).replace(/\n/g, '\n> ')}\nReply from the JustCall Leasing line · ${fmtPhone(phone)}${links(phone)}`);
    return 'reply alert';
  }
  if (type === 'call') {
    const { data: c } = await supabase.from('justcall_calls').select('id, contact_number_norm, direction, call_type').eq('id', id).maybeSingle();
    if (!c || !/^incoming$/i.test(c.direction || '') || !c.contact_number_norm) return 'ignored';
    if (String(c.call_type || '').toLowerCase() === 'answered') return 'answered';
    const lead = await findLead(c.contact_number_norm);
    if (!lead) return 'not a lead';
    await alert('missed_call', String(c.id), c.contact_number_norm,
      `:telephone_receiver: *Missed call from ${lead.name}* · ${[lead.property, lead.unit].filter(Boolean).join(' ')} (${String(c.call_type || 'missed').toLowerCase()}) — call back: ${fmtPhone(c.contact_number_norm)}${links(c.contact_number_norm)}`);
    return 'missed-call alert';
  }
  return 'unknown type';
}

/** Leads nobody on the team has reached yet, 15+ minutes in, during working hours. */
async function alertNeedsPerson(s: Settings): Promise<number> {
  const now = new Date();
  const { hour } = centralParts(now);
  const dow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' })).getDay();
  if (hour < 8 || hour >= 19 || dow === 0) return 0;
  const floor = new Date(Math.max(Date.now() - 24 * 3600e3, new Date(s.live_since).getTime())).toISOString();
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: leads } = await supabase.from('leasing_reports').select('name, property, unit, phone, inquiry_received, status, source')
    .gte('inquiry_received', floor).lte('inquiry_received', cutoff);
  let n = 0;
  const seen = new Set<string>();
  for (const l of leads || []) {
    const phone = phone10(l.phone);
    if (!phone || seen.has(phone) || /inactive/i.test(l.status || '')) continue;
    seen.add(phone);
    const ours = await ourTextIds(phone);
    const { data: texts } = await supabase.from('justcall_texts').select('id, direction, agent_name').eq('contact_number_norm', phone).gte('sms_at', l.inquiry_received);
    const humanText = (texts || []).some((t: any) => !/^incoming$/i.test(t.direction || '') && t.agent_name && !ours.has(String(t.id)));
    const { count } = await supabase.from('justcall_calls').select('id', { count: 'exact', head: true }).eq('contact_number_norm', phone).gte('call_at', l.inquiry_received);
    if (humanText || (count || 0) > 0) continue;
    const raw = String(l.name || '');
    const name = raw.includes(',') ? `${raw.split(',').slice(1).join(' ').trim()} ${raw.split(',')[0].trim()}` : raw;
    const mins = Math.round((Date.now() - new Date(l.inquiry_received).getTime()) / 60_000);
    await alert('needs_person', `${phone}|${centralParts(new Date(l.inquiry_received)).date}`, phone,
      `:rotating_light: *${name}* (${l.source || 'lead'}) · ${[l.property, l.unit].filter(Boolean).join(' ')} — no call or text from the team after ${mins} min. ${fmtPhone(phone)}${links(phone)}`);
    n++;
  }
  return n;
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
      if (s.nurture_enabled) out.nurture = await queueNurture(s);
      out.needs_person = await alertNeedsPerson(s);
    } else if (mode === 'inbound') {
      // Called by justcall-webhook the moment a text or call lands.
      out.inbound = await handleInbound(s, url.searchParams.get('type') || '', url.searchParams.get('id') || '');
    } else if (mode !== 'send') {
      return json({ error: `unknown mode ${mode}` }, 400);
    }
    out.sent = await drain(s);
    if (s.alerts_enabled) out.alerts = await flushAlerts(s);
    out.ms = Date.now() - t0;
    return json(out);
  } catch (e: any) {
    console.error('lead-engine', mode, e?.message || e);
    return json({ error: e?.message || String(e), mode }, 500);
  }
});
