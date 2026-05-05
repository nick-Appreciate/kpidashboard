import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';

// Banking net cash flow per period, derived from actual bank balance deltas.
//
// Why balance deltas, not transactions:
//   mercury_transactions only covers ~1 month of history → gross in/out
//     would be zero for almost every period and the chart would lie.
//   simmons_deposits has 18 months but only inflows (no withdrawals).
//   mercury_daily_balances has 4 years of daily balances per account.
//
// Net flow per period = total bank balance at period end
//                      − total bank balance at prior period end
// where total = Mercury Total Cash + Simmons most-recent balance_after
//
// We also surface per-source detail in the tooltip when transaction data
// is available for the period (Mercury inflows/outflows, Simmons inflows).
//
// Returns: { periods: [{ period_start, period_label,
//                        opening, closing, net,
//                        mercury_in?, mercury_out?, simmons_in? }] }
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') === 'quarter' ? 'quarter' : 'month';
  const months = parseInt(searchParams.get('months') || '24', 10);

  // Need one extra period before the cutoff to compute the first period's net.
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  cutoff.setDate(1);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  // 1. Mercury daily total cash — pick last snapshot per day. Total Cash row.
  const { data: mercuryBalances, error: mErr } = await supabase
    .from('mercury_daily_balances')
    .select('snapshot_date, account_name, current_balance')
    .gte('snapshot_date', cutoffStr)
    .eq('account_name', 'Total Cash')
    .order('snapshot_date', { ascending: true });
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  // 2. Simmons deposits — balance_after gives running balance per account.
  const { data: simmonsDeposits, error: sErr } = await supabase
    .from('simmons_deposits')
    .select('deposit_date, account_suffix, amount, balance_after')
    .gte('deposit_date', cutoffStr)
    .order('deposit_date', { ascending: true });
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  // 3. Mercury transactions (for tooltip detail, when available)
  const { data: mercuryTxns, error: tErr } = await supabase
    .from('mercury_transactions')
    .select('amount, posted_at')
    .eq('status', 'sent')
    .gte('posted_at', cutoffStr);
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  // Helper: bucket a date into period_start (YYYY-MM-01 or quarter-start)
  function bucketKey(d: Date): string {
    const y = d.getUTCFullYear();
    if (period === 'quarter') {
      const q = Math.floor(d.getUTCMonth() / 3);
      return `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
    }
    return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }

  function periodLabel(periodStart: string): string {
    const d = new Date(periodStart + 'T12:00:00');
    if (period === 'quarter') {
      return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    }
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }

  // Mercury: for each period, find the LATEST snapshot date that falls in
  // it and read its Total Cash balance. That's our period-end Mercury cash.
  const mercuryByPeriod = new Map<string, number>();
  for (const row of mercuryBalances || []) {
    const date = row.snapshot_date as string;
    const key = bucketKey(new Date(date + 'T12:00:00'));
    // Always overwrite — rows arrive sorted ascending, so the last one wins.
    mercuryByPeriod.set(key, Number(row.current_balance));
  }

  // Simmons: track each account's running balance_after; for each period,
  // sum all accounts' last balance_after.
  const simmonsAccountsByPeriod = new Map<string, Map<string, number>>(); // period → account → balance_after
  const accountRunning = new Map<string, number>();
  for (const d of simmonsDeposits || []) {
    const acct = (d.account_suffix as string) ?? 'unknown';
    const date = d.deposit_date as string;
    const key = bucketKey(new Date(date + 'T12:00:00'));
    accountRunning.set(acct, Number(d.balance_after));
    if (!simmonsAccountsByPeriod.has(key)) simmonsAccountsByPeriod.set(key, new Map());
    // Snapshot of all accounts' running balances at this period
    const periodSnapshot = simmonsAccountsByPeriod.get(key)!;
    for (const [a, b] of accountRunning) periodSnapshot.set(a, b);
  }
  // For period totals, we also need to carry forward the running balance to
  // periods with no Simmons activity (account hasn't deposited that month
  // but its balance hasn't changed). Build a sorted list of all periods we
  // know about and forward-fill.
  const allKnownPeriods = new Set<string>([
    ...mercuryByPeriod.keys(),
    ...simmonsAccountsByPeriod.keys(),
  ]);
  const sortedPeriods = Array.from(allKnownPeriods).sort();
  const simmonsByPeriod = new Map<string, number>();
  let lastSimmonsAccts = new Map<string, number>();
  for (const p of sortedPeriods) {
    const thisPeriodSnap = simmonsAccountsByPeriod.get(p);
    if (thisPeriodSnap) {
      lastSimmonsAccts = new Map(thisPeriodSnap);
    }
    let sum = 0;
    for (const v of lastSimmonsAccts.values()) sum += v;
    simmonsByPeriod.set(p, sum);
  }

  // Mercury transactions detail — only useful for periods with data
  type TxnDetail = { mercury_in: number; mercury_out: number };
  const txnDetailByPeriod = new Map<string, TxnDetail>();
  for (const t of mercuryTxns || []) {
    const key = bucketKey(new Date(t.posted_at as string));
    const amt = Number(t.amount);
    const e = txnDetailByPeriod.get(key) ?? { mercury_in: 0, mercury_out: 0 };
    if (amt > 0) e.mercury_in += amt;
    else e.mercury_out += -amt;
    txnDetailByPeriod.set(key, e);
  }

  // Simmons inflows for tooltip detail
  const simmonsInByPeriod = new Map<string, number>();
  for (const d of simmonsDeposits || []) {
    const key = bucketKey(new Date((d.deposit_date as string) + 'T12:00:00'));
    const amt = Number(d.amount);
    if (amt > 0) simmonsInByPeriod.set(key, (simmonsInByPeriod.get(key) ?? 0) + amt);
  }

  // Compose: opening = prior period's closing, closing = mercury + simmons
  // We drop the first period in our sorted list (it provides the opening
  // balance for period 2 only).
  type Out = {
    period_start: string;
    period_label: string;
    opening: number;
    closing: number;
    net: number;
    mercury_in: number | null;
    mercury_out: number | null;
    simmons_in: number | null;
  };
  const result: Out[] = [];
  let prevClosing: number | null = null;
  for (const p of sortedPeriods) {
    const closing = (mercuryByPeriod.get(p) ?? 0) + (simmonsByPeriod.get(p) ?? 0);
    if (prevClosing !== null) {
      const net = closing - prevClosing;
      const detail = txnDetailByPeriod.get(p);
      result.push({
        period_start: p,
        period_label: periodLabel(p),
        opening: Math.round(prevClosing),
        closing: Math.round(closing),
        net: Math.round(net),
        mercury_in:  detail ? Math.round(detail.mercury_in)  : null,
        mercury_out: detail ? Math.round(detail.mercury_out) : null,
        simmons_in:  simmonsInByPeriod.has(p) ? Math.round(simmonsInByPeriod.get(p)!) : null,
      });
    }
    prevClosing = closing;
  }

  // Identify the in-progress current period so the chart can render it
  // with a different style — but include it in the output. Its "closing"
  // is the latest balance we have (which is today's, not month-end).
  const today = new Date();
  let currentPeriodStartStr: string;
  if (period === 'quarter') {
    const q = Math.floor(today.getMonth() / 3);
    currentPeriodStartStr = new Date(today.getFullYear(), q * 3, 1).toISOString().split('T')[0];
  } else {
    currentPeriodStartStr = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  }
  const tagged = result.map(r => ({ ...r, is_partial: r.period_start === currentPeriodStartStr }));

  // Trim to last `months` periods of output (we kept extras only to provide
  // opening balances for the chain).
  const trimmed = tagged.slice(-months);

  return NextResponse.json({
    period,
    periods: trimmed,
    note: 'Net = total bank balance at period end − at prior period end. The current period is partial (closing = today\'s balance) and is flagged is_partial so the chart can highlight it.',
  });
}
