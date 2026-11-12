/**
 * /api/admin/leasing-special
 *
 * GET  → the current special (or null)
 * PUT  { name_en, name_es, details_en?, details_es?, active } → save it.
 *
 * One active row in leasing_specials drives the website promo banner and the
 * lead engine's follow-up text #2. Saving replaces the current special's text;
 * active=false turns the banner and the special line off.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireAuth } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const { data, error } = await auth.supabase
    .from('leasing_specials')
    .select('id, active, name_en, name_es, details_en, details_es, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ special: data || null }, { headers: { 'Cache-Control': 'private, max-age=0' } });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const row = {
    name_en: clean(body.name_en, 80),
    name_es: clean(body.name_es, 80),
    details_en: clean(body.details_en, 140) || null,
    details_es: clean(body.details_es, 140) || null,
    active: body.active !== false,
    updated_at: new Date().toISOString(),
  };
  if (!row.name_en || !row.name_es) return NextResponse.json({ error: 'English and Spanish names are required' }, { status: 400 });

  // Edit the most recent special in place (keeps one row; the banner's
  // per-special dismissal resets only when the name changes).
  const { data: current } = await auth.supabase
    .from('leasing_specials').select('id, name_en').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  const renamed = !current || current.name_en !== row.name_en;
  const q = renamed
    ? auth.supabase.from('leasing_specials').insert(row)
    : auth.supabase.from('leasing_specials').update(row).eq('id', current!.id);
  if (renamed && current) {
    // A new special replaces the old one (only one may be active).
    await auth.supabase.from('leasing_specials').update({ active: false, updated_at: new Date().toISOString() }).eq('id', current.id);
  }
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
