/**
 * GET /api/financials/owner-net-income
 *
 * Computes "true net to owner" with PERIOD-AWARE proration.
 *
 *   net_to_owner = (distributions − contributions) − insurance − taxes − debt
 *
 * The unit of work is a (property_period × calendar_month) overlap.
 * Each row in the response describes how much of one specific period
 * contributed to one specific month, prorated by days of overlap. This
 * matters when a property changes hands mid-month — e.g. Hilltop went
 * from KCK Holdings → Summit Ridge Townhomes on 2026-04-22, so April
 * 2026 emits TWO rows for Hilltop: one for KCK (22 days, prorated) and
 * one for Summit Ridge (8 days, prorated). Months outside the transition
 * still emit a single row at full weight.
 *
 * Each row also carries the period's group_ids so the client can apply
 * the global filter at PERIOD granularity. Filtering by a group that
 * contains KCK's Hilltop period (but not Summit Ridge's) correctly
 * picks up Hilltop through April 22 and drops it after.
 *
 * Where distributions/contributions live monthly per-property in
 * af_cash_flow, we attribute them proportionally to period overlap.
 * It's a rough approximation — AppFolio doesn't expose daily-level
 * distribution timing — but it matches user intent for clean splits
 * at period boundaries.
 *
 * Response shape:
 *   {
 *     months: ['2025-11-01', ...],
 *     properties: ['Pioneer Apartments', ...],
 *     rows: [
 *       { property, period_id, group_ids, month,
 *         days_overlap, days_in_month,
 *         distributions, contributions, insurance, taxes, debt_service,
 *         net_to_owner }
 *     ],
 *     totals: [{ month, distributions, contributions,
 *                insurance, taxes, debt_service, net_to_owner }],
 *     unmodeled: ['Glen Oaks', ...]
 *   }
 *
 * Query params:
 *   months   number of months back (default 12)
 *   from/to  YYYY-MM-DD overrides (optional)
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';

interface PeriodRow {
  id: string;
  property_name: string;
  period_start: string | null;
  period_end: string | null;
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

    // Load every property period (with id so we can carry it on each row
    // for client-side group filtering).
    const { data: periodRows, error: pdiErr } = await supabase
      .from('property_period')
      .select('id, property_name, period_start, period_end, monthly_insurance, monthly_taxes, monthly_debt_service');
    if (pdiErr) return NextResponse.json({ error: pdiErr.message }, { status: 500 });

    const periodsByProperty = new Map<string, PeriodRow[]>();
    for (const r of (periodRows || []) as PeriodRow[]) {
      const arr = periodsByProperty.get(r.property_name) || [];
      arr.push(r);
      periodsByProperty.set(r.property_name, arr);
    }
    for (const arr of periodsByProperty.values()) {
      arr.sort((a, b) => (a.period_start || '').localeCompare(b.period_start || ''));
    }

    // Period → list of group_ids it belongs to. Drives the client filter.
    const { data: membershipRows, error: mErr } = await supabase
      .from('property_period_group_memberships')
      .select('period_id, group_id');
    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
    const groupIdsByPeriod = new Map<string, string[]>();
    for (const m of membershipRows || []) {
      const arr = groupIdsByPeriod.get(m.period_id) || [];
      arr.push(m.group_id);
      groupIdsByPeriod.set(m.period_id, arr);
    }

    // Owner distributions + contributions from af_cash_flow_latest
    let cfQuery = supabase
      .from('af_cash_flow_latest')
      .select('property_name, period_start, account_number, amount')
      .in('account_number', ['3050', '3060'])
      .neq('property_name', 'Total')
      .gte('period_start', cutoff)
      .range(0, 9999);
    if (to) cfQuery = cfQuery.lte('period_start', to);
    const { data: cfRows, error: cfErr } = await cfQuery;
    if (cfErr) return NextResponse.json({ error: cfErr.message }, { status: 500 });

    const key = (p: string, m: string) => `${p}|${m}`;
    const distMap = new Map<string, number>();
    const contribMap = new Map<string, number>();
    const monthsSet = new Set<string>();
    const propsSet = new Set<string>();

    for (const r of (cfRows || []) as CfRow[]) {
      if (!r.property_name || !r.period_start) continue;
      monthsSet.add(r.period_start);
      propsSet.add(r.property_name);
      const k = key(r.property_name, r.period_start);
      const amt = Number(r.amount || 0);
      if (r.account_number === '3060') {
        distMap.set(k, (distMap.get(k) || 0) + -amt);
      } else if (r.account_number === '3050') {
        contribMap.set(k, (contribMap.get(k) || 0) + amt);
      }
    }
    for (const name of periodsByProperty.keys()) propsSet.add(name);

    const months_sorted = Array.from(monthsSet).sort();
    const properties_sorted = Array.from(propsSet).sort();

    // ── Build per (period × month) rows with proration ──────────────────
    const rows: any[] = [];
    const monthTotals = new Map<string, {
      distributions: number; contributions: number;
      insurance: number; taxes: number; debt_service: number;
    }>();
    for (const m of months_sorted) {
      monthTotals.set(m, { distributions: 0, contributions: 0, insurance: 0, taxes: 0, debt_service: 0 });
    }

    for (const property of properties_sorted) {
      const periods = periodsByProperty.get(property) || [];
      for (const month of months_sorted) {
        const [y, mm] = month.split('-').map(Number);
        const monthStartTs = Date.UTC(y, mm - 1, 1);
        const monthEndTs   = Date.UTC(y, mm, 0);
        const daysInMonth  = (monthEndTs - monthStartTs) / 86_400_000 + 1;

        // Compute overlap (in days) for each period that touches this month
        const overlaps: { period: PeriodRow | null; days: number }[] = [];
        let coveredDays = 0;
        for (const p of periods) {
          const pStart = p.period_start ? Date.UTC(...dateParts(p.period_start)) : -Infinity;
          const pEnd   = p.period_end   ? Date.UTC(...dateParts(p.period_end))   : Infinity;
          const lo = Math.max(pStart, monthStartTs);
          const hi = Math.min(pEnd,   monthEndTs);
          if (hi < lo) continue;
          const days = Math.round((hi - lo) / 86_400_000) + 1;
          if (days > 0) {
            overlaps.push({ period: p, days });
            coveredDays += days;
          }
        }
        // If no period overlaps but af_cash_flow has data for this property,
        // we still emit a row with no overlay attribution.
        if (overlaps.length === 0) {
          const distAll = round2(distMap.get(key(property, month)) || 0);
          const contribAll = round2(contribMap.get(key(property, month)) || 0);
          if (distAll || contribAll) {
            const net = round2(distAll - contribAll);
            rows.push({
              property, period_id: null, group_ids: [], month,
              days_overlap: 0, days_in_month: daysInMonth,
              distributions: distAll, contributions: contribAll,
              insurance: 0, taxes: 0, debt_service: 0, net_to_owner: net,
            });
            const t = monthTotals.get(month)!;
            t.distributions += distAll;
            t.contributions += contribAll;
          }
          continue;
        }

        // Attribute distributions/contributions to each overlap proportional
        // to days. (AppFolio doesn't expose daily-level distribution dates,
        // so this is the cleanest split available.)
        const distAll    = distMap.get(key(property, month)) || 0;
        const contribAll = contribMap.get(key(property, month)) || 0;

        for (const { period, days } of overlaps) {
          if (!period) continue;
          const share        = coveredDays > 0 ? days / coveredDays : 0;
          const distributions = round2(distAll * share);
          const contributions = round2(contribAll * share);
          // Insurance / taxes / debt scale by the period's share of the
          // FULL month — a half-month period still costs (cost × half).
          const monthShare   = days / daysInMonth;
          const insurance    = round2((period.monthly_insurance    || 0) * monthShare);
          const taxes        = round2((period.monthly_taxes        || 0) * monthShare);
          const debt_service = round2((period.monthly_debt_service || 0) * monthShare);
          const net_to_owner = round2(distributions - contributions - insurance - taxes - debt_service);

          if (distributions || contributions || insurance || taxes || debt_service) {
            rows.push({
              property,
              period_id: period.id,
              group_ids: groupIdsByPeriod.get(period.id) || [],
              month,
              days_overlap: days,
              days_in_month: daysInMonth,
              distributions, contributions,
              insurance, taxes, debt_service,
              net_to_owner,
            });
            const t = monthTotals.get(month)!;
            t.distributions += distributions;
            t.contributions += contributions;
            t.insurance     += insurance;
            t.taxes         += taxes;
            t.debt_service  += debt_service;
          }
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

    const unmodeled = Array.from(propsSet)
      .filter(p => !periodsByProperty.has(p))
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

function dateParts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m - 1, d];
}
