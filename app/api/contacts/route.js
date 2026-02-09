import { supabase } from '../../../lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const type = searchParams.get('type') || 'all'; // all, tenants, vendors
    
    const results = {
      tenants: [],
      vendors: []
    };
    
    // Search tenants from af_delinquency (current occupants with contact info)
    if (type === 'all' || type === 'tenants') {
      const latestSnapshot = await supabase
        .from('af_delinquency')
        .select('snapshot_date')
        .order('snapshot_date', { ascending: false })
        .limit(1);
      
      const latestDate = latestSnapshot.data?.[0]?.snapshot_date;
      
      let tenantQuery = supabase
        .from('af_delinquency')
        .select('name, phone_numbers, primary_tenant_email, property_name, unit, occupancy_id')
        .eq('snapshot_date', latestDate);
      
      if (search) {
        tenantQuery = tenantQuery.or(`name.ilike.%${search}%,primary_tenant_email.ilike.%${search}%,phone_numbers.ilike.%${search}%,property_name.ilike.%${search}%`);
      }
      
      const { data: tenants, error: tenantError } = await tenantQuery
        .order('name', { ascending: true })
        .limit(50);
      
      if (tenantError) {
        console.error('Tenant search error:', tenantError);
      } else {
        results.tenants = (tenants || []).map(t => ({
          id: t.occupancy_id,
          name: t.name,
          phone: t.phone_numbers,
          email: t.primary_tenant_email,
          property: t.property_name,
          unit: t.unit,
          type: 'tenant',
          appfolioUrl: t.occupancy_id ? `https://appreciateinc.appfolio.com/occupancies/${t.occupancy_id}` : null
        }));
      }
    }
    
    // Search vendors
    if (type === 'all' || type === 'vendors') {
      let vendorQuery = supabase
        .from('af_vendor_directory')
        .select('vendor_id, company_name, name, phone_numbers, email, vendor_trades');
      
      if (search) {
        vendorQuery = vendorQuery.or(`name.ilike.%${search}%,company_name.ilike.%${search}%,email.ilike.%${search}%,phone_numbers.ilike.%${search}%`);
      }
      
      const { data: vendors, error: vendorError } = await vendorQuery
        .order('name', { ascending: true })
        .limit(50);
      
      if (vendorError) {
        console.error('Vendor search error:', vendorError);
      } else {
        results.vendors = (vendors || []).map(v => ({
          id: v.vendor_id,
          name: v.name || v.company_name || 'Unknown',
          companyName: v.company_name,
          phone: v.phone_numbers,
          email: v.email,
          trades: v.vendor_trades,
          type: 'vendor',
          appfolioUrl: v.vendor_id ? `https://appreciateinc.appfolio.com/vendors/${v.vendor_id}` : null
        }));
      }
    }
    
    return NextResponse.json(results);
    
  } catch (error) {
    console.error('Error fetching contacts:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
