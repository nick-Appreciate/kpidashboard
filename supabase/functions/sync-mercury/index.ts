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

    // 4. Always compute a "Total Cash" row from individual account balances
    const hasTotalCash = records.some(r => r.account_name === 'Total Cash');
    if (!hasTotalCash) {
      const totalBalance = records.reduce((sum, r) => sum + Number(r.current_balance), 0);
      records.push({
        snapshot_date: snapshotDate,
        account_id: 'total_cash_computed',
        account_name: 'Total Cash',
        account_type: 'computed',
        account_kind: null,
        current_balance: totalBalance,
        available_balance: null,
        account_status: 'active',
      });
      console.log(`Computed Total Cash: $${totalBalance.toFixed(2)}`);
    }

    // 5. Upsert balance records
    const { error } = await supabase
      .from('mercury_daily_balances')
      .upsert(records, { onConflict: 'snapshot_date,account_id' });

    if (error) throw new Error(`Upsert error: ${JSON.stringify(error)}`);

    console.log(`Logged balances for ${records.length} accounts on ${snapshotDate}`);

    return new Response(JSON.stringify({
      success: true,
      snapshotDate,
      accountsLogged: records.length,
      accounts: records.map(r => ({
        name: r.account_name,
        balance: r.current_balance,
      })),
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
