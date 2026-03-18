import { NextResponse } from "next/server";
import { requireAuth } from '../../../../lib/auth';

/**
 * GET /api/billing/af-options
 * Returns available vendors, GL accounts, properties, and units-by-property
 * for dropdown selection in the bill entry form.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    // Fetch distinct GL accounts from af_bill_detail
    // NOTE: .limit(10000) prevents Supabase default 1000-row truncation
    const { data: glData, error: glErr } = await supabase
      .from('af_bill_detail')
      .select('gl_account_id, gl_account_name')
      .not('gl_account_name', 'is', null)
      .order('gl_account_name')
      .limit(10000);

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
      .order('property_name')
      .limit(10000);

    if (propErr) {
      return NextResponse.json({ error: propErr.message }, { status: 500 });
    }

    const propSet = new Set<string>();
    for (const r of propData || []) {
      if (r.property_name) propSet.add(r.property_name);
    }

    // Fetch vendors from af_vendor_directory
    const { data: vendorData, error: vendorErr } = await supabase
      .from('af_vendor_directory')
      .select('company_name')
      .not('company_name', 'is', null)
      .order('company_name')
      .limit(10000);

    if (vendorErr) {
      return NextResponse.json({ error: vendorErr.message }, { status: 500 });
    }

    const vendors = (vendorData || []).map((v) => v.company_name).filter(Boolean);

    // Fetch units-by-property from rent_roll_snapshots (most complete source)
    const { data: unitData, error: unitErr } = await supabase
      .from('rent_roll_snapshots')
      .select('property, unit')
      .not('unit', 'is', null)
      .not('unit', 'eq', '')
      .limit(10000);

    if (unitErr) {
      console.error("Error fetching units:", unitErr.message);
    }

    const unitsByProperty: Record<string, string[]> = {};
    for (const row of unitData || []) {
      if (!row.property || !row.unit) continue;
      // Also merge rent_roll properties into the property set
      propSet.add(row.property);
      if (!unitsByProperty[row.property]) unitsByProperty[row.property] = [];
      if (!unitsByProperty[row.property].includes(row.unit)) {
        unitsByProperty[row.property].push(row.unit);
      }
    }
    // Sort units naturally within each property (e.g. "2" before "10")
    for (const prop of Object.keys(unitsByProperty)) {
      unitsByProperty[prop].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }

    const properties = Array.from(propSet).sort();

    return NextResponse.json({ gl_accounts, properties, vendors, units_by_property: unitsByProperty });
  } catch (error) {
    console.error("Error fetching AF options:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
