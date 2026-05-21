/**
 * GET /api/admin/simmons/af-detail?af_id=<uuid>
 *
 * For one AppFolio income_register row, returns:
 *   - receipt: the row itself
 *   - tenant:  directory entry joined by (property_name, unit)
 *   - ledger:  tenant ledger entries (matched by payer name) within ±90 days
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  const { searchParams } = new URL(req.url);
  const afId = searchParams.get('af_id');
  if (!afId) return NextResponse.json({ error: 'af_id required' }, { status: 400 });

  // 1) Receipt
  const { data: receipt, error: rErr } = await supabase
    .from('af_income_register')
    .select('id, receipt_date, receipt_amount, payer, reference, description, property_name, unit, property_id, unit_id')
    .eq('id', afId)
    .single();
  if (rErr || !receipt) return NextResponse.json({ error: 'receipt not found' }, { status: 404 });

  // 2) Tenant from directory (property + unit) — including occupancy_id so we
  //    can build a deep-link to the tenant ledger in AppFolio.
  let tenant: any = null;
  if (receipt.property_name && receipt.unit) {
    const { data } = await supabase
      .from('af_tenant_directory')
      .select('tenant_id, occupancy_id, tenant_name, status, move_in, move_out, lease_start, lease_end, email, phone_numbers')
      .eq('property_name', receipt.property_name)
      .eq('unit', receipt.unit)
      .order('status', { ascending: true })
      .limit(1)
      .maybeSingle();
    tenant = data || null;
  }

  return NextResponse.json({ receipt, tenant });
}
