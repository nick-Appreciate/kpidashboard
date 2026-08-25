import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * One-shot backfill of Plaid daily balances by walking transactions backwards
 * from current balance. Companion to the Next.js API route
 * /api/admin/plaid/backfill-history — same logic, but invocable from the
 * server without an admin session (uses service role).
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   PLAID_CLIENT_ID, PLAID_SECRET
 *   PLAID_ENV — 'sandbox' | 'development' | 'production'
 *
 * POST body (optional): { item_id?: string, months?: number }
 */

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const plaidClient = Deno.env.get('PLAID_CLIENT_ID')!;
const plaidSecret = Deno.env.get('PLAID_SECRET')!;
const plaidEnv    = Deno.env.get('PLAID_ENV') || 'sandbox';

const PLAID_HOSTS: Record<string, string> = {
  sandbox:     'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production:  'https://production.plaid.com',
};
const plaidHost = PLAID_HOSTS[plaidEnv] || PLAID_HOSTS.sandbox;
const supabase  = createClient(supabaseUrl, supabaseKey);

const PAGE_SIZE = 500;

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return ymd(d);
}

async function plaidCall(path: string, body: Record<string, unknown>) {
  const r = await fetch(`${plaidHost}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: plaidClient, secret: plaidSecret, ...body }),
  });
  const j = await r.json();
  if (!r.ok) {
    const err = new Error(j.error_message || j.error_code || `${path} ${r.status}`);
    (err as any).plaid = j;
    throw err;
  }
  return j;
}

Deno.serve(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const targetItemId = typeof body.item_id === 'string' ? body.item_id : null;
  const months       = Math.min(Math.max(Number(body.months) || 24, 1), 24);

  const today = ymd(new Date());
  const start = new Date();
  start.setUTCMonth(start.getUTCMonth() - months);
  const startStr = ymd(start);

  let itemsQ = supabase.from('plaid_items')
    .select('id, access_token, institution_name')
    .eq('status', 'active');
  if (targetItemId) itemsQ = itemsQ.eq('id', targetItemId);
  const { data: items, error: itemsErr } = await itemsQ;
  if (itemsErr)              return json({ error: itemsErr.message }, 500);
  if (!items || !items.length) return json({ error: 'No active Plaid items' }, 404);

  let earliestBackfillDate = today;
  const summary: any[] = [];

  for (const it of items) {
    try {
      const balRes  = await plaidCall('/accounts/balance/get', { access_token: it.access_token });
      const accounts = balRes.accounts || [];

      const allTx: any[] = [];
      let offset = 0;
      while (true) {
        const txRes = await plaidCall('/transactions/get', {
          access_token: it.access_token,
          start_date:   startStr,
          end_date:     today,
          options:      { count: PAGE_SIZE, offset },
        });
        allTx.push(...(txRes.transactions || []));
        offset += (txRes.transactions || []).length;
        if (offset >= (txRes.total_transactions ?? offset)) break;
      }

      const accountSummaries: any[] = [];
      const rows: any[] = [];

      for (const acc of accounts) {
        const accTx = allTx.filter((t: any) => t.account_id === acc.account_id);
        const txByDate = new Map<string, number>();
        for (const t of accTx) {
          txByDate.set(t.date, (txByDate.get(t.date) || 0) + (t.amount || 0));
        }
        const earliest = accTx.length
          ? accTx.map((t: any) => t.date).sort()[0]
          : today;
        if (earliest < earliestBackfillDate) earliestBackfillDate = earliest;

        let running = Number(acc.balances?.current ?? 0);
        let d = today;
        let days = 0;
        while (d >= earliest) {
          rows.push({
            snapshot_date:     d,
            plaid_account_id:  acc.account_id,
            item_id:           it.id,
            institution_name:  it.institution_name,
            account_name:      acc.official_name || acc.name,
            account_mask:      acc.mask,
            account_type:      acc.type,
            account_subtype:   acc.subtype,
            current_balance:   Number(running.toFixed(2)),
            available_balance: null,
            iso_currency_code: acc.balances?.iso_currency_code || 'USD',
          });
          days++;
          running = running + (txByDate.get(d) || 0);
          d = addDays(d, -1);
        }
        accountSummaries.push({
          account_id: acc.account_id,
          account_name: acc.official_name || acc.name || acc.account_id,
          mask: acc.mask,
          days_backfilled: days,
          earliest_tx: earliest,
          tx_count: accTx.length,
        });
      }

      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error: upErr } = await supabase
          .from('plaid_daily_balances')
          .upsert(rows.slice(i, i + CHUNK),
                  { onConflict: 'snapshot_date,plaid_account_id' });
        if (upErr) throw new Error(`upsert @${i}: ${upErr.message}`);
      }

      await supabase.from('plaid_items').update({
        last_synced_at: new Date().toISOString(),
        status: 'active', status_message: null,
      }).eq('id', it.id);

      summary.push({ item_id: it.id, accounts: accountSummaries });
    } catch (err: any) {
      const code = err.plaid?.error_code;
      const msg  = err.plaid?.error_message || err.message;
      console.error(`backfill ${it.id} failed:`, code, msg);
      summary.push({ item_id: it.id, error: `${code || 'error'}: ${msg}` });
    }
  }

  let totalCashRowsUpdated = 0;
  try {
    const { data: n, error } = await supabase.rpc('recompute_total_cash_range', {
      from_date: earliestBackfillDate, to_date: today,
    });
    if (error) throw error;
    totalCashRowsUpdated = Number(n || 0);
  } catch (err: any) {
    console.error('recompute_total_cash_range failed:', err.message);
  }

  return json({
    ok: true,
    earliest_backfill_date: earliestBackfillDate,
    total_cash_rows_updated: totalCashRowsUpdated,
    items: summary,
  }, 200);
});

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x, null, 2), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
