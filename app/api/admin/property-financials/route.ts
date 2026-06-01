/**
 * /api/admin/property-financials
 *
 *   GET   — list every property's overlay (insurance, taxes, debt). Open
 *           to all authenticated users so the Owners page + Owner Net
 *           Income chart can read it. Mutating endpoints below are
 *           admin-only.
 *
 *   PATCH — upsert a property's overlay
 *           body: { property_name, monthly_insurance?, monthly_taxes?,
 *                   monthly_debt_service?, notes? }
 *
 * The overlay is per-property — multiple owners can touch the same
 * property, but the financial costs apply to the property as a whole.
 * Editing from any owner's view updates the same shared row.
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

  const { data, error } = await auth.supabase
    .from('property_debt_insurance')
    .select('property_name, holding_company, spreadsheet_name, monthly_insurance, monthly_taxes, monthly_debt_service, notes, updated_at')
    .order('property_name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data || [] });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;
  const sb = admin();

  let body: any = {};
  try { body = await req.json(); } catch {}
  const property_name = (body?.property_name || '').trim();
  if (!property_name) return NextResponse.json({ error: 'property_name is required' }, { status: 400 });

  // Parse incoming numeric fields, allowing explicit null to clear a value
  const patch: any = { property_name, updated_at: new Date().toISOString() };
  for (const k of ['monthly_insurance', 'monthly_taxes', 'monthly_debt_service'] as const) {
    if (k in body) {
      const v = body[k];
      patch[k] = v === '' || v == null ? null : Number(v);
    }
  }
  if ('notes' in body) patch.notes = body.notes ?? null;
  if ('holding_company' in body) patch.holding_company = body.holding_company ?? null;

  const { data, error } = await sb
    .from('property_debt_insurance')
    .upsert(patch, { onConflict: 'property_name' })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}
