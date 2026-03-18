import { NextResponse } from "next/server";
import { requireAdmin } from '../../../../../../lib/auth';

/**
 * POST /api/admin/bills/[id]/verify-upload
 *
 * Called after a bill has been pending AF confirmation for too long (~5 min).
 * Updates our AF records first (critical), then checks if the bill was matched.
 * If not matched, clears appfolio_synced_at so the bill shows as "Needs Entered" for retry.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;
    const supabase = auth.supabase;

    const { id } = await params;
    const billId = parseInt(id);
    if (isNaN(billId)) {
      return NextResponse.json({ error: "Invalid bill ID" }, { status: 400 });
    }

    // 1. Run matching function to pick up any newly synced AF data
    //    (the background sync-appfolio should have completed by now)
    const { error: matchErr } = await supabase.rpc('match_bills_to_appfolio');
    if (matchErr) {
      console.error("Error running match_bills_to_appfolio:", matchErr);
    }

    // 2. Re-check the bill
    const { data: bill, error } = await supabase
      .from('bills')
      .select('id, status, appfolio_bill_id, appfolio_synced_at')
      .eq('id', billId)
      .single();

    if (error || !bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    // If matched (status changed to 'entered' or has appfolio_bill_id), success
    if (bill.status === 'entered' || bill.appfolio_bill_id) {
      return NextResponse.json({ verified: true, matched: true });
    }

    // 3. Not matched — clear appfolio_synced_at so it shows "Needs Entered" for retry
    await supabase
      .from('bills')
      .update({
        appfolio_synced_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', billId);

    return NextResponse.json({ verified: true, matched: false });
  } catch (error) {
    console.error("Error verifying bill upload:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
