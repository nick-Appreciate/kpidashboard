/**
 * PATCH/DELETE /api/admin/owner-property-history/[id]
 *
 * Edit a single per-owner-per-property ownership window:
 *   { start_date?, end_date?, ownership_pct?, notes? }
 *
 * The seeded rows came from AppFolio + property_acquisitions. The Owner
 * page surfaces a date editor so users can correct dates the seed got
 * wrong (e.g. an owner bought in mid-cycle, not at property acquisition).
 *
 * source is flipped to 'manual' on any successful PATCH so we can tell
 * hand-edited rows from auto-seeded ones.
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

  let body: any = {};
  try { body = await req.json(); } catch {}

  const patch: any = { updated_at: new Date().toISOString(), source: 'manual' };
  if ('start_date' in body)     patch.start_date = body.start_date || null;
  if ('end_date' in body)       patch.end_date   = body.end_date   || null;
  if ('ownership_pct' in body)  patch.ownership_pct = body.ownership_pct == null || body.ownership_pct === ''
    ? null : Number(body.ownership_pct);
  if ('notes' in body)          patch.notes = body.notes || null;

  const { data, error } = await admin()
    .from('owner_property_history')
    .update(patch).eq('id', params.id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;
  const { error } = await admin()
    .from('owner_property_history').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
