/**
 * /api/admin/property-periods
 *
 *   GET   — list every period with its groups + a resolved
 *            currently-active flag. Open to all authenticated users
 *            (the global filter bar reads this).
 *   POST  — create a new period
 *            body: { property_name, period_start?, period_end?,
 *                    holding_company?, notes?,
 *                    monthly_insurance?, monthly_taxes?,
 *                    monthly_debt_service?, group_ids?[] }
 *
 * The property-period model replaces the per-property "single overlay"
 * model. Properties that traded hands (e.g. Hilltop Townhomes) have
 * multiple rows, one per ownership window, each with its own financial
 * costs and group memberships.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, requireAdmin } from '../../../../lib/auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = () => createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;

  const [periodsRes, membershipsRes, groupsRes] = await Promise.all([
    auth.supabase.from('property_period')
      .select('*')
      .order('property_name')
      .order('period_start', { ascending: true }),
    auth.supabase.from('property_period_group_memberships')
      .select('period_id, group_id'),
    auth.supabase.from('ownership_groups')
      .select('id, name, color, description'),
  ]);
  for (const r of [periodsRes, membershipsRes, groupsRes]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  }

  const groupsById = new Map<string, any>();
  for (const g of groupsRes.data || []) groupsById.set(g.id, g);

  const groupsByPeriod = new Map<string, any[]>();
  for (const m of membershipsRes.data || []) {
    const g = groupsById.get(m.group_id);
    if (!g) continue;
    const arr = groupsByPeriod.get(m.period_id) || [];
    arr.push(g);
    groupsByPeriod.set(m.period_id, arr);
  }

  const today = new Date().toISOString().slice(0, 10);
  const periods = (periodsRes.data || []).map((p: any) => ({
    ...p,
    is_active: !p.period_end || p.period_end >= today,
    groups: groupsByPeriod.get(p.id) || [],
  }));

  return NextResponse.json({ periods, groups: groupsRes.data || [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;
  const sb = admin();
  let body: any = {};
  try { body = await req.json(); } catch {}

  const property_name = (body?.property_name || '').trim();
  if (!property_name) return NextResponse.json({ error: 'property_name is required' }, { status: 400 });

  const insert: any = { property_name, source: 'manual' };
  for (const k of ['period_start', 'period_end', 'holding_company', 'notes'] as const) {
    if (k in body) insert[k] = body[k] || null;
  }
  for (const k of ['monthly_insurance', 'monthly_taxes', 'monthly_debt_service'] as const) {
    if (k in body) {
      const v = body[k];
      insert[k] = v === '' || v == null ? null : Number(v);
    }
  }

  const { data: created, error } = await sb.from('property_period').insert(insert).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Optional initial group assignments
  if (Array.isArray(body?.group_ids) && body.group_ids.length > 0) {
    const rows = body.group_ids.map((gid: string) => ({
      period_id: created.id, group_id: gid, added_by: auth.appUser.email,
    }));
    await sb.from('property_period_group_memberships').insert(rows);
  }

  return NextResponse.json({ period: created });
}
