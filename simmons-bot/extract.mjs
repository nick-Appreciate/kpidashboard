/**
 * extract.mjs
 * Runs Claude vision extraction on simmons_check_images rows where
 * claude_extracted = false. Downloads each image from Supabase storage,
 * sends front (+ optional back) to Claude, parses the JSON response,
 * and writes the structured fields back to simmons_check_images.
 *
 * Run:
 *   node extract.mjs                  # extract everything pending
 *   node extract.mjs --limit 5        # only 5 rows (for smoke test)
 *   node extract.mjs --since 2026-05  # only deposits on/after a date
 *   node extract.mjs --dry-run        # print extraction but don't write back
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'url';

loadEnv({ path: fileURLToPath(new URL('./.env', import.meta.url)), override: true });

const DRY_RUN  = process.argv.includes('--dry-run');
const LIMIT_I  = process.argv.indexOf('--limit');
const LIMIT    = LIMIT_I >= 0 ? Number(process.argv[LIMIT_I + 1]) : Infinity;
const SINCE_I  = process.argv.indexOf('--since');
const SINCE    = SINCE_I >= 0 ? process.argv[SINCE_I + 1] : null;
const MODEL    = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (!anthropicKey) {
  console.error('❌ ANTHROPIC_API_KEY missing in .env');
  process.exit(1);
}
const anthropic = new Anthropic({ apiKey: anthropicKey });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchImage(path, attempts = 4) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const { data, error } = await supabase.storage.from('simmons-checks').download(path);
      if (error) { lastErr = error.message; }
      else if (data) {
        const buf = Buffer.from(await data.arrayBuffer());
        return buf.toString('base64');
      }
    } catch (e) {
      lastErr = e.message;
    }
    if (i < attempts) await sleep(1500 * i); // 1.5s, 3s, 4.5s backoff
  }
  console.log(`     download retry exhausted (${attempts} tries): ${lastErr}`);
  return null;
}

const PROMPT = `You are a check image analyzer for a property management company. Extract all structured data from this check / money order image.

IMPORTANT INSTRUCTIONS:
1. For money orders (Dandelion Payments/Ria, USPS Postal Money Orders, Western Union, RGA, QuikTrip, etc.):
   - The MONEY ORDER NUMBER is usually printed prominently at the top right or vertically on the LEFT edge. It is typically a 10-digit number.
   - The issuer is listed at the top (e.g., "DANDELION PAYMENTS, INC." / "ria", "INTERNATIONAL MONEY ORDER", "Western Union", "RGA MONEY ORDER")
2. For personal checks: extract the check number (top right corner), routing and account from the MICR line at bottom.
3. The PAYEE is who the check is made out to (after "PAY TO THE ORDER OF").
4. The PAYER/PURCHASER is the person who bought/signed the check (after "PURCHASER" or the signature line). For cashiers checks, this is the REMITTER.
5. Read the ADDRESS carefully — it's usually below the purchaser name.
6. For deposit slips (Virtual DDA Deposit / Credit slip from the bank itself), set check_type = "deposit_slip" and skip per-payer fields.

Return ONLY valid JSON (no markdown, no code blocks) with these exact keys:
{
  "payee": "string or null",
  "payer_name": "string or null",
  "payer_address": "string or null",
  "check_type": "money_order | personal_check | cashiers_check | usps_money_order | business_check | deposit_slip",
  "issuer": "string or null (e.g. 'Dandelion Payments / Ria', 'USPS', 'Western Union', 'UMB Bank', bank name)",
  "money_order_number": "string or null",
  "check_number": "string or null",
  "check_date": "YYYY-MM-DD or null",
  "amount": number or null,
  "memo": "string or null",
  "routing_number": "string or null (from MICR line)",
  "account_number_last4": "string or null (last 4 digits from MICR)"
}`;

async function extractOne(row) {
  const frontB64 = await fetchImage(row.front_image_path);
  if (!frontB64) return { error: 'front download failed' };
  const backB64 = row.back_image_path ? await fetchImage(row.back_image_path) : null;

  const expectedAmt = row.amount ? parseFloat(row.amount) : null;
  const promptText = expectedAmt
    ? `${PROMPT}\n\nExpected amount (for sanity check only — Banno records it as ${expectedAmt < 0 ? 'negative for individual check, positive for deposit slip' : 'positive'}): $${Math.abs(expectedAmt).toFixed(2)}.`
    : PROMPT;

  const content = [
    { type: 'text', text: promptText },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: frontB64 } },
  ];
  if (backB64) {
    content.push({ type: 'text', text: 'This is the back of the same check (endorsement side):' });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: backB64 } });
  }

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content }],
  });

  const textBlock = message.content.find(c => c.type === 'text');
  if (!textBlock) return { error: 'no text in response', raw: message };

  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
  if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
  if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);

  try {
    const data = JSON.parse(jsonStr.trim());
    return { data, raw: message };
  } catch (e) {
    return { error: 'JSON parse failed: ' + e.message, raw: message, text: jsonStr };
  }
}

async function fetchPendingRows() {
  let q = supabase
    .from('simmons_check_images')
    .select('id, deposit_id, image_index, image_type, amount, check_number, front_image_path, back_image_path, simmons_deposits!inner(deposit_date)')
    .eq('claude_extracted', false)
    .order('id', { ascending: true });

  if (SINCE) {
    q = q.gte('simmons_deposits.deposit_date', SINCE);
  }
  if (LIMIT < Infinity) {
    q = q.limit(LIMIT);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

(async () => {
  console.log(`🤖 Claude extraction (${DRY_RUN ? '🧪 DRY' : '✅ LIVE'} writes) — model: ${MODEL}`);
  if (SINCE) console.log(`   Since: ${SINCE}`);
  if (LIMIT < Infinity) console.log(`   Limit: ${LIMIT}`);

  const rows = await fetchPendingRows();
  console.log(`📥 ${rows.length} rows pending\n`);

  let ok = 0, fail = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const depositDate = r.simmons_deposits?.deposit_date || '?';
    const tag = `[${String(i + 1).padStart(3)}/${rows.length}] ${depositDate} img${r.image_index} $${r.amount}`;

    try {
      const result = await extractOne(r);
      if (result.error) {
        console.log(`${tag}  ❌ ${result.error}`);
        fail++;
        continue;
      }
      const d = result.data;
      const issuer = d.issuer || '?';
      const payer = d.payer_name || '?';
      console.log(`${tag}  ${d.check_type}/${issuer} ← ${payer} → ${d.payee || '?'}`);

      if (!DRY_RUN) {
        const { error: upErr } = await supabase
          .from('simmons_check_images')
          .update({
            claude_extracted: true,
            payee: d.payee,
            payer_name: d.payer_name,
            payer_address: d.payer_address,
            check_type: d.check_type,
            issuer: d.issuer,
            money_order_number: d.money_order_number,
            check_number: d.check_number ?? r.check_number,
            check_date: d.check_date,
            memo: d.memo,
            routing_number: d.routing_number,
            account_number_last4: d.account_number_last4,
            raw_claude_response: result.raw,
            extracted_at: new Date().toISOString(),
          })
          .eq('id', r.id);
        if (upErr) {
          console.log(`${tag}  ⚠️  update: ${upErr.message}`);
          fail++;
          continue;
        }
      }
      ok++;
      await sleep(250); // gentle rate-limit
    } catch (e) {
      console.log(`${tag}  ❌ ${e.message}`);
      fail++;
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Extracted: ${ok}`);
  console.log(`❌ Failed:    ${fail}`);
  process.exit(0);
})().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
