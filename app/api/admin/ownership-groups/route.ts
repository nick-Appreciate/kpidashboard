/**
 * /api/admin/ownership-groups
 *
 *   GET    — list every group with its member owner_ids + the union of
 *            properties currently owned by those members. Open to all
 *            authenticated users since the global filter bar (visible
 *            on every page) reads this data.
 *   POST   — create a new group { name, color?, description?, owner_ids? }
 *            Admin only — Owners is under the "Private" sidebar group.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, requireAdmin } from '../../../../lib/auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function admin() {
  return createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const [groupsRes, membershipsRes, historyRes] = await Promise.all([
    supabase.from('ownership_groups').select('*').order('name'),
    supabase.from('owner_group_memberships').select('owner_id, group_id'),
    // Only currently-owned slices (end_date null or in future)
    supabase.from('owner_property_history')
      .select('owner_id, property_name, end_date')
      .or('end_date.is.null,end_date.gte.' + new Date().toISOString().slice(0, 10)),
  ]);

  for (const r of [groupsRes, membershipsRes, historyRes]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  }

  // owner_id → set of property_names currently owned
  const propsByOwner = new Map<number, Set<string>>();
  for (const h of historyRes.data || []) {
    if (!h.property_name) continue;
    const s = propsByOwner.get(h.owner_id) || new Set<string>();
    s.add(h.property_name);
    propsByOwner.set(h.owner_id, s);
  }

  // group_id → owner_ids[]
  const ownersByGroup = new Map<string, number[]>();
  for (const m of membershipsRes.data || []) {
    const arr = ownersByGroup.get(m.group_id) || [];
    arr.push(m.owner_id);
    ownersByGroup.set(m.group_id, arr);
  }

  const groups = (groupsRes.data || []).map((g: any) => {
    const owner_ids = ownersByGroup.get(g.id) || [];
    const props = new Set<string>();
    for (const oid of owner_ids) {
      const ps = propsByOwner.get(oid);
      if (ps) for (const p of ps) props.add(p);
    }
    return {
      ...g,
      owner_ids,
      properties: Array.from(props).sort(),
    };
  });

  return NextResponse.json({ groups });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;
  const sb = admin();

  let body: any = {};
  try { body = await req.json(); } catch {}
  const name = (body?.name || '').trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const color = body?.color || '#06b6d4';
  const description = body?.description || null;
  const ownerIds: number[] = Array.isArray(body?.owner_ids) ? body.owner_ids.map(Number).filter(Number.isFinite) : [];

  const { data: created, error } = await sb
    .from('ownership_groups')
    .insert({ name, color, description, created_by: auth.appUser.email })
    .select('*')
    .single();
  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  if (ownerIds.length > 0) {
    const rows = ownerIds.map(oid => ({
      owner_id: oid, group_id: created.id, added_by: auth.appUser.email,
    }));
    const { error: mErr } = await sb.from('owner_group_memberships').insert(rows);
    if (mErr) {
      // Roll back the group so we don't leave an empty one
      await sb.from('ownership_groups').delete().eq('id', created.id);
      return NextResponse.json({ error: mErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ group: created });
}
