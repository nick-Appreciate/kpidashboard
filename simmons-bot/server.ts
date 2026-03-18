/**
 * Simmons Bank Check Image Scraper + Claude API Extraction Server
 *
 * Express REST API that:
 * 1. Logs into Simmons Bank via Playwright (username + password + TOTP)
 * 2. Scrapes deposit transactions and downloads check images
 * 3. Stores images in Supabase Storage
 * 4. Sends images to Claude API for structured data extraction
 * 5. Stores extracted data in Supabase tables
 *
 * Runs on Hostinger VPS alongside appfolio-bot (3100) and bpu-bot (3101).
 */

import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import {
  ensureBrowser,
  closeBrowser,
  isLoggedIn,
  login,
  scrapeDeposits,
  DepositInfo,
  CheckImageInfo,
} from './browser';
import { initClaude, extractCheckData, ExtractedCheckData } from './extractor';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3102');
const API_SECRET = process.env.API_SECRET || 'changeme';
const SIMMONS_USERNAME = process.env.SIMMONS_USERNAME || '';
const SIMMONS_PASSWORD = process.env.SIMMONS_PASSWORD || '';
const SIMMONS_TOTP_SECRET = process.env.SIMMONS_TOTP_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// ─── Scrape Mutex ────────────────────────────────────────────────────────

let scrapeInProgress = false;

// ─── Supabase Client ──────────────────────────────────────────────────────

let supabase: any = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log('   Supabase: ✓ configured');
} else {
  console.log('   Supabase: ⚠️  not configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY)');
}

// ─── Claude API ───────────────────────────────────────────────────────────

if (ANTHROPIC_API_KEY) {
  initClaude(ANTHROPIC_API_KEY);
  console.log('   Claude API: ✓ configured');
} else {
  console.log('   Claude API: ⚠️  not configured (set ANTHROPIC_API_KEY)');
}

// ─── Auth Middleware ──────────────────────────────────────────────────────

function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== API_SECRET) {
    return res.status(401).json({ error: 'Invalid API_SECRET' });
  }
  next();
}

app.use('/api', requireAuth);

// ─── Routes ──────────────────────────────────────────────────────────────

/**
 * GET /api/health
 */
app.get('/api/health', async (_req, res) => {
  try {
    const status = await isLoggedIn();
    res.json({
      ok: true,
      logged_in: status.loggedIn,
      current_url: status.url,
    });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/test-api
 * Debug: test the Banno API from the logged-in browser context.
 */
app.get('/api/test-api', async (_req, res) => {
  try {
    const p = await ensureBrowser();
    const userId = 'cb6aa36a-841f-4477-9811-a0c56216d221';
    const columbiaId = 'de5a245f-2cba-4067-9e0d-f5c88318033d';
    const base = 'https://login.simmonsbank.com/a/consumer/api';

    // Navigate to the account page so fetch works in the right origin
    await p.goto(`https://login.simmonsbank.com/account/${columbiaId}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await p.waitForTimeout(3000);

    // Debug: check current URL
    const currentUrl = p.url();
    const parsedUrl = new URL(currentUrl, 'https://login.simmonsbank.com');
    if (parsedUrl.pathname === '/login') {
      return res.json({ error: 'Not logged in after navigation', url: currentUrl });
    }

    // Get deposits via Banno API
    const txnApiUrl = `${base}/v0/users/${userId}/accounts/${columbiaId}/transactions?offset=0&limit=500`;

    const deposits = await p.evaluate(`(async () => {
      try {
        const r = await fetch('${txnApiUrl}');
        if (r.status !== 200) return { error: 'HTTP ' + r.status };
        const j = await r.json();
        return j.transactions
          .filter(t => t.memo && t.memo.includes('DEPOSIT') && t.hasProviderImages)
          .slice(0, 2)
          .map(t => ({ id: t.id, date: t.date, amount: t.amount, memo: t.memo, providerImageIds: t.providerImageIds, checkImageIds: t.checkImageIds }));
      } catch(e) { return { error: e.message }; }
    })()`) as any;

    if (deposits.error) {
      return res.json({ error: 'API fetch failed', details: deposits, url: currentUrl });
    }
    if (!deposits.length) {
      return res.json({ error: 'No deposits found' });
    }

    const dep = deposits[0];
    const depId = dep.id;
    const provId = dep.providerImageIds?.[0] || '';

    // Fetch check-image metadata
    const metaUrl = `${base}/users/${userId}/accounts/${columbiaId}/check-image/transaction/${depId}`;
    const meta = await p.evaluate(`(async () => {
      const r = await fetch('${metaUrl}');
      return await r.json();
    })()`);

    // Now test the actual image download URL with ?side= query param
    const metaObj = meta as any;
    const checkImages = metaObj?.checkImages || [];
    const imageResults: any[] = [];
    const imageBase = `${base}/users/${userId}/accounts/${columbiaId}/check-image`;

    for (const ci of checkImages.slice(0, 3)) {
      for (const side of ['front', 'back']) {
        const url = `${imageBase}/${ci.id}?side=${side}`;
        const result = await p.evaluate(`(async () => {
          try {
            const r = await fetch('${url}');
            const ct = r.headers.get('content-type') || '';
            const buf = await r.arrayBuffer();
            return { status: r.status, type: ct, size: buf.byteLength, isImage: ct.startsWith('image/') };
          } catch(e) { return { error: e.message }; }
        })()`);
        imageResults.push({ checkId: ci.id, amount: ci.amount, side, ...result as any });
      }
    }

    res.json({ deposit: dep, metadata: meta, imageResults });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/login
 * Automated login using TOTP (no manual intervention needed).
 */
app.post('/api/login', async (_req, res) => {
  try {
    const username = _req.body?.username || SIMMONS_USERNAME;
    const password = _req.body?.password || SIMMONS_PASSWORD;
    const totpSecret = _req.body?.totp_secret || SIMMONS_TOTP_SECRET;

    if (!username || !password || !totpSecret) {
      return res.status(400).json({
        error: 'Missing credentials. Set SIMMONS_USERNAME, SIMMONS_PASSWORD, SIMMONS_TOTP_SECRET env vars.',
      });
    }

    console.log('[api] Starting automated login...');
    const result = await login(username, password, totpSecret);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/scrape
 * Scrape deposits from one or all accounts, download images, extract with Claude, upload to Supabase.
 *
 * Body:
 * {
 *   account_suffix?: "x5218",      // specific account, or omit for all active
 *   start_date?: "2025-01-01",     // default: 30 days ago
 *   end_date?: "2025-12-31",       // default: today
 *   extract?: boolean,             // run Claude extraction (default: true)
 *   dry_run?: boolean              // if true, scrape but don't upload
 * }
 */
app.post('/api/scrape', async (req, res) => {
  try {
    const loginStatus = await isLoggedIn();
    if (!loginStatus.loggedIn) {
      return res.status(400).json({
        error: 'Not logged in. POST /api/login first.',
        current_url: loginStatus.url,
      });
    }

    const {
      account_suffix,
      start_date,
      end_date,
      extract = true,
      dry_run = false,
    } = req.body || {};

    // Get accounts to scrape
    const accounts = await getAccountsToScrape(account_suffix);
    if (accounts.length === 0) {
      return res.status(400).json({ error: 'No active accounts found.' });
    }

    const results: any[] = [];

    for (const account of accounts) {
      if (!account.account_url_id) {
        console.warn(`[api] Skipping ${account.account_name} — no URL ID configured`);
        continue;
      }

      console.log(`[api] Scraping ${account.account_name} (${account.account_suffix})...`);

      // Create scrape log entry
      const logId = await createScrapeLog(account.account_suffix, start_date ? 'backfill' : 'daily', start_date, end_date);

      try {
        const scrapeResult = await scrapeDeposits(
          account.account_url_id,
          start_date,
          end_date
        );

        if (!scrapeResult.success) {
          await updateScrapeLog(logId, 'failed', scrapeResult.error);
          results.push({
            account: account.account_suffix,
            success: false,
            error: scrapeResult.error,
          });
          continue;
        }

        const { deposits } = scrapeResult;
        console.log(`[api] ${account.account_name}: Found ${deposits.length} deposits`);

        let imagesDownloaded = 0;
        let imagesExtracted = 0;

        if (!dry_run && supabase) {
          for (const deposit of deposits) {
            // Upload deposit + images to Supabase
            const { depositId, imageIds } = await uploadDeposit(
              account.account_suffix,
              deposit
            );
            imagesDownloaded += deposit.images.length;

            // Run Claude extraction on check images (skip deposit slip)
            if (extract && ANTHROPIC_API_KEY) {
              for (let i = 0; i < deposit.images.length; i++) {
                const img = deposit.images[i];
                if (img.type === 'deposit_slip') continue;

                const imageId = imageIds[i];
                if (!imageId) continue;

                try {
                  const { data: extracted, raw_response } = await extractCheckData(
                    img.front_base64,
                    img.back_base64,
                    img.amount
                  );

                  await updateCheckExtraction(imageId, extracted, raw_response);
                  imagesExtracted++;
                  console.log(
                    `[api]   Image ${img.index}: ${extracted.check_type || 'unknown'} — ` +
                    `${extracted.payer_name || '?'} — MO# ${extracted.money_order_number || 'N/A'}`
                  );
                } catch (err: any) {
                  console.error(`[api]   Image ${img.index} extraction failed: ${err.message}`);
                }

                // Rate limit
                await new Promise((r) => setTimeout(r, 1200));
              }
            }
          }
        }

        await updateScrapeLog(logId, 'completed', undefined, deposits.length, imagesDownloaded, imagesExtracted);

        results.push({
          account: account.account_suffix,
          success: true,
          deposits_found: deposits.length,
          images_downloaded: imagesDownloaded,
          images_extracted: imagesExtracted,
        });
      } catch (err: any) {
        await updateScrapeLog(logId, 'failed', err.message);
        results.push({
          account: account.account_suffix,
          success: false,
          error: err.message,
        });
      }
    }

    res.json({ success: true, results });
  } catch (err: any) {
    console.error('[api] Scrape error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/scrape-async
 * Fire-and-forget version. Returns immediately, runs in background.
 */
app.post('/api/scrape-async', async (req, res) => {
  try {
    const loginStatus = await isLoggedIn();
    if (!loginStatus.loggedIn) {
      return res.status(400).json({
        triggered: false,
        error: 'Not logged in. POST /api/login first.',
      });
    }

    const body = req.body || {};

    if (scrapeInProgress) {
      return res.json({ triggered: false, reason: 'Scrape already in progress' });
    }

    res.json({ triggered: true, ...body });

    // Run in background
    runBackgroundScrape(body);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/extract
 * Re-run Claude extraction on images that haven't been extracted yet.
 * Useful for processing images downloaded in a previous scrape.
 */
app.post('/api/extract', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY not configured.' });
  }
  if (!supabase) {
    return res.status(400).json({ error: 'Supabase not configured.' });
  }

  const { limit = 50 } = req.body || {};

  try {
    // Get un-extracted check images
    const { data: checks, error } = await supabase
      .from('simmons_check_images')
      .select('id, front_image_path, back_image_path, amount, image_type')
      .eq('claude_extracted', false)
      .neq('image_type', 'deposit_slip')
      .limit(limit);

    if (error) throw error;
    if (!checks || checks.length === 0) {
      return res.json({ message: 'No un-extracted images found.', extracted: 0 });
    }

    res.json({ triggered: true, pending: checks.length });

    // Process in background
    (async () => {
      let extracted = 0;
      for (const check of checks) {
        try {
          // Download image from Supabase Storage
          const { data: frontData } = await supabase!.storage
            .from('simmons-checks')
            .download(check.front_image_path);

          if (!frontData) continue;

          const frontBase64 = Buffer.from(await frontData.arrayBuffer()).toString('base64');

          let backBase64: string | undefined;
          if (check.back_image_path) {
            const { data: backData } = await supabase!.storage
              .from('simmons-checks')
              .download(check.back_image_path);
            if (backData) {
              backBase64 = Buffer.from(await backData.arrayBuffer()).toString('base64');
            }
          }

          const { data: extractedData, raw_response } = await extractCheckData(
            frontBase64,
            backBase64,
            check.amount
          );

          await updateCheckExtraction(check.id, extractedData, raw_response);
          extracted++;
          console.log(
            `[extract] ✅ ${check.id}: ${extractedData.check_type} — MO# ${extractedData.money_order_number || 'N/A'}`
          );
        } catch (err: any) {
          console.error(`[extract] Error on ${check.id}: ${err.message}`);
        }

        await new Promise((r) => setTimeout(r, 1200));
      }
      console.log(`[extract] ✅ Done. Extracted ${extracted}/${checks.length} images.`);
    })();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/scrape-api
 * Scrape deposits via Banno REST API instead of UI automation.
 * Much faster and gets ALL historical deposits (not just visible in UI scroll).
 *
 * Body:
 * {
 *   account_suffix?: "x5218",   // specific account, or omit for all active
 *   limit?: 500,                // max transactions to fetch (default: 500)
 *   dry_run?: boolean           // if true, list deposits but don't upload
 * }
 */
app.post('/api/scrape-api', async (req, res) => {
  try {
    const loginStatus = await isLoggedIn();
    if (!loginStatus.loggedIn) {
      return res.status(400).json({ error: 'Not logged in. POST /api/login first.' });
    }

    const { account_suffix, limit: txnLimit = 500, dry_run = false } = req.body || {};
    const accounts = await getAccountsToScrape(account_suffix);
    if (accounts.length === 0) {
      return res.status(400).json({ error: 'No active accounts found.' });
    }

    // Respond immediately, run in background
    res.json({ triggered: true, accounts: accounts.map(a => a.account_suffix) });

    const p = await ensureBrowser();
    const base = 'https://login.simmonsbank.com/a/consumer/api';

    const userId = 'cb6aa36a-841f-4477-9811-a0c56216d221';

    for (const account of accounts) {
      if (!account.account_url_id) continue;
      const acctId = account.account_url_id;

      // Navigate to this account's page so fetch runs in the right context
      await p.goto('https://login.simmonsbank.com/account/' + acctId, {
        waitUntil: 'domcontentloaded', timeout: 30000,
      });
      await p.waitForTimeout(3000);

      const logId = await createScrapeLog(account.account_suffix, 'api-backfill');

      try {
        console.log(`[api-scrape] Fetching transactions for ${account.account_name}...`);

        // 1. Get all transactions
        const txnUrl = `${base}/v0/users/${userId}/accounts/${acctId}/transactions?offset=0&limit=${txnLimit}`;
        const txns = await p.evaluate(`(async () => {
          const r = await fetch('${txnUrl}');
          if (r.status !== 200) return { error: 'HTTP ' + r.status };
          const j = await r.json();
          return j.transactions
            .filter(t => t.memo && t.memo.includes('DEPOSIT') && t.hasProviderImages)
            .map(t => ({ id: t.id, date: t.date, amount: t.amount, memo: t.memo, providerImageIds: t.providerImageIds, checkImageIds: t.checkImageIds }));
        })()`) as any;

        if (txns.error) {
          console.error(`[api-scrape] ${account.account_name}: API error:`, txns.error);
          await updateScrapeLog(logId, 'failed', txns.error);
          continue;
        }

        console.log(`[api-scrape] ${account.account_name}: Found ${txns.length} deposits with images`);
        let imagesUploaded = 0;
        let depositsProcessed = 0;

        for (const txn of txns) {
          try {
            // 2. Get check image metadata for this deposit
            const metaUrl = `${base}/users/${userId}/accounts/${acctId}/check-image/transaction/${txn.id}`;
            const meta = await p.evaluate(`(async () => {
              try {
                const r = await fetch('${metaUrl}');
                return await r.json();
              } catch(e) { return { error: e.message }; }
            })()`) as any;

            if (meta.error || !meta.checkImages || meta.checkImages.length === 0) {
              console.log(`[api-scrape]   ${txn.date.substring(0, 10)} $${txn.amount}: no check images`);
              continue;
            }

            const depositDate = txn.date.substring(0, 10);
            console.log(`[api-scrape]   ${depositDate} $${txn.amount}: ${meta.checkImages.length} images`);

            if (dry_run) {
              depositsProcessed++;
              imagesUploaded += meta.checkImages.length;
              continue;
            }

            // Build DepositInfo compatible with uploadDeposit
            const images: CheckImageInfo[] = [];
            for (let i = 0; i < meta.checkImages.length; i++) {
              const ci = meta.checkImages[i];
              const isDeposit = parseFloat(ci.amount) > 0;

              // 3. Download front + back images
              const frontUrl = `${base}/users/${userId}/accounts/${acctId}/check-image/${ci.id}?side=front`;
              const backUrl = `${base}/users/${userId}/accounts/${acctId}/check-image/${ci.id}?side=back`;

              const frontB64 = await p.evaluate(`(async () => {
                try {
                  const r = await fetch('${frontUrl}');
                  if (r.status !== 200) return null;
                  const buf = await r.arrayBuffer();
                  const bytes = new Uint8Array(buf);
                  let binary = '';
                  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                  return btoa(binary);
                } catch(e) { return null; }
              })()`) as string | null;

              const backB64 = await p.evaluate(`(async () => {
                try {
                  const r = await fetch('${backUrl}');
                  if (r.status !== 200) return null;
                  const buf = await r.arrayBuffer();
                  const bytes = new Uint8Array(buf);
                  let binary = '';
                  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                  return btoa(binary);
                } catch(e) { return null; }
              })()`) as string | null;

              if (!frontB64) {
                console.log(`[api-scrape]     Image ${i + 1}: failed to download front`);
                continue;
              }

              images.push({
                index: i + 1,
                type: isDeposit ? 'deposit_slip' : 'check',
                amount: ci.amount,
                front_base64: frontB64,
                back_base64: backB64 || undefined,
              } as CheckImageInfo);
            }

            if (images.length > 0 && supabase) {
              await uploadDepositByTxnId(account.account_suffix, txn.id, depositDate, txn.amount, images);
              depositsProcessed++;
              imagesUploaded += images.length;
              console.log(`[api-scrape]     ✅ Uploaded ${images.length} images`);
            }

            // Small delay between deposits to avoid rate limiting
            await new Promise(r => setTimeout(r, 500));
          } catch (err: any) {
            console.error(`[api-scrape]   Error on ${txn.date}: ${err.message}`);
          }
        }

        const status = depositsProcessed > 0 ? 'completed' : 'failed';
        await updateScrapeLog(logId, status, undefined, depositsProcessed, imagesUploaded, 0);
        console.log(`[api-scrape] ✅ ${account.account_name}: ${depositsProcessed} deposits, ${imagesUploaded} images`);
      } catch (err: any) {
        console.error(`[api-scrape] ${account.account_name} error:`, err.message);
        await updateScrapeLog(logId, 'failed', err.message);
      }
    }

    console.log('[api-scrape] ✅ All accounts done.');
  } catch (err: any) {
    console.error('[api-scrape] Error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ─── Background Scrape (shared by API + watchdog) ────────────────────────

async function runBackgroundScrape(opts: {
  account_suffix?: string;
  start_date?: string;
  end_date?: string;
  extract?: boolean;
  dry_run?: boolean;
} = {}): Promise<void> {
  if (scrapeInProgress) {
    console.log('[scrape] Skipping — scrape already in progress');
    return;
  }
  scrapeInProgress = true;
  try {
    const accounts = await getAccountsToScrape(opts.account_suffix);
    for (const account of accounts) {
      if (!account.account_url_id) continue;
      console.log(`[async-scrape] Processing ${account.account_name}...`);

      const logId = await createScrapeLog(account.account_suffix, opts.start_date ? 'backfill' : 'daily', opts.start_date, opts.end_date);

      const result = await scrapeDeposits(
        account.account_url_id,
        opts.start_date,
        opts.end_date
      );

      let imagesDownloaded = 0;
      let imagesExtracted = 0;

      if (!result.success && result.deposits.length === 0) {
        await updateScrapeLog(logId, 'failed', result.error);
        continue;
      }

      if (supabase) {
        for (const deposit of result.deposits) {
          const { depositId, imageIds } = await uploadDeposit(
            account.account_suffix,
            deposit
          );
          imagesDownloaded += deposit.images.length;

          if (opts.extract !== false && ANTHROPIC_API_KEY) {
            for (let i = 0; i < deposit.images.length; i++) {
              const img = deposit.images[i];
              if (img.type === 'deposit_slip') continue;

              const imageId = imageIds[i];
              if (!imageId) continue;

              try {
                const { data: extracted, raw_response } = await extractCheckData(
                  img.front_base64,
                  img.back_base64,
                  img.amount
                );
                await updateCheckExtraction(imageId, extracted, raw_response);
                imagesExtracted++;
              } catch (err: any) {
                console.error(`[async-scrape] Extraction error: ${err.message}`);
              }

              await new Promise((r) => setTimeout(r, 1200));
            }
          }
        }
      }

      const logStatus = result.success ? 'completed' : 'partial';
      await updateScrapeLog(logId, logStatus, result.error, result.deposits.length, imagesDownloaded, imagesExtracted);
      console.log(
        `[async-scrape] ${result.success ? '✅' : '⚠️'} ${account.account_name}: ${result.deposits.length} deposits, ${imagesDownloaded} images, ${imagesExtracted} extracted`
      );
    }
  } catch (err: any) {
    console.error('[async-scrape] Background error:', err.message);
  } finally {
    scrapeInProgress = false;
  }
}

// ─── Supabase Helpers ─────────────────────────────────────────────────────

async function getAccountsToScrape(
  suffix?: string
): Promise<Array<{ account_name: string; account_suffix: string; account_url_id: string | null }>> {
  if (!supabase) {
    // Fallback to hardcoded accounts if Supabase not configured
    const accounts = [
      { account_name: 'Columbia', account_suffix: 'x5218', account_url_id: 'de5a245f-2cba-4067-9e0d-f5c88318033d' },
    ];
    if (suffix) return accounts.filter((a) => a.account_suffix === suffix);
    return accounts;
  }

  let query = supabase
    .from('simmons_accounts')
    .select('account_name, account_suffix, account_url_id')
    .eq('status', 'active');

  if (suffix) query = query.eq('account_suffix', suffix);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function createScrapeLog(
  accountSuffix: string,
  scrapeType: string,
  startDate?: string,
  endDate?: string
): Promise<string | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('simmons_scrape_log')
    .insert({
      account_suffix: accountSuffix,
      scrape_type: scrapeType,
      start_date: startDate || null,
      end_date: endDate || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[supabase] Failed to create scrape log:', error.message);
    return null;
  }
  return data?.id || null;
}

async function updateScrapeLog(
  logId: string | null,
  status: string,
  errorMessage?: string,
  depositsFound?: number,
  imagesDownloaded?: number,
  imagesExtracted?: number
): Promise<void> {
  if (!supabase || !logId) return;

  await supabase
    .from('simmons_scrape_log')
    .update({
      status,
      error_message: errorMessage || null,
      deposits_found: depositsFound,
      images_downloaded: imagesDownloaded,
      images_extracted: imagesExtracted,
      completed_at: new Date().toISOString(),
    })
    .eq('id', logId);
}

async function uploadDeposit(
  accountSuffix: string,
  deposit: DepositInfo
): Promise<{ depositId: string; imageIds: (string | null)[] }> {
  if (!supabase) return { depositId: '', imageIds: [] };

  // Upsert the deposit
  const { data: depData, error: depError } = await supabase
    .from('simmons_deposits')
    .upsert(
      {
        account_suffix: accountSuffix,
        deposit_date: deposit.date,
        amount: deposit.amount,
        balance_after: deposit.balance_after,
        image_count: deposit.image_count,
        branch_name: deposit.branch_name || null,
        teller_id: deposit.teller_id || null,
        workstation: deposit.workstation || null,
        hin_number: deposit.hin_number || null,
      },
      { onConflict: 'account_suffix,deposit_date,amount' }
    )
    .select('id')
    .single();

  if (depError) {
    console.error('[supabase] Deposit upsert error:', depError.message);
    throw depError;
  }

  const depositId = depData.id;
  const imageIds: (string | null)[] = [];

  // Upload each image
  for (const img of deposit.images) {
    try {
      // Upload front image to Supabase Storage
      const frontPath = `${accountSuffix}/${deposit.date}/${depositId}/img${img.index}_front.png`;
      const frontBuffer = Buffer.from(img.front_base64, 'base64');

      await supabase.storage
        .from('simmons-checks')
        .upload(frontPath, frontBuffer, {
          contentType: 'image/png',
          upsert: true,
        });

      // Upload back image if available
      let backPath: string | null = null;
      if (img.back_base64) {
        backPath = `${accountSuffix}/${deposit.date}/${depositId}/img${img.index}_back.png`;
        const backBuffer = Buffer.from(img.back_base64, 'base64');
        await supabase.storage
          .from('simmons-checks')
          .upload(backPath, backBuffer, {
            contentType: 'image/png',
            upsert: true,
          });
      }

      // Upsert the check image record
      const { data: imgData, error: imgError } = await supabase
        .from('simmons_check_images')
        .upsert(
          {
            deposit_id: depositId,
            image_index: img.index,
            amount: img.amount,
            image_type: img.type,
            front_image_path: frontPath,
            back_image_path: backPath,
          },
          { onConflict: 'deposit_id,image_index' }
        )
        .select('id')
        .single();

      if (imgError) {
        console.error(`[supabase] Image ${img.index} upsert error:`, imgError.message);
        imageIds.push(null);
      } else {
        imageIds.push(imgData.id);
      }
    } catch (err: any) {
      console.error(`[supabase] Image ${img.index} upload error:`, err.message);
      imageIds.push(null);
    }
  }

  return { depositId, imageIds };
}

async function uploadDepositByTxnId(
  accountSuffix: string,
  transactionId: string,
  depositDate: string,
  amount: string,
  images: CheckImageInfo[]
): Promise<void> {
  if (!supabase) return;

  const { data: depData, error: depError } = await supabase
    .from('simmons_deposits')
    .upsert(
      {
        account_suffix: accountSuffix,
        transaction_id: transactionId,
        deposit_date: depositDate,
        amount: parseFloat(amount),
        image_count: images.length,
      },
      { onConflict: 'transaction_id' }
    )
    .select('id')
    .single();

  if (depError) throw new Error('Deposit upsert: ' + depError.message);
  const depositId = depData.id;

  for (const img of images) {
    try {
      const frontPath = `${accountSuffix}/${depositDate}/${depositId}/img${img.index}_front.png`;
      await supabase.storage.from('simmons-checks').upload(
        frontPath, Buffer.from(img.front_base64, 'base64'),
        { contentType: 'image/png', upsert: true }
      );

      let backPath: string | null = null;
      if (img.back_base64) {
        backPath = `${accountSuffix}/${depositDate}/${depositId}/img${img.index}_back.png`;
        await supabase.storage.from('simmons-checks').upload(
          backPath, Buffer.from(img.back_base64, 'base64'),
          { contentType: 'image/png', upsert: true }
        );
      }

      await supabase.from('simmons_check_images').upsert(
        {
          deposit_id: depositId,
          image_index: img.index,
          amount: img.amount,
          image_type: img.type,
          front_image_path: frontPath,
          back_image_path: backPath,
        },
        { onConflict: 'deposit_id,image_index' }
      );
    } catch (err: any) {
      console.error(`[supabase] Image ${img.index} error: ${err.message}`);
    }
  }
}

async function updateCheckExtraction(
  imageId: string,
  data: ExtractedCheckData,
  rawResponse: any
): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from('simmons_check_images')
    .update({
      claude_extracted: true,
      payee: data.payee,
      payer_name: data.payer_name,
      payer_address: data.payer_address,
      check_type: data.check_type,
      issuer: data.issuer,
      money_order_number: data.money_order_number,
      check_number: data.check_number,
      check_date: data.check_date,
      memo: data.memo,
      routing_number: data.routing_number,
      account_number_last4: data.account_number_last4,
      raw_claude_response: rawResponse,
      extracted_at: new Date().toISOString(),
    })
    .eq('id', imageId);

  if (error) {
    console.error(`[supabase] Extraction update error for ${imageId}:`, error.message);
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await closeBrowser().catch(() => {});
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  await closeBrowser().catch(() => {});
  process.exit(0);
});

// ─── Start ────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`\n🏦 Simmons Bank Bot running on port ${PORT}`);
  console.log(
    `   API Secret: ${API_SECRET === 'changeme' ? '⚠️  DEFAULT (set API_SECRET env var!)' : '✓ set'}`
  );
  console.log(`   Username: ${SIMMONS_USERNAME || '⚠️  not set'}`);
  console.log(`   TOTP: ${SIMMONS_TOTP_SECRET ? '✓ set' : '⚠️  not set'}`);
  console.log('');

  // Pre-warm browser
  await ensureBrowser();

  // Check session status
  const status = await isLoggedIn();
  console.log(
    `   Session: ${status.loggedIn ? '✅ Active' : '⚠️  Not logged in → POST /api/login'}`
  );
  console.log('');

  // ─── Self-Healing Session Watchdog ───────────────────────────────────
  // Checks session every 30 minutes and auto-relogins via TOTP if expired.
  // After successful re-login, triggers a background scrape to clear stale data.
  const WATCHDOG_INTERVAL = 30 * 60 * 1000; // 30 minutes
  setInterval(async () => {
    try {
      const watchdogStatus = await isLoggedIn();
      if (watchdogStatus.loggedIn) {
        console.log('[watchdog] Session active ✓');
        return;
      }

      console.warn('[watchdog] Session expired — attempting auto-login via TOTP...');
      const loginResult = await login(SIMMONS_USERNAME, SIMMONS_PASSWORD, SIMMONS_TOTP_SECRET);

      if (loginResult.success) {
        console.log('[watchdog] ✅ Re-login successful, triggering background scrape...');
        runBackgroundScrape();
      } else {
        console.error('[watchdog] Re-login failed:', loginResult.message || loginResult.error);
      }
    } catch (err: any) {
      console.error('[watchdog] Error:', err.message);
    }
  }, WATCHDOG_INTERVAL);
  console.log(`   Watchdog: ✓ session check every ${WATCHDOG_INTERVAL / 60000} min`);
});

export default app;
