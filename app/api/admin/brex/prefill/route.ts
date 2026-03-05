import { NextResponse } from "next/server";
import { supabase } from '../../../../../lib/supabase';

/**
 * POST /api/admin/brex/prefill
 *
 * Takes an array of Brex merchant names and fuzzy-matches them against
 * historical af_bill_detail records to pre-fill vendor, property, and GL account.
 *
 * Body: { merchants: string[] }
 * Returns: { [merchant_name]: { vendor_name, property, gl_account } | null }
 */

// ─── POS / card-descriptor prefixes to strip ─────────────────────────────────
const POS_PREFIXES = [
  /^sq\s*\*/i,           // Square: "SQ *AMERICAN APPLIANCE"
  /^tst\s*\*/i,          // Toast: "TST* RESTAURANT"
  /^pp\s*\*/i,           // PayPal: "PP*VENDOR"
  /^paypal\s*\*/i,       // PayPal long: "PAYPAL *VENDOR"
  /^google\s*\*/i,       // Google: "GOOGLE*FIBER FX62TS"
  /^intuit\s*\*/i,       // Intuit: "INTUIT *QBooks Online"
  /^ubr\s*\*/i,          // Uber: "UBR* PENDING.UBER.COM"
  /^sl\.nord\s*\*/i,     // Nord: "SL.NORD* PRODUCTS"
  /^amzn\s*/i,           // Amazon: "AMZN MKTP"
  /^in\s*\*/i,           // Invoice: "IN *VENDOR"
];

// Merchant names where the POS prefix IS the vendor (remaining text is just an ID)
// Maps the prefix pattern to the actual vendor name to use for matching
const POS_BRAND_VENDORS: Array<{ pattern: RegExp; vendor: string }> = [
  { pattern: /^facebk\s*\*/i, vendor: 'facebook' },
  { pattern: /^uber\s/i, vendor: 'uber' },
];

// Known abbreviation / alias map: card descriptor → AF vendor name token
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
  'comm': '',  // commercial suffix, strip
};

// ─── Normalization ──────────────────────────────────────────────────────────

/** Deep normalize for matching: strips POS prefixes, suffixes, symbols, etc. */
function normalizeMerchant(name: string): string {
  let n = name.trim();

  // 0. Check if this is a POS brand vendor (e.g. FACEBK *randomID → facebook)
  for (const { pattern, vendor } of POS_BRAND_VENDORS) {
    if (pattern.test(n)) {
      return vendor;
    }
  }

  // 1. Strip POS prefixes
  for (const prefix of POS_PREFIXES) {
    n = n.replace(prefix, '');
  }

  // 2. Lowercase
  n = n.toLowerCase();

  // 3. Strip leading "the "
  n = n.replace(/^the\s+/, '');

  // 4. Strip trailing legal suffixes
  n = n.replace(/,?\s*(inc\.?|llc\.?|l\.?l\.?c\.?|corp\.?|co\.?|ltd\.?|company|enterprises?)$/i, '');

  // 5. Strip "(US)" and similar country/region identifiers
  n = n.replace(/\s*\(us\)\s*/gi, ' ');
  n = n.replace(/\s*\(usa?\)\s*/gi, ' ');

  // 6. Replace & with "and"
  n = n.replace(/\s*&\s*/g, ' and ');

  // 7. Strip symbols: *, #, @, apostrophes (curly and straight)
  n = n.replace(/[*#@''\u2018\u2019]/g, '');

  // 8. Strip trailing store/location numbers: "#2202", "N 1", etc.
  n = n.replace(/\s*#\d+\s*$/, '');
  n = n.replace(/\s+\d+\s*$/, '');
  n = n.replace(/\s+n\s+\d+\s*$/i, '');  // "ARROW COLD CONTROL N 1"

  // 9. Strip trailing random IDs (alphanumeric codes like "FX62TS", "T0390KRL92B")
  n = n.replace(/\s+[a-z0-9]{6,}\s*$/i, '');

  // 10. Strip common transaction suffixes
  n = n.replace(/\s+(bill\s+pay|outside|online|payment|pmts?|charge)\s*$/i, '');

  // 11. Strip trailing city/state/zip
  n = n.replace(/\s+[a-z]+\s+[a-z]{2}\s*\d{0,5}$/i, '');

  // 12. Strip domain suffixes
  n = n.replace(/\.(com|io|org|net|app)\/?.*$/i, '');

  // 13. Collapse whitespace
  n = n.replace(/\s+/g, ' ').trim();

  return n;
}

/** Lighter normalize for AF vendor names (they're already clean) */
function normalizeAfVendor(name: string): string {
  let n = name.trim().toLowerCase();
  n = n.replace(/^the\s+/, '');
  n = n.replace(/,?\s*(inc\.?|llc\.?|l\.?l\.?c\.?|corp\.?|co\.?|ltd\.?|company|enterprises?)$/i, '');
  n = n.replace(/\s*&\s*/g, ' and ');
  n = n.replace(/[*#''\u2018\u2019]/g, '');
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

/** Get significant tokens from a name (3+ char words) */
function getTokens(name: string): string[] {
  return name.split(/\s+/).filter(t => t.length >= 2);
}

/** Expand abbreviations in token list */
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

/**
 * Score how well two names match (0-1).
 * Uses token overlap with abbreviation expansion.
 * Higher score = better match.
 */
function matchScore(merchantNorm: string, vendorNorm: string): number {
  // Exact match
  if (merchantNorm === vendorNorm) return 1.0;

  // Get tokens
  const mTokens = expandTokens(getTokens(merchantNorm));
  const vTokens = expandTokens(getTokens(vendorNorm));

  if (mTokens.length === 0 || vTokens.length === 0) return 0;

  // Count how many vendor tokens appear in merchant tokens (or vice versa)
  let matchedVendorTokens = 0;
  for (const vt of vTokens) {
    // Check exact token match or if merchant contains vendor token as substring
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

  // Score: ratio of matched tokens (use the better direction)
  const vendorCoverage = matchedVendorTokens / vTokens.length;   // How much of vendor is found in merchant
  const merchantCoverage = matchedMerchantTokens / mTokens.length; // How much of merchant is found in vendor

  // Vendor coverage is more important (we want the AF vendor to be well-represented)
  const score = Math.max(vendorCoverage * 0.7 + merchantCoverage * 0.3,
                         merchantCoverage * 0.7 + vendorCoverage * 0.3);

  // Boost if first significant token matches (strong signal)
  const mFirst = mTokens[0] || '';
  const vFirst = vTokens[0] || '';
  const firstTokenBonus = (mFirst === vFirst || mFirst.startsWith(vFirst) || vFirst.startsWith(mFirst)) ? 0.15 : 0;

  // Boost for close edit distance on first token (handles typos like Janssen/Jansen)
  let typoBonus = 0;
  if (mFirst.length >= 4 && vFirst.length >= 4) {
    const dist = editDistance(mFirst, vFirst);
    if (dist <= 1) typoBonus = 0.3;
    else if (dist <= 2 && Math.max(mFirst.length, vFirst.length) >= 6) typoBonus = 0.15;
  }

  return Math.min(1.0, Math.max(score + firstTokenBonus, typoBonus + vendorCoverage * 0.5));
}

/** Simple Levenshtein edit distance */
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

// Minimum score to consider a match (tuned to avoid false positives)
const MIN_MATCH_SCORE = 0.5;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const merchants: string[] = body.merchants || [];

    if (merchants.length === 0) {
      return NextResponse.json({});
    }

    // Fetch distinct vendors with their most common property/GL from af_bill_detail
    const { data: billDetails, error: bdErr } = await supabase
      .from('af_bill_detail')
      .select('vendor_name, property_name, gl_account_id')
      .not('vendor_name', 'is', null);

    if (bdErr) {
      return NextResponse.json({ error: bdErr.message }, { status: 500 });
    }

    // Build a lookup: normalized AF vendor name -> { vendor_name, property, gl_account, count }
    const vendorMap = new Map<string, Map<string, { vendor_name: string; property: string; gl_account: string; count: number }>>();

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
      } else {
        combos.set(key, {
          vendor_name: row.vendor_name,
          property: row.property_name || '',
          gl_account: row.gl_account_id || '',
          count: 1,
        });
      }
    }

    const vendorEntries = Array.from(vendorMap.entries());

    // For each merchant, find the best match
    const result: Record<string, { vendor_name: string; property: string; gl_account: string } | null> = {};

    for (const merchant of merchants) {
      const merchantNorm = normalizeMerchant(merchant);

      let bestScore = 0;
      let bestCombos: Map<string, { vendor_name: string; property: string; gl_account: string; count: number }> | null = null;

      // 1. Exact normalized match (score = 1.0)
      if (vendorMap.has(merchantNorm)) {
        bestScore = 1.0;
        bestCombos = vendorMap.get(merchantNorm)!;
      }

      // 2. Score-based fuzzy matching against all vendors
      if (bestScore < 1.0) {
        for (const [normVendor, combos] of vendorEntries) {
          const score = matchScore(merchantNorm, normVendor);
          if (score > bestScore && score >= MIN_MATCH_SCORE) {
            bestScore = score;
            bestCombos = combos;
            if (score >= 1.0) break; // Perfect match, stop looking
          }
        }
      }

      if (bestCombos) {
        // Pick the combo with the highest count
        let best: { vendor_name: string; property: string; gl_account: string; count: number } | null = null;
        const comboValues = Array.from(bestCombos.values());
        for (const combo of comboValues) {
          if (!best || combo.count > best.count) {
            best = combo;
          }
        }
        if (best) {
          result[merchant] = {
            vendor_name: best.vendor_name,
            property: best.property,
            gl_account: best.gl_account,
          };
        } else {
          result[merchant] = null;
        }
      } else {
        result[merchant] = null;
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
