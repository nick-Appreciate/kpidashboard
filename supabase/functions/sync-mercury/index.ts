import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const mercuryApiKey = Deno.env.get('MERCURY_API_KEY')!;

const supabase = createClient(supabaseUrl, supabaseKey);

Deno.serve(async (_req: Request) => {
  try {
    // 1. Determine today's date in Central Time
    const now = new Date();
    const centralDateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const snapshotDate = centralDateStr; // YYYY-MM-DD format

    console.log(`Mercury balance sync for ${snapshotDate}`);

    // 2. Fetch all accounts from Mercury API
    const allAccounts: any[] = [];
    let url: string | null = 'https://api.mercury.com/api/v1/accounts';

    while (url) {
      console.log(`Fetching: ${url}`);
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${mercuryApiKey}` },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mercury API error ${response.status}: ${errorText}`);
      }

      const data = await response.json();

      // Mercury returns { accounts: [...] } or just an array
      const accounts = data.accounts || data;
      if (Array.isArray(accounts)) {
        allAccounts.push(...accounts);
      }

      // Handle cursor-based pagination
      url = data.nextPage
        ? `https://api.mercury.com/api/v1/accounts?start_after=${data.nextPage}`
        : null;
    }

    console.log(`Fetched ${allAccounts.length} Mercury accounts`);

    // 3. Filter to only active accounts and transform
    const records = allAccounts
      .filter((acct: any) => acct.status === 'active')
      .map((acct: any) => ({
        snapshot_date: snapshotDate,
        account_id: acct.id,
        account_name: acct.name || acct.nickname || 'Unknown',
        account_type: acct.type || null,
        account_kind: acct.kind || null,
        current_balance: acct.currentBalance,
        available_balance: acct.availableBalance ?? null,
        account_status: acct.status || null,
      }));

    if (records.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        snapshotDate,
        accountsLogged: 0,
        message: 'No active accounts found',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. Upsert the per-account balance records. The "Total Cash" row is no
    // longer computed inline here — recompute_total_cash() below sums Mercury
    // AND Plaid-linked balances into one canonical row so /admin/cash reflects
    // every source of managed funds. Keeping this file responsible only for
    // Mercury data keeps the source-per-file boundary clean.
    const { error } = await supabase
      .from('mercury_daily_balances')
      .upsert(records, { onConflict: 'snapshot_date,account_id' });

    if (error) throw new Error(`Upsert error: ${JSON.stringify(error)}`);

    console.log(`Logged balances for ${records.length} accounts on ${snapshotDate}`);

    // 4b. Recompute the day's Total Cash across Mercury + Plaid
    const { data: totalRow, error: totalErr } = await supabase.rpc('recompute_total_cash', {
      target_date: snapshotDate,
    });
    if (totalErr) console.error('recompute_total_cash error:', totalErr);
    else console.log(`Total Cash (Mercury + Plaid) for ${snapshotDate}: $${Number(totalRow).toFixed(2)}`);

    // 6. Upsert accounts (so mercury_transactions FK resolves)
    const activeAccounts = allAccounts.filter((a: any) => a.status === 'active');
    const accountRows = activeAccounts.map((a: any) => ({
      id: a.id,
      account_number: a.accountNumber ?? null,
      routing_number: a.routingNumber ?? null,
      name: a.name ?? null,
      nickname: a.nickname ?? null,
      status: a.status ?? null,
      kind: a.kind ?? null,
      available_balance: a.availableBalance ?? null,
      current_balance: a.currentBalance ?? null,
      legal_business_name: a.legalBusinessName ?? null,
      dashboard_link: a.dashboardLink ?? null,
      synced_at: new Date().toISOString(),
    }));
    if (accountRows.length > 0) {
      const { error: acctErr } = await supabase
        .from('mercury_accounts')
        .upsert(accountRows, { onConflict: 'id' });
      if (acctErr) console.error('mercury_accounts upsert error:', acctErr);
    }

    // 7. Fetch + upsert transactions per active account (incremental)
    // Look back a rolling window since MAX(posted_at) - 3 days per account (safety
    // buffer for late-posting items), capped at 90 days if no rows yet.
    const txCounts: Record<string, number> = {};
    let totalTxUpserted = 0;
    const nowMs = Date.now();
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const THREE_DAYS_MS  =  3 * 24 * 60 * 60 * 1000;

    for (const acct of activeAccounts) {
      // per-account watermark
      const { data: watermark } = await supabase
        .from('mercury_transactions')
        .select('posted_at')
        .eq('account_id', acct.id)
        .not('posted_at', 'is', null)
        .order('posted_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // If we have a watermark, use it (- 3 day buffer) regardless of age so
      // long gaps still get filled. Only fall back to a 90-day window if the
      // account has never been synced.
      const startMs = watermark?.posted_at
        ? new Date(watermark.posted_at).getTime() - THREE_DAYS_MS
        : nowMs - NINETY_DAYS_MS;
      const startISO = new Date(startMs).toISOString().substring(0, 10);

      const txs: any[] = [];
      let offset = 0;
      const limit = 500;
      while (true) {
        const txUrl = `https://api.mercury.com/api/v1/account/${acct.id}/transactions?limit=${limit}&offset=${offset}&start=${startISO}`;
        const r = await fetch(txUrl, { headers: { 'Authorization': `Bearer ${mercuryApiKey}` } });
        if (!r.ok) {
          console.error(`  tx fetch ${acct.name}: ${r.status} ${await r.text()}`);
          break;
        }
        const j = await r.json();
        const list = j.transactions || j;
        if (!Array.isArray(list) || list.length === 0) break;
        txs.push(...list);
        if (list.length < limit) break;
        offset += limit;
      }

      if (txs.length === 0) {
        txCounts[acct.name || acct.id] = 0;
        continue;
      }

      const rows = txs.map((t: any) => ({
        id: t.id,
        account_id: acct.id,
        amount: t.amount,
        currency_exponent: t.currencyExponent ?? null,
        counterparty_name: t.counterpartyName ?? null,
        counterparty_account_number: t.counterpartyAccountNumber ?? null,
        status: t.status ?? null,
        kind: t.kind ?? null,
        note: t.note ?? null,
        posted_at: t.postedAt ?? null,
        created_at: t.createdAt ?? null,
        synced_at: new Date().toISOString(),
      }));

      const { error: txErr } = await supabase
        .from('mercury_transactions')
        .upsert(rows, { onConflict: 'id' });
      if (txErr) {
        console.error(`  tx upsert ${acct.name}: ${JSON.stringify(txErr)}`);
        continue;
      }
      txCounts[acct.name || acct.id] = rows.length;
      totalTxUpserted += rows.length;
    }

    console.log(`Transactions upserted: ${totalTxUpserted} across ${activeAccounts.length} accounts`);

    return new Response(JSON.stringify({
      success: true,
      snapshotDate,
      accountsLogged: records.length,
      accounts: records.map(r => ({
        name: r.account_name,
        balance: r.current_balance,
      })),
      transactionsUpserted: totalTxUpserted,
      transactionsPerAccount: txCounts,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Mercury sync error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
