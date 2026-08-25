import { NextResponse } from 'next/server';
import { plaidClient } from '../../../../../lib/plaid';
import { requireAdmin } from '../../../../../lib/auth';

/**
 * POST /api/admin/plaid/exchange-token
 * body: { public_token: string, institution?: { institution_id, name } }
 *
 * Called by the client after the user completes Plaid Link. Exchanges the
 * short-lived public_token for a long-lived access_token, and stores the item
 * in `plaid_items`. Also does an initial balance pull so /admin/cash reflects
 * the new institution immediately without waiting for the next cron.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const publicToken = body.public_token as string | undefined;
  if (!publicToken) {
    return NextResponse.json({ error: 'Missing public_token' }, { status: 400 });
  }

  try {
    const client = plaidClient();

    // 1. Exchange public_token → access_token (server-side only, never leaves DB)
    const exch = await client.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = exch.data.access_token;
    const itemId      = exch.data.item_id;

    // 2. Get item metadata (institution name/id) for display
    const item = await client.itemGet({ access_token: accessToken });
    const institutionId = item.data.item.institution_id || null;
    let institutionName: string | null = body.institution?.name || null;
    if (!institutionName && institutionId) {
      try {
        const inst = await client.institutionsGetById({
          institution_id: institutionId,
          country_codes: ['US'] as any,
        });
        institutionName = inst.data.institution.name;
      } catch { /* non-fatal — leave null */ }
    }

    // 3. Persist the item
    const { error: upsertErr } = await auth.supabase.from('plaid_items').upsert({
      id:               itemId,
      institution_id:   institutionId,
      institution_name: institutionName,
      access_token:     accessToken,
      linked_by:        auth.user.email,
      linked_at:        new Date().toISOString(),
      status:           'active',
      updated_at:       new Date().toISOString(),
    }, { onConflict: 'id' });
    if (upsertErr) throw upsertErr;

    // 4. Immediate balance pull so /admin/cash lights up without waiting for cron
    const bal = await client.accountsBalanceGet({ access_token: accessToken });
    const today = new Date().toISOString().slice(0, 10);
    const rows = (bal.data.accounts || []).map((a: any) => ({
      snapshot_date:     today,
      plaid_account_id:  a.account_id,
      item_id:           itemId,
      institution_name:  institutionName,
      account_name:      a.official_name || a.name,
      account_mask:      a.mask,
      account_type:      a.type,
      account_subtype:   a.subtype,
      current_balance:   a.balances?.current ?? null,
      available_balance: a.balances?.available ?? null,
      iso_currency_code: a.balances?.iso_currency_code || 'USD',
    }));
    if (rows.length > 0) {
      await auth.supabase.from('plaid_daily_balances').upsert(rows, {
        onConflict: 'snapshot_date,plaid_account_id',
      });
    }
    await auth.supabase.from('plaid_items').update({
      last_synced_at: new Date().toISOString(),
    }).eq('id', itemId);

    // 5. Recompute Total Cash so /admin/cash shows the new bank immediately
    await auth.supabase.rpc('recompute_total_cash', { target_date: today });

    return NextResponse.json({
      ok: true,
      item_id: itemId,
      institution: { id: institutionId, name: institutionName },
      accounts: rows.map(r => ({
        name: r.account_name, mask: r.account_mask, balance: r.current_balance,
      })),
    });
  } catch (err: any) {
    console.error('Plaid exchange-token error:', err?.response?.data || err);
    return NextResponse.json(
      { error: err?.response?.data?.error_message || err?.message || 'Plaid error' },
      { status: 500 },
    );
  }
}
