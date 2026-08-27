/**
 * GET /api/occupancy/rent-roll-over-time
 *
 * Returns DAILY scheduled rent & charges due over time. One data point
 * per snapshot date in rent_roll_snapshots (one snapshot per day, ~750
 * rows total over ~2 years).
 *
 * Aggregation is done in Postgres via the `v_rent_roll_daily_sum` view
 * so we don't transfer 51k per-unit rows over the wire just to sum
 * them in JS.
 *
 * NOTE: this is "what tenants owe per their leases", NOT "what was
 * collected".
 *
 * Query params:
 *   gls        comma-separated list of GL codes (see GL_COLUMN_MAP below)
 *              OR omitted / "all" → single "All rent & charges" series
 *   from       YYYY-MM-DD lower bound on snapshot_date (optional)
 *   to         YYYY-MM-DD upper bound (optional)
 *   properties comma-separated list of property_name values. When provided,
 *              queries the by-property view and re-sums only rows matching
 *              those names. Empty / omitted → portfolio total (all props).
 *   region     'region_kansas_city' | 'region_columbia' | 'farquhar' — same
 *              convention as other /api/occupancy endpoints (page-local
 *              dropdown). Server resolves to a property list.
 *   property   single property_name — same convention as other endpoints.
 *
 * Response:
 *   {
 *     points:    ['2024-05-07', '2024-05-08', ...],   // YYYY-MM-DD list
 *     glOptions: [{ number, name, totalAmount, hasHistory }],
 *     series:    [{ gl, name, points: [{ date, amount }, ...] }],
 *     note?:     'Per-GL breakdown only populated from Oct 2025 onward'
 *   }
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';
import { fetchAllRows } from '../../../../lib/supabase-paging';
import { matchesKansasCity } from '../../../../lib/propertyGroups';

// Mapping from AppFolio GL number → rent_roll_snapshots column name
const GL_COLUMN_MAP = {
  '4001':   { col: 'tenant_rental_income',  name: 'Tenant Rental Income' },
  '4001.5': { col: 'utility_reimbursement', name: 'Tenant Reimbursement of Utilities' },
  '4002.1': { col: 'cha_income',            name: 'CHA Affordable Housing Income' },
  '4002.2': { col: 'iha_income',            name: 'IHA Affordable Housing Income' },
  '4002.3': { col: 'kckha_income',          name: 'KCKHA Affordable Housing Income' },
  '4002.4': { col: 'hakc_income',           name: 'HAKC Affordable Housing Income' },
  '4002.5': { col: 'hud_income',            name: 'HUD Affordable Housing Income' },
  '4004':   { col: 'pet_rent',              name: 'Pet Rent' },
  '4005':   { col: 'storage_fee',           name: 'Storage Fee' },
  '4006':   { col: 'parking_fee',           name: 'Parking Fee' },
  '4025':   { col: 'insurance_services',    name: 'Insurance Services' },
  '__other':    { col: 'other_charges',     name: 'Other charges' },
  '__past_due': { col: 'past_due',          name: 'Past due (delinquent)' },
};
const ALL_COLUMN = 'total_rent';

export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { searchParams } = new URL(request.url);
    const glsParam = (searchParams.get('gls') || '').trim();
    const from = searchParams.get('from');
    const to   = searchParams.get('to');
    const propertiesParam = (searchParams.get('properties') || '').trim();
    const regionParam   = (searchParams.get('region') || '').trim();
    const propertyParam = (searchParams.get('property') || '').trim();

    // Region definitions come from lib/propertyGroups.js — the single source
    // of truth for KC substring matchers and the Farquhar cutoff.
    const HILLTOP_GONE_DATE = new Date('2026-04-22T00:00:00');

    // Resolve a `region` or `property` into a concrete property_name list
    // by querying the distinct property_name values in the by-property view.
    let propertyList = propertiesParam
      ? propertiesParam.split(',').map(s => s.trim()).filter(Boolean)
      : null;

    if (!propertyList && (regionParam || propertyParam)) {
      if (propertyParam) {
        propertyList = [propertyParam];
      } else {
        // Region → resolve against the distinct property names in the view.
        const { data: distinctRows, error: distinctErr } = await supabase
          .from('v_rent_roll_daily_sum_by_property')
          .select('property_name')
          .not('property_name', 'is', null)
          .range(0, 9999);
        if (distinctErr) {
          console.error('distinct property_name query error', distinctErr);
          return NextResponse.json({ error: distinctErr.message }, { status: 500 });
        }
        const allProps = Array.from(new Set((distinctRows || []).map(r => r.property_name).filter(Boolean)));
        if (regionParam === 'region_kansas_city') {
          propertyList = allProps.filter(p => matchesKansasCity(p));
        } else if (regionParam === 'region_columbia') {
          propertyList = allProps.filter(p => !matchesKansasCity(p));
        } else if (regionParam === 'farquhar') {
          const hilltopGone = new Date() >= HILLTOP_GONE_DATE;
          propertyList = allProps.filter(p =>
            p !== 'Glen Oaks' && !(hilltopGone && p === 'Hilltop Townhomes')
          );
        }
      }
    }

    // When a property filter is active, query the per-property variant of
    // the view and re-aggregate ourselves over the selected property list.
    // Otherwise the portfolio-total view is a straight per-day sum.
    const NUMERIC_COLS = [
      'total_rent','tenant_rental_income','utility_reimbursement',
      'cha_income','iha_income','kckha_income','hakc_income','hud_income',
      'pet_rent','storage_fee','parking_fee','insurance_services',
      'other_charges','past_due',
    ];

    let rows;
    if (propertyList && propertyList.length > 0) {
      // Page through — Supabase enforces a 1000-row server-side cap
      // regardless of .range(). For ~10 properties × ~260 days = ~2600
      // rows, a single request would silently truncate to the earliest
      // ~100 dates, cutting the chart off before the current month.
      const { data, error } = await fetchAllRows(() => {
        let q = supabase
          .from('v_rent_roll_daily_sum_by_property')
          .select('*')
          .in('property_name', propertyList)
          .order('snapshot_date', { ascending: true });
        if (from) q = q.gte('snapshot_date', from);
        if (to)   q = q.lte('snapshot_date', to);
        return q;
      });
      if (error) {
        console.error('v_rent_roll_daily_sum_by_property query error', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      // Collapse per-property rows into one row per snapshot_date
      const bucket = new Map();
      for (const r of data || []) {
        const dt = r.snapshot_date;
        let agg = bucket.get(dt);
        if (!agg) {
          agg = { snapshot_date: dt, unit_count: 0 };
          for (const c of NUMERIC_COLS) agg[c] = null;
          bucket.set(dt, agg);
        }
        agg.unit_count += Number(r.unit_count || 0);
        for (const c of NUMERIC_COLS) {
          const v = r[c];
          if (v != null) agg[c] = (agg[c] == null ? 0 : agg[c]) + Number(v);
        }
      }
      rows = Array.from(bucket.values()).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    } else {
      // Portfolio total: one row per snapshot_date already, no filter →
      // paging still worth using in case history grows past 1000 days.
      const { data, error } = await fetchAllRows(() => {
        let q = supabase
          .from('v_rent_roll_daily_sum')
          .select('*')
          .order('snapshot_date', { ascending: true });
        if (from) q = q.gte('snapshot_date', from);
        if (to)   q = q.lte('snapshot_date', to);
        return q;
      });
      if (error) {
        console.error('v_rent_roll_daily_sum query error', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      rows = data || [];
    }

    const points = (rows || []).map(r => r.snapshot_date);

    // GL options for picker — derive lifetime totals so we can sort by
    // significance and hide GLs that have no history.
    const lifetimeTotals = {};
    for (const r of rows || []) {
      for (const c of Object.keys(r)) {
        if (c === 'snapshot_date' || c === 'unit_count') continue;
        if (r[c] != null) lifetimeTotals[c] = (lifetimeTotals[c] || 0) + Number(r[c] || 0);
      }
    }
    const glOptions = Object.entries(GL_COLUMN_MAP)
      .map(([number, def]) => ({
        number,
        name: def.name,
        totalAmount: round2(lifetimeTotals[def.col] || 0),
        hasHistory: (lifetimeTotals[def.col] || 0) > 0,
      }))
      .filter(o => o.hasHistory)
      .sort((a, b) => b.totalAmount - a.totalAmount);

    // Which series to build
    const requestedGls = glsParam && glsParam !== 'all'
      ? glsParam.split(',').map(s => s.trim()).filter(Boolean)
      : null;

    let series;
    if (!requestedGls) {
      series = [{
        gl: 'all',
        name: 'All rent & charges due',
        points: (rows || []).map(r => ({
          date: r.snapshot_date,
          amount: r[ALL_COLUMN] == null ? null : Number(r[ALL_COLUMN]),
        })),
      }];
    } else {
      series = requestedGls.map(gl => {
        const def = GL_COLUMN_MAP[gl];
        if (!def) return { gl, name: gl, points: [] };
        return {
          gl,
          name: def.name,
          points: (rows || []).map(r => ({
            date: r.snapshot_date,
            // null = column wasn't populated that day → chart renders a gap
            amount: r[def.col] == null ? null : Number(r[def.col]),
          })),
        };
      });
    }

    const note = buildNote(requestedGls, series);

    return NextResponse.json({ points, glOptions, series, note });
  } catch (e) {
    console.error('rent-roll-over-time error', e);
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function buildNote(requestedGls, series) {
  if (!requestedGls) return null;
  let nullCount = 0;
  for (const s of series) for (const p of s.points) if (p.amount == null) nullCount += 1;
  if (nullCount > 0) {
    return `Per-GL breakdown is only populated from Oct 2025 onward — earlier ${nullCount} points are blank.`;
  }
  return null;
}
