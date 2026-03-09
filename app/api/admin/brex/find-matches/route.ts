import { NextResponse } from "next/server";
import { supabase } from '../../../../../lib/supabase';
import { normalizeMerchant, normalizeAfVendor, matchScore } from '../../../../../lib/vendor-matching';

/**
 * POST /api/admin/brex/find-matches
 *
 * Takes a Brex merchant name and amount, finds potential matching bills
 * from both ops_bills (invoices from Front email) AND af_bill_detail
 * (bills already in AppFolio).
 *
 * Body: { merchant_name: string, amount: number }
 * Returns: { matches: Array<{ id, vendor_name, amount, invoice_date, invoice_number, status, payment_status, score, match_reason, source }> }
 */

const MIN_VENDOR_SCORE = 0.4; // Lower threshold for "find potential matches" - user will verify

/** Unified match result from either ops_bills or af_bill_detail */
interface MatchResult {
  id: number | string;
  vendor_name: string;
  amount: number;
  invoice_date: string | null;
  invoice_number: string | null;
  status: string | null;
  payment_status: string | null;
  score: number;
  match_reason: string;
  source: 'ops_bills' | 'af_bill_detail';
  property_name?: string | null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { merchant_name, amount } = body;

    if (!merchant_name || amount === undefined) {
      return NextResponse.json({ error: "merchant_name and amount are required" }, { status: 400 });
    }

    const merchantNorm = normalizeMerchant(merchant_name);
    const expenseAmount = Math.abs(Number(amount));

    // ─── Fetch already-matched bill IDs to exclude ──────────────────────────

    const { data: matchedExpenses } = await supabase
      .from('brex_expenses')
      .select('matched_bill_id')
      .not('matched_bill_id', 'is', null);

    const alreadyMatchedBillIds = new Set(
      (matchedExpenses || []).map(e => e.matched_bill_id as number)
    );

    // ─── Search ops_bills (invoices from Front email) ───────────────────────

    const { data: opsBills } = await supabase
      .from('ops_bills')
      .select('id, vendor_name, amount, invoice_date, invoice_number, status, payment_status')
      .eq('is_hidden', false)
      .order('invoice_date', { ascending: false })
      .limit(500);

    // ─── Search af_bill_detail (bills already in AppFolio) ──────────────────

    const { data: afBills } = await supabase
      .from('af_bill_detail')
      .select('id, bill_id, vendor_name, amount, bill_date, bill_number, status, paid_date, property_name')
      .order('bill_date', { ascending: false })
      .limit(1000);

    // ─── Score and rank all candidates ──────────────────────────────────────

    const results: MatchResult[] = [];
    // Dedup key: source:id
    const seen = new Set<string>();

    // Helper to process a bill candidate
    const scoreBill = (
      bill: { id: number | string; vendor_name: string | null; amount: string | number; invoice_date?: string | null; bill_date?: string | null; invoice_number?: string | null; bill_number?: string | null; status?: string | null; payment_status?: string | null; paid_date?: string | null; property_name?: string | null },
      source: 'ops_bills' | 'af_bill_detail'
    ) => {
      const key = `${source}:${bill.id}`;
      if (seen.has(key)) return;

      // Skip bills already matched to another Brex expense
      const billIdForMatch = source === 'af_bill_detail' ? ((bill as any).bill_id || bill.id) : bill.id;
      if (alreadyMatchedBillIds.has(Number(billIdForMatch))) return;

      const billNorm = normalizeAfVendor(bill.vendor_name || '');
      const vendorScore = matchScore(merchantNorm, billNorm);
      const billAmount = Math.abs(Number(bill.amount));
      const amountMatch = Math.abs(billAmount - expenseAmount) < 0.01;

      // Require BOTH exact amount match AND vendor name match
      if (!amountMatch) return;
      if (vendorScore < MIN_VENDOR_SCORE) return;

      seen.add(key);

      const score = 0.9 + vendorScore * 0.1;
      const reason = 'Amount + vendor match';

      const invoiceDate = bill.invoice_date || bill.bill_date || null;
      const invoiceNumber = bill.invoice_number || bill.bill_number || null;
      const paymentStatus = bill.payment_status || (bill.paid_date ? 'paid' : null);

      results.push({
        id: source === 'af_bill_detail' ? (bill as any).bill_id || bill.id : bill.id,
        vendor_name: bill.vendor_name || '',
        amount: billAmount,
        invoice_date: invoiceDate,
        invoice_number: invoiceNumber,
        status: bill.status || null,
        payment_status: paymentStatus,
        score,
        match_reason: reason,
        source,
        property_name: bill.property_name || null,
      });
    };

    // Score ops_bills
    for (const bill of opsBills || []) {
      scoreBill(bill, 'ops_bills');
    }

    // Score af_bill_detail
    for (const bill of afBills || []) {
      scoreBill(bill, 'af_bill_detail');
    }

    // Sort by score descending, then date
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.invoice_date && b.invoice_date) return b.invoice_date.localeCompare(a.invoice_date);
      return 0;
    });

    // Deduplicate: if same vendor + same amount from both sources, prefer af_bill_detail (already in AppFolio)
    const deduped: MatchResult[] = [];
    const vendorAmountSeen = new Set<string>();
    for (const r of results) {
      const vaKey = `${normalizeAfVendor(r.vendor_name)}:${r.amount.toFixed(2)}`;
      if (vendorAmountSeen.has(vaKey)) {
        // Skip duplicate from ops_bills if af_bill_detail already has it
        if (r.source === 'ops_bills') continue;
      }
      vendorAmountSeen.add(vaKey);
      deduped.push(r);
    }

    // Filter low-score matches
    const MIN_FINAL_SCORE = 0.35;
    const filtered = deduped.filter(r => r.score >= MIN_FINAL_SCORE);

    return NextResponse.json({ matches: filtered.slice(0, 15) });
  } catch (error) {
    console.error("Error finding matches:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
