import { NextResponse } from "next/server";
import { requireAdmin } from '../../../../../lib/auth';
import { normalizeMerchant, normalizeAfVendor, matchScore } from '../../../../../lib/vendor-matching';

/**
 * POST /api/admin/bills/prefill
 *
 * Takes an array of vendor names and fuzzy-matches them against
 * historical af_bill_detail records to pre-fill vendor, property, and GL account.
 *
 * Body: { vendors: string[] }
 * Returns: { [vendor_name]: { vendor_name, property, gl_account, description } | null }
 */

const MIN_MATCH_SCORE = 0.5;

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;
  try {
    const body = await request.json();
    // Accept both 'vendors' and 'merchants' for backward compat
    const vendors: string[] = body.vendors || body.merchants || [];

    if (vendors.length === 0) {
      return NextResponse.json({});
    }

    // Fetch distinct vendors with their most common property/GL/memo from af_bill_detail
    const { data: billDetails, error: bdErr } = await supabase
      .from('af_bill_detail')
      .select('vendor_name, property_name, gl_account_id, memo')
      .not('vendor_name', 'is', null);

    if (bdErr) {
      return NextResponse.json({ error: bdErr.message }, { status: 500 });
    }

    // Build lookup: normalized AF vendor name -> { vendor_name, property, gl_account, description, count }
    const vendorMap = new Map<string, Map<string, { vendor_name: string; property: string; gl_account: string; description: string; count: number }>>();

    for (const row of billDetails || []) {
      if (!row.vendor_name) continue;
      const normalized = normalizeAfVendor(row.vendor_name);
      if (!vendorMap.has(normalized)) {
        vendorMap.set(normalized, new Map());
      }
      const key = `${row.vendor_name}|${row.property_name || ''}|${row.gl_account_id || ''}`;
      const combos = vendorMap.get(normalized)!;
      const existing = combos.get(key);
      if (existing) {
        existing.count++;
        if (row.memo && !existing.description) {
          existing.description = row.memo;
        }
      } else {
        combos.set(key, {
          vendor_name: row.vendor_name,
          property: row.property_name || '',
          gl_account: row.gl_account_id || '',
          description: row.memo || '',
          count: 1,
        });
      }
    }

    const vendorEntries = Array.from(vendorMap.entries());

    // For each vendor, find the best match
    const result: Record<string, { vendor_name: string; property: string; gl_account: string; description: string } | null> = {};

    for (const vendor of vendors) {
      const vendorNorm = normalizeMerchant(vendor);

      let bestScore = 0;
      let bestCombos: Map<string, { vendor_name: string; property: string; gl_account: string; description: string; count: number }> | null = null;

      // 1. Exact normalized match
      if (vendorMap.has(vendorNorm)) {
        bestScore = 1.0;
        bestCombos = vendorMap.get(vendorNorm)!;
      }

      // 2. Score-based fuzzy matching
      if (bestScore < 1.0) {
        for (const [normV, combos] of vendorEntries) {
          const score = matchScore(vendorNorm, normV);
          if (score > bestScore && score >= MIN_MATCH_SCORE) {
            bestScore = score;
            bestCombos = combos;
            if (score >= 1.0) break;
          }
        }
      }

      if (bestCombos) {
        const comboValues = Array.from(bestCombos.values());
        let best: (typeof comboValues)[number] | null = null;
        for (const combo of comboValues) {
          if (!best || combo.count > best.count) {
            best = combo;
          }
        }
        result[vendor] = best ? {
          vendor_name: best.vendor_name,
          property: best.property,
          gl_account: best.gl_account,
          description: best.description,
        } : null;
      } else {
        result[vendor] = null;
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error in prefill:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
