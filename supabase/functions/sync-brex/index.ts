import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const brexApiToken = Deno.env.get('BREX_API_KEY')!;

const supabase = createClient(supabaseUrl, supabaseKey);

// Only import transactions from February 2026 onwards
const EARLIEST_DATE = '2026-02-01';
const MAX_PAGES = 10;

// --- Vendor name normalization (for brex_expenses.vendor_name_normalized) ---
function normalizeVendorName(name: string): string {
  let n = name.trim().toLowerCase();
  n = n.replace(/^the\s+/i, '');
  n = n.replace(/,?\s*(inc\.?|llc\.?|l\.?l\.?c\.?|corp\.?|co\.?|ltd\.?|company|enterprises?)$/i, '');
  n = n.replace(/[*#]/g, '');
  n = n.replace(/[\u2018\u2019\u201A\u2032\u0060]/g, "'");
  n = n.replace(/[\u201C\u201D\u201E\u2033]/g, '"');
  n = n.replace(/\s+[a-z]+\s+[a-z]{2}\s*\d{0,5}$/i, '');
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

// --- Transform a single Brex transaction into a DB record ---
function transformTransaction(txn: any) {
  return {
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
  };
}

// --- Fetch expenses from Brex Expenses API to get expense_id + memo ---
async function enrichWithExpenses(): Promise<{ enriched: number; logged: boolean; debug?: any }> {
  const { data: needsEnrichment } = await supabase
    .from('brex_expenses')
    .select('id, brex_id, amount, merchant_name, posted_at')
    .is('expense_id', null)
    .order('posted_at', { ascending: false })
    .limit(500);

  if (!needsEnrichment || needsEnrichment.length === 0) {
    console.log('No records need expense enrichment');
    return { enriched: 0, logged: false, debug: { reason: 'no_records_need_enrichment' } };
  }

  console.log(`${needsEnrichment.length} records need expense_id enrichment`);

  const brexIdToDbId = new Map<string, number>();
  for (const r of needsEnrichment) {
    brexIdToDbId.set(r.brex_id, r.id);
  }

  let enrichedCount = 0;
  let logged = false;
  let cursor: string | null = null;
  let pageCount = 0;
  let totalExpensesSeen = 0;
  let txnIdMatches = 0;
  let fallbackMatches = 0;
  let apiError: string | null = null;
  let sampleKeys: string[] = [];
  let sampleExpense: any = null;

  do {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    params.set('limit', '100');
    params.append('expand[]', 'merchant');
    params.append('expand[]', 'receipts');

    const url = `https://platform.brexapis.com/v1/expenses/card?${params.toString()}`;
    console.log(`Fetching expenses page ${pageCount + 1}: ${url}`);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${brexApiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      apiError = `${response.status}: ${errorText}`;
      console.error(`Expenses API error ${apiError}`);
      break;
    }

    const data = await response.json();
    const items = data.items || [];
    pageCount++;
    totalExpensesSeen += items.length;

    if (!logged && items.length > 0) {
      sampleKeys = Object.keys(items[0]);
      const sample = items[0];
      sampleExpense = {
        id: sample.id,
        memo: sample.memo,
        merchant_name: sample.merchant_name,
        merchant: sample.merchant,
        purchased_at: sample.purchased_at,
        updated_at: sample.updated_at,
        card_expense_id: sample.card_expense?.id,
        card_transaction_id: sample.card_expense?.card_transaction?.id,
        transaction_id: sample.transaction_id,
        card_transaction: sample.card_transaction,
        original_amount: sample.original_amount,
        amount: sample.amount,
      };
      console.log('Sample expense object keys:', JSON.stringify(sampleKeys));
      logged = true;
    }

    console.log(`Expenses page ${pageCount}: got ${items.length} items`);

    for (const expense of items) {
      const expenseId = expense.id;

      let memo: string | null = null;
      if (typeof expense.memo === 'string') {
        memo = expense.memo;
      } else if (expense.memo?.raw_memo) {
        memo = expense.memo.raw_memo;
      } else if (expense.memo?.value) {
        memo = expense.memo.value;
      }

      const txnId = expense.card_expense?.card_transaction?.id
        || expense.card_transaction?.id
        || expense.transaction_id
        || null;

      if (txnId && brexIdToDbId.has(txnId)) {
        txnIdMatches++;
        const dbId = brexIdToDbId.get(txnId)!;
        const updateData: any = { expense_id: expenseId };
        if (memo) updateData.memo = memo;

        const { error } = await supabase
          .from('brex_expenses')
          .update(updateData)
          .eq('id', dbId);

        if (!error) {
          enrichedCount++;
          brexIdToDbId.delete(txnId);
        }
      } else {
        const expAmount = expense.original_amount?.amount
          ? Math.abs(expense.original_amount.amount / 100)
          : expense.amount?.amount
          ? Math.abs(expense.amount.amount / 100)
          : null;

        const expDate = expense.purchased_at || null;
        const expMerchant = (expense.merchant_name || expense.merchant?.name || '').toLowerCase();

        if (expAmount !== null) {
          for (const [brexId, dbId] of brexIdToDbId.entries()) {
            const record = needsEnrichment.find(r => r.id === dbId);
            if (!record) continue;

            const dbAmount = Number(record.amount);
            const amountMatch = Math.abs(dbAmount - expAmount) < 0.01;
            if (!amountMatch) continue;

            const dbMerchant = (record.merchant_name || '').toLowerCase();
            const merchantMatch = dbMerchant.includes(expMerchant) || expMerchant.includes(dbMerchant)
              || (dbMerchant.split(' ')[0].length > 2 && dbMerchant.split(' ')[0] === expMerchant.split(' ')[0]);

            let dateMatch = false;
            if (expDate && record.posted_at) {
              const d1 = new Date(expDate);
              const d2 = new Date(record.posted_at);
              dateMatch = Math.abs(d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24) <= 3;
            }

            if (amountMatch && (merchantMatch || dateMatch)) {
              fallbackMatches++;
              const updateData: any = { expense_id: expenseId };
              if (memo) updateData.memo = memo;

              const { error } = await supabase
                .from('brex_expenses')
                .update(updateData)
                .eq('id', dbId);

              if (!error) {
                enrichedCount++;
                brexIdToDbId.delete(brexId);
              }
              break;
            }
          }
        }
      }
    }

    cursor = data.next_cursor || null;

    if (brexIdToDbId.size === 0) {
      console.log('All records enriched, stopping expense fetch');
      break;
    }
  } while (cursor && pageCount < MAX_PAGES);

  console.log(`Expense enrichment: ${enrichedCount} records updated across ${pageCount} pages (${totalExpensesSeen} expenses seen, ${txnIdMatches} txnId matches, ${fallbackMatches} fallback matches)`);

  return {
    enriched: enrichedCount,
    logged,
    debug: {
      needsEnrichment: needsEnrichment.length,
      totalExpensesSeen,
      txnIdMatches,
      fallbackMatches,
      pagesProcessed: pageCount,
      apiError,
      sampleKeys,
      sampleExpense,
      remainingUnmatched: brexIdToDbId.size,
    },
  };
}

// --- Apply corporate merchant rules (auto-archive expenses from designated merchants) ---
async function applyCorporateMerchantRules(): Promise<number> {
  const { data: rules } = await supabase
    .from('brex_corporate_merchants')
    .select('merchant_name_normalized')
    .eq('enabled', true);

  if (!rules || rules.length === 0) return 0;

  const names = rules.map(r => r.merchant_name_normalized);

  const { data: updated } = await supabase
    .from('brex_expenses')
    .update({
      is_corporate: true,
      match_status: 'corporate',
      corporate_at: new Date().toISOString(),
      corporate_note: 'Auto: merchant rule',
      updated_at: new Date().toISOString(),
    })
    .in('vendor_name_normalized', names)
    .eq('is_corporate', false)
    .eq('appfolio_synced', false)
    .select('id');

  const count = updated?.length || 0;
  if (count > 0) console.log(`Auto-corporate: marked ${count} expenses from merchant rules`);
  return count;
}

// --- Create bills records for new Brex expenses ---
async function createBillsForNewExpenses(): Promise<{ created: number; skipped: number }> {
  // Find brex_expenses that don't have corresponding bills records yet
  const { data: expenses } = await supabase
    .from('brex_expenses')
    .select('id, amount, merchant_name, merchant_raw_descriptor, posted_at, initiated_at, transaction_type, is_corporate, appfolio_synced, memo, receipt_ids, expense_id')
    .order('posted_at', { ascending: false });

  if (!expenses || expenses.length === 0) {
    return { created: 0, skipped: 0 };
  }

  // Get existing bills linked to brex expenses
  const { data: existingBills } = await supabase
    .from('bills')
    .select('brex_expense_id')
    .eq('source', 'brex')
    .not('brex_expense_id', 'is', null);

  const existingBrexIds = new Set((existingBills || []).map(b => b.brex_expense_id));

  let created = 0;
  let skipped = 0;

  for (const expense of expenses) {
    if (existingBrexIds.has(expense.id)) {
      skipped++;
      continue;
    }

    // Determine status based on expense state
    let status: string;
    if (expense.is_corporate) {
      status = 'corporate';
    } else if (expense.transaction_type === 'COLLECTION') {
      status = 'payment';
    } else if (expense.appfolio_synced) {
      status = 'entered';
    } else {
      status = 'pending';
    }

    const postedDate = expense.posted_at || expense.initiated_at || new Date().toISOString().split('T')[0];

    const billRecord: Record<string, unknown> = {
      source: 'brex',
      brex_expense_id: expense.id,
      vendor_name: expense.merchant_name || 'Unknown',
      amount: expense.amount,
      invoice_date: postedDate,
      description: expense.memo || null,
      status,
      is_hidden: false,
    };

    const { error: insertErr } = await supabase
      .from('bills')
      .insert(billRecord);

    if (insertErr) {
      // Likely unique constraint violation — already exists
      if (insertErr.message?.includes('duplicate') || insertErr.message?.includes('unique')) {
        skipped++;
      } else {
        console.error(`Failed to create bill for brex_expense #${expense.id}: ${insertErr.message}`);
      }
    } else {
      created++;
    }
  }

  console.log(`Bills creation: ${created} created, ${skipped} already existed`);
  return { created, skipped };
}

// --- Update bills table status to match brex_expenses corporate status ---
async function syncCorporateStatusToBills(autoCorporateCount: number): Promise<number> {
  if (autoCorporateCount === 0) return 0;

  // Find brex expenses marked corporate that have bills not yet marked
  const { data: corporateExpenses } = await supabase
    .from('brex_expenses')
    .select('id')
    .eq('is_corporate', true);

  if (!corporateExpenses || corporateExpenses.length === 0) return 0;

  const corporateIds = corporateExpenses.map(e => e.id);

  const { data: updated } = await supabase
    .from('bills')
    .update({ status: 'corporate', updated_at: new Date().toISOString() })
    .in('brex_expense_id', corporateIds)
    .neq('status', 'corporate')
    .neq('status', 'entered')
    .select('id');

  const count = updated?.length || 0;
  if (count > 0) console.log(`Synced corporate status to ${count} bills`);
  return count;
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

    const startDate = cursorRow?.last_posted_date || EARLIEST_DATE;

    console.log(`Starting sync from date: ${startDate}`);

    // 2. Fetch from Brex API page-by-page and upsert as we go
    const baseUrl = 'https://platform.brexapis.com/v2/transactions/card/primary';
    let cursor: string | null = cursorRow?.last_cursor || null;
    let totalFetched = 0;
    let totalUpserted = 0;
    let pageCount = 0;
    let latestPostedDate: string | null = null;

    do {
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      params.set('limit', '100');

      const url = `${baseUrl}?${params.toString()}`;
      console.log(`Fetching page ${pageCount + 1}: ${url}`);

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${brexApiToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Brex API error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const items = data.items || [];
      totalFetched += items.length;
      pageCount++;

      console.log(`Page ${pageCount}: got ${items.length} transactions`);

      if (items.length > 0) {
        const filtered = items.filter((txn: any) => {
          const posted = txn.posted_at_date;
          return !posted || posted >= startDate;
        });
        console.log(`Filtered to ${filtered.length} of ${items.length} (startDate=${startDate})`);
        const records = filtered.map(transformTransaction);

        for (const r of records) {
          if (r.posted_at && (!latestPostedDate || r.posted_at > latestPostedDate)) {
            latestPostedDate = r.posted_at;
          }
        }

        const batchSize = 50;
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize);
          const { error } = await supabase
            .from('brex_expenses')
            .upsert(batch, { onConflict: 'brex_id', ignoreDuplicates: false });
          if (error) throw new Error(`Upsert error: ${JSON.stringify(error)}`);
          totalUpserted += batch.length;
        }
      }

      cursor = data.next_cursor || null;

      await supabase
        .from('brex_sync_cursor')
        .update({
          last_synced_at: new Date().toISOString(),
          last_cursor: cursor,
          last_posted_date: latestPostedDate || cursorRow?.last_posted_date,
          total_synced: (cursorRow?.total_synced || 0) + totalUpserted,
        })
        .eq('id', 1);

    } while (cursor && pageCount < MAX_PAGES);

    console.log(`Sync complete: ${totalFetched} fetched, ${totalUpserted} upserted across ${pageCount} pages`);

    // 3. Enrich with expense IDs + memos from Expenses API
    const enrichResults = await enrichWithExpenses();

    // 4. Apply corporate merchant rules (auto-archive vendor-rule expenses)
    const autoCorporateCount = await applyCorporateMerchantRules();

    // 5. Create bills records for any new Brex expenses
    const billsCreation = await createBillsForNewExpenses();

    // 6. Sync corporate status to bills table
    const corporateSynced = await syncCorporateStatusToBills(autoCorporateCount);

    return new Response(JSON.stringify({
      success: true,
      syncedAt: new Date().toISOString(),
      transactionsFetched: totalFetched,
      recordsUpserted: totalUpserted,
      pagesProcessed: pageCount,
      hasMore: !!cursor,
      enrichment: enrichResults,
      autoCorporate: autoCorporateCount,
      billsCreated: billsCreation.created,
      billsSkipped: billsCreation.skipped,
      corporateSynced,
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
