/**
 * GET /api/admin/owners
 *
 * Returns every AppFolio owner with:
 *   - their current and historical properties (owner_property_history)
 *   - the ownership groups they belong to
 *
 * Used by the /admin/owners page and (later) the global filter module.
 *
 * Open to any authenticated user — Owners lives in the Administrative
 * sidebar group (admin-only would be requireAdmin).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const [ownersRes, historyRes, membershipsRes, groupsRes] = await Promise.all([
    supabase
      .from('af_owner_directory')
      .select('owner_id, name, first_name, last_name, email, properties_owned, payment_type, hold_payments')
      .order('name'),
    supabase
      .from('owner_property_history')
      .select('id, owner_id, property_name, ownership_pct, start_date, end_date, source, notes'),
    supabase
      .from('owner_group_memberships')
      .select('owner_id, group_id'),
    supabase
      .from('ownership_groups')
      .select('id, name, color, description'),
  ]);

  for (const r of [ownersRes, historyRes, membershipsRes, groupsRes]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  }

  const groupsById = new Map<string, any>();
  for (const g of groupsRes.data || []) groupsById.set(g.id, g);

  const histByOwner = new Map<number, any[]>();
  for (const h of historyRes.data || []) {
    const arr = histByOwner.get(h.owner_id) || [];
    arr.push(h);
    histByOwner.set(h.owner_id, arr);
  }

  const groupsByOwner = new Map<number, any[]>();
  for (const m of membershipsRes.data || []) {
    const g = groupsById.get(m.group_id);
    if (!g) continue;
    const arr = groupsByOwner.get(m.owner_id) || [];
    arr.push(g);
    groupsByOwner.set(m.owner_id, arr);
  }

  const owners = (ownersRes.data || []).map((o: any) => ({
    ...o,
    properties: (histByOwner.get(o.owner_id) || []).sort((a, b) =>
      (a.property_name || '').localeCompare(b.property_name || '')),
    groups: groupsByOwner.get(o.owner_id) || [],
  }));

  return NextResponse.json({ owners, groups: groupsRes.data || [] });
}
