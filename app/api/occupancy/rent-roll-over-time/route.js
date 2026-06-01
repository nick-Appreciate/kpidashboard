/**
 * GET /api/occupancy/rent-roll-over-time
 *
 * Returns scheduled rent & charges DUE over time, sourced from
 * `rent_roll_snapshots` (per-unit, per-day rent roll). For each month in
 * the requested range we return two data points: one for the snapshot
 * taken on/around the 1st of the month and one for the snapshot taken
 * on/around the 15th. (User requested 1st + 15th visibility so the
 * mid-month change in scheduled rent is visible.)
 *
 * NOTE: this is "what tenants owe per their leases", NOT "what was
 * collected". The old version of this endpoint summed af_cash_flow which
 * is cash actually received — replaced because the user wanted billed
 * amounts.
 *
 * Query params:
 *   gls   comma-separated list of GL codes (see GL_COLUMN_MAP below) OR
 *         omitted / "all" → returns a single "All rent & charges" series
 *   from  YYYY-MM-DD lower bound on snapshot_date (optional)
 *   to    YYYY-MM-DD upper bound (optional)
 *
 * Response:
 *   {
 *     points:    ['2025-11-01', '2025-11-15', '2025-12-01', ...],
 *     glOptions: [{ number, name, totalAmount, hasHistory }],
 *     series:    [{ gl, name, points: [{ date, amount }, ...] }],
 *     note?:     'GL breakdown is only available from Oct 2025 to Jan 2026',
 *   }
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';

// Mapping from AppFolio GL number → rent_roll_snapshots column name.
// The snapshot table has one column per known GL (so a sparse but
// breakdown-rich shape). "all" is special — it uses total_rent.
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

// "All" / aggregate column
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

    // Step 1: discover available snapshot dates so we can pick the
    // "around the 1st" and "around the 15th" snapshot in each month.
    // We only need DISTINCT snapshot_date values; a wide SELECT would be
    // expensive (51k rows × 28 cols).
    let distinctQuery = supabase
      .from('rent_roll_snapshots')
      .select('snapshot_date')
      .order('snapshot_date', { ascending: true })
      .range(0, 99999);
    if (from) distinctQuery = distinctQuery.gte('snapshot_date', from);
    if (to)   distinctQuery = distinctQuery.lte('snapshot_date', to);

    const { data: dateRows, error: dErr } = await distinctQuery;
    if (dErr) {
      console.error('snapshot_date query error', dErr);
      return NextResponse.json({ error: dErr.message }, { status: 500 });
    }
    const allDates = Array.from(new Set((dateRows || []).map(r => r.snapshot_date))).sort();
    if (allDates.length === 0) {
      return NextResponse.json({ points: [], glOptions: buildGlOptions(null), series: [] });
    }

    // Step 2: for each (year, month) pick the snapshot closest to day 1
    // and the one closest to day 15. We do this in JS — cheap given
    // we're working with ≤ ~750 unique dates.
    const pickDates = pickFirstAndFifteenth(allDates);

    if (pickDates.length === 0) {
      return NextResponse.json({ points: [], glOptions: buildGlOptions(null), series: [] });
    }

    // Step 3: pull only those snapshot dates and aggregate per-column.
    const { data: snapRows, error: sErr } = await supabase
      .from('rent_roll_snapshots')
      .select(`snapshot_date, total_rent, tenant_rental_income, utility_reimbursement,
               cha_income, iha_income, kckha_income, hakc_income, hud_income,
               pet_rent, storage_fee, parking_fee, insurance_services,
               other_charges, past_due`)
      .in('snapshot_date', pickDates)
      .range(0, 99999);
    if (sErr) {
      console.error('rent_roll_snapshots query error', sErr);
      return NextResponse.json({ error: sErr.message }, { status: 500 });
    }

    // Aggregate per snapshot_date per column
    const cols = [
      'total_rent', 'tenant_rental_income', 'utility_reimbursement',
      'cha_income', 'iha_income', 'kckha_income', 'hakc_income', 'hud_income',
      'pet_rent', 'storage_fee', 'parking_fee', 'insurance_services',
      'other_charges', 'past_due',
    ];
    /** date → { col → sum } */
    const sums = new Map();
    for (const d of pickDates) {
      const empty = Object.fromEntries(cols.map(c => [c, 0]));
      empty._hasAny = Object.fromEntries(cols.map(c => [c, false]));
      sums.set(d, empty);
    }
    for (const r of snapRows || []) {
      const bucket = sums.get(r.snapshot_date);
      if (!bucket) continue;
      for (const c of cols) {
        const v = r[c];
        if (v != null) {
          bucket[c] += Number(v) || 0;
          bucket._hasAny[c] = true;
        }
      }
    }

    // GL options for picker — based on lifetime totals across all rows
    const glOptions = buildGlOptions(sums);

    // Step 4: figure out which series the caller wants
    const requestedGls = glsParam && glsParam !== 'all'
      ? glsParam.split(',').map(s => s.trim()).filter(Boolean)
      : null;

    let series;
    if (!requestedGls) {
      series = [{
        gl: 'all', name: 'All rent & charges due',
        points: pickDates.map(d => ({ date: d, amount: round2(sums.get(d)[ALL_COLUMN]) })),
      }];
    } else {
      series = requestedGls.map(gl => {
        const def = GL_COLUMN_MAP[gl];
        if (!def) return { gl, name: gl, points: [] };
        return {
          gl,
          name: def.name,
          points: pickDates.map(d => {
            const b = sums.get(d);
            // If this column wasn't populated at all on this date, return
            // null so the chart can render a gap instead of a phantom 0.
            const amt = b._hasAny[def.col] ? round2(b[def.col]) : null;
            return { date: d, amount: amt };
          }),
        };
      });
    }

    // Surface a hint if the user selected GLs but breakdown data isn't
    // available for the whole range
    const note = buildNote(requestedGls, series);

    return NextResponse.json({ points: pickDates, glOptions, series, note });
  } catch (e) {
    console.error('rent-roll-over-time error', e);
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/**
 * For each (year, month) present in `allDates`, pick:
 *   - the date with day-of-month closest to 1 (preferring on/after the 1st)
 *   - the date with day-of-month closest to 15 (within the same month)
 * Returns the chronologically-sorted list of chosen dates.
 */
function pickFirstAndFifteenth(allDates) {
  const byMonth = new Map();
  for (const ds of allDates) {
    const [y, m] = ds.split('-');
    const key = `${y}-${m}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(ds);
  }

  const out = new Set();
  for (const [, datesInMonth] of byMonth) {
    out.add(closestTo(datesInMonth, 1));
    const mid = closestTo(datesInMonth, 15);
    if (mid) out.add(mid);
  }
  return Array.from(out).filter(Boolean).sort();
}

function closestTo(datesInMonth, targetDay) {
  let best = null;
  let bestDelta = Infinity;
  for (const ds of datesInMonth) {
    const day = parseInt(ds.split('-')[2], 10);
    const delta = Math.abs(day - targetDay);
    if (delta < bestDelta) { bestDelta = delta; best = ds; }
  }
  return best;
}

function buildGlOptions(sums) {
  // Lifetime totals from all the chosen snapshots — used to sort the
  // picker by significance.
  const totals = {};
  if (sums) {
    for (const bucket of sums.values()) {
      for (const c of Object.keys(bucket)) {
        if (c === '_hasAny') continue;
        totals[c] = (totals[c] || 0) + bucket[c];
      }
    }
  }
  return Object.entries(GL_COLUMN_MAP)
    .map(([number, def]) => ({
      number,
      name: def.name,
      totalAmount: round2(totals[def.col] || 0),
      hasHistory: (totals[def.col] || 0) > 0,
    }))
    .filter(o => o.hasHistory)
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

function buildNote(requestedGls, series) {
  if (!requestedGls) return null;
  let nullCount = 0, totalPoints = 0;
  for (const s of series) {
    for (const p of s.points) {
      totalPoints += 1;
      if (p.amount == null) nullCount += 1;
    }
  }
  if (nullCount > 0) {
    return `Per-GL breakdown is only populated from Oct 2025 onward — earlier ${nullCount} points are blank.`;
  }
  return null;
}
