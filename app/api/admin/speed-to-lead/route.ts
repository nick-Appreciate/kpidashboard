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

  const [leadRes, callRes] = await Promise.all([
    supabase.from('leasing_reports')
      .select('name, source, property, phone, inquiry_received, first_response_at, first_response_type')
      .gte('inquiry_received', sinceIso)
      .range(0, 9999),
    supabase.from('justcall_calls')
      .select('contact_number_norm, direction, call_type, call_at, agent_name')
      .gte('call_at', sinceIso)
      .range(0, 49999),
  ]);
  if (leadRes.error) return NextResponse.json({ error: leadRes.error.message }, { status: 500 });

  const rawLeads = (leadRes.data || []).filter(r => r.inquiry_received && inRegion(r.property));

  // Index outbound calls by matched phone (last-10).
  const outByPhone = new Map<string, { at: number; answered: boolean; agent: string | null }[]>();
  for (const c of (callRes.data || [])) {
    if (!c.contact_number_norm || (c.direction || '').toLowerCase() !== 'outgoing') continue;
    if (!outByPhone.has(c.contact_number_norm)) outByPhone.set(c.contact_number_norm, []);
    outByPhone.get(c.contact_number_norm)!.push({
      at: new Date(c.call_at).getTime(),
      answered: (c.call_type || '').toLowerCase() === 'answered',
      agent: c.agent_name ?? null,
    });
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
  const nowMs = Date.now();
  let dialed = 0, connected = 0, within5 = 0, within1h = 0;
  // Leads still without an answered call — the worklist (phone included for the dialer).
  const uncontacted: { name: string | null; source: string; phone: string | null; inquiry_received: string; dialed: boolean; hours_waiting: number }[] = [];
  // Per-day accountability series: of that day's leads, how many hit the SLA.
  const dailyMap = new Map<string, { leads: number; w5: number; w60: number }>();

  for (const l of withPhone) {
    const inqMs = new Date(l.inquiry_received).getTime();
    const day = l.inquiry_received.slice(0, 10);
    const d = dailyMap.get(day) || { leads: 0, w5: 0, w60: 0 };
    d.leads++;

    const calls = (outByPhone.get(phone10(l.phone)!) || []).filter(c => c.at >= inqMs);
    if (calls.length > 0) {
      dialed++;
      dialLat.push(Math.round((Math.min(...calls.map(c => c.at)) - inqMs) / 60000));
    }
    const answered = calls.filter(c => c.answered);
    if (answered.length > 0) {
      connected++;
      const firstWarm = answered.reduce((m, c) => (c.at < m.at ? c : m));
      const min = Math.round((firstWarm.at - inqMs) / 60000);
      warmLat.push(min);
      if (min <= SLA_MIN) { within5++; d.w5++; }
      if (min <= WARN_MIN) { within1h++; d.w60++; }
      if (firstWarm.agent) {
        if (!agentAgg.has(firstWarm.agent)) agentAgg.set(firstWarm.agent, []);
        agentAgg.get(firstWarm.agent)!.push(min);
      }
    } else {
      uncontacted.push({
        name: l.name ?? null,
        source: norm(l.source),
        phone: l.phone ?? null,
        inquiry_received: l.inquiry_received,
        dialed: calls.length > 0,          // dialed but no answer, vs never dialed
        hours_waiting: Math.round((nowMs - inqMs) / 3_600_000),
      });
    }
    dailyMap.set(day, d);
  }
  // Freshest first — the leads most worth calling now.
  uncontacted.sort((a, b) => b.inquiry_received.localeCompare(a.inquiry_received));

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
    agents: Array.from(agentAgg.entries())
      .map(([name, lats]) => ({ name, connects: lats.length, median_warm_min: median(lats) }))
      .sort((a, b) => b.connects - a.connects),
  };

  // Recent leads with BOTH tracks for the table.
  const recent = [...rawLeads]
    .sort((a, b) => b.inquiry_received.localeCompare(a.inquiry_received))
    .slice(0, 50)
    .map(l => {
      const inqMs = new Date(l.inquiry_received).getTime();
      const calls = phone10(l.phone) ? (outByPhone.get(phone10(l.phone)!) || []).filter(c => c.at >= inqMs) : [];
      const answered = calls.filter(c => c.answered);
      const firstWarm = answered.length ? Math.min(...answered.map(c => c.at)) : null;
      const autoMin = l.first_response_at ? Math.round((new Date(l.first_response_at).getTime() - inqMs) / 60000) : null;
      return {
        name: l.name ?? null,
        source: norm(l.source),
        inquiry_received: l.inquiry_received,
        auto_min: (trackingMs != null && inqMs >= trackingMs) ? autoMin : null,
        auto_type: l.first_response_type ?? null,
        dialed: calls.length > 0,
        warm_min: firstWarm != null ? Math.round((firstWarm - inqMs) / 60000) : null,
      };
    });

  return NextResponse.json({
    days, region, since: sinceIso, sla_min: SLA_MIN, warn_min: WARN_MIN,
    automated, warm, recent, daily,
    uncontacted: uncontacted.slice(0, 30),
    uncontacted_total: uncontacted.length,
  });
}
