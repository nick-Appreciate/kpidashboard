import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';

// Portfolio cash in / out / net per period, from af_cash_flow_auto.
// Includes ALL GLs that move cash:
//   income      → operating income (rent + reimbursements + fees)
//   expense     → operating expense
//   other       → equity / capex flows (Owner Contributions/Distributions,
//                 CapEx Labor, CapEx Materials)
//
// cash_in  = SUM(income) + SUM(other > 0)         e.g. owner contributions
// cash_out = SUM(expense) + SUM(|other < 0|)      e.g. owner distributions, capex
// net      = cash_flow row directly (matches AppFolio's "Cash Flow" line —
//            NOI + Net Other Items, after capex and equity).
//
// Validation: net should equal cash_in − cash_out within a few cents.
//
// Query params: period=month|quarter, months=24
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') === 'quarter' ? 'quarter' : 'month';
  const months = parseInt(searchParams.get('months') || '24', 10);

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months + 1);
  cutoff.setDate(1);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  // Pull every detail + summary row for Total. We need detail rows (income,
  // expense, other) to decompose in/out, and the cash_flow summary row
  // for net.
  const { data, error } = await supabase
    .from('af_cash_flow_auto')
    .select('period_start, row_type, amount')
    .gte('period_start', cutoffStr)
    .eq('property_name', 'Total')
    .in('row_type', ['income', 'expense', 'other', 'cash_flow']);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Bucket = { cash_in: number; cash_out: number; net: number };
  const monthly = new Map<string, Bucket>();
  for (const row of data || []) {
    const key = row.period_start as string;
    const entry = monthly.get(key) ?? { cash_in: 0, cash_out: 0, net: 0 };
    const amt = Number(row.amount);
    if (row.row_type === 'income') entry.cash_in += amt;
    else if (row.row_type === 'expense') entry.cash_out += amt;
    else if (row.row_type === 'other') {
      if (amt > 0) entry.cash_in += amt;
      else if (amt < 0) entry.cash_out += -amt;
    } else if (row.row_type === 'cash_flow') {
      entry.net += amt;
    }
    monthly.set(key, entry);
  }

  type Out = { period_start: string; period_label: string; cash_in: number; cash_out: number; net: number };
  const out: Out[] = [];

  if (period === 'month') {
    for (const [period_start, v] of monthly) {
      const d = new Date(period_start + 'T12:00:00');
      out.push({
        period_start,
        period_label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        cash_in: v.cash_in,
        cash_out: v.cash_out,
        net: v.net,
      });
    }
  } else {
    const quarterly = new Map<string, Bucket & { period_start: string }>();
    for (const [period_start, v] of monthly) {
      const d = new Date(period_start + 'T12:00:00');
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      const y = d.getUTCFullYear();
      const key = `${y}-Q${q}`;
      const qStartMonth = (q - 1) * 3;
      const qStartDate = `${y}-${String(qStartMonth + 1).padStart(2, '0')}-01`;
      const entry = quarterly.get(key) ?? { cash_in: 0, cash_out: 0, net: 0, period_start: qStartDate };
      entry.cash_in  += v.cash_in;
      entry.cash_out += v.cash_out;
      entry.net      += v.net;
      if (qStartDate < entry.period_start) entry.period_start = qStartDate;
      quarterly.set(key, entry);
    }
    for (const [label, v] of quarterly) {
      out.push({
        period_start: v.period_start,
        period_label: label,
        cash_in: v.cash_in,
        cash_out: v.cash_out,
        net: v.net,
      });
    }
  }

  out.sort((a, b) => a.period_start.localeCompare(b.period_start));

  return NextResponse.json({ period, periods: out });
}
