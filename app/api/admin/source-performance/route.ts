/**
 * /api/admin/source-performance
 *
 * GET ?days=180&region=region_kansas_city
 *
 * Per-source funnel for the last N days:
 *   inquiries  → showings_scheduled  → showings_completed
 *              → applications        → denied / converted
 *
 * Surfaces the Phase 2b finding (KC denial rate is 49%, driven by
 * Zillow Rental Network at 83% and Rent. at 75%) continuously, so
 * the team can decide whether to keep spending manager time on
 * leads from those sources.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';

const KC_NEEDLES = ['hilltop', 'oakwood', 'glen oaks', 'normandy', 'maple manor'];

function inKcRegion(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return KC_NEEDLES.some(n => lower.includes(n));
}

interface SourceRow {
  source: string;
  inquiries: number;
  showings_scheduled: number;
  showings_completed: number;
  applications: number;
  denied: number;
  converted: number;
  // derived
  show_up_pct: number | null;          // completed / scheduled
  apply_pct: number | null;            // applications / inquiries
  denial_pct: number | null;           // denied / applications
  close_pct: number | null;            // converted / applications
  inquiry_to_lease_pct: number | null; // converted / inquiries
  recommendation: 'trim' | 'invest' | 'hold' | 'unknown';
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const { searchParams } = new URL(req.url);
  const days = Math.max(7, Math.min(365, parseInt(searchParams.get('days') || '180', 10)));
  const region = searchParams.get('region') || 'all'; // 'all' | 'region_kansas_city' | 'region_columbia'

  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();

  const [inqRes, shRes, apRes] = await Promise.all([
    supabase.from('leasing_reports')
      .select('source, property, inquiry_received')
      .gte('inquiry_received', sinceIso)
      .range(0, 9999),
    supabase.from('showings')
      .select('source, property, status, showing_time')
      .gte('showing_time', sinceIso)
      .range(0, 9999),
    supabase.from('rental_applications')
      .select('lead_source, unit, status, received')
      .gte('received', sinceIso)
      .range(0, 9999),
  ]);
  const inquiries = inqRes.data || [];
  const showings = shRes.data || [];
  const apps = apRes.data || [];

  // Region scope — applied per-row by property (leasing/showings have
  // property; rental_applications stores property as the first part
  // of a "Property - Unit - Address" string in `unit`).
  const inRegion = (propLike: string | null | undefined): boolean => {
    if (region === 'all') return true;
    if (region === 'region_kansas_city') return inKcRegion(propLike);
    if (region === 'region_columbia')    return !inKcRegion(propLike);
    return true;
  };
  const appPropertyOf = (unitField: string | null): string => {
    if (!unitField) return '';
    const dash = unitField.indexOf(' - ');
    return dash >= 0 ? unitField.slice(0, dash) : unitField;
  };

  const norm = (s: string | null | undefined): string => {
    if (!s) return '(no source)';
    const t = s.trim();
    if (!t) return '(no source)';
    // Coalesce "apartments.com" / "Apartments.com" + similar duplicates
    const lower = t.toLowerCase();
    if (lower === 'apartments.com') return 'Apartments.com';
    if (lower === 'zillow' || lower === 'zillow rental network') return 'Zillow Rental Network';
    if (lower === 'rent.' || lower === 'rent') return 'Rent.';
    return t;
  };

  const bucket = new Map<string, SourceRow>();
  const ensure = (src: string): SourceRow => {
    const k = norm(src);
    let row = bucket.get(k);
    if (!row) {
      row = {
        source: k,
        inquiries: 0, showings_scheduled: 0, showings_completed: 0,
        applications: 0, denied: 0, converted: 0,
        show_up_pct: null, apply_pct: null, denial_pct: null,
        close_pct: null, inquiry_to_lease_pct: null,
        recommendation: 'unknown',
      };
      bucket.set(k, row);
    }
    return row;
  };

  for (const r of inquiries) {
    if (!inRegion(r.property)) continue;
    ensure(r.source).inquiries++;
  }
  for (const r of showings) {
    if (!inRegion(r.property)) continue;
    const row = ensure(r.source);
    row.showings_scheduled++;
    if (r.status === 'Completed') row.showings_completed++;
  }
  for (const r of apps) {
    if (!inRegion(appPropertyOf(r.unit))) continue;
    const row = ensure(r.lead_source);
    row.applications++;
    if (r.status === 'Denied') row.denied++;
    if (r.status === 'Converted' || r.status === 'Approved') row.converted++;
  }

  // Derive rates + recommendation
  for (const row of bucket.values()) {
    const pct = (num: number, den: number) =>
      den > 0 ? Math.round((100 * num / den) * 10) / 10 : null;
    row.show_up_pct           = pct(row.showings_completed, row.showings_scheduled);
    row.apply_pct             = pct(row.applications, row.inquiries);
    row.denial_pct            = pct(row.denied, row.applications);
    row.close_pct             = pct(row.converted, row.applications);
    row.inquiry_to_lease_pct  = pct(row.converted, row.inquiries);

    // Recommendation rules:
    //   - "trim": >= 5 applications AND >= 60% denial rate
    //   - "invest": >= 5 applications AND < 30% denial AND >= 20% close
    //   - "hold": enough volume to evaluate, in between
    //   - "unknown": too little volume to call
    if (row.applications >= 5) {
      if ((row.denial_pct ?? 0) >= 60) row.recommendation = 'trim';
      else if ((row.denial_pct ?? 100) < 30 && (row.close_pct ?? 0) >= 20) row.recommendation = 'invest';
      else row.recommendation = 'hold';
    } else if (row.inquiries >= 10) {
      row.recommendation = 'hold';
    } else {
      row.recommendation = 'unknown';
    }
  }

  // Drop empty + sort by inquiries desc
  const rows = Array.from(bucket.values())
    .filter(r => r.inquiries + r.showings_scheduled + r.applications > 0)
    .sort((a, b) => b.inquiries - a.inquiries || b.applications - a.applications);

  const totals = rows.reduce((acc, r) => {
    acc.inquiries += r.inquiries;
    acc.showings_scheduled += r.showings_scheduled;
    acc.showings_completed += r.showings_completed;
    acc.applications += r.applications;
    acc.denied += r.denied;
    acc.converted += r.converted;
    return acc;
  }, { inquiries: 0, showings_scheduled: 0, showings_completed: 0, applications: 0, denied: 0, converted: 0 });

  return NextResponse.json({
    days,
    region,
    since: sinceIso,
    rows,
    totals,
  });
}
