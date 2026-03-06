import { NextResponse } from "next/server";
import { supabase } from '../../../../../lib/supabase';

/**
 * POST /api/admin/brex/find-matches
 *
 * Takes a Brex merchant name and amount, finds potential matching ops_bills.
 * Uses the same sophisticated normalization from the prefill route.
 *
 * Body: { merchant_name: string, amount: number }
 * Returns: { matches: Array<{ id, vendor_name, amount, invoice_date, invoice_number, status, payment_status, score, match_reason }> }
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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { merchant_name, amount } = body;

    if (!merchant_name || amount === undefined) {
      return NextResponse.json({ error: "merchant_name and amount are required" }, { status: 400 });
    }

    const merchantNorm = normalizeMerchant(merchant_name);
    const expenseAmount = Math.abs(Number(amount));

    // Strategy: fetch bills that match by amount OR by vendor name, then score
    // 1. Exact amount matches (most important signal)
    const { data: amountMatches, error: amtErr } = await supabase
      .from('ops_bills')
      .select('id, vendor_name, amount, invoice_date, invoice_number, status, payment_status')
      .eq('is_hidden', false)
      .gte('amount', expenseAmount - 0.01)
      .lte('amount', expenseAmount + 0.01);

    if (amtErr) {
      return NextResponse.json({ error: amtErr.message }, { status: 500 });
    }

    // 2. Also fetch bills by vendor name that might have different amounts (near-matches)
    // We'll do a broader search and filter by vendor similarity
    // Get distinct vendor names that fuzzy-match our merchant
    const { data: allBills, error: allErr } = await supabase
      .from('ops_bills')
      .select('id, vendor_name, amount, invoice_date, invoice_number, status, payment_status')
      .eq('is_hidden', false)
      .order('invoice_date', { ascending: false })
      .limit(500);

    if (allErr) {
      return NextResponse.json({ error: allErr.message }, { status: 500 });
    }

    // Score and rank all potential matches
    const seen = new Set<number>();
    const results: Array<{
      id: number;
      vendor_name: string;
      amount: number;
      invoice_date: string | null;
      invoice_number: string | null;
      status: string | null;
      payment_status: string | null;
      score: number;
      match_reason: string;
    }> = [];

    // Process amount matches first (these are strong candidates)
    for (const bill of amountMatches || []) {
      if (seen.has(bill.id)) continue;
      seen.add(bill.id);

      const billNorm = normalizeAfVendor(bill.vendor_name || '');
      const vendorScore = matchScore(merchantNorm, billNorm);
      const amountMatch = Math.abs(Number(bill.amount) - expenseAmount) < 0.01;

      // Amount matches always included; vendor match boosts score
      let score = 0;
      let reason = '';

      if (amountMatch && vendorScore >= MIN_VENDOR_SCORE) {
        score = 0.9 + vendorScore * 0.1; // Strong match: both amount and vendor
        reason = 'Amount + vendor match';
      } else if (amountMatch) {
        score = 0.5; // Amount match only
        reason = 'Amount match';
      }

      if (score > 0) {
        results.push({
          id: bill.id,
          vendor_name: bill.vendor_name,
          amount: Number(bill.amount),
          invoice_date: bill.invoice_date,
          invoice_number: bill.invoice_number,
          status: bill.status,
          payment_status: bill.payment_status,
          score,
          match_reason: reason,
        });
      }
    }

    // Process vendor name matches (may have different amounts)
    for (const bill of allBills || []) {
      if (seen.has(bill.id)) continue;

      const billNorm = normalizeAfVendor(bill.vendor_name || '');
      const vendorScore = matchScore(merchantNorm, billNorm);

      if (vendorScore >= MIN_VENDOR_SCORE) {
        seen.add(bill.id);
        const amountMatch = Math.abs(Number(bill.amount) - expenseAmount) < 0.01;

        let score = vendorScore * 0.6; // Vendor match but different amount
        let reason = 'Vendor match (different amount)';

        if (amountMatch) {
          score = 0.9 + vendorScore * 0.1;
          reason = 'Amount + vendor match';
        }

        results.push({
          id: bill.id,
          vendor_name: bill.vendor_name,
          amount: Number(bill.amount),
          invoice_date: bill.invoice_date,
          invoice_number: bill.invoice_number,
          status: bill.status,
          payment_status: bill.payment_status,
          score,
          match_reason: reason,
        });
      }
    }

    // Sort by score descending, then date
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Prefer more recent bills
      if (a.invoice_date && b.invoice_date) return b.invoice_date.localeCompare(a.invoice_date);
      return 0;
    });

    // Filter out low-score vendor-only matches (reduce noise)
    const MIN_FINAL_SCORE = 0.35;
    const filtered = results.filter(r => r.score >= MIN_FINAL_SCORE);

    // Limit to top 10 matches
    return NextResponse.json({ matches: filtered.slice(0, 10) });
  } catch (error) {
    console.error("Error finding matches:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
