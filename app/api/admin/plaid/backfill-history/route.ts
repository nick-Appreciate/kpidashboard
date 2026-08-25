import { NextResponse } from 'next/server';
import { plaidClient } from '../../../../../lib/plaid';
import { requireAdmin } from '../../../../../lib/auth';

/**
 * POST /api/admin/plaid/backfill-history
 * body: { item_id?: string }   // optional — omit to backfill every active item
 *
 * For each Plaid Item, pulls the last 24 months of transactions and walks
 * backwards from the account's current balance to reconstruct end-of-day
 * balance for every date in the window. Rows are upserted into
 * plaid_daily_balances so the /admin/cash Total Cash chart has history for
 * this bank going back as far as Plaid supports.
 *
 * Requires the Item to have Transactions initialized (link-token requests
 * Auth + Transactions). Newly-linked Items may return PRODUCT_NOT_READY for
 * the first ~1-2 minutes while Plaid does its initial transaction pull;
 * we surface that as a 202 so the UI can prompt a retry.
 */

const PLAID_MAX_MONTHS = 24;
const PAGE_SIZE = 500;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return ymd(d);
}

interface ItemRow {
  id: string;
  access_token: string;
  institution_name: string | null;
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const targetItemId = typeof body.item_id === 'string' ? body.item_id : null;

  let query = auth.supabase
    .from('plaid_items')
    .select('id, access_token, institution_name')
    .eq('status', 'active');
  if (targetItemId) query = query.eq('id', targetItemId);
  const { data: items, error: itemsErr } = await query;
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'No active Plaid items to backfill' }, { status: 404 });
  }

  const today = ymd(new Date());
  const startDate = new Date();
  startDate.setUTCMonth(startDate.getUTCMonth() - PLAID_MAX_MONTHS);
  const startDateStr = ymd(startDate);

  const client = plaidClient();
  const summary: Array<{
    item_id: string;
    accounts?: Array<{ account_id: string; account_name: string; days_backfilled: number }>;
    error?: string;
    not_ready?: boolean;
  }> = [];
  let earliestBackfillDate = today;

  for (const it of items as ItemRow[]) {
    try {
      // 1. Current balances (anchor for the walk)
      const balRes = await client.accountsBalanceGet({ access_token: it.access_token });
      const accounts = balRes.data.accounts || [];

      // 2. Pull ALL transactions in the 24-month window (paged)
      const allTx: any[] = [];
      let offset = 0;
      while (true) {
        const txRes = await client.transactionsGet({
          access_token: it.access_token,
          start_date:   startDateStr,
          end_date:     today,
          options:      { count: PAGE_SIZE, offset },
        });
        allTx.push(...(txRes.data.transactions || []));
        offset += (txRes.data.transactions || []).length;
        if (offset >= (txRes.data.total_transactions ?? offset)) break;
      }

      // 3. Per-account: group tx by date, walk backwards from current balance
      const accountSummaries: Array<{ account_id: string; account_name: string; days_backfilled: number }> = [];
      const rowsToUpsert: any[] = [];

      for (const acc of accounts) {
        const accountTxs = allTx.filter((t: any) => t.account_id === acc.account_id);
        const txByDate = new Map<string, number>();
        for (const t of accountTxs) {
          txByDate.set(t.date, (txByDate.get(t.date) || 0) + (t.amount || 0));
        }

        // Earliest date to reconstruct: earliest tx date, or today if no tx
        const earliest = accountTxs.length > 0
          ? accountTxs.map(t => t.date).sort()[0]
          : today;
        if (earliest < earliestBackfillDate) earliestBackfillDate = earliest;

        // Walk backwards. Anchor: end_of_today = current_balance.
        // Reversal: end_of_(d-1) = end_of_d + sum(txs.amount where date == d)
        // (Plaid convention: positive amount = money OUT.)
        let running = Number(acc.balances?.current ?? 0);
        let d = today;
        let daysBackfilled = 0;
        while (d >= earliest) {
          rowsToUpsert.push({
            snapshot_date:     d,
            plaid_account_id:  acc.account_id,
            item_id:           it.id,
            institution_name:  it.institution_name,
            account_name:      acc.official_name || acc.name,
            account_mask:      acc.mask,
            account_type:      acc.type,
            account_subtype:   acc.subtype,
            current_balance:   Number(running.toFixed(2)),
            available_balance: null, // unknown historically
            iso_currency_code: acc.balances?.iso_currency_code || 'USD',
          });
          daysBackfilled++;
          const dayTotal = txByDate.get(d) || 0;
          running = running + dayTotal;
          d = addDays(d, -1);
        }
        accountSummaries.push({
          account_id:      acc.account_id,
          account_name:    acc.official_name || acc.name || acc.account_id,
          days_backfilled: daysBackfilled,
        });
      }

      // 4. Upsert in chunks (Supabase-js handles arbitrary size but chunking
      //    keeps individual requests under the payload limit).
      const CHUNK = 500;
      for (let i = 0; i < rowsToUpsert.length; i += CHUNK) {
        const chunk = rowsToUpsert.slice(i, i + CHUNK);
        const { error: upErr } = await auth.supabase
          .from('plaid_daily_balances')
          .upsert(chunk, { onConflict: 'snapshot_date,plaid_account_id' });
        if (upErr) throw new Error(`upsert chunk ${i}: ${upErr.message}`);
      }

      await auth.supabase.from('plaid_items').update({
        last_synced_at: new Date().toISOString(),
        status:         'active',
        status_message: null,
      }).eq('id', it.id);

      summary.push({ item_id: it.id, accounts: accountSummaries });
    } catch (err: any) {
      const plaidErr = err?.response?.data;
      const code     = plaidErr?.error_code;
      const message  = plaidErr?.error_message || err?.message || 'Unknown error';

      // Newly-linked Items: Plaid needs 30-60s to fetch initial transactions
      if (code === 'PRODUCT_NOT_READY') {
        summary.push({
          item_id:   it.id,
          not_ready: true,
          error:     'Plaid is still preparing transactions for this account. Try again in about a minute.',
        });
        continue;
      }
      // Transactions product not on this Item — user linked before we added it.
      if (code === 'INVALID_PRODUCT' || code === 'PRODUCTS_NOT_SUPPORTED') {
        summary.push({
          item_id: it.id,
          error:   'Transactions product is not on this Item. Unlink and re-link this bank to grant Transactions consent, then retry backfill.',
        });
        continue;
      }
      console.error(`backfill failed for ${it.id}:`, code, message);
      summary.push({ item_id: it.id, error: `${code || 'error'}: ${message}` });
    }
  }

  // 5. Rebuild Total Cash for every date in the backfill window that has
  //    Mercury data (so we don't overwrite Mercury-less dates with Plaid-only).
  let totalCashRowsUpdated = 0;
  try {
    const { data: cnt, error: rangeErr } = await auth.supabase.rpc('recompute_total_cash_range', {
      from_date: earliestBackfillDate,
      to_date:   today,
    });
    if (rangeErr) throw rangeErr;
    totalCashRowsUpdated = Number(cnt || 0);
  } catch (err: any) {
    console.error('recompute_total_cash_range failed:', err?.message);
  }

  const anyNotReady = summary.some(s => s.not_ready);
  return NextResponse.json({
    ok: !anyNotReady,
    earliest_backfill_date: earliestBackfillDate,
    total_cash_rows_updated: totalCashRowsUpdated,
    items: summary,
  }, { status: anyNotReady ? 202 : 200 });
}
