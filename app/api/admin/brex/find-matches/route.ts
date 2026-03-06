import { NextResponse } from "next/server";
import { supabase } from '../../../../../lib/supabase';

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

// ─── POS / card-descriptor prefixes to strip ─────────────────────────────────
const POS_PREFIXES = [
  /^sq\s*\*/i,
  /^tst\s*\*/i,
  /^pp\s*\*/i,
  /^paypal\s*\*/i,
  /^google\s*\*/i,
  /^intuit\s*\*/i,
  /^ubr\s*\*/i,
  /^sl\.nord\s*\*/i,
  /^amzn\s*/i,
  /^in\s*\*/i,
];

const POS_BRAND_VENDORS: Array<{ pattern: RegExp; vendor: string }> = [
  { pattern: /^facebk\s*\*/i, vendor: 'facebook' },
  { pattern: /^uber\s/i, vendor: 'uber' },
];

const ABBREVIATIONS: Record<string, string> = {
  'facebk': 'facebook',
  'mister': 'mr',
  'mr': 'mister',
  'dept': 'depot',
  'svcs': 'services',
  'svc': 'service',
  'mgmt': 'management',
  'maint': 'maintenance',
  'elec': 'electric',
  'plbg': 'plumbing',
  'htg': 'heating',
  'clg': 'cooling',
  'comm': '',
};

/** Deep normalize for matching: strips POS prefixes, suffixes, symbols, etc. */
function normalizeMerchant(name: string): string {
  let n = name.trim();

  for (const { pattern, vendor } of POS_BRAND_VENDORS) {
    if (pattern.test(n)) return vendor;
  }

  for (const prefix of POS_PREFIXES) {
    n = n.replace(prefix, '');
  }

  n = n.toLowerCase();
  n = n.replace(/^the\s+/, '');
  n = n.replace(/,?\s*(inc\.?|llc\.?|l\.?l\.?c\.?|corp\.?|co\.?|ltd\.?|company|enterprises?)$/i, '');
  n = n.replace(/\s*\(us\)\s*/gi, ' ');
  n = n.replace(/\s*\(usa?\)\s*/gi, ' ');
  n = n.replace(/\s*&\s*/g, ' and ');
  n = n.replace(/[*#@''\u2018\u2019]/g, '');
  n = n.replace(/\s*#\d+\s*$/, '');
  n = n.replace(/\s+\d+\s*$/, '');
  n = n.replace(/\s+n\s+\d+\s*$/i, '');
  n = n.replace(/\s+[a-z0-9]{6,}\s*$/i, '');
  n = n.replace(/\s+(bill\s+pay|outside|online|payment|pmts?|charge)\s*$/i, '');
  n = n.replace(/\s+[a-z]+\s+[a-z]{2}\s*\d{0,5}$/i, '');
  n = n.replace(/\.(com|io|org|net|app)\/?.*$/i, '');
  n = n.replace(/\s+/g, ' ').trim();

  return n;
}

/** Lighter normalize for AF vendor names */
function normalizeAfVendor(name: string): string {
  let n = name.trim().toLowerCase();
  n = n.replace(/^the\s+/, '');
  n = n.replace(/,?\s*(inc\.?|llc\.?|l\.?l\.?c\.?|corp\.?|co\.?|ltd\.?|company|enterprises?)$/i, '');
  n = n.replace(/\s*&\s*/g, ' and ');
  n = n.replace(/[*#''\u2018\u2019]/g, '');
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

function getTokens(name: string): string[] {
  return name.split(/\s+/).filter(t => t.length >= 2);
}

function expandTokens(tokens: string[]): string[] {
  const expanded: string[] = [];
  for (const t of tokens) {
    expanded.push(t);
    if (ABBREVIATIONS[t] && ABBREVIATIONS[t].length > 0) {
      expanded.push(ABBREVIATIONS[t]);
    }
  }
  return expanded;
}

function matchScore(merchantNorm: string, vendorNorm: string): number {
  if (merchantNorm === vendorNorm) return 1.0;

  const mTokens = expandTokens(getTokens(merchantNorm));
  const vTokens = expandTokens(getTokens(vendorNorm));

  if (mTokens.length === 0 || vTokens.length === 0) return 0;

  let matchedVendorTokens = 0;
  for (const vt of vTokens) {
    if (mTokens.some(mt => mt === vt || mt.startsWith(vt) || vt.startsWith(mt))) {
      matchedVendorTokens++;
    }
  }

  let matchedMerchantTokens = 0;
  for (const mt of mTokens) {
    if (vTokens.some(vt => vt === mt || vt.startsWith(mt) || mt.startsWith(vt))) {
      matchedMerchantTokens++;
    }
  }

  const vendorCoverage = matchedVendorTokens / vTokens.length;
  const merchantCoverage = matchedMerchantTokens / mTokens.length;

  const score = Math.max(vendorCoverage * 0.7 + merchantCoverage * 0.3,
                         merchantCoverage * 0.7 + vendorCoverage * 0.3);

  const mFirst = mTokens[0] || '';
  const vFirst = vTokens[0] || '';
  const firstTokenBonus = (mFirst === vFirst || mFirst.startsWith(vFirst) || vFirst.startsWith(mFirst)) ? 0.15 : 0;

  let typoBonus = 0;
  if (mFirst.length >= 4 && vFirst.length >= 4) {
    const dist = editDistance(mFirst, vFirst);
    if (dist <= 1) typoBonus = 0.3;
    else if (dist <= 2 && Math.max(mFirst.length, vFirst.length) >= 6) typoBonus = 0.15;
  }

  return Math.min(1.0, Math.max(score + firstTokenBonus, typoBonus + vendorCoverage * 0.5));
}

function editDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

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

      const billNorm = normalizeAfVendor(bill.vendor_name || '');
      const vendorScore = matchScore(merchantNorm, billNorm);
      const billAmount = Math.abs(Number(bill.amount));
      const amountMatch = Math.abs(billAmount - expenseAmount) < 0.01;

      // Must match on amount OR vendor name
      if (!amountMatch && vendorScore < MIN_VENDOR_SCORE) return;

      seen.add(key);

      let score = 0;
      let reason = '';

      if (amountMatch && vendorScore >= MIN_VENDOR_SCORE) {
        score = 0.9 + vendorScore * 0.1;
        reason = 'Amount + vendor match';
      } else if (amountMatch) {
        score = 0.5;
        reason = 'Amount match';
      } else {
        score = vendorScore * 0.6;
        reason = 'Vendor match (different amount)';
      }

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
