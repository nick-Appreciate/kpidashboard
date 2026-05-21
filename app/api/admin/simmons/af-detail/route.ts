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

  // 2) Tenant from directory. A unit can have multiple historical tenants —
  //    we want the one whose lease/occupancy window contains the receipt date,
  //    not just "the current" tenant. Fallback ladder if no exact match.
  let tenant: any = null;
  if (receipt.property_name && receipt.unit) {
    const { data: candidates } = await supabase
      .from('af_tenant_directory')
      .select('tenant_id, occupancy_id, tenant_name, status, move_in, move_out, lease_start, lease_end, email, phone_numbers')
      .eq('property_name', receipt.property_name)
      .eq('unit', receipt.unit);

    if (candidates && candidates.length > 0) {
      const rd = receipt.receipt_date;
      // Build a sortable score per candidate. Earlier rules win.
      const scored = candidates.map((c: any) => {
        const ls = c.lease_start, le = c.lease_end, mi = c.move_in, mo = c.move_out;
        const inLease = ls && rd >= ls && (!le || rd <= le);
        const inOcc   = mi && rd >= mi && (!mo || rd <= mo);
        // Distance from the receipt date to the lease window's center
        // (used only as a tiebreaker — picks the lease "closest" to the receipt)
        let distance = Infinity;
        if (ls && le) {
          const center = (new Date(ls).getTime() + new Date(le).getTime()) / 2;
          distance = Math.abs(new Date(rd).getTime() - center);
        } else if (ls) {
          distance = Math.abs(new Date(rd).getTime() - new Date(ls).getTime());
        }
        return {
          row: c,
          rank: inLease ? 0 : inOcc ? 1 : c.status === 'Current' ? 2 : 3,
          distance,
        };
      });
      scored.sort((a, b) => a.rank - b.rank || a.distance - b.distance);
      tenant = scored[0]?.row ?? null;
    }
  }

  return NextResponse.json({ receipt, tenant });
}
