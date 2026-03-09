/**
 * Shared vendor name normalization and matching utilities.
 *
 * Used by:
 *  - /api/admin/brex/find-matches  (potential match scoring)
 *  - /api/admin/brex/prefill       (vendor prefill lookup)
 *  - /api/admin/bills/prefill      (unified prefill)
 *  - Edge functions (sync-brex, parse-invoice-pdf)
 */

// ─── POS / card-descriptor prefixes to strip ─────────────────────────────────

export const POS_PREFIXES = [
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
export const POS_BRAND_VENDORS: Array<{ pattern: RegExp; vendor: string }> = [
  { pattern: /^facebk\s*\*/i, vendor: 'facebook' },
  { pattern: /^uber\s/i, vendor: 'uber' },
];

// Known abbreviation / alias map: card descriptor → AF vendor name token
export const ABBREVIATIONS: Record<string, string> = {
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

/**
 * Deep normalize for matching: strips POS prefixes, legal suffixes,
 * trailing IDs/locations, symbols, etc.
 *
 * Use for raw card descriptors / merchant names from Brex.
 */
export function normalizeMerchant(name: string): string {
  let n = name.trim();

  // 0. Check if this is a POS brand vendor (e.g. FACEBK *randomID → facebook)
  for (const { pattern, vendor } of POS_BRAND_VENDORS) {
    if (pattern.test(n)) return vendor;
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

/**
 * Lighter normalize for AF vendor names (they're already clean).
 * Strips "the", legal suffixes, &, apostrophes.
 */
export function normalizeAfVendor(name: string): string {
  let n = name.trim().toLowerCase();
  n = n.replace(/^the\s+/, '');
  n = n.replace(/,?\s*(inc\.?|llc\.?|l\.?l\.?c\.?|corp\.?|co\.?|ltd\.?|company|enterprises?)$/i, '');
  n = n.replace(/\s*&\s*/g, ' and ');
  n = n.replace(/[*#''\u2018\u2019]/g, '');
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

/**
 * Basic normalize for dedup keys: lowercase, strip "the", legal suffixes,
 * collapse whitespace. Used by SQL trigger equivalent on the JS side.
 */
export function normalizeForDedup(name: string): string {
  let n = name.trim().toLowerCase();
  n = n.replace(/^the\s+/, '');
  n = n.replace(/,?\s*(inc\.?|llc\.?|l\.?l\.?c\.?|corp\.?|co\.?|ltd\.?|company|enterprises?)$/i, '');
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

// ─── Token matching ─────────────────────────────────────────────────────────

/** Get significant tokens from a name (2+ char words) */
export function getTokens(name: string): string[] {
  return name.split(/\s+/).filter(t => t.length >= 2);
}

/** Expand abbreviations in token list */
export function expandTokens(tokens: string[]): string[] {
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
 * Score how well two normalized names match (0-1).
 * Uses token overlap with abbreviation expansion,
 * first-token bonus, and typo tolerance.
 */
export function matchScore(merchantNorm: string, vendorNorm: string): number {
  // Exact match
  if (merchantNorm === vendorNorm) return 1.0;

  // Get tokens
  const mTokens = expandTokens(getTokens(merchantNorm));
  const vTokens = expandTokens(getTokens(vendorNorm));

  if (mTokens.length === 0 || vTokens.length === 0) return 0;

  // Count how many vendor tokens appear in merchant tokens (or vice versa)
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

  // Score: ratio of matched tokens (use the better direction)
  const vendorCoverage = matchedVendorTokens / vTokens.length;
  const merchantCoverage = matchedMerchantTokens / mTokens.length;

  // Vendor coverage is more important (AF vendor should be well-represented)
  const score = Math.max(vendorCoverage * 0.7 + merchantCoverage * 0.3,
                         merchantCoverage * 0.7 + vendorCoverage * 0.3);

  // Boost if first significant token matches (strong signal)
  const mFirst = mTokens[0] || '';
  const vFirst = vTokens[0] || '';
  const firstTokenBonus = (mFirst === vFirst || mFirst.startsWith(vFirst) || vFirst.startsWith(mFirst)) ? 0.15 : 0;

  // Boost for close edit distance on first token (handles typos)
  let typoBonus = 0;
  if (mFirst.length >= 4 && vFirst.length >= 4) {
    const dist = editDistance(mFirst, vFirst);
    if (dist <= 1) typoBonus = 0.3;
    else if (dist <= 2 && Math.max(mFirst.length, vFirst.length) >= 6) typoBonus = 0.15;
  }

  return Math.min(1.0, Math.max(score + firstTokenBonus, typoBonus + vendorCoverage * 0.5));
}

/** Simple Levenshtein edit distance */
export function editDistance(a: string, b: string): number {
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

/**
 * Compute a dedup key for a bill: normalize(vendor)|amount|YYYY-MM
 * Used to detect cross-source duplicates (Brex + Front for same purchase).
 */
export function computeDedupKey(vendorName: string, amount: number, invoiceDate: string): string {
  const normalized = normalizeForDedup(vendorName);
  const amountStr = Math.abs(amount).toFixed(2);
  const monthStr = invoiceDate.substring(0, 7); // YYYY-MM
  return `${normalized}|${amountStr}|${monthStr}`;
}
