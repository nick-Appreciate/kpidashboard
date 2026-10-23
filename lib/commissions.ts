import type { SupabaseClient } from '@supabase/supabase-js';

// Leasing & renewal commissions — the "Commission tracker" sheet, computed
// from AppFolio. See supabase/migrations/20261023_commissions.sql.
//
//   gross = AppFolio bills on GL "Commissions/Placement Fees" paid in the
//           month (Lease Fee 12.5% of rent, Renewal Fee 7.5%). AppFolio
//           already prorates partial-term fees, and keying on paid_date means
//           a commission is earned only once the fee is actually collected.
//   net   = gross × accelerator for month-end occupancy (plan tiers)
//   split = maintenance_share / pm_share, then evenly among the payees
//           active in that role on the last day of the month.

export const COMMISSION_GL = 'Commissions/Placement Fees';
const OCCUPIED = ['Current', 'Evict', 'Notice-Unrented', 'Notice-Rented']; // same rule as /api/rent-roll/stats

export interface CommissionItem {
  bill_id: string;
  property_name: string;
  unit: string | null;
  type: 'Lease' | 'Renewal' | 'Other';
  memo: string | null;
  amount: number;
  bill_date: string;
  paid_date: string;
}

export interface CommissionLine {
  name: string;
  role: 'pm' | 'maintenance';
  rippling_worker_id: string | null;
  share: number; // fraction of net
  amount: number;
}

export interface CommissionMonth {
  month: string;            // YYYY-MM
  status: 'open' | 'ready' | 'approved' | 'exported' | 'paid';
  gross: number;
  lease_gross: number;
  renewal_gross: number;
  lease_count: number;
  renewal_count: number;
  occupancy_pct: number | null;
  occupancy_as_of: string | null;
  multiplier: number;
  net: number;
  lines: CommissionLine[];
  items: CommissionItem[];
  approved_by?: string | null;
  approved_at?: string | null;
}

interface Plan { effective_from: string; maintenance_share: number; pm_share: number; tiers: { min_occupancy: number; multiplier: number }[] }
interface Payee { name: string; role: 'pm' | 'maintenance'; rippling_worker_id: string | null; active_from: string; active_to: string | null }

const cents = (n: number) => Math.round(n * 100) / 100;

export function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end };
}

export function multiplierFor(plan: Plan, occupancyPct: number | null): number {
  if (occupancyPct == null) return plan.tiers[0]?.multiplier ?? 0;
  const tiers = [...plan.tiers].sort((a, b) => a.min_occupancy - b.min_occupancy);
  let m = tiers[0]?.multiplier ?? 0;
  for (const t of tiers) if (occupancyPct >= t.min_occupancy) m = t.multiplier;
  return m;
}

/** Split `pool` evenly; any rounding cent goes to the first person so lines sum to the pool exactly. */
function splitEven(pool: number, n: number): number[] {
  if (n === 0) return [];
  const each = Math.floor((pool / n) * 100) / 100;
  const out = Array(n).fill(each);
  out[0] = cents(pool - each * (n - 1));
  return out;
}

export function splitLines(plan: Plan, payees: Payee[], net: number, monthEnd: string): CommissionLine[] {
  const active = (p: Payee) => p.active_from <= monthEnd && (!p.active_to || p.active_to >= monthEnd);
  const lines: CommissionLine[] = [];
  for (const [role, share] of [['pm', plan.pm_share], ['maintenance', plan.maintenance_share]] as const) {
    const people = payees.filter((p) => p.role === role && active(p)).sort((a, b) => a.name.localeCompare(b.name));
    const amounts = splitEven(cents(net * share), people.length);
    people.forEach((p, i) => lines.push({ name: p.name, role, rippling_worker_id: p.rippling_worker_id, share: share / people.length, amount: amounts[i] }));
  }
  return lines;
}

async function monthEndOccupancy(supabase: SupabaseClient, monthEnd: string) {
  const { data: snap } = await supabase
    .from('rent_roll_snapshots').select('snapshot_date')
    .lte('snapshot_date', monthEnd).order('snapshot_date', { ascending: false }).limit(1);
  const asOf = snap?.[0]?.snapshot_date as string | undefined;
  if (!asOf) return { pct: null, asOf: null };
  const rows: { status: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('rent_roll_snapshots').select('status').eq('snapshot_date', asOf).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  if (!rows.length) return { pct: null, asOf };
  const occ = rows.filter((r) => OCCUPIED.includes(r.status || '')).length;
  return { pct: Math.round((occ / rows.length) * 1000) / 10, asOf };
}

export async function loadPlanAndPayees(supabase: SupabaseClient) {
  const [{ data: plans, error: pe }, { data: payees, error: ye }] = await Promise.all([
    supabase.from('commission_plans').select('effective_from, maintenance_share, pm_share, tiers').order('effective_from'),
    supabase.from('commission_payees').select('name, role, rippling_worker_id, active_from, active_to'),
  ]);
  if (pe) throw new Error(pe.message);
  if (ye) throw new Error(ye.message);
  return { plans: (plans || []) as Plan[], payees: (payees || []) as Payee[] };
}

const typeOf = (memo: string | null): CommissionItem['type'] =>
  /renewal/i.test(memo || '') ? 'Renewal' : /lease/i.test(memo || '') ? 'Lease' : 'Other';

/** Compute a month from AppFolio data. `today` decides whether the month is still open. */
export async function computeMonth(
  supabase: SupabaseClient, month: string, ctx: { plans: Plan[]; payees: Payee[] }, today = new Date().toISOString().slice(0, 10),
): Promise<CommissionMonth> {
  const { start, end } = monthBounds(month);
  const plan = [...ctx.plans].reverse().find((p) => p.effective_from <= start);
  if (!plan) throw new Error(`No commission plan in effect for ${month}`);

  const { data: bills, error } = await supabase
    .from('af_bill_detail')
    .select('bill_id, property_name, unit, memo, amount, bill_date, paid_date')
    .eq('gl_account_name', COMMISSION_GL)
    .gte('paid_date', start).lte('paid_date', end)
    .order('paid_date');
  if (error) throw new Error(error.message);

  const items: CommissionItem[] = (bills || []).map((b: any) => ({
    bill_id: String(b.bill_id), property_name: b.property_name, unit: b.unit, memo: b.memo,
    type: typeOf(b.memo), amount: Number(b.amount), bill_date: b.bill_date, paid_date: b.paid_date,
  }));
  const sum = (f: (i: CommissionItem) => boolean) => cents(items.filter(f).reduce((t, i) => t + i.amount, 0));
  const gross = sum(() => true);

  const occ = await monthEndOccupancy(supabase, end);
  const multiplier = multiplierFor(plan, occ.pct);
  const net = cents(gross * multiplier);

  return {
    month,
    status: end < today ? 'ready' : 'open',
    gross,
    lease_gross: sum((i) => i.type === 'Lease'),
    renewal_gross: sum((i) => i.type !== 'Lease'),
    lease_count: items.filter((i) => i.type === 'Lease').length,
    renewal_count: items.filter((i) => i.type !== 'Lease').length,
    occupancy_pct: occ.pct,
    occupancy_as_of: occ.asOf,
    multiplier,
    net,
    lines: splitLines(plan, ctx.payees, net, end),
    items,
  };
}

/** A month as frozen at approval, in the same shape as a computed one. */
export function fromRun(run: any): CommissionMonth {
  const items: CommissionItem[] = run.items || [];
  const sum = (f: (i: CommissionItem) => boolean) => cents(items.filter(f).reduce((t, i) => t + Number(i.amount), 0));
  return {
    month: String(run.month).slice(0, 7),
    status: run.status,
    gross: Number(run.gross),
    lease_gross: sum((i) => i.type === 'Lease'),
    renewal_gross: sum((i) => i.type !== 'Lease'),
    lease_count: items.filter((i) => i.type === 'Lease').length,
    renewal_count: items.filter((i) => i.type !== 'Lease').length,
    occupancy_pct: Number(run.occupancy_pct),
    occupancy_as_of: null,
    multiplier: Number(run.multiplier),
    net: Number(run.net),
    lines: run.lines,
    items,
    approved_by: run.approved_by,
    approved_at: run.approved_at,
  };
}

export function ripplingCsv(m: CommissionMonth): string {
  const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const label = new Date(`${m.month}-15T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const rows = [['Employee Name', 'Rippling Worker ID', 'Earning Type', 'Amount', 'Memo']];
  for (const l of m.lines) {
    if (l.amount <= 0) continue;
    rows.push([l.name, l.rippling_worker_id || '', 'Commission', l.amount.toFixed(2), `${label} leasing/renewal commission`]);
  }
  return rows.map((r) => r.map(q).join(',')).join('\n') + '\n';
}
