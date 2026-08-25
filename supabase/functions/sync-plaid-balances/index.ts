import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Pull today's balances for every active plaid_items link and upsert into
 * plaid_daily_balances. Called by pg_cron hourly + on demand by API routes.
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — for DB access
 *   PLAID_CLIENT_ID, PLAID_SECRET            — Plaid credentials (stored in vault)
 *   PLAID_ENV                                 — 'sandbox' | 'development' | 'production'
 */

const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
const supabaseKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const plaidClient  = Deno.env.get('PLAID_CLIENT_ID')!;
const plaidSecret  = Deno.env.get('PLAID_SECRET')!;
const plaidEnv     = Deno.env.get('PLAID_ENV') || 'sandbox';

const PLAID_HOSTS: Record<string, string> = {
  sandbox:     'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production:  'https://production.plaid.com',
};
const plaidHost = PLAID_HOSTS[plaidEnv] || PLAID_HOSTS.sandbox;

const supabase = createClient(supabaseUrl, supabaseKey);

async function plaidCall(path: string, body: Record<string, unknown>) {
  const r = await fetch(`${plaidHost}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: plaidClient,
      secret:    plaidSecret,
      ...body,
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    throw new Error(`${path} ${r.status}: ${j.error_message || j.error_code || 'unknown'}`);
  }
  return j;
}

Deno.serve(async (_req: Request) => {
  const today = new Date().toISOString().slice(0, 10);

  const { data: items, error: itemsErr } = await supabase
    .from('plaid_items')
    .select('id, access_token, institution_name')
    .eq('status', 'active');
  if (itemsErr) {
    return new Response(JSON.stringify({ success: false, error: itemsErr.message }),
                        { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  if (!items || items.length === 0) {
    return new Response(JSON.stringify({ success: true, message: 'No active Plaid items' }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const summary: Array<{ item_id: string; accounts_synced: number; error?: string }> = [];

  for (const it of items) {
    try {
      const balRes = await plaidCall('/accounts/balance/get', { access_token: it.access_token });
      const rows = (balRes.accounts || []).map((a: any) => ({
        snapshot_date:     today,
        plaid_account_id:  a.account_id,
        item_id:           it.id,
        institution_name:  it.institution_name,
        account_name:      a.official_name || a.name,
        account_mask:      a.mask,
        account_type:      a.type,
        account_subtype:   a.subtype,
        current_balance:   a.balances?.current ?? null,
        available_balance: a.balances?.available ?? null,
        iso_currency_code: a.balances?.iso_currency_code || 'USD',
      }));

      if (rows.length > 0) {
        const { error: upErr } = await supabase
          .from('plaid_daily_balances')
          .upsert(rows, { onConflict: 'snapshot_date,plaid_account_id' });
        if (upErr) throw new Error(upErr.message);
      }

      await supabase.from('plaid_items').update({
        last_synced_at: new Date().toISOString(),
        status:         'active',
        status_message: null,
      }).eq('id', it.id);

      summary.push({ item_id: it.id, accounts_synced: rows.length });
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error(`sync-plaid-balances failed for ${it.id}:`, msg);
      // Mark item errored so /admin/plaid-link can surface it, but keep going.
      await supabase.from('plaid_items').update({
        status:         'error',
        status_message: msg.slice(0, 500),
        updated_at:     new Date().toISOString(),
      }).eq('id', it.id);
      summary.push({ item_id: it.id, accounts_synced: 0, error: msg });
    }
  }

  // Refresh the canonical Total Cash row so /admin/cash reflects Plaid immediately
  const { data: totalRow, error: totalErr } = await supabase.rpc('recompute_total_cash', {
    target_date: today,
  });
  if (totalErr) console.error('recompute_total_cash error:', totalErr);

  return new Response(JSON.stringify({
    success: true,
    date:    today,
    items:   summary,
    total_cash: totalRow == null ? null : Number(totalRow),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
