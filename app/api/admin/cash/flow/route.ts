import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';

// Portfolio cash flow per period, from af_cash_flow_auto.
//
// Tracks operating cash flow plus capital expenditures only — owner
// contributions and distributions are EXCLUDED. Those are equity flows
// (cash moving between the business and its owners), not operations,
// and the user's mental model for this chart is "did the properties
// generate cash this period." Including them swung the bars by tens
// of thousands per month based on payout timing, which obscured trends.
//
//   noi   = Operating Income − Operating Expense
//   capex = CapEx Labor + CapEx Materials (negative)
//   net   = NOI + capex
//
// Note: this means our `net` will NOT match AppFolio's "Cash Flow" line
// for periods where owner equity flows were nonzero. That's intentional.
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

  // Drop the in-progress current period (month or quarter). The latest
  // snapshot for it is partial — only what's posted so far this period —
  // and showing it alongside closed periods makes the partial number
  // look like it represents a full month/quarter.
  const today = new Date();
  let currentPeriodStart: Date;
  if (period === 'quarter') {
    const q = Math.floor(today.getMonth() / 3);
    currentPeriodStart = new Date(today.getFullYear(), q * 3, 1);
  } else {
    currentPeriodStart = new Date(today.getFullYear(), today.getMonth(), 1);
  }
  const currentPeriodStartStr = currentPeriodStart.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('af_cash_flow_auto')
    .select('period_start, row_type, account_name, amount')
    .gte('period_start', cutoffStr)
    .lt('period_start', currentPeriodStartStr)
    .eq('property_name', 'Total')
    .in('row_type', ['income', 'expense', 'other', 'cash_flow']);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Bucket = {
    operating_income: number;
    operating_expense: number;
    capex: number;          // negative
    owner_contributions: number;
    owner_distributions: number;
    other_other: number;    // any other 'other' row that isn't capex or owner equity
    net: number;            // from the cash_flow row directly
  };
  const monthly = new Map<string, Bucket>();
  function ensure(key: string): Bucket {
    if (!monthly.has(key)) monthly.set(key, {
      operating_income: 0, operating_expense: 0,
      capex: 0, owner_contributions: 0, owner_distributions: 0, other_other: 0,
      net: 0,
    });
    return monthly.get(key)!;
  }

  for (const row of data || []) {
    const key = row.period_start as string;
    const e = ensure(key);
    const amt = Number(row.amount);
    const name = (row.account_name as string) || '';
    if (row.row_type === 'income') {
      e.operating_income += amt;
    } else if (row.row_type === 'expense') {
      e.operating_expense += amt;
    } else if (row.row_type === 'other') {
      if (/CapEx/i.test(name)) {
        e.capex += amt; // already negative
      } else if (/Owner Contribution/i.test(name)) {
        e.owner_contributions += amt;
      } else if (/Owner Distribution/i.test(name)) {
        e.owner_distributions += amt; // typically negative
      } else {
        e.other_other += amt;
      }
    } else if (row.row_type === 'cash_flow') {
      e.net += amt;
    }
  }

  type Out = {
    period_start: string;
    period_label: string;
    net: number;
    noi: number;
    operating_income: number;
    operating_expense: number;
    capex: number;
    owner_contributions: number;
    owner_distributions: number;
    other_other: number;
  };

  function buildOut(period_start: string, b: Bucket, label: string): Out {
    const noi = b.operating_income - b.operating_expense;
    return {
      period_start,
      period_label: label,
      net: noi + b.capex,  // operating cash flow after capex, excluding owner equity
      noi,
      operating_income: b.operating_income,
      operating_expense: b.operating_expense,
      capex: b.capex,
      owner_contributions: b.owner_contributions,
      owner_distributions: b.owner_distributions,
      other_other: b.other_other,
    };
  }

  const out: Out[] = [];

  if (period === 'month') {
    for (const [period_start, v] of monthly) {
      const d = new Date(period_start + 'T12:00:00');
      out.push(buildOut(
        period_start,
        v,
        d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      ));
    }
  } else {
    type QBucket = Bucket & { period_start: string };
    const quarterly = new Map<string, QBucket>();
    for (const [period_start, v] of monthly) {
      const d = new Date(period_start + 'T12:00:00');
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      const y = d.getUTCFullYear();
      const key = `${y}-Q${q}`;
      const qStartMonth = (q - 1) * 3;
      const qStartDate = `${y}-${String(qStartMonth + 1).padStart(2, '0')}-01`;
      const cur = quarterly.get(key) ?? { ...v, period_start: qStartDate };
      if (quarterly.has(key)) {
        cur.operating_income     += v.operating_income;
        cur.operating_expense    += v.operating_expense;
        cur.capex                += v.capex;
        cur.owner_contributions  += v.owner_contributions;
        cur.owner_distributions  += v.owner_distributions;
        cur.other_other          += v.other_other;
        cur.net                  += v.net;
        if (qStartDate < cur.period_start) cur.period_start = qStartDate;
      }
      quarterly.set(key, cur);
    }
    for (const [label, v] of quarterly) {
      out.push(buildOut(v.period_start, v, label));
    }
  }

  out.sort((a, b) => a.period_start.localeCompare(b.period_start));
  return NextResponse.json({ period, periods: out });
}
