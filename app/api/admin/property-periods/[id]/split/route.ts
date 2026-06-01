/**
 * POST /api/admin/property-periods/[id]/split
 *
 * Convenience: split an active period in two when a property changes
 * hands. Closes the existing period on `split_date` and creates a new
 * period for the same property starting that day.
 *
 * Body:
 *   { split_date: 'YYYY-MM-DD',
 *     new_holding_company?, new_notes?,
 *     new_monthly_insurance?, new_monthly_taxes?, new_monthly_debt_service? }
 *
 * The new period inherits the property_name. Its financial overlay
 * starts blank (or whatever the caller passes) — different ownership
 * usually means different loans, policies, tax assessments.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../../../../../lib/auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = () => createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;
  const sb = admin();
  let body: any = {};
  try { body = await req.json(); } catch {}

  const split_date = (body?.split_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(split_date)) {
    return NextResponse.json({ error: 'split_date (YYYY-MM-DD) is required' }, { status: 400 });
  }

  // Load the existing period
  const { data: existing, error: eErr } = await sb
    .from('property_period').select('*').eq('id', params.id).single();
  if (eErr || !existing) {
    return NextResponse.json({ error: eErr?.message || 'period not found' }, { status: 404 });
  }
  if (existing.period_end && existing.period_end < split_date) {
    return NextResponse.json({ error: `period already ended before ${split_date}` }, { status: 400 });
  }

  // Close the existing period
  const { error: u1 } = await sb.from('property_period')
    .update({ period_end: split_date, updated_at: new Date().toISOString(), source: 'manual' })
    .eq('id', params.id);
  if (u1) return NextResponse.json({ error: u1.message }, { status: 500 });

  // Open the new one
  const newRow: any = {
    property_name: existing.property_name,
    period_start: split_date,
    period_end: null,
    holding_company: body?.new_holding_company ?? null,
    notes: body?.new_notes ?? null,
    source: 'manual',
  };
  for (const [k, src] of [
    ['monthly_insurance',     'new_monthly_insurance'],
    ['monthly_taxes',         'new_monthly_taxes'],
    ['monthly_debt_service',  'new_monthly_debt_service'],
  ] as const) {
    if (src in body) {
      const v = (body as any)[src];
      newRow[k] = v === '' || v == null ? null : Number(v);
    }
  }
  const { data: created, error: iErr } = await sb.from('property_period').insert(newRow).select('*').single();
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  return NextResponse.json({ closed: { id: params.id, period_end: split_date }, opened: created });
}
