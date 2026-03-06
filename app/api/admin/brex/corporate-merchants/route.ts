import { NextResponse } from "next/server";
import { supabase } from '../../../../../lib/supabase';

/**
 * GET /api/admin/brex/corporate-merchants
 *
 * Returns all unique Brex merchants with expense counts and corporate rule status.
 */
export async function GET() {
  try {
    // Get all distinct merchants with counts
    const { data: merchantStats, error: statsError } = await supabase
      .rpc('get_brex_merchant_stats');

    if (statsError) {
      // Fallback: manual query if RPC doesn't exist
      const { data: expenses } = await supabase
        .from('brex_expenses')
        .select('vendor_name_normalized, merchant_name, is_corporate');

      const merchantMap = new Map<string, {
        merchant_name_normalized: string;
        display_name: string;
        expense_count: number;
        corporate_count: number;
        non_corporate_count: number;
      }>();

      for (const exp of expenses || []) {
        const norm = exp.vendor_name_normalized || '';
        if (!norm) continue;
        const existing = merchantMap.get(norm);
        if (existing) {
          existing.expense_count++;
          if (exp.is_corporate) existing.corporate_count++;
          else existing.non_corporate_count++;
        } else {
          merchantMap.set(norm, {
            merchant_name_normalized: norm,
            display_name: exp.merchant_name || norm,
            expense_count: 1,
            corporate_count: exp.is_corporate ? 1 : 0,
            non_corporate_count: exp.is_corporate ? 0 : 1,
          });
        }
      }

      // Get existing rules
      const { data: rules } = await supabase
        .from('brex_corporate_merchants')
        .select('merchant_name_normalized, enabled');

      const ruleMap = new Map(
        (rules || []).map(r => [r.merchant_name_normalized, r.enabled])
      );

      const merchants = Array.from(merchantMap.values()).map(m => ({
        ...m,
        is_corporate_merchant: ruleMap.get(m.merchant_name_normalized) === true,
      }));

      merchants.sort((a, b) => a.display_name.localeCompare(b.display_name));

      return NextResponse.json({ merchants });
    }

    // If RPC exists, use it (future optimization)
    return NextResponse.json({ merchants: merchantStats });
  } catch (error) {
    console.error("Error fetching corporate merchants:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/brex/corporate-merchants
 *
 * Enable a corporate merchant rule. Bulk-archives matching expenses.
 * Body: { merchant_name_normalized: string, display_name: string, created_by?: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { merchant_name_normalized, display_name, created_by } = body;

    if (!merchant_name_normalized) {
      return NextResponse.json({ error: "merchant_name_normalized is required" }, { status: 400 });
    }

    // Upsert the rule (enable if it was previously disabled)
    const { error: upsertError } = await supabase
      .from('brex_corporate_merchants')
      .upsert({
        merchant_name_normalized,
        display_name: display_name || merchant_name_normalized,
        enabled: true,
        created_by: created_by || null,
        created_at: new Date().toISOString(),
      }, { onConflict: 'merchant_name_normalized' });

    if (upsertError) {
      console.error("Error upserting corporate merchant rule:", upsertError);
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    // Bulk-archive matching expenses that aren't already corporate or synced
    const { data: updated, error: updateError } = await supabase
      .from('brex_expenses')
      .update({
        is_corporate: true,
        match_status: 'corporate',
        corporate_at: new Date().toISOString(),
        corporate_note: 'Auto: merchant rule',
        updated_at: new Date().toISOString(),
      })
      .eq('vendor_name_normalized', merchant_name_normalized)
      .eq('is_corporate', false)
      .eq('appfolio_synced', false)
      .select('id');

    if (updateError) {
      console.error("Error bulk-archiving expenses:", updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      affected_count: updated?.length || 0,
    });
  } catch (error) {
    console.error("Error in corporate merchants POST:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/brex/corporate-merchants
 *
 * Disable a corporate merchant rule. Does NOT un-archive existing expenses.
 * Body: { merchant_name_normalized: string }
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { merchant_name_normalized } = body;

    if (!merchant_name_normalized) {
      return NextResponse.json({ error: "merchant_name_normalized is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from('brex_corporate_merchants')
      .update({ enabled: false })
      .eq('merchant_name_normalized', merchant_name_normalized);

    if (error) {
      console.error("Error disabling corporate merchant rule:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in corporate merchants DELETE:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
