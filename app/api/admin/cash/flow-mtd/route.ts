import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';

// MTD comparison: each month's cash flow taken on today's day-of-month.
// E.g. if today is May 5, May shows Jan 1-5 numbers, April shows Apr 1-5,
// March shows Mar 1-5 — apples-to-apples MTD across months.
//
// Reads from af_cash_flow_day_of_month (the existing snapshot-mode view that
// picks each month's snapshot taken on today's day-of-month). Same
// in/expense/capex logic as the main flow chart; owner equity excluded.
//
//   net = (Operating Income − Operating Expense) + CapEx
//
// Query params: months=12
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const { searchParams } = new URL(request.url);
  const months = parseInt(searchParams.get('months') || '12', 10);

  const today = new Date();
  const dayOfMonth = today.getDate();
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - months + 1);
  cutoff.setDate(1);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('af_cash_flow_day_of_month')
    .select('period_start, row_type, account_name, amount')
    .gte('period_start', cutoffStr)
    .eq('property_name', 'Total')
    .in('row_type', ['income', 'expense', 'other']);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Bucket = {
    operating_income: number;
    operating_expense: number;
    capex: number;
  };
  const monthly = new Map<string, Bucket>();
  function ensure(key: string): Bucket {
    if (!monthly.has(key)) monthly.set(key, { operating_income: 0, operating_expense: 0, capex: 0 });
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
      if (/CapEx/i.test(name)) e.capex += amt;
      // owner equity intentionally ignored
    }
  }

  const out = Array.from(monthly.entries())
    .map(([period_start, b]) => {
      const d = new Date(period_start + 'T12:00:00');
      const noi = b.operating_income - b.operating_expense;
      return {
        period_start,
        period_label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        operating_income: b.operating_income,
        operating_expense: b.operating_expense,
        capex: b.capex,
        noi,
        net: noi + b.capex,
      };
    })
    .sort((a, b) => a.period_start.localeCompare(b.period_start));

  return NextResponse.json({
    day_of_month: dayOfMonth,
    periods: out,
    note: `Each bar shows that month\'s cash flow as of day ${dayOfMonth} (today\'s day-of-month). Apples-to-apples MTD comparison.`,
  });
}
