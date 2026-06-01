/**
 * GET /api/occupancy/rent-roll-over-time
 *
 * Returns monthly income totals from `af_cash_flow`, grouped by GL account
 * number. Drives the "Rent Roll Over Time" line chart on /occupancy.
 *
 * Query params:
 *   gls         comma-separated GL numbers (e.g. "4001,4002.1") OR "all" /
 *               omitted → return a single "All Income" series
 *   from        YYYY-MM-DD lower bound on period_start (optional)
 *   to          YYYY-MM-DD upper bound on period_start (optional)
 *
 * Response:
 *   {
 *     months:   ['2025-11-01', '2025-12-01', ...],  // chronological YYYY-MM-DD
 *     glOptions: [{ number, name, totalAmount }],   // every income GL that
 *                                                      has data — for the
 *                                                      multiselect picker
 *     series:   [
 *       { gl: '4001' | 'all', name: 'Tenant Rental Income' | 'All Income',
 *         points: [{ month: '2025-11-01', amount: 5421000 }, ...] }
 *     ]
 *   }
 *
 * Notes:
 *   af_cash_flow contains both per-property rows and a property_name='Total'
 *   sub-total row per (account, month). We sum only the per-property rows
 *   to avoid double-counting.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';

const INCOME_TYPES = ['Income', 'Other Income'];

export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { searchParams } = new URL(request.url);
    const glsParam = (searchParams.get('gls') || '').trim();
    const from = searchParams.get('from');
    const to   = searchParams.get('to');

    const includeOtherIncome = searchParams.get('include_other_income') === '1';
    const allowedTypes = includeOtherIncome ? INCOME_TYPES : ['Income'];

    // Load every income GL that has at least one row in af_cash_flow. We
    // need this for the multiselect picker *and* to validate user input.
    const { data: allRows, error } = await supabase
      .from('af_cash_flow')
      .select('account_number, account_name, account_type, period_start, property_name, amount')
      .in('account_type', allowedTypes)
      .neq('property_name', 'Total');

    if (error) {
      console.error('af_cash_flow read error', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Aggregate locally — fewer round trips than multiple Supabase queries,
    // and the row count for income is in the ~30k range (cheap).
    const inWindow = (allRows || []).filter(r => {
      if (!r.period_start) return false;
      if (from && r.period_start < from) return false;
      if (to   && r.period_start > to)   return false;
      return true;
    });

    // Catalog of GLs (independent of date filter so the picker stays stable)
    const glCatalog = new Map();
    for (const r of allRows || []) {
      const k = r.account_number || `__${r.account_name}`;
      const prev = glCatalog.get(k) || { number: r.account_number, name: r.account_name, totalAmount: 0 };
      prev.totalAmount += Number(r.amount || 0);
      glCatalog.set(k, prev);
    }
    const glOptions = Array.from(glCatalog.values())
      .filter(g => g.number) // skip rows with null account_number (unusable for filter)
      .sort((a, b) => (b.totalAmount || 0) - (a.totalAmount || 0));

    // Determine which series to build
    const requestedGls = glsParam && glsParam !== 'all'
      ? glsParam.split(',').map(s => s.trim()).filter(Boolean)
      : null;

    // monthsSet collects every period_start we see in the filtered window so
    // the front end gets a consistent X axis (no missing buckets).
    const monthsSet = new Set();
    for (const r of inWindow) monthsSet.add(r.period_start);
    const months = Array.from(monthsSet).sort();

    const series = [];
    if (!requestedGls) {
      // Single "All Income" line — sum every per-property row in the window
      const byMonth = new Map();
      for (const r of inWindow) {
        byMonth.set(r.period_start, (byMonth.get(r.period_start) || 0) + Number(r.amount || 0));
      }
      series.push({
        gl: 'all',
        name: includeOtherIncome ? 'All Income (incl. Other)' : 'All Income',
        points: months.map(m => ({ month: m, amount: round2(byMonth.get(m) || 0) })),
      });
    } else {
      // One line per requested GL
      for (const gl of requestedGls) {
        const glRows = inWindow.filter(r => r.account_number === gl);
        const byMonth = new Map();
        let nameSample = null;
        for (const r of glRows) {
          byMonth.set(r.period_start, (byMonth.get(r.period_start) || 0) + Number(r.amount || 0));
          nameSample = nameSample || r.account_name;
        }
        const meta = glOptions.find(o => o.number === gl);
        series.push({
          gl,
          name: meta?.name || nameSample || gl,
          points: months.map(m => ({ month: m, amount: round2(byMonth.get(m) || 0) })),
        });
      }
    }

    return NextResponse.json({ months, glOptions, series });
  } catch (e) {
    console.error('rent-roll-over-time error', e);
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
