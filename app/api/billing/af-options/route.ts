import { NextResponse } from "next/server";
import { supabase } from '../../../../lib/supabase';

/**
 * GET /api/billing/af-options
 * Returns available vendors, GL accounts, and properties for dropdown selection
 * in the editable unmatched bill card.
 */
export async function GET() {
  try {
    // Fetch distinct GL accounts from af_bill_detail
    const { data: glData, error: glErr } = await supabase
      .from('af_bill_detail')
      .select('gl_account_id, gl_account_name')
      .not('gl_account_name', 'is', null)
      .order('gl_account_name');

    if (glErr) {
      return NextResponse.json({ error: glErr.message }, { status: 500 });
    }

    // Deduplicate GL accounts
    const glMap = new Map<string, { id: string; name: string }>();
    for (const row of glData || []) {
      if (row.gl_account_id && !glMap.has(row.gl_account_id)) {
        glMap.set(row.gl_account_id, {
          id: row.gl_account_id,
          name: row.gl_account_name,
        });
      }
    }
    const gl_accounts = Array.from(glMap.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );

    // Fetch distinct properties from af_bill_detail
    const { data: propData, error: propErr } = await supabase
      .from('af_bill_detail')
      .select('property_name')
      .not('property_name', 'is', null)
      .order('property_name');

    if (propErr) {
      return NextResponse.json({ error: propErr.message }, { status: 500 });
    }

    const propSet = new Set<string>();
    for (const r of propData || []) {
      if (r.property_name) propSet.add(r.property_name);
    }
    const properties = Array.from(propSet).sort();

    // Fetch vendors from af_vendor_directory
    const { data: vendorData, error: vendorErr } = await supabase
      .from('af_vendor_directory')
      .select('company_name')
      .not('company_name', 'is', null)
      .order('company_name');

    if (vendorErr) {
      return NextResponse.json({ error: vendorErr.message }, { status: 500 });
    }

    const vendors = (vendorData || []).map((v) => v.company_name).filter(Boolean);

    return NextResponse.json({ gl_accounts, properties, vendors });
  } catch (error) {
    console.error("Error fetching AF options:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
