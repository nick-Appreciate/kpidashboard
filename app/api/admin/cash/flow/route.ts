import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';

// Cash in / out / net per period, aggregated from af_cash_flow_auto
// (which is the same view the Financials dashboard reads — matches AppFolio).
//
// Query params:
//   period=month|quarter   how to bucket results (default month)
//   months=24              months of history to include (default 24)
//
// Response: { periods: [{ period_start, period_label, cash_in, cash_out, net }] }
//
// cash_in  = SUM(amount) WHERE row_type='total_income'  AND property_name='Total'
// cash_out = SUM(amount) WHERE row_type='total_expense' AND property_name='Total'
// net      = cash_in − cash_out  (matches the af_cash_flow NOI)
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

  const { data, error } = await supabase
    .from('af_cash_flow_auto')
    .select('period_start, row_type, amount, property_name')
    .gte('period_start', cutoffStr)
    .eq('property_name', 'Total')
    .in('row_type', ['total_income', 'total_expense']);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Aggregate per period_start (already month-keyed in the view), then roll
  // up into quarters if requested.
  const monthly = new Map<string, { cash_in: number; cash_out: number }>();
  for (const row of data || []) {
    const key = row.period_start as string;
    const entry = monthly.get(key) ?? { cash_in: 0, cash_out: 0 };
    if (row.row_type === 'total_income')  entry.cash_in  += Number(row.amount);
    if (row.row_type === 'total_expense') entry.cash_out += Number(row.amount);
    monthly.set(key, entry);
  }

  const out: { period_start: string; period_label: string; cash_in: number; cash_out: number; net: number }[] = [];

  if (period === 'month') {
    for (const [period_start, v] of monthly) {
      const d = new Date(period_start + 'T12:00:00');
      out.push({
        period_start,
        period_label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        cash_in: v.cash_in,
        cash_out: v.cash_out,
        net: v.cash_in - v.cash_out,
      });
    }
  } else {
    // Quarter: bucket by year-quarter
    const quarterly = new Map<string, { cash_in: number; cash_out: number; period_start: string }>();
    for (const [period_start, v] of monthly) {
      const d = new Date(period_start + 'T12:00:00');
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      const y = d.getUTCFullYear();
      const key = `${y}-Q${q}`;
      const qStartMonth = (q - 1) * 3;
      const qStartDate = `${y}-${String(qStartMonth + 1).padStart(2, '0')}-01`;
      const entry = quarterly.get(key) ?? { cash_in: 0, cash_out: 0, period_start: qStartDate };
      entry.cash_in  += v.cash_in;
      entry.cash_out += v.cash_out;
      // Use the earliest month-start of the quarter as the period_start
      if (qStartDate < entry.period_start) entry.period_start = qStartDate;
      quarterly.set(key, entry);
    }
    for (const [label, v] of quarterly) {
      out.push({
        period_start: v.period_start,
        period_label: label,
        cash_in: v.cash_in,
        cash_out: v.cash_out,
        net: v.cash_in - v.cash_out,
      });
    }
  }

  out.sort((a, b) => a.period_start.localeCompare(b.period_start));

  return NextResponse.json({ period, periods: out });
}
