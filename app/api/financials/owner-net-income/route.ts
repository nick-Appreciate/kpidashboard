/**
 * GET /api/financials/owner-net-income
 *
 * Computes "true net to owner" per property per month:
 *
 *   net_to_owner = (distributions_out − contributions_in) − insurance − debt_service
 *
 * Where:
 *   net_to_owner =
 *     (distributions_out − contributions_in)
 *       − insurance − taxes − debt_service
 *
 *   distributions_out — AppFolio Owner Distribution (account 3060). In
 *     af_cash_flow this is stored as a negative number (capital leaving
 *     the property). We negate to get a positive "owner pulled this much
 *     out".
 *   contributions_in — Owner Contribution (account 3050), positive in
 *     af_cash_flow. Subtracted because if the owner had to put money in,
 *     that reduces net to owner.
 *   insurance, taxes, debt_service — per-property monthly costs from
 *     property_debt_insurance, editable on /admin/owners. These are paid
 *     OUTSIDE AppFolio so they don't appear in distributions — we have
 *     to subtract them explicitly.
 *
 * Response:
 *   {
 *     months: ['2025-11-01', ...],
 *     properties: ['Pioneer Apartments', ...],
 *     rows: [
 *       { property, month, distributions, contributions, insurance,
 *         debt_service, net_to_owner }
 *     ],
 *     totals: [{ month, distributions, contributions, insurance,
 *                debt_service, net_to_owner }],
 *     unmodeled: ['Glen Oaks', 'Hilltop Townhomes']  // in AppFolio but
 *                                                      no debt/ins data
 *   }
 *
 * Query params:
 *   months   number of months back (default 12)
 *   from/to  YYYY-MM-DD overrides (optional)
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';

interface PdiRow {
  property_name: string;
  monthly_insurance: number | null;
  monthly_taxes: number | null;
  monthly_debt_service: number | null;
}

interface CfRow {
  property_name: string;
  period_start: string;
  account_number: string;
  amount: number | null;
}

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { searchParams } = new URL(request.url);
    const months = Math.max(1, Math.min(60, parseInt(searchParams.get('months') || '12', 10)));
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    let cutoff = from;
    if (!cutoff) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
      cutoff = start.toISOString().slice(0, 10);
    }

    // Load the per-property debt/insurance lookup
    const { data: pdiRows, error: pdiErr } = await supabase
      .from('property_debt_insurance')
      .select('property_name, monthly_insurance, monthly_taxes, monthly_debt_service');
    if (pdiErr) {
      return NextResponse.json({ error: pdiErr.message }, { status: 500 });
    }
    const pdiByProperty = new Map<string, PdiRow>(
      (pdiRows || []).map((r: any) => [r.property_name, r as PdiRow])
    );

    // Load Owner Distribution + Owner Contribution rows from the latest
    // snapshot view (uses the just-fixed DISTINCT ON dedup).
    let cfQuery = supabase
      .from('af_cash_flow_latest')
      .select('property_name, period_start, account_number, amount')
      .in('account_number', ['3050', '3060'])
      .neq('property_name', 'Total')
      .gte('period_start', cutoff)
      .range(0, 9999);
    if (to) cfQuery = cfQuery.lte('period_start', to);
    const { data: cfRows, error: cfErr } = await cfQuery;
    if (cfErr) {
      return NextResponse.json({ error: cfErr.message }, { status: 500 });
    }

    // Aggregate per (property, month, account)
    const key = (p: string, m: string) => `${p}|${m}`;
    const distMap = new Map<string, number>(); // distributions_out (positive)
    const contribMap = new Map<string, number>(); // contributions_in (positive)
    const monthsSet = new Set<string>();
    const propsSet = new Set<string>();

    for (const r of (cfRows || []) as CfRow[]) {
      if (!r.property_name || !r.period_start) continue;
      monthsSet.add(r.period_start);
      propsSet.add(r.property_name);
      const k = key(r.property_name, r.period_start);
      const amt = Number(r.amount || 0);
      if (r.account_number === '3060') {
        // Owner Distribution is stored negative; flip to positive "out"
        distMap.set(k, (distMap.get(k) || 0) + (-amt));
      } else if (r.account_number === '3050') {
        contribMap.set(k, (contribMap.get(k) || 0) + amt);
      }
    }

    // Make sure every property with a debt/insurance row shows up too,
    // even if it had no distributions in this window — keeps the chart
    // honest about ongoing costs.
    for (const pdi of pdiByProperty.values()) {
      propsSet.add(pdi.property_name);
    }

    const months_sorted = Array.from(monthsSet).sort();
    const properties_sorted = Array.from(propsSet).sort();

    // Build per-property-per-month rows
    const rows: any[] = [];
    const monthTotals = new Map<string, {
      distributions: number; contributions: number;
      insurance: number; taxes: number; debt_service: number;
    }>();
    for (const m of months_sorted) {
      monthTotals.set(m, { distributions: 0, contributions: 0, insurance: 0, taxes: 0, debt_service: 0 });
    }

    for (const p of properties_sorted) {
      const pdi = pdiByProperty.get(p);
      for (const m of months_sorted) {
        const k = key(p, m);
        const distributions = round2(distMap.get(k) || 0);
        const contributions = round2(contribMap.get(k) || 0);
        const insurance = round2(pdi?.monthly_insurance || 0);
        const taxes = round2(pdi?.monthly_taxes || 0);
        const debt_service = round2(pdi?.monthly_debt_service || 0);
        const net_to_owner = round2(distributions - contributions - insurance - taxes - debt_service);
        if (distributions || contributions || insurance || taxes || debt_service) {
          rows.push({ property: p, month: m, distributions, contributions, insurance, taxes, debt_service, net_to_owner });
          const t = monthTotals.get(m)!;
          t.distributions += distributions;
          t.contributions += contributions;
          t.insurance += insurance;
          t.taxes += taxes;
          t.debt_service += debt_service;
        }
      }
    }

    const totals = months_sorted.map(m => {
      const t = monthTotals.get(m)!;
      return {
        month: m,
        distributions: round2(t.distributions),
        contributions: round2(t.contributions),
        insurance: round2(t.insurance),
        taxes: round2(t.taxes),
        debt_service: round2(t.debt_service),
        net_to_owner: round2(t.distributions - t.contributions - t.insurance - t.taxes - t.debt_service),
      };
    });

    // Surface properties in AppFolio that have distributions but NO
    // debt/insurance row → user knows the model is missing data for them.
    const unmodeled = Array.from(propsSet)
      .filter(p => !pdiByProperty.has(p))
      .sort();

    return NextResponse.json({
      months: months_sorted,
      properties: properties_sorted,
      rows,
      totals,
      unmodeled,
    });
  } catch (e: any) {
    console.error('owner-net-income error', e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
