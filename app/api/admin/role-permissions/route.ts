import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/auth';
// @ts-ignore — supabase.js is untyped JS
import { supabaseAdmin } from '../../../../lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET  /api/admin/role-permissions
 *   Returns { rows: [{ role, page_key, allowed, updated_at }] } for every
 *   non-admin role. Used by the Users → Permissions tab to render the matrix.
 *
 * PATCH /api/admin/role-permissions
 *   Body: { role, page_key, allowed }
 *   Upserts a single toggle. Role 'admin' is rejected — admins are always
 *   allowed everywhere by design (requirePage bypasses the DB check).
 */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const { data, error } = await supabaseAdmin
    .from('role_page_permissions')
    .select('role, page_key, allowed, updated_at')
    .neq('role', 'admin')
    .order('role', { ascending: true })
    .order('page_key', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const body = await request.json();
  const { role, page_key, allowed } = body as { role?: string; page_key?: string; allowed?: boolean };

  if (!role || !page_key || typeof allowed !== 'boolean') {
    return NextResponse.json({ error: 'role, page_key, allowed(boolean) required' }, { status: 400 });
  }
  if (role === 'admin') {
    return NextResponse.json({ error: "'admin' role is always allowed and can't be toggled" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('role_page_permissions')
    .upsert(
      { role, page_key, allowed, updated_at: new Date().toISOString() },
      { onConflict: 'role,page_key' },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, role, page_key, allowed });
}
