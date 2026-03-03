import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const brexApiToken = Deno.env.get('BREX_API_TOKEN')!;

const supabase = createClient(supabaseUrl, supabaseKey);

// --- Vendor name normalization (mirrors parse-invoice-pdf logic + card descriptor cleanup) ---
function normalizeVendorName(name: string): string {
  let n = name.trim().toLowerCase();
  // Strip leading "The"
  n = n.replace(/^the\s+/i, '');
  // Strip trailing legal suffixes
  n = n.replace(/,?\s*(inc\.?|llc\.?|l\.?l\.?c\.?|corp\.?|co\.?|ltd\.?|company|enterprises?)$/i, '');
  // Strip card descriptor artifacts (asterisks, hash marks)
  n = n.replace(/[*#]/g, '');
  // Strip trailing city/state/zip patterns common in card transactions
  n = n.replace(/\s+[a-z]+\s+[a-z]{2}\s*\d{0,5}$/i, '');
  // Collapse whitespace
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

// --- Brex API fetch with cursor pagination ---
async function fetchBrexTransactions(startDate?: string): Promise<unknown[]> {
  const baseUrl = 'https://platform.brexapis.com/v2/transactions/card/primary';
  let allTransactions: unknown[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (startDate) params.set('posted_at_start', startDate + 'T00:00:00Z');
    params.set('limit', '100');

    const url = `${baseUrl}?${params.toString()}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${brexApiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Brex API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    allTransactions = allTransactions.concat(data.items || []);
    cursor = data.next_cursor || null;
  } while (cursor);

  return allTransactions;
}

// --- Matching logic ---
async function runMatching(): Promise<{ highConfidence: number; lowConfidence: number }> {
  // Get all unmatched, non-corporate brex expenses
  const { data: unmatched } = await supabase
    .from('brex_expenses')
    .select('id, amount, vendor_name_normalized, merchant_name, posted_at')
    .eq('match_status', 'unmatched')
    .eq('is_corporate', false);

  if (!unmatched || unmatched.length === 0) return { highConfidence: 0, lowConfidence: 0 };

  let highCount = 0;
  let lowCount = 0;

  for (const expense of unmatched) {
    // Find ops_bills with exact amount match
    const { data: candidates } = await supabase
      .from('ops_bills')
      .select('id, vendor_name, amount, invoice_date')
      .eq('amount', expense.amount)
      .eq('is_hidden', false);

    if (!candidates || candidates.length === 0) continue;

    let bestMatch: { billId: number; confidence: 'high' | 'low' } | null = null;

    for (const bill of candidates) {
      const billNormalized = normalizeVendorName(bill.vendor_name);
      const expenseNormalized = expense.vendor_name_normalized;

      // Check vendor name match
      const exactVendor = billNormalized === expenseNormalized;
      const fuzzyVendor = !exactVendor && (
        billNormalized.includes(expenseNormalized) ||
        expenseNormalized.includes(billNormalized) ||
        (billNormalized.split(' ')[0].length > 2 &&
         billNormalized.split(' ')[0] === expenseNormalized.split(' ')[0])
      );

      if (!exactVendor && !fuzzyVendor) continue;

      // Check date proximity (optional, boosts confidence)
      let dateClose = false;
      if (expense.posted_at && bill.invoice_date) {
        const brexDate = new Date(expense.posted_at);
        const billDate = new Date(bill.invoice_date);
        const daysDiff = Math.abs(brexDate.getTime() - billDate.getTime()) / (1000 * 60 * 60 * 24);
        dateClose = daysDiff <= 7;
      }

      // Determine confidence
      if (exactVendor && dateClose) {
        bestMatch = { billId: bill.id, confidence: 'high' };
        break; // Can't do better than this
      } else if (exactVendor && !dateClose) {
        // Exact vendor but no date match — low confidence
        if (!bestMatch || bestMatch.confidence !== 'high') {
          bestMatch = { billId: bill.id, confidence: 'low' };
        }
      } else if (fuzzyVendor) {
        // Fuzzy vendor — low confidence regardless of date
        if (!bestMatch) {
          bestMatch = { billId: bill.id, confidence: 'low' };
        }
      }
    }

    if (bestMatch) {
      await supabase
        .from('brex_expenses')
        .update({
          match_status: 'matched',
          match_confidence: bestMatch.confidence,
          matched_bill_id: bestMatch.billId,
          matched_at: new Date().toISOString(),
          matched_by: 'auto',
        })
        .eq('id', expense.id);

      if (bestMatch.confidence === 'high') highCount++;
      else lowCount++;
    }
  }

  return { highConfidence: highCount, lowConfidence: lowCount };
}

// --- Main handler ---
Deno.serve(async (_req: Request) => {
  try {
    // 1. Get cursor/last sync date
    const { data: cursorRow } = await supabase
      .from('brex_sync_cursor')
      .select('*')
      .eq('id', 1)
      .single();

    const startDate = cursorRow?.last_posted_date
      ? cursorRow.last_posted_date
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // 2. Fetch from Brex API
    const transactions = await fetchBrexTransactions(startDate);

    // 3. Transform and upsert
    const records = transactions.map((txn: any) => ({
      brex_id: txn.id,
      card_id: txn.card_id || null,
      amount: Math.abs(txn.amount?.amount ? txn.amount.amount / 100 : 0),
      currency: txn.amount?.currency || 'USD',
      merchant_raw_descriptor: txn.merchant?.raw_descriptor || null,
      merchant_name: txn.merchant?.name || txn.merchant?.raw_descriptor || 'Unknown',
      merchant_mcc: txn.merchant?.mcc || null,
      initiated_at: txn.initiated_at_date || null,
      posted_at: txn.posted_at_date || null,
      transaction_type: txn.type || null,
      memo: txn.memo || null,
      receipt_ids: txn.receipts?.map((r: any) => r.id) || null,
      vendor_name_normalized: normalizeVendorName(
        txn.merchant?.name || txn.merchant?.raw_descriptor || ''
      ),
      synced_at: new Date().toISOString(),
    }));

    // Upsert in batches (brex_id unique constraint)
    const batchSize = 50;
    let totalUpserted = 0;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase
        .from('brex_expenses')
        .upsert(batch, { onConflict: 'brex_id', ignoreDuplicates: false });
      if (error) throw new Error(`Upsert error: ${JSON.stringify(error)}`);
      totalUpserted += batch.length;
    }

    // 4. Update cursor
    const latestPostedDate = records
      .map((r: any) => r.posted_at)
      .filter(Boolean)
      .sort()
      .pop();

    await supabase
      .from('brex_sync_cursor')
      .update({
        last_synced_at: new Date().toISOString(),
        last_posted_date: latestPostedDate || cursorRow?.last_posted_date,
        total_synced: (cursorRow?.total_synced || 0) + totalUpserted,
      })
      .eq('id', 1);

    // 5. Run matching
    const matchResults = await runMatching();

    return new Response(JSON.stringify({
      success: true,
      syncedAt: new Date().toISOString(),
      transactionsFetched: transactions.length,
      recordsUpserted: totalUpserted,
      matching: matchResults,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Brex sync error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
