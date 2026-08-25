import { NextResponse } from 'next/server';
import { plaidClient } from '../../../../../../lib/plaid';
import { requireAdmin } from '../../../../../../lib/auth';

/**
 * DELETE /api/admin/plaid/items/[id]
 *
 * Unlinks a Plaid Item: revokes the access_token upstream via /item/remove and
 * deletes the local row (which cascades plaid_daily_balances via FK if set,
 * otherwise leaves history rows in place — see note below).
 *
 * We do NOT delete plaid_daily_balances history here — leaving those rows
 * preserves the Total Cash timeline even after an item is unlinked. If you
 * want a hard purge, DELETE FROM plaid_daily_balances WHERE item_id = 'X'.
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;

  const itemId = params.id;
  if (!itemId) return NextResponse.json({ error: 'Missing item id' }, { status: 400 });

  // Look up the access_token so we can revoke it at Plaid before deleting locally.
  const { data: item, error: fetchErr } = await auth.supabase
    .from('plaid_items')
    .select('access_token')
    .eq('id', itemId)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!item)   return NextResponse.json({ error: 'Item not found' }, { status: 404 });

  try {
    await plaidClient().itemRemove({ access_token: item.access_token });
  } catch (err: any) {
    // Non-fatal: even if Plaid revoke fails (e.g. already-revoked item), still
    // remove locally so the UI reflects the user's intent.
    console.warn('Plaid itemRemove failed (continuing):', err?.response?.data || err?.message);
  }

  const { error: delErr } = await auth.supabase
    .from('plaid_items')
    .delete()
    .eq('id', itemId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
