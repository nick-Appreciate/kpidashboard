/**
 * /api/admin/speed-to-lead
 *
 * GET ?days=14&region=all
 *
 * Two tracks of first-contact speed for leasing inquiries:
 *   automated — auto-text/email, from leasing_reports.first_response_at
 *               (observation-time capture; only meaningful post-instrumentation).
 *   warm      — first answered OUTBOUND call, from justcall_calls matched to the
 *               lead by phone. Minute-precise, with full history, so it's the
 *               headline. We report time-to-first-DIAL (any outbound attempt)
 *               separately from time-to-first-CONNECT (answered) so a slow VA
 *               reads differently from an unreachable lead.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';

const KC_NEEDLES = ['hilltop', 'oakwood', 'glen oaks', 'normandy', 'maple manor'];
function inKcRegion(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return KC_NEEDLES.some(n => lower.includes(n));
}

const SLA_MIN = 5;
const WARN_MIN = 60;

const phone10 = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const d = v.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
};

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? Math.round(s[mid]) : Math.round((s[mid - 1] + s[mid]) / 2);
}
const pct = (num: number, den: number) => (den > 0 ? Math.round((100 * num) / den) : null);
const durStr = (s: number | null) => { if (s == null) return null; const m = Math.floor(s / 60), sec = s % 60; return m ? `${m}m ${sec}s` : `${sec}s`; };

// Business hours: 9:00–17:00 America/Chicago, Mon–Fri. "Business minutes"
// between two instants, so an inquiry after hours / on a weekend doesn't count
// against the team until they're back on the clock. The clock pauses outside
// 9–5 and resumes when they reopen.
const BIZ_OPEN = 9 * 3600, BIZ_CLOSE = 17 * 3600;
const BIZ_DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
function centralInfo(ms: number): { weekday: string; secs: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value || '0');
  const weekday = parts.find((p) => p.type === 'weekday')?.value || '';
  return { weekday, secs: (g('hour') % 24) * 3600 + g('minute') * 60 + g('second') };
}
function businessMinutes(startMs: number, endMs: number): number {
  if (endMs <= startMs) return 0;
  let total = 0, cur = startMs;
  for (let i = 0; i < 200 && cur < endMs; i++) {
    const { weekday, secs } = centralInfo(cur);
    const dayEnd = cur + (86400 - secs) * 1000; // next Central midnight
    const segEnd = Math.min(endMs, dayEnd);
    if (BIZ_DAYS.has(weekday)) {
      const lo = Math.max(secs, BIZ_OPEN);
      const hi = Math.min(secs + (segEnd - cur) / 1000, BIZ_CLOSE);
      if (hi > lo) total += (hi - lo) / 60;
    }
    cur = dayEnd;
  }
  return Math.round(total);
}

const norm = (s: string | null | undefined): string => {
  if (!s) return '(no source)';
  const t = s.trim();
  if (!t) return '(no source)';
  const lower = t.toLowerCase();
  if (lower === 'apartments.com') return 'Apartments.com';
  if (lower === 'zillow' || lower === 'zillow rental network') return 'Zillow Rental Network';
  if (lower === 'rent.' || lower === 'rent') return 'Rent.';
  return t;
};

// AppFolio "MM/DD/YYYY" → ISO (date-only precision, noon UTC).
function mdyToIso(s: string): string | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}T12:00:00Z` : null;
}

// Guest-card notes are a ";"-joined activity log, newest first. When a PM
// disqualifies a lead AppFolio writes a "Marked Inactive … Reason: <X>" entry
// with an optional freeform detail line. Pull the newest such entry.
function parseInactive(notes: string | null | undefined): { reason: string | null; detail: string | null; at: string | null } | null {
  if (!notes) return null;
  const m = notes.match(/(\d{2}\/\d{2}\/\d{4}),\s*(?:Cleared [^\n;]*? and )?Marked Inactive[\s\S]*?Reason:\s*([^\n;]+)(?:\n([^\n;]+))?/i);
  if (!m) return null;
  let detail = (m[3] || '').trim();
  if (/^\d{2}\/\d{2}\/\d{4}/.test(detail) || /^(Call|Text|Email|Auto|Cleared|Marked)/i.test(detail)) detail = '';
  return { at: mdyToIso(m[1]), reason: (m[2] || '').trim() || null, detail: detail || null };
}

// Furthest-along wins when a person has multiple applications.
function appRank(status: string): number {
  const s = (status || '').toLowerCase();
  if (s === 'converted') return 5;
  if (s === 'approved' || s === 'converting') return 4;
  if (s === 'decision pending' || s === 'new') return 3;
  if (s === 'denied') return 1;
  return 2;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const { searchParams } = new URL(req.url);
  const days = Math.max(1, Math.min(90, parseInt(searchParams.get('days') || '14', 10)));
  const region = searchParams.get('region') || 'all';
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();

  const inRegion = (propLike: string | null | undefined): boolean => {
    if (region === 'all') return true;
    if (region === 'region_kansas_city') return inKcRegion(propLike);
    if (region === 'region_columbia') return !inKcRegion(propLike);
    return true;
  };

  const [leadRes, callRes, showRes, appRes, leaseHistRes] = await Promise.all([
    supabase.from('leasing_reports')
      .select('name, source, property, unit, phone, inquiry_received, first_response_at, first_response_type, guest_card_id, inquiry_id, status, notes')
      .gte('inquiry_received', sinceIso)
      .range(0, 9999),
    supabase.from('justcall_calls')
      .select('contact_number_norm, direction, call_type, call_at, agent_name, duration_seconds')
      .gte('call_at', sinceIso)
      .range(0, 49999),
    supabase.from('showings')
      .select('guest_card_id, status, showing_time')
      .gte('showing_time', sinceIso)
      .range(0, 9999),
    supabase.from('rental_applications')
      .select('phone_number, status, received, unit, lease_start_date, desired_move_in')
      .gte('received', sinceIso)
      .range(0, 9999),
    supabase.from('af_lease_history')
      .select('tenant_name, lease_start')
      .range(0, 9999),
  ]);
  if (leadRes.error) return NextResponse.json({ error: leadRes.error.message }, { status: 500 });

  const rawLeads = (leadRes.data || []).filter(r => r.inquiry_received && inRegion(r.property));

  // Index showings by guest_card_id and applications by inquiry_id.
  const showsByGcid = new Map<string, { status: string; at: string }[]>();
  for (const s of (showRes.data || [])) {
    if (!s.guest_card_id) continue;
    const k = String(s.guest_card_id);
    if (!showsByGcid.has(k)) showsByGcid.set(k, []);
    showsByGcid.get(k)!.push({ status: s.status || '', at: s.showing_time });
  }
  // Applications link to leads by PHONE, not inquiry_id: AppFolio gives each
  // application its own inquiry_id, distinct from the guest card's, so they
  // don't join. Phone10 is how leads are keyed everywhere, so match the same
  // way and keep the furthest-along application per person.
  type AppRec = { status: string; received: string; unit: string | null; lease_start: string | null; desired: string | null };
  const appByPhone = new Map<string, AppRec>();
  for (const a of (appRes.data || [])) {
    const p10 = phone10(a.phone_number);
    if (!p10) continue;
    const cand: AppRec = { status: a.status || '', received: a.received, unit: a.unit ?? null, lease_start: a.lease_start_date ?? null, desired: a.desired_move_in ?? null };
    const prev = appByPhone.get(p10);
    if (!prev || appRank(cand.status) > appRank(prev.status) || (appRank(cand.status) === appRank(prev.status) && cand.received > prev.received)) appByPhone.set(p10, cand);
  }
  // Real lease start from af_lease_history, keyed by "Last|First" (its
  // tenant_name shares the leasing_reports "Last, First" format).
  const leaseKey = (name: string | null | undefined) => {
    if (!name) return '';
    const [last, rest = ''] = name.toLowerCase().split(',');
    return `${last.trim()}|${(rest.trim().split(/\s+/)[0] || '')}`;
  };
  const leaseStartByName = new Map<string, string>();
  for (const lh of (leaseHistRes.data || [])) {
    if (!lh.tenant_name || !lh.lease_start) continue;
    const k = leaseKey(lh.tenant_name);
    const prev = leaseStartByName.get(k);
    if (!prev || lh.lease_start > prev) leaseStartByName.set(k, lh.lease_start); // most recent lease
  }
  const showRank = (st: string) => {
    const s = st.toLowerCase();
    if (s.startsWith('completed')) return 3;
    if (s === 'scheduled') return 2;
    return 1; // canceled / no show / prospect canceled
  };

  // Index outbound calls by matched phone (last-10).
  const outByPhone = new Map<string, { at: number; answered: boolean; agent: string | null }[]>();
  // ALL calls by phone (any direction) — for the per-lead timeline.
  const callsByPhone = new Map<string, { atIso: string; atMs: number; direction: string; call_type: string; duration: number | null; agent: string | null }[]>();
  // Full per-agent activity across ALL calls, so every VA appears — not just
  // whoever happened to get the first warm contact on a lead.
  const agentScore = new Map<string, { outbound: number; connected: number; inbound_answered: number; contacts: Set<string> }>();
  for (const c of (callRes.data || [])) {
    const dir = (c.direction || '').toLowerCase();
    const answered = (c.call_type || '').toLowerCase() === 'answered';

    if (c.contact_number_norm && dir === 'outgoing') {
      if (!outByPhone.has(c.contact_number_norm)) outByPhone.set(c.contact_number_norm, []);
      outByPhone.get(c.contact_number_norm)!.push({ at: new Date(c.call_at).getTime(), answered, agent: c.agent_name ?? null });
    }
    if (c.contact_number_norm) {
      if (!callsByPhone.has(c.contact_number_norm)) callsByPhone.set(c.contact_number_norm, []);
      callsByPhone.get(c.contact_number_norm)!.push({
        atIso: c.call_at, atMs: new Date(c.call_at).getTime(),
        direction: c.direction || '', call_type: c.call_type || '', duration: c.duration_seconds ?? null, agent: c.agent_name ?? null,
      });
    }

    const name = c.agent_name || '(unknown)';
    let a = agentScore.get(name);
    if (!a) { a = { outbound: 0, connected: 0, inbound_answered: 0, contacts: new Set() }; agentScore.set(name, a); }
    if (dir === 'outgoing') { a.outbound++; if (answered) a.connected++; }
    else if (dir === 'incoming' && answered) a.inbound_answered++;
    if (answered && c.contact_number_norm) a.contacts.add(c.contact_number_norm);
  }

  // ---- Automated track (unchanged semantics) -------------------------------
  let trackingSince: string | null = null;
  for (const r of rawLeads) {
    if (r.first_response_at && (!trackingSince || r.first_response_at < trackingSince)) trackingSince = r.first_response_at;
  }
  const trackingMs = trackingSince ? new Date(trackingSince).getTime() : null;
  const autoTrackable = trackingMs != null ? rawLeads.filter(l => new Date(l.inquiry_received).getTime() >= trackingMs) : [];
  const autoResponded = autoTrackable.filter(l => l.first_response_at);
  const autoLat = autoResponded.map(l => Math.max(0, Math.round((new Date(l.first_response_at!).getTime() - new Date(l.inquiry_received).getTime()) / 60000)));
  const automated = {
    tracking_since: trackingSince,
    tracked: autoTrackable.length,
    responded: autoResponded.length,
    within_sla_pct: pct(autoResponded.filter((_, i) => autoLat[i] <= SLA_MIN).length, autoTrackable.length),
    median_latency_min: median(autoLat),
  };

  // ---- Warm track (calls) — full history, this is the headline -------------
  const withPhone = rawLeads.filter(l => phone10(l.phone));
  const dialLat: number[] = [];
  const warmLat: number[] = [];
  const agentAgg = new Map<string, number[]>();
  let dialed = 0, connected = 0, within5 = 0, within1h = 0;
  // Per-day accountability series: of that day's leads, how many hit the SLA.
  const dailyMap = new Map<string, { leads: number; w5: number; w60: number }>();

  for (const l of withPhone) {
    const inqMs = new Date(l.inquiry_received).getTime();
    const day = l.inquiry_received.slice(0, 10);
    const d = dailyMap.get(day) || { leads: 0, w5: 0, w60: 0 };
    d.leads++;

    const calls = (outByPhone.get(phone10(l.phone)!) || []).filter(c => c.at >= inqMs);
    if (calls.length > 0) dialed++;   // "dialed" count still spans every lead with an attempt
    const answered = calls.filter(c => c.answered);
    if (answered.length > 0) {
      connected++;
      // First-dial latency is measured over the SAME connected leads as warm
      // contact, so median-to-dial can never exceed median-to-warm. (Leads that
      // were dialed but never answered — often dialed very late — are surfaced
      // via the connect rate and the worklist instead.)
      dialLat.push(businessMinutes(inqMs, Math.min(...calls.map(c => c.at))));
      const firstWarm = answered.reduce((m, c) => (c.at < m.at ? c : m));
      const min = businessMinutes(inqMs, firstWarm.at);
      warmLat.push(min);
      if (min <= SLA_MIN) { within5++; d.w5++; }
      if (min <= WARN_MIN) { within1h++; d.w60++; }
      if (firstWarm.agent) {
        if (!agentAgg.has(firstWarm.agent)) agentAgg.set(firstWarm.agent, []);
        agentAgg.get(firstWarm.agent)!.push(min);
      }
    }
    dailyMap.set(day, d);
  }

  // Daily SLA success-rate series (chronological), for the accountability chart.
  const daily = Array.from(dailyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({
      date,
      leads: v.leads,
      within_sla_pct: pct(v.w5, v.leads),
      within_warn_pct: pct(v.w60, v.leads),
    }));

  const warm = {
    leads_with_phone: withPhone.length,
    dialed,
    connected,
    connect_rate_pct: pct(connected, withPhone.length),
    median_dial_min: median(dialLat),
    median_warm_min: median(warmLat),
    within_sla_pct: pct(within5, withPhone.length),
    within_warn_pct: pct(within1h, withPhone.length),
    agents: Array.from(agentScore.entries())
      .map(([name, v]) => ({
        name,
        outbound: v.outbound,
        connected: v.connected,
        inbound_answered: v.inbound_answered,
        contacts: v.contacts.size,
        warm_leads: (agentAgg.get(name) || []).length,
        median_warm_min: median(agentAgg.get(name) || []),
      }))
      .sort((a, b) => (b.connected + b.inbound_answered) - (a.connected + a.inbound_answered)),
  };

  // Collapse a person's multiple inquiries into ONE tracker row. A lead can
  // inquire more than once (a new guest card each time) and can have several
  // showings — so we key by phone (last-10, fallback name), keep the earliest
  // inquiry as the origin, and aggregate every guest_card_id / inquiry_id so
  // the furthest stage spans all of their activity.
  type Disq = { reason: string | null; detail: string | null; at: string | null };
  type Acc = { name: string | null; source: string; phone: string | null; earliest: string; firstRespAt: string | null; firstRespType: string | null; gcids: Set<string>; inqids: Set<string>; latestReceived: string; latestStatus: string | null; disq: Disq | null; property: string | null; unit: string | null; latestGcid: string | null };
  const byPerson = new Map<string, Acc>();
  for (const l of rawLeads) {
    const key = phone10(l.phone) || `name:${(l.name || '').toLowerCase().trim()}`;
    let a = byPerson.get(key);
    if (!a) {
      a = { name: l.name ?? null, source: norm(l.source), phone: l.phone ?? null, earliest: l.inquiry_received, firstRespAt: null, firstRespType: null, gcids: new Set(), inqids: new Set(), latestReceived: l.inquiry_received, latestStatus: l.status ?? null, disq: null, property: l.property ?? null, unit: l.unit ?? null, latestGcid: l.guest_card_id ? String(l.guest_card_id) : null };
      byPerson.set(key, a);
    }
    if (l.inquiry_received < a.earliest) { a.earliest = l.inquiry_received; a.source = norm(l.source); }
    // Current status/property/unit = those of this person's most recent guest
    // card, so a re-inquiry (Active) after a disqualification wins back "live".
    if (l.inquiry_received >= a.latestReceived) {
      a.latestReceived = l.inquiry_received;
      a.latestStatus = l.status ?? a.latestStatus;
      if (l.property) a.property = l.property;
      if (l.unit) a.unit = l.unit;
      if (l.guest_card_id) a.latestGcid = String(l.guest_card_id);
    }
    if (l.first_response_at && (!a.firstRespAt || l.first_response_at < a.firstRespAt)) { a.firstRespAt = l.first_response_at; a.firstRespType = l.first_response_type ?? null; }
    const d = parseInactive(l.notes as string | null);
    if (d && (!a.disq || (d.at && (!a.disq.at || d.at > a.disq.at)))) a.disq = d;
    if (!a.name && l.name) a.name = l.name;
    if (!a.phone && l.phone) a.phone = l.phone;
    if (l.guest_card_id) a.gcids.add(String(l.guest_card_id));
    if (l.inquiry_id) a.inqids.add(String(l.inquiry_id));
  }

  const leads = Array.from(byPerson.values()).map(a => {
    const inqMs = new Date(a.earliest).getTime();
    const p10 = phone10(a.phone);
    const calls = p10 ? (outByPhone.get(p10) || []).filter(c => c.at >= inqMs) : [];
    const answered = calls.filter(c => c.answered);
    const firstWarm = answered.length ? Math.min(...answered.map(c => c.at)) : null;
    const dial: 'connected' | 'no_answer' | 'none' =
      answered.length ? 'connected' : calls.length ? 'no_answer' : 'none';

    // Furthest leasing stage. Application is matched by the person's phone.
    const bestApp = (p10 ? appByPhone.get(p10) : undefined) || undefined;
    // AppFolio's guest card says they submitted an application, even when we
    // can't link the specific application row (e.g. it aged out of the report).
    const gcApplied = a.latestStatus === 'Application Completed';
    const shows: { status: string; at: string }[] = [];
    for (const g of a.gcids) shows.push(...(showsByGcid.get(g) || []));

    let stage: string, stage_label: string, stage_date: string | null;
    if (bestApp) {
      stage = 'application';
      stage_label = `Application${bestApp.status ? ` · ${bestApp.status}` : ''}`;
      stage_date = bestApp.received;
    } else if (shows.length) {
      const best = shows.reduce((m, s) =>
        showRank(s.status) > showRank(m.status) || (showRank(s.status) === showRank(m.status) && s.at > m.at) ? s : m);
      const r = showRank(best.status);
      stage = r === 3 ? 'showing_completed' : r === 2 ? 'showing_scheduled' : 'showing_other';
      stage_label = r === 3 ? 'Showing completed' : r === 2 ? 'Showing scheduled' : `Showing · ${best.status}`;
      stage_date = best.at;
    } else if (answered.length) {
      stage = 'contacted'; stage_label = 'Contacted'; stage_date = firstWarm ? new Date(firstWarm).toISOString() : null;
    } else {
      stage = 'inquiry'; stage_label = 'Inquiry'; stage_date = null;
    }

    // Chronological timeline of everything we know about this lead.
    const timeline: { at: string; kind: string; label: string; detail: string | null; missed?: boolean }[] = [];
    timeline.push({ at: a.earliest, kind: 'inquiry', label: 'Inquiry', detail: a.source });
    if (a.firstRespAt) timeline.push({ at: a.firstRespAt, kind: 'auto', label: a.firstRespType || 'Auto-response', detail: 'automated' });
    for (const c of (p10 ? (callsByPhone.get(p10) || []) : [])) {
      if (c.atMs < inqMs) continue;
      const out = (c.direction || '').toLowerCase() === 'outgoing';
      timeline.push({
        at: c.atIso, kind: 'call',
        label: `${out ? 'Outbound' : 'Inbound'} call`,
        detail: `${c.agent || '—'} · ${c.call_type}${c.duration != null ? ` · ${durStr(c.duration)}` : ''}`,
        missed: (c.call_type || '').toLowerCase() !== 'answered',
      });
    }
    for (const g of a.gcids) for (const s of (showsByGcid.get(g) || [])) {
      const r = showRank(s.status);
      timeline.push({ at: s.at, kind: 'showing', label: r === 3 ? 'Showing completed' : r === 2 ? 'Showing scheduled' : `Showing ${s.status}`, detail: null });
    }
    if (bestApp) timeline.push({ at: bestApp.received, kind: 'application', label: 'Application', detail: bestApp.status || null });
    else if (gcApplied) timeline.push({ at: a.latestReceived, kind: 'application', label: 'Application submitted', detail: 'per AppFolio guest card' });
    // Disqualified in AppFolio (guest card Marked Inactive with a reason).
    const disqualified = a.latestStatus === 'Inactive';
    const disq_reason = a.disq?.reason ?? null;
    const disq_detail = a.disq?.detail ?? null;
    if (disqualified && (disq_reason || a.disq?.at)) {
      timeline.push({ at: a.disq?.at || a.earliest, kind: 'disqualified', label: 'Disqualified', detail: [disq_reason, disq_detail].filter(Boolean).join(' — ') || null });
    }
    timeline.sort((x, y) => x.at.localeCompare(y.at));

    // Flag for follow-up if never connected OR the most recent event that has
    // actually happened is a missed call (e.g. the lead called back and we
    // missed it). A future scheduled showing doesn't count as "most recent".
    // Disqualified leads are dead — never flag them for follow-up.
    const nowIso = new Date().toISOString();
    const lastPast = [...timeline].reverse().find((e) => e.at <= nowIso);
    const lastMissedCall = !!(lastPast && lastPast.kind === 'call' && lastPast.missed);
    const awaiting = !disqualified && (dial !== 'connected' || lastMissedCall);
    const flag_reason = !awaiting ? null
      : (dial === 'connected' && lastMissedCall) ? 'missed callback'
      : dial === 'none' ? 'never called' : 'no answer';

    // Pipeline column. A signed lease is terminal-success; then disqualified
    // (AppFolio Marked Inactive, or a denied application); then application
    // progress; then furthest showing stage. For leads with no showing/app and
    // not disqualified: First Touch if we've never called them, else Follow Up.
    // A lead owed a callback stays in its stage column (flagged via `awaiting`).
    const appStatus = bestApp?.status?.toLowerCase() || null;
    const column =
      appStatus === 'converted' ? 'signed_lease'
      : (disqualified || appStatus === 'denied') ? 'disqualified'
      : (appStatus === 'converting' || appStatus === 'approved') ? 'app_approved'
      : (bestApp || gcApplied) ? 'app_sent'
      : stage === 'showing_completed' ? 'showing_completed'
      : stage === 'showing_scheduled' ? 'showing_scheduled'
      : dial === 'none' ? 'first_touch'
      : 'follow_up';

    // When the lead entered its current column, for the "time in stage" timer.
    // Fall back to the inquiry date for pre-stage columns and future showings.
    const stageEntry =
      column === 'signed_lease' ? (bestApp?.received ?? stage_date)
      : column === 'disqualified' ? (a.disq?.at ?? bestApp?.received ?? (disqualified ? a.latestReceived : null))
      : (column === 'app_approved' || column === 'app_sent') ? (bestApp?.received ?? a.latestReceived)
      : (column === 'showing_completed' || column === 'showing_scheduled') ? stage_date
      : null;
    const column_since = (stageEntry && stageEntry <= nowIso) ? stageEntry : a.earliest;

    return {
      name: a.name,
      source: a.source,
      phone: a.phone,
      property: a.property,
      unit: bestApp?.unit ? (bestApp.unit.split(' - ')[1]?.trim() ?? a.unit) : a.unit,
      guest_card_id: a.latestGcid,
      inquiry_received: a.earliest,
      dial,
      warm_min: firstWarm != null ? businessMinutes(inqMs, firstWarm) : null,
      stage, stage_label, stage_date, column_since,
      awaiting, flag_reason, column,
      // Latest known date for this lead (most recent timeline event), used to
      // order each pipeline column newest-first.
      sort_at: timeline.length ? timeline[timeline.length - 1].at : a.earliest,
      disq_reason, disq_detail,
      lease_unit: bestApp?.unit ? bestApp.unit.split(' - ').slice(0, 2).join(' - ') : null,
      lease_start: leaseStartByName.get(leaseKey(a.name)) ?? bestApp?.lease_start ?? bestApp?.desired ?? null,
      lease_start_confirmed: (leaseStartByName.get(leaseKey(a.name)) ?? bestApp?.lease_start) != null,
      timeline,
    };
  });
  // Awaiting a warm call first, then freshest inquiry first.
  leads.sort((a, b) => (Number(b.awaiting) - Number(a.awaiting)) || b.inquiry_received.localeCompare(a.inquiry_received));

  return NextResponse.json({
    days, region, since: sinceIso, sla_min: SLA_MIN, warn_min: WARN_MIN,
    automated, warm, daily, leads,
    leads_awaiting: leads.filter(l => l.awaiting).length,
    leads_total: leads.length,
  });
}
