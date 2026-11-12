/**
 * /api/admin/lead-timeline
 *
 * GET ?days=30&property=<name>|all
 *
 * Every lead in the window with every touch point, human or automated:
 *   inquiry      AppFolio guest cards (any source) + website form submissions
 *   auto         our lead engine's texts (lead_outbox: sent / dry-run / skipped / scheduled)
 *   appfolio     AppFolio's own automation as observed (first auto-response, latest activity)
 *   sms          every JustCall text in/out (justcall_texts)
 *   call         every JustCall call in/out (justcall_calls)
 *   showing      AppFolio showings + tours booked on our site
 *   application  AppFolio rental applications
 *   optout       STOP replies
 *
 * A lead = one person, keyed by phone (last 10 digits), else email, else the
 * guest card — so a prospect who filled our form AND came through Zillow is
 * one row with both inquiries on it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';
import { fetchAllRows } from '../../../../lib/supabase-paging';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Actor = 'auto' | 'human' | 'prospect' | 'appfolio' | 'system';
type Channel = 'inquiry' | 'sms' | 'call' | 'email' | 'showing' | 'application' | 'appfolio' | 'optout';

interface Touch {
  at: string;
  actor: Actor;
  channel: Channel;
  label: string;
  detail?: string | null;
  agent?: string | null;
  status?: string | null;   // e.g. sent | dry_run | skipped | scheduled | answered | missed
}

interface LeadOut {
  key: string;
  name: string;
  phone: string | null;
  email: string | null;
  property: string | null;
  unit: string | null;
  sources: string[];
  received: string;
  appfolio_status: string | null;
  guest_card_uuid: string | null;
  stage: 'new' | 'contacted' | 'tour_scheduled' | 'toured' | 'applied' | 'inactive';
  first_auto_sec: number | null;
  first_human_min: number | null;
  human_touches: number;
  auto_touches: number;
  prospect_replies: number;
  needs_human: boolean;
  opted_out: boolean;
  last_touch_at: string;
  timeline: Touch[];
}

const phone10 = (v: unknown): string | null => {
  if (!v) return null;
  const d = String(v).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  return d.length >= 10 ? d.slice(-10) : null;
};
// AppFolio guest-card names are "Last, First" — show "First Last".
const displayName = (n: string | null | undefined) => {
  const s = String(n || '').trim();
  if (!s.includes(',')) return s || 'Unknown';
  const [last, ...rest] = s.split(',');
  return `${rest.join(' ').trim()} ${last.trim()}`.trim();
};
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mins = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000;
const fmtDur = (sec: number | null | undefined) => {
  if (!sec) return null;
  return sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;
};

// AppFolio activity types that are AppFolio's own automation vs. a person in AppFolio.
const AF_AUTO = /auto|call to action|reminder|status changed|task created|task cleared/i;

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const days = Math.max(1, Math.min(180, Number(request.nextUrl.searchParams.get('days')) || 30));
  const propertyFilter = request.nextUrl.searchParams.get('property') || 'all';
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  // Touches can trail the inquiry by weeks; read a little past the window edge.
  const touchSince = new Date(Date.now() - (days + 1) * 86_400_000).toISOString();

  const [lr, web, outbox, texts, calls, showings, apps, optouts] = await Promise.all([
    fetchAllRows(() => supabase.from('leasing_reports')
      .select('id, name, email, phone, property, unit, source, inquiry_received, status, last_activity_type, last_activity_at, first_response_at, first_response_type, guest_card_id, guest_card_uuid')
      .gte('inquiry_received', since)),
    fetchAllRows(() => supabase.from('web_inquiries')
      .select('id, created_at, first_name, last_name, email, phone_norm, property_name, listing_address, wants_tour, message, showing_status, showing_start, appfolio_status')
      .gte('created_at', since)),
    fetchAllRows(() => supabase.from('lead_outbox')
      .select('id, kind, channel, subject, status, skip_reason, phone_norm, leasing_report_id, web_inquiry_id, body, send_after, sent_at, created_at, error, external_id')
      .gte('created_at', touchSince)),
    fetchAllRows(() => supabase.from('justcall_texts')
      .select('id, contact_number_norm, direction, body, sms_at, agent_name, justcall_line_name')
      .gte('sms_at', touchSince)),
    fetchAllRows(() => supabase.from('justcall_calls')
      .select('id, contact_number_norm, direction, call_type, call_at, duration_seconds, agent_name, justcall_line_name')
      .gte('call_at', touchSince)),
    fetchAllRows(() => supabase.from('showings')
      .select('showing_id, guest_card_id, phone, property, showing_unit, showing_time, status, assigned_user, created_at')
      .gte('showing_time', touchSince)),
    fetchAllRows(() => supabase.from('rental_applications')
      .select('rental_application_id, unit, received, status, application_status, phone_number')
      .gte('received', touchSince)),
    supabase.from('sms_opt_outs').select('phone_norm, opted_out_at'),
  ]);
  const { data: confirms } = await supabase.from('showing_confirmations').select('showing_id, phone_norm, confirmed_at, message').gte('confirmed_at', touchSince);
  for (const r of [lr, web, outbox, texts, calls, showings, apps]) {
    if (r.error) return NextResponse.json({ error: r.error.message || String(r.error) }, { status: 500 });
  }

  // ── Build leads keyed by person ────────────────────────────────────
  type Acc = {
    key: string; name: string; phone: string | null; email: string | null;
    property: string | null; unit: string | null; sources: Set<string>; received: string;
    appfolio_status: string | null; guest_card_uuid: string | null; gcids: Set<string>;
    lrIds: Set<string>; webIds: Set<string>; latestAt: string; timeline: Touch[];
  };
  const leads = new Map<string, Acc>();
  const keyOf = (phone: string | null, email: string | null, fallback: string) =>
    phone ? `p:${phone}` : email ? `e:${email.toLowerCase()}` : fallback;
  const upsert = (k: string, seed: () => Acc) => {
    let a = leads.get(k);
    if (!a) { a = seed(); leads.set(k, a); }
    return a;
  };

  for (const l of lr.data as any[]) {
    const phone = phone10(l.phone);
    const k = keyOf(phone, l.email, `g:${l.guest_card_id || l.id}`);
    const a = upsert(k, () => ({
      key: k, name: displayName(l.name), phone, email: l.email || null, property: l.property, unit: l.unit,
      sources: new Set(), received: l.inquiry_received, appfolio_status: l.status, guest_card_uuid: l.guest_card_uuid,
      gcids: new Set(), lrIds: new Set(), webIds: new Set(), latestAt: l.inquiry_received, timeline: [],
    }));
    if (l.inquiry_received < a.received) a.received = l.inquiry_received;
    if (l.inquiry_received >= a.latestAt) {
      a.latestAt = l.inquiry_received; a.property = l.property || a.property; a.unit = l.unit || a.unit;
      a.appfolio_status = l.status; a.guest_card_uuid = l.guest_card_uuid || a.guest_card_uuid;
    }
    if (!a.email && l.email) a.email = l.email;
    a.sources.add(l.source || 'Unknown');
    if (l.guest_card_id) a.gcids.add(String(l.guest_card_id));
    a.lrIds.add(l.id);
    a.timeline.push({ at: l.inquiry_received, actor: 'prospect', channel: 'inquiry', label: `Inquiry via ${l.source || 'unknown source'}`, detail: [l.property, l.unit].filter(Boolean).join(' · ') || null });
    if (l.first_response_at) {
      a.timeline.push({ at: l.first_response_at, actor: 'appfolio', channel: 'appfolio', label: `AppFolio: ${l.first_response_type || 'first response'}`, detail: 'observed by 5-min poll (±5 min)', status: 'first_response' });
    }
    if (l.last_activity_type && l.last_activity_at && l.last_activity_type !== l.first_response_type) {
      a.timeline.push({
        at: l.last_activity_at, actor: AF_AUTO.test(l.last_activity_type) ? 'appfolio' : 'human', channel: 'appfolio',
        label: `AppFolio: ${l.last_activity_type}`, detail: 'latest AppFolio activity — AppFolio only reports the date', status: 'date_only',
      });
    }
  }

  for (const w of web.data as any[]) {
    const k = keyOf(w.phone_norm, w.email, `w:${w.id}`);
    const a = upsert(k, () => ({
      key: k, name: [w.first_name, w.last_name].filter(Boolean).join(' '), phone: w.phone_norm, email: w.email,
      property: w.property_name || w.listing_address, unit: null, sources: new Set(), received: w.created_at,
      appfolio_status: null, guest_card_uuid: null, gcids: new Set(), lrIds: new Set(), webIds: new Set(), latestAt: w.created_at, timeline: [],
    }));
    if (w.created_at < a.received) a.received = w.created_at;
    a.sources.add('Website (appreciate.io)');
    a.webIds.add(w.id);
    a.timeline.push({
      at: w.created_at, actor: 'prospect', channel: 'inquiry',
      label: w.wants_tour ? 'Tour request on appreciate.io' : 'Question on appreciate.io',
      detail: [w.message, w.appfolio_status === 'failed' ? '⚠ AppFolio guest card not created' : null].filter(Boolean).join(' · ') || null,
    });
    if (w.showing_status === 'booked' && w.showing_start) {
      a.timeline.push({ at: w.created_at, actor: 'prospect', channel: 'showing', label: `Booked tour for ${new Date(w.showing_start).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, detail: 'self-scheduled on AppFolio calendar' });
    } else if (w.showing_status === 'slot_taken') {
      a.timeline.push({ at: w.created_at, actor: 'system', channel: 'showing', label: 'Picked tour time was taken', status: 'missed' });
    }
  }

  // Index leads by phone / record ids for touch matching.
  const byPhone = new Map<string, Acc>();
  const byLr = new Map<string, Acc>();
  const byWeb = new Map<string, Acc>();
  const byGc = new Map<string, Acc>();
  for (const a of leads.values()) {
    if (a.phone) byPhone.set(a.phone, a);
    a.lrIds.forEach((id) => byLr.set(id, a));
    a.webIds.forEach((id) => byWeb.set(id, a));
    a.gcids.forEach((id) => byGc.set(id, a));
  }
  // Only count touches from shortly before the first inquiry onward.
  const inScope = (a: Acc, at: string) => new Date(at).getTime() >= new Date(a.received).getTime() - 60 * 60_000;

  const outboxExt = new Set<string>();
  const KIND_LABEL: Record<string, string> = {
    instant: 'Instant text', instant_email: 'Instant email',
    tour_booked: 'Tour booking confirmation', confirm_ack: 'Tour confirmed — reply',
    tour_reminder_day: 'Tour reminder (day before)', tour_reminder_2h: 'Tour reminder (2h before)',
    no_show: 'No-show rebook text', post_tour: 'Post-tour follow-up',
    nurture_1: 'Follow-up #1 (day 1)', nurture_2: 'Follow-up #2 (day 2)', nurture_3: 'Follow-up #3 (day 4)', nurture_4: 'Follow-up #4 (day 7)',
    nurture_1_email: 'Follow-up email (day 1)', nurture_2_email: 'Follow-up email (day 2)', nurture_3_email: 'Follow-up email (day 4)', nurture_4_email: 'Follow-up email (day 7)',
    reengage: 'Re-engagement text', test: 'Test text',
  };
  for (const o of outbox.data as any[]) {
    // The JustCall copy of a text we sent shouldn't show twice.
    if (o.external_id) outboxExt.add(String(o.external_id));
    const a = (o.leasing_report_id && byLr.get(o.leasing_report_id)) || (o.web_inquiry_id && byWeb.get(o.web_inquiry_id)) || (o.phone_norm && byPhone.get(o.phone_norm));
    if (!a) continue;
    const status = o.status === 'pending' ? 'scheduled' : o.status;
    const at = o.sent_at || (o.status === 'pending' ? o.send_after : o.created_at);
    a.timeline.push({
      at, actor: 'auto', channel: o.channel === 'email' ? 'email' : 'sms', label: KIND_LABEL[o.kind] || o.kind, status,
      detail: o.status === 'skipped' ? `Not sent: ${o.skip_reason}`
        : o.status === 'failed' ? `Failed: ${o.error}`
        : o.channel === 'email' ? `${o.subject ? `“${o.subject}” — ` : ''}${o.body || ''}` : o.body,
    });
  }

  for (const t of texts.data as any[]) {
    const a = t.contact_number_norm && byPhone.get(t.contact_number_norm);
    if (!a || !t.sms_at || !inScope(a, t.sms_at)) continue;
    if (outboxExt.has(String(t.id))) continue;
    const incoming = /^incoming$/i.test(t.direction || '');
    // Texts we send through the API arrive with no agent attached.
    const actor: Actor = incoming ? 'prospect' : t.agent_name ? 'human' : 'auto';
    a.timeline.push({
      at: t.sms_at, actor, channel: 'sms', label: incoming ? 'Text from prospect' : actor === 'human' ? 'Text sent' : 'Automated text (JustCall)',
      detail: t.body, agent: t.agent_name || t.justcall_line_name || null,
    });
  }

  for (const c of calls.data as any[]) {
    const a = c.contact_number_norm && byPhone.get(c.contact_number_norm);
    if (!a || !c.call_at || !inScope(a, c.call_at)) continue;
    const incoming = /^incoming$/i.test(c.direction || '');
    const type = String(c.call_type || '').toLowerCase();
    const answered = type === 'answered';
    a.timeline.push({
      at: c.call_at, actor: incoming ? 'prospect' : 'human', channel: 'call',
      label: incoming ? (answered ? 'Prospect called — answered' : `Prospect called — ${type || 'missed'}`) : (answered ? 'Call — connected' : `Call — ${type || 'no answer'}`),
      detail: fmtDur(c.duration_seconds), agent: c.agent_name || c.justcall_line_name || null, status: answered ? 'answered' : 'missed',
    });
  }

  for (const s of showings.data as any[]) {
    const a = (s.guest_card_id && byGc.get(String(s.guest_card_id))) || (phone10(s.phone) && byPhone.get(phone10(s.phone)!));
    if (!a || !s.showing_time) continue;
    a.timeline.push({
      at: s.showing_time, actor: 'system', channel: 'showing', label: `Tour ${String(s.status || 'scheduled').toLowerCase()}`,
      detail: [s.property, s.showing_unit].filter(Boolean).join(' · ') || null, agent: s.assigned_user || null, status: s.status,
    });
  }

  for (const ap of apps.data as any[]) {
    const p = phone10(ap.phone_number);
    const a = p && byPhone.get(p);
    if (!a || !ap.received || !inScope(a, ap.received)) continue;
    a.timeline.push({
      at: ap.received, actor: 'prospect', channel: 'application', label: 'Application received',
      detail: [ap.unit, ap.application_status || ap.status].filter(Boolean).join(' · ') || null, status: ap.application_status || ap.status,
    });
  }

  for (const c of (confirms || []) as any[]) {
    const a = c.phone_norm && byPhone.get(c.phone_norm);
    if (a) a.timeline.push({ at: c.confirmed_at, actor: 'prospect', channel: 'showing', label: 'Confirmed tour by text', detail: c.message, status: 'confirmed' });
  }

  const optedOut = new Map<string, string>();
  for (const o of (optouts.data || []) as any[]) optedOut.set(o.phone_norm, o.opted_out_at);
  for (const [p, at] of optedOut) {
    const a = byPhone.get(p);
    if (a) a.timeline.push({ at, actor: 'prospect', channel: 'optout', label: 'Replied STOP — opted out of texts' });
  }

  // ── Per-lead metrics ───────────────────────────────────────────────
  const now = Date.now();
  const all: LeadOut[] = [];
  const properties = new Map<string, number>();
  for (const a of leads.values()) {
    a.timeline.sort((x, y) => x.at.localeCompare(y.at));
    // One guest card per unit asked about → identical AppFolio rows; keep one.
    const seenT = new Set<string>();
    a.timeline = a.timeline.filter((t) => {
      if (t.channel !== 'appfolio') return true;
      const k = `${t.at}|${t.label}`;
      if (seenT.has(k)) return false;
      seenT.add(k); return true;
    });
    // First automated reply to the inquiry: our instant text or AppFolio's auto-response.
    const firstAuto = a.timeline.find((t) =>
      (t.actor === 'auto' && (t.label === 'Instant text' || t.label === 'Instant email') && (t.status === 'sent' || t.status === 'dry_run'))
      || t.status === 'first_response');
    const firstHuman = a.timeline.find((t) => t.actor === 'human' && t.channel !== 'appfolio');
    const humanTouches = a.timeline.filter((t) => t.actor === 'human' && t.channel !== 'appfolio').length;
    const autoTouches = a.timeline.filter((t) => t.actor === 'auto' && t.status !== 'skipped' && t.status !== 'scheduled').length;
    const replies = a.timeline.filter((t) => t.actor === 'prospect' && (t.channel === 'sms' || t.channel === 'call')).length;
    const hasApp = a.timeline.some((t) => t.channel === 'application');
    const showingsT = a.timeline.filter((t) => t.channel === 'showing');
    const toured = showingsT.some((t) => /^completed/i.test(t.status || ''));
    const tourSched = showingsT.length > 0;
    const inactive = /inactive/i.test(a.appfolio_status || '');
    const stage: LeadOut['stage'] = hasApp ? 'applied' : toured ? 'toured' : tourSched ? 'tour_scheduled'
      : inactive ? 'inactive' : (humanTouches || replies) ? 'contacted' : 'new';
    const lastTouch = a.timeline.filter((t) => new Date(t.at).getTime() <= now).at(-1)?.at || a.received;
    const firstHumanMin = firstHuman ? Math.max(0, Math.round(mins(a.received, firstHuman.at))) : null;
    all.push({
      key: a.key, name: a.name, phone: a.phone, email: a.email, property: a.property, unit: a.unit,
      sources: [...a.sources], received: a.received, appfolio_status: a.appfolio_status, guest_card_uuid: a.guest_card_uuid,
      stage,
      first_auto_sec: firstAuto ? Math.max(0, Math.round(mins(a.received, firstAuto.at) * 60)) : null,
      first_human_min: firstHumanMin,
      human_touches: humanTouches, auto_touches: autoTouches, prospect_replies: replies,
      needs_human: !firstHuman && !inactive && !hasApp && now - new Date(a.received).getTime() > 15 * 60_000,
      opted_out: !!(a.phone && optedOut.has(a.phone)),
      last_touch_at: lastTouch,
      timeline: a.timeline,
    });
    const pk = a.property || 'Unknown';
    properties.set(pk, (properties.get(pk) || 0) + 1);
  }

  const filtered = propertyFilter === 'all' ? all : all.filter((l) => (l.property || 'Unknown') === propertyFilter);
  filtered.sort((x, y) => y.received.localeCompare(x.received));

  const autoSecs = filtered.map((l) => l.first_auto_sec).filter((v): v is number => v != null);
  const humanMins = filtered.map((l) => l.first_human_min).filter((v): v is number => v != null);
  const n = filtered.length || 1;
  const kpis = {
    leads: filtered.length,
    auto_within_1m_pct: Math.round(100 * filtered.filter((l) => l.first_auto_sec != null && l.first_auto_sec <= 60).length / n),
    median_auto_sec: median(autoSecs),
    human_within_5m_pct: Math.round(100 * filtered.filter((l) => l.first_human_min != null && l.first_human_min <= 5).length / n),
    human_within_1h_pct: Math.round(100 * filtered.filter((l) => l.first_human_min != null && l.first_human_min <= 60).length / n),
    median_human_min: median(humanMins),
    never_human: filtered.filter((l) => l.first_human_min == null).length,
    needs_human: filtered.filter((l) => l.needs_human).length,
    toured: filtered.filter((l) => l.stage === 'toured' || l.stage === 'applied').length,
    tour_scheduled: filtered.filter((l) => ['tour_scheduled', 'toured', 'applied'].includes(l.stage)).length,
    applied: filtered.filter((l) => l.stage === 'applied').length,
  };

  const { data: settings } = await supabase.from('lead_engine_settings').select('enabled, dry_run, live_since').eq('id', 1).maybeSingle();

  return NextResponse.json({
    days, property: propertyFilter,
    engine: settings || null,
    properties: [...properties.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    kpis,
    leads: filtered,
  }, { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } });
}
