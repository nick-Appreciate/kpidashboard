/**
 * PATCH/DELETE /api/admin/ownership-groups/[id]
 *
 * PATCH body (any subset):
 *   { name?, color?, description?, owner_ids? }
 *   If owner_ids is provided, it REPLACES the membership list for this
 *   group (i.e. it's the authoritative new set of members).
 *
 * DELETE removes the group + cascades the memberships.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../../../../lib/auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function admin() {
  return createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;
  const sb = admin();

  let body: any = {};
  try { body = await req.json(); } catch {}

  const id = params.id;
  const patch: any = {};
  if (typeof body?.name === 'string')        patch.name = body.name.trim();
  if (typeof body?.color === 'string')       patch.color = body.color;
  if ('description' in (body || {}))         patch.description = body.description ?? null;

  if (Object.keys(patch).length > 0) {
    const { error } = await sb.from('ownership_groups').update(patch).eq('id', id);
    if (error) {
      const status = error.code === '23505' ? 409 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
  }

  // Replace membership set if provided
  if (Array.isArray(body?.owner_ids)) {
    const newIds: number[] = body.owner_ids.map(Number).filter(Number.isFinite);
    // Wipe existing, insert new — simple and atomic enough for our scale
    const { error: dErr } = await sb.from('owner_group_memberships').delete().eq('group_id', id);
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
    if (newIds.length > 0) {
      const rows = newIds.map(oid => ({ owner_id: oid, group_id: id, added_by: auth.appUser.email }));
      const { error: iErr } = await sb.from('owner_group_memberships').insert(rows);
      if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
    }
  }

  const { data: g, error: fErr } = await sb.from('ownership_groups').select('*').eq('id', id).single();
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
  return NextResponse.json({ group: g });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;
  const sb = admin();

  const { error } = await sb.from('ownership_groups').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
