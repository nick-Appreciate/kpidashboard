import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';

/**
 * GET /api/admin/plaid/items — list of banks currently linked via Plaid.
 * Used by /admin/plaid-link to display the existing links. Explicitly omits
 * access_token so the browser never receives it.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;

  const { data, error } = await auth.supabase
    .from('plaid_items')
    .select('id, institution_id, institution_name, linked_by, linked_at, last_synced_at, status, status_message')
    .order('linked_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data || [] });
}
