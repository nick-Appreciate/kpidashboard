import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';

// Bank-level cash in/out per period, combining Mercury transactions and
// Simmons deposits.
//
// Coverage caveats (the chart should expose these):
//   mercury_transactions covers ~1 month — gross in AND out are accurate
//     within that window; outside it, mercury_in/out are 0.
//   simmons_deposits covers ~18 months — only inflows (we don't scrape
//     Simmons withdrawals); simmons_out is always 0.
//
// Returned shape per period:
//   { period_start, period_label,
//     mercury_in, mercury_out, simmons_in,
//     cash_in, cash_out, net }
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

  // Mercury: pull all sent transactions in window
  const { data: mercury, error: mErr } = await supabase
    .from('mercury_transactions')
    .select('amount, posted_at')
    .eq('status', 'sent')
    .gte('posted_at', cutoffStr);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  // Simmons: deposits in window
  const { data: simmons, error: sErr } = await supabase
    .from('simmons_deposits')
    .select('amount, deposit_date')
    .gte('deposit_date', cutoffStr);
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  // Bucket helper: map a date string to its period_start (YYYY-MM-01 or quarter-start)
  function bucketKey(d: Date): string {
    if (period === 'quarter') {
      const q = Math.floor(d.getUTCMonth() / 3);
      const month = q * 3;
      return `${d.getUTCFullYear()}-${String(month + 1).padStart(2, '0')}-01`;
    }
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }

  function periodLabel(periodStart: string): string {
    const d = new Date(periodStart + 'T12:00:00');
    if (period === 'quarter') {
      return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    }
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }

  type Bucket = { mercury_in: number; mercury_out: number; simmons_in: number };
  const buckets = new Map<string, Bucket>();
  function ensure(key: string): Bucket {
    if (!buckets.has(key)) buckets.set(key, { mercury_in: 0, mercury_out: 0, simmons_in: 0 });
    return buckets.get(key)!;
  }

  for (const t of mercury || []) {
    const key = bucketKey(new Date(t.posted_at as string));
    const amt = Number(t.amount);
    const b = ensure(key);
    if (amt > 0) b.mercury_in += amt;
    else b.mercury_out += -amt;
  }
  for (const d of simmons || []) {
    const key = bucketKey(new Date((d.deposit_date as string) + 'T12:00:00'));
    const amt = Number(d.amount);
    if (amt > 0) ensure(key).simmons_in += amt;
  }

  const periods = Array.from(buckets.entries())
    .map(([period_start, v]) => ({
      period_start,
      period_label: periodLabel(period_start),
      mercury_in:  Math.round(v.mercury_in),
      mercury_out: Math.round(v.mercury_out),
      simmons_in:  Math.round(v.simmons_in),
      cash_in:  Math.round(v.mercury_in + v.simmons_in),
      cash_out: Math.round(v.mercury_out),
      net:      Math.round(v.mercury_in + v.simmons_in - v.mercury_out),
    }))
    .sort((a, b) => a.period_start.localeCompare(b.period_start));

  return NextResponse.json({
    period,
    periods,
    coverage: {
      mercury_first: mercury?.[0]?.posted_at?.toString().slice(0, 10) ?? null,
      mercury_last:  mercury?.[mercury.length - 1]?.posted_at?.toString().slice(0, 10) ?? null,
      simmons_first: simmons?.[0]?.deposit_date ?? null,
      simmons_last:  simmons?.[simmons.length - 1]?.deposit_date ?? null,
      note: 'mercury_transactions covers ~1 month; simmons_deposits covers ~18 months and only includes inflows.',
    },
  });
}
