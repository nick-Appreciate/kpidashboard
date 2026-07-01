/**
 * /api/admin/speed-to-lead
 *
 * GET ?days=14&region=all
 *
 * Time-to-first-response for leasing inquiries, derived from
 * leasing_reports.first_response_at (observation-time capture — see
 * migration 20260701_leasing_first_response_observed.sql).
 *
 * Honesty caveats baked into the response:
 *  - `tracking_since`: response capture only began when the 5-min guest_cards
 *    poll went live. Inquiries received BEFORE that can't be scored (a null
 *    first_response there means "not tracked", not "not answered"), so all
 *    rates below are computed only over inquiries received on/after it.
 *  - Latency is bounded by the ~5-min poll cadence, so it slightly OVER-states
 *    (never under-states) true speed — the safe direction for an SLA.
 *  - Only responses that create an AppFolio guest-card activity are seen; a VA
 *    call never logged in AppFolio leaves no trace.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';

const KC_NEEDLES = ['hilltop', 'oakwood', 'glen oaks', 'normandy', 'maple manor'];
function inKcRegion(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return KC_NEEDLES.some(n => lower.includes(n));
}

const SLA_MIN = 5;      // the target: contacted within 5 minutes
const WARN_MIN = 60;    // secondary threshold: within the hour

interface LeadRow {
  name: string | null;
  source: string;
  property: string | null;
  inquiry_received: string;
  first_response_at: string | null;
  first_response_type: string | null;
  latency_min: number | null;
}

interface SourceStat {
  source: string;
  tracked: number;
  responded: number;
  response_rate_pct: number | null;
  median_latency_min: number | null;
  within_sla_pct: number | null;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
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

  const { data, error } = await supabase
    .from('leasing_reports')
    .select('name, source, property, inquiry_received, first_response_at, first_response_type')
    .gte('inquiry_received', sinceIso)
    .range(0, 9999);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const raw = (data || []).filter(r => r.inquiry_received && inRegion(r.property));

  // When did response tracking start? Earliest first_response_at we have.
  // Rates are only meaningful for inquiries that arrived on/after this.
  let trackingSince: string | null = null;
  for (const r of raw) {
    if (r.first_response_at && (!trackingSince || r.first_response_at < trackingSince)) {
      trackingSince = r.first_response_at;
    }
  }
  const trackingSinceMs = trackingSince ? new Date(trackingSince).getTime() : null;

  const leads: LeadRow[] = raw.map(r => {
    const inqMs = new Date(r.inquiry_received).getTime();
    const latency_min = r.first_response_at
      ? Math.max(0, Math.round((new Date(r.first_response_at).getTime() - inqMs) / 60000))
      : null;
    return {
      name: r.name ?? null,
      source: norm(r.source),
      property: r.property ?? null,
      inquiry_received: r.inquiry_received,
      first_response_at: r.first_response_at ?? null,
      first_response_type: r.first_response_type ?? null,
      latency_min,
    };
  });

  // Trackable = arrived after tracking began, so a null response genuinely
  // means "not yet answered" rather than "predates instrumentation".
  const trackable = trackingSinceMs != null
    ? leads.filter(l => new Date(l.inquiry_received).getTime() >= trackingSinceMs)
    : [];

  const buildStats = (rows: LeadRow[]) => {
    const responded = rows.filter(l => l.latency_min != null);
    const lat = responded.map(l => l.latency_min!) as number[];
    const withinSla = responded.filter(l => (l.latency_min as number) <= SLA_MIN).length;
    return {
      tracked: rows.length,
      responded: responded.length,
      response_rate_pct: rows.length ? Math.round((100 * responded.length) / rows.length) : null,
      median_latency_min: median(lat),
      within_sla_pct: rows.length ? Math.round((100 * withinSla) / rows.length) : null,
    };
  };

  const totalsBase = buildStats(trackable);
  const withinWarn = trackable.filter(l => l.latency_min != null && l.latency_min <= WARN_MIN).length;
  const totals = {
    ...totalsBase,
    within_warn_pct: trackable.length ? Math.round((100 * withinWarn) / trackable.length) : null,
    unanswered: totalsBase.tracked - totalsBase.responded,
  };

  // Per-source breakdown (over trackable rows).
  const bySource = new Map<string, LeadRow[]>();
  for (const l of trackable) {
    if (!bySource.has(l.source)) bySource.set(l.source, []);
    bySource.get(l.source)!.push(l);
  }
  const sources: SourceStat[] = Array.from(bySource.entries())
    .map(([source, rows]) => {
      const s = buildStats(rows);
      return {
        source,
        tracked: s.tracked,
        responded: s.responded,
        response_rate_pct: s.response_rate_pct,
        median_latency_min: s.median_latency_min,
        within_sla_pct: s.within_sla_pct,
      };
    })
    .sort((a, b) => b.tracked - a.tracked);

  // Recent leads (newest first) across the whole window — even pre-tracking
  // ones, flagged so the UI can grey them out.
  const recent = [...leads]
    .sort((a, b) => b.inquiry_received.localeCompare(a.inquiry_received))
    .slice(0, 50)
    .map(l => ({
      ...l,
      tracked: trackingSinceMs != null && new Date(l.inquiry_received).getTime() >= trackingSinceMs,
    }));

  return NextResponse.json({
    days,
    region,
    since: sinceIso,
    tracking_since: trackingSince,
    sla_min: SLA_MIN,
    warn_min: WARN_MIN,
    totals,
    sources,
    recent,
  });
}
