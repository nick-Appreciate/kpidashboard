/**
 * capture.mjs
 * Standalone Simmons Bank deposit/check-image scraper.
 *
 * Connects to your real Chrome via CDP (which must already be open and logged
 * into Simmons), then iterates through every deposit in the Columbia account,
 * downloads the front + back of every check image, and uploads to Supabase
 * (storage bucket `simmons-checks`, tables `simmons_deposits` and
 * `simmons_check_images`).
 *
 * Setup (one-time):
 *   1) Launch a CDP-enabled Chrome with a dedicated debug profile:
 *        open -na "Google Chrome" --args --remote-debugging-port=9222 \
 *          --user-data-dir="$HOME/.chrome-debug-profile"
 *   2) Log into Simmons in that window (login.simmonsbank.com).
 *
 * Run:
 *   node capture.mjs            # uploads to Supabase
 *   node capture.mjs --dry-run  # downloads + prints, no Supabase writes
 *   node capture.mjs --limit 5  # only first 5 deposits (for smoke-test)
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

loadEnv({ path: fileURLToPath(new URL('./.env', import.meta.url)), override: true });

const CDP_URL  = 'http://localhost:9222';
const DRY_RUN  = process.argv.includes('--dry-run');
const FORCE    = process.argv.includes('--force');  // re-upload even if already in DB
const LIMIT_I  = process.argv.indexOf('--limit');
const LIMIT    = LIMIT_I >= 0 ? Number(process.argv[LIMIT_I + 1]) : Infinity;
const OUT_DIR  = '/tmp/simmons-capture';
try { mkdirSync(OUT_DIR, { recursive: true }); } catch {}

// Columbia account — extend when we add Como later
const ACCOUNTS = [
  { id: 'de5a245f-2cba-4067-9e0d-f5c88318033d', name: 'Columbia', suffix: 'x5218' },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Supabase setup ────────────────────────────────────────────────────────
let supabase = null;
if (!DRY_RUN) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_KEY missing in .env');
    process.exit(1);
  }
  supabase = createClient(url, key, { auth: { persistSession: false } });
}

// ── In-page fetch helpers (uses session cookies) ──────────────────────────
async function fetchJson(page, url) {
  return await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    if (!r.ok) return { __error: `HTTP ${r.status}`, __status: r.status };
    return await r.json();
  }, url);
}

class SessionExpiredError extends Error {
  constructor() { super('Banno session expired (HTTP 401). Refresh Chrome tab and re-run.'); }
}

async function fetchImageBytes(page, url) {
  const bytes = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  }, url);
  return bytes ? Buffer.from(bytes) : null;
}

// ── Discover userId from performance entries ──────────────────────────────
async function discoverUserId(page) {
  return await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource');
    for (const e of entries) {
      const m = e.name.match(/\/api\/(?:v0\/)?users\/([0-9a-f-]{36})\b/);
      if (m) return m[1];
    }
    return null;
  });
}

// ── Supabase wrapper: retry on transient fetch failures ───────────────────
async function withRetry(label, fn, attempts = 4) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts) await sleep(1200 * i); // 1.2s, 2.4s, 3.6s
    }
  }
  throw new Error(`${label} (after ${attempts} tries): ${lastErr?.message || lastErr}`);
}

// ── Upload a deposit + its check images to Supabase ───────────────────────
async function uploadDeposit({ accountSuffix, txnId, depositDate, amount, images }) {
  if (!supabase) return null;

  // 1) Clean up any stale NULL-transaction_id duplicate for this (account, date, amount).
  // Old bot inserted rows with txid=NULL; without removing them we'd end up with
  // 2 rows pointing to the same deposit (one with logos, one real).
  const { data: dupes } = await withRetry('lookup dupes', () =>
    supabase
      .from('simmons_deposits')
      .select('id')
      .eq('account_suffix', accountSuffix)
      .eq('deposit_date', depositDate)
      .eq('amount', parseFloat(amount))
      .is('transaction_id', null)
  );
  if (dupes && dupes.length > 0) {
    const dupIds = dupes.map(d => d.id);
    // delete linked check_image rows first (FK), then the deposit rows
    await withRetry('delete dup images', () =>
      supabase.from('simmons_check_images').delete().in('deposit_id', dupIds)
    );
    await withRetry('delete dup deposits', () =>
      supabase.from('simmons_deposits').delete().in('id', dupIds)
    );
    console.log(`     🧹 cleaned ${dupIds.length} stale duplicate row(s)`);
  }

  const dep = await withRetry('deposit upsert', async () => {
    const { data, error } = await supabase
      .from('simmons_deposits')
      .upsert(
        {
          account_suffix: accountSuffix,
          transaction_id: txnId,
          deposit_date: depositDate,
          amount: parseFloat(amount),
          image_count: images.length,
        },
        { onConflict: 'transaction_id' }
      )
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return data;
  });
  const depositId = dep.id;

  for (const img of images) {
    const frontPath = `${accountSuffix}/${depositDate}/${depositId}/img${img.index}_front.png`;
    await withRetry(`upload front img${img.index}`, async () => {
      const { error: fErr } = await supabase.storage
        .from('simmons-checks')
        .upload(frontPath, img.frontBytes, { contentType: 'image/png', upsert: true });
      if (fErr) throw new Error(fErr.message);
    });

    let backPath = null;
    if (img.backBytes) {
      backPath = `${accountSuffix}/${depositDate}/${depositId}/img${img.index}_back.png`;
      await withRetry(`upload back img${img.index}`, async () => {
        const { error: bErr } = await supabase.storage
          .from('simmons-checks')
          .upload(backPath, img.backBytes, { contentType: 'image/png', upsert: true });
        if (bErr) throw new Error(bErr.message);
      });
    }

    const isDepositSlip = parseFloat(img.amount) > 0;
    const { error: ciErr } = await supabase
      .from('simmons_check_images')
      .upsert(
        {
          deposit_id: depositId,
          image_index: img.index,
          amount: img.amount,
          image_type: isDepositSlip ? 'deposit_slip' : 'check',
          check_number: img.checkNumber,
          front_image_path: frontPath,
          back_image_path: backPath,
        },
        { onConflict: 'deposit_id,image_index' }
      );
    if (ciErr) throw new Error(`check_image upsert: ${ciErr.message}`);
  }

  // Mark deposit as fully captured (only after all images uploaded cleanly).
  // If any image upload failed above, we threw and never reach this line, so
  // images_captured_at stays NULL → next run will retry this deposit.
  await withRetry('mark captured', async () => {
    const { error } = await supabase
      .from('simmons_deposits')
      .update({ images_captured_at: new Date().toISOString() })
      .eq('id', depositId);
    if (error) throw new Error(error.message);
  });

  return depositId;
}

// ── Main ──────────────────────────────────────────────────────────────────
(async () => {
  console.log(`🔗 Connecting to Chrome via CDP at ${CDP_URL}...`);
  console.log(`   Mode: ${DRY_RUN ? '🧪 DRY RUN' : '✅ LIVE (Supabase writes ON)'}`);
  if (LIMIT < Infinity) console.log(`   Limit: ${LIMIT} deposits`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (e) {
    console.error('❌ Could not connect. Is Chrome running with --remote-debugging-port=9222?');
    process.exit(1);
  }

  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('simmonsbank.com'));
  if (!page) {
    console.error('❌ No Simmons tab open. Log into login.simmonsbank.com first.');
    process.exit(1);
  }

  // Make sure we're past login (URL pathname is /login or starts with /login/ on the login page)
  const { pathname } = new URL(page.url());
  if (pathname === '/login' || pathname.startsWith('/login/')) {
    console.error('❌ Tab is on the login page — log in first.');
    process.exit(1);
  }

  const userId = await discoverUserId(page);
  if (!userId) {
    console.log('   No userId in performance entries — reloading to trigger API calls...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(3500);
  }
  const finalUserId = await discoverUserId(page);
  if (!finalUserId) {
    console.error('❌ Could not discover userId. Reload the Simmons tab manually and try again.');
    process.exit(1);
  }
  console.log(`✅ userId: ${finalUserId}`);

  const summary = { accounts: [], depositsProcessed: 0, imagesUploaded: 0, errors: 0 };

  for (const account of ACCOUNTS) {
    console.log(`\n📂 Account: ${account.name} (${account.suffix})`);

    // 1) Fetch transactions
    const txnUrl = `/a/consumer/api/v0/users/${finalUserId}/accounts/${account.id}/transactions?offset=0&limit=500`;
    const txData = await fetchJson(page, txnUrl);
    if (txData.__error) {
      console.error(`   ❌ transactions fetch: ${txData.__error}`);
      summary.errors++;
      continue;
    }
    const allTxns = txData.transactions || [];
    console.log(`   ${allTxns.length} total transactions`);

    // 2) Filter for deposits with images
    const deposits = allTxns.filter(t =>
      t.memo &&
      /DEPOSIT/.test(t.memo) &&
      !/INTEREST/.test(t.memo) &&
      t.hasProviderImages
    );
    console.log(`   ${deposits.length} deposits flagged with check images`);

    // Skip already-CAPTURED deposits (unless --force).
    // We look at images_captured_at — set only after ALL images uploaded
    // cleanly. Partial/failed deposits stay with NULL and will be retried.
    let capturedIds = new Set();
    if (!DRY_RUN && !FORCE && supabase) {
      const { data, error } = await supabase
        .from('simmons_deposits')
        .select('transaction_id')
        .eq('account_suffix', account.suffix)
        .not('images_captured_at', 'is', null);
      if (error) {
        console.error(`   ⚠️  could not query captured: ${error.message}`);
      } else {
        capturedIds = new Set((data || []).map(d => d.transaction_id).filter(Boolean));
        console.log(`   ${capturedIds.size} fully captured already — will skip`);
      }
    }

    const pending = deposits.filter(t => !capturedIds.has(t.id));
    const toProcess = pending.slice(0, Math.min(LIMIT, pending.length));
    console.log(`   Processing ${toProcess.length} ${toProcess.length === pending.length ? '' : `(limited from ${pending.length})`}\n`);

    for (let i = 0; i < toProcess.length; i++) {
      const txn = toProcess[i];
      const depositDate = txn.date.slice(0, 10);
      const prefix = `   [${String(i + 1).padStart(3)}/${toProcess.length}] ${depositDate} $${txn.amount}`;

      try {
        // 3) Fetch check image metadata
        const metaUrl = `/a/consumer/api/users/${finalUserId}/accounts/${account.id}/check-image/transaction/${txn.id}`;
        const meta = await fetchJson(page, metaUrl);
        if (meta.__status === 401) throw new SessionExpiredError();
        if (meta.__error || !meta.checkImages || meta.checkImages.length === 0) {
          console.log(`${prefix}  (no images) ${meta.__error || ''}`);
          continue;
        }

        console.log(`${prefix}  ${meta.checkImages.length} image(s)`);

        // 4) Download front + back of each image
        const images = [];
        for (let j = 0; j < meta.checkImages.length; j++) {
          const ci = meta.checkImages[j];
          const imgIdx = j + 1;
          const baseUrl = `/a/consumer/api/users/${finalUserId}/accounts/${account.id}/check-image/${ci.id}`;
          const frontBytes = await fetchImageBytes(page, `${baseUrl}?side=front`);
          const backBytes  = await fetchImageBytes(page, `${baseUrl}?side=back`);
          if (!frontBytes) {
            console.log(`${prefix}     img${imgIdx}: front fetch failed, skipping`);
            continue;
          }
          images.push({
            index: imgIdx,
            amount: ci.amount,
            checkNumber: ci.checkNumber || null,
            frontBytes,
            backBytes,
          });

          if (DRY_RUN) {
            const dir = `${OUT_DIR}/${account.suffix}/${depositDate}/${txn.id}`;
            mkdirSync(dir, { recursive: true });
            writeFileSync(`${dir}/img${imgIdx}_front.png`, frontBytes);
            if (backBytes) writeFileSync(`${dir}/img${imgIdx}_back.png`, backBytes);
          }
        }

        if (DRY_RUN) {
          console.log(`${prefix}     dry-run: ${images.length} images written to ${OUT_DIR}`);
        } else {
          await uploadDeposit({
            accountSuffix: account.suffix,
            txnId: txn.id,
            depositDate,
            amount: txn.amount,
            images,
          });
          console.log(`${prefix}     ✅ uploaded ${images.length} images`);
        }

        summary.depositsProcessed++;
        summary.imagesUploaded += images.length;
        await sleep(800); // be gentle on Banno — 200ms killed the session after ~20 deposits
      } catch (e) {
        if (e instanceof SessionExpiredError) {
          console.error(`\n${prefix}  ⛔ ${e.message}`);
          console.error('   Stopping early. Refresh the Simmons tab in Chrome and re-run capture.mjs.');
          summary.errors++;
          summary.accounts.push({ name: account.name, totalDeposits: deposits.length, processed: i });
          throw e; // bubble out of both loops
        }
        console.error(`${prefix}  ❌ ${e.message}`);
        summary.errors++;
      }
    }

    summary.accounts.push({ name: account.name, totalDeposits: deposits.length, processed: toProcess.length });
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ DONE');
  console.log(`   Accounts processed: ${summary.accounts.length}`);
  console.log(`   Deposits processed: ${summary.depositsProcessed}`);
  console.log(`   Images uploaded:    ${summary.imagesUploaded}`);
  console.log(`   Errors:             ${summary.errors}`);
  if (DRY_RUN) console.log(`   📁 Local output:    ${OUT_DIR}/`);
  process.exit(0);
})().catch(e => {
  if (e.message?.includes('session expired')) {
    console.error('\n' + e.message);
    process.exit(2);
  }
  console.error('\nFatal:', e);
  process.exit(1);
});
