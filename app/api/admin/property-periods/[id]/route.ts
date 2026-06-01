/**
 * PATCH/DELETE /api/admin/property-periods/[id]
 *
 * PATCH body (any subset):
 *   { period_start?, period_end?, holding_company?, notes?,
 *     monthly_insurance?, monthly_taxes?, monthly_debt_service?,
 *     group_ids? }
 *   If group_ids is provided it REPLACES the membership set for the
 *   period (authoritative new list, mirroring the ownership_groups
 *   pattern).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../../../../lib/auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = () => createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;
  const sb = admin();
  let body: any = {};
  try { body = await req.json(); } catch {}

  const patch: any = { updated_at: new Date().toISOString() };
  let touchedCore = false;
  for (const k of ['period_start', 'period_end', 'holding_company', 'notes'] as const) {
    if (k in body) { patch[k] = body[k] || null; touchedCore = true; }
  }
  for (const k of ['monthly_insurance', 'monthly_taxes', 'monthly_debt_service'] as const) {
    if (k in body) {
      const v = body[k];
      patch[k] = v === '' || v == null ? null : Number(v);
      touchedCore = true;
    }
  }
  // Flip source to 'manual' on any hand-edit so we can tell seeded from edited
  if (touchedCore) patch.source = 'manual';

  if (touchedCore) {
    const { error } = await sb.from('property_period').update(patch).eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Replace membership set if provided
  if (Array.isArray(body?.group_ids)) {
    const { error: dErr } = await sb.from('property_period_group_memberships')
      .delete().eq('period_id', params.id);
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
    if (body.group_ids.length > 0) {
      const rows = body.group_ids.map((gid: string) => ({
        period_id: params.id, group_id: gid, added_by: auth.appUser.email,
      }));
      const { error: iErr } = await sb.from('property_period_group_memberships').insert(rows);
      if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
    }
  }

  const { data: row, error: fErr } = await sb.from('property_period').select('*').eq('id', params.id).single();
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
  return NextResponse.json({ period: row });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;
  const { error } = await admin().from('property_period').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
