import { requireAuth } from '../../../lib/auth';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const property = searchParams.get('property');
    const priority = searchParams.get('priority');

    let query = supabase
      .from('af_work_orders')
      .select(`
        id, work_order_id, work_order_number, service_request_number,
        service_request_description, job_description, work_order_issue,
        instructions, status_notes, status, priority, work_order_type,
        property_name, property_id, unit_name, unit_id,
        primary_tenant, requesting_tenant, submitted_by_tenant,
        vendor, vendor_id, vendor_trade, assigned_user,
        created_at, created_by, scheduled_start, scheduled_end,
        completed_on, canceled_on, amount,
        vendor_bill_id, vendor_bill_amount, tenant_total_charge_amount,
        recurring
      `)
      .order('created_at', { ascending: false });

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    if (property && property !== 'all') {
      query = query.eq('property_name', property);
    }
    if (priority && priority !== 'all') {
      query = query.eq('priority', priority);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Get bill details for work orders that have vendor_bill_id
    const billIds = (data || [])
      .map(wo => wo.vendor_bill_id)
      .filter(Boolean);

    let billMap: Record<string, any> = {};
    if (billIds.length > 0) {
      const { data: bills } = await supabase
        .from('af_bill_detail')
        .select('bill_id, vendor_name, amount, gl_account_name, memo, status, paid_date')
        .in('bill_id', billIds);

      if (bills) {
        billMap = Object.fromEntries(bills.map(b => [b.bill_id, b]));
      }
    }

    // Get distinct values for filters
    const { data: properties } = await supabase
      .from('af_work_orders')
      .select('property_name')
      .not('property_name', 'is', null)
      .order('property_name');

    const distinctProperties = [...new Set((properties || []).map(p => p.property_name))];

    // Status counts
    const statusCounts: Record<string, number> = {};
    (data || []).forEach(wo => {
      // Count against unfiltered would be better, but this is good enough
      statusCounts[wo.status] = (statusCounts[wo.status] || 0) + 1;
    });

    return NextResponse.json({
      workOrders: (data || []).map(wo => ({
        ...wo,
        bill: wo.vendor_bill_id ? billMap[wo.vendor_bill_id] || null : null,
      })),
      filters: {
        properties: distinctProperties,
        statuses: ['Completed', 'Completed No Need To Bill', 'Scheduled', 'New', 'Assigned', 'Work Done', 'Canceled'],
        priorities: ['Emergency', 'Urgent', 'Normal'],
      },
      statusCounts,
    });
  } catch (error: any) {
    console.error('Work orders API error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch work orders' },
      { status: 500 }
    );
  }
}
