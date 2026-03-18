/**
 * Claude API vision pipeline for extracting structured data from check images.
 *
 * Sends check image PNG to Claude and extracts:
 * - Money order number, check number
 * - Payee, payer name/address
 * - Amount, date, memo
 * - Check type (money order, personal check, etc.)
 * - Issuer (Ria/Dandelion, USPS, etc.)
 */

import Anthropic from '@anthropic-ai/sdk';

let anthropic: Anthropic | null = null;

export function initClaude(apiKey: string): void {
  anthropic = new Anthropic({ apiKey });
  console.log('[claude] Anthropic client initialized.');
}

export interface ExtractedCheckData {
  payee: string | null;
  payer_name: string | null;
  payer_address: string | null;
  check_type: string | null; // money_order, personal_check, cashiers_check, usps_money_order
  issuer: string | null; // e.g. "Dandelion Payments / Ria", "USPS", "BancFirst"
  money_order_number: string | null;
  check_number: string | null;
  check_date: string | null; // YYYY-MM-DD
  amount: number | null;
  memo: string | null;
  routing_number: string | null;
  account_number_last4: string | null;
}

/**
 * Send a check image (front) to Claude API and extract structured data.
 * Optionally include the back image for endorsement info.
 */
export async function extractCheckData(
  frontBase64: string,
  backBase64?: string,
  checkAmount?: number | null
): Promise<{ data: ExtractedCheckData; raw_response: any }> {
  if (!anthropic) throw new Error('Claude API not initialized. Call initClaude() first.');

  const content: any[] = [
    {
      type: 'text',
      text: `You are a check image analyzer for a property management company. Extract all structured data from this check/money order image.

IMPORTANT INSTRUCTIONS:
1. For money orders (Dandelion Payments/Ria, USPS Postal Money Orders, Western Union, etc.):
   - The MONEY ORDER NUMBER is critical. It is usually printed vertically on the LEFT edge of the check in a box labeled "MONEY ORDER NUMBER". Read it carefully — it is a 10-digit number.
   - The issuer is listed at the top (e.g., "DANDELION PAYMENTS, INC." / "ria", "INTERNATIONAL MONEY ORDER", "UNITED STATES POSTAL SERVICE")
2. For personal checks: extract the check number (top right corner), routing and account from MICR line at bottom
3. The PAYEE is who the check is made out to (after "PAY TO THE ORDER OF")
4. The PAYER/PURCHASER is the person who bought/signed the check (after "PURCHASER" or the signature line)
5. Read the ADDRESS carefully — it's usually below the purchaser name

${checkAmount ? `Expected check amount: $${checkAmount.toFixed(2)}` : ''}

Return ONLY valid JSON (no markdown, no code blocks) with these exact keys:
{
  "payee": "string or null",
  "payer_name": "string or null",
  "payer_address": "string or null",
  "check_type": "money_order | personal_check | cashiers_check | usps_money_order | business_check",
  "issuer": "string or null (e.g. 'Dandelion Payments / Ria', 'USPS', bank name)",
  "money_order_number": "string or null (the 10-digit serial number)",
  "check_number": "string or null",
  "check_date": "YYYY-MM-DD or null",
  "amount": number or null,
  "memo": "string or null",
  "routing_number": "string or null (from MICR line)",
  "account_number_last4": "string or null (last 4 digits from MICR)"
}`,
    },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: frontBase64,
      },
    },
  ];

  if (backBase64) {
    content.push({
      type: 'text',
      text: 'This is the back of the same check (endorsement side):',
    });
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: backBase64,
      },
    });
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content }],
  });

  try {
    const textContent = message.content[0];
    if (textContent.type !== 'text') throw new Error('Unexpected response type');

    let jsonStr = textContent.text.trim();
    // Strip markdown code fences if present
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);

    const parsed = JSON.parse(jsonStr.trim()) as ExtractedCheckData;

    return {
      data: parsed,
      raw_response: message,
    };
  } catch (err) {
    console.error('[claude] Failed to parse response:', err);
    console.error('[claude] Raw text:', message.content[0]);
    return {
      data: {
        payee: null,
        payer_name: null,
        payer_address: null,
        check_type: null,
        issuer: null,
        money_order_number: null,
        check_number: null,
        check_date: null,
        amount: null,
        memo: null,
        routing_number: null,
        account_number_last4: null,
      },
      raw_response: message,
    };
  }
}

/**
 * Process a batch of check images through Claude extraction.
 * Rate-limits to avoid hitting API limits.
 */
export async function extractBatch(
  checks: Array<{
    id: string;
    front_base64: string;
    back_base64?: string;
    amount?: number | null;
  }>,
  onProgress?: (completed: number, total: number) => void
): Promise<
  Array<{
    id: string;
    data: ExtractedCheckData;
    raw_response: any;
    error?: string;
  }>
> {
  const results: Array<{
    id: string;
    data: ExtractedCheckData;
    raw_response: any;
    error?: string;
  }> = [];

  for (let i = 0; i < checks.length; i++) {
    const check = checks[i];
    try {
      const result = await extractCheckData(
        check.front_base64,
        check.back_base64,
        check.amount
      );
      results.push({ id: check.id, ...result });
    } catch (err: any) {
      console.error(`[claude] Error extracting check ${check.id}: ${err.message}`);
      results.push({
        id: check.id,
        data: {
          payee: null,
          payer_name: null,
          payer_address: null,
          check_type: null,
          issuer: null,
          money_order_number: null,
          check_number: null,
          check_date: null,
          amount: null,
          memo: null,
          routing_number: null,
          account_number_last4: null,
        },
        raw_response: null,
        error: err.message,
      });
    }

    if (onProgress) onProgress(i + 1, checks.length);

    // Rate limit: ~1 request per second
    if (i < checks.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return results;
}
