import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import {
  ensureBrowser,
  closeBrowser,
  isLoggedIn,
  interactiveLogin,
  scrapeUsageData,
  MeterReading,
} from './browser';
import {
  ensureComoBrowser,
  closeComoBrowser,
  isComoLoggedIn,
  interactiveComoLogin,
  scrapeComoData,
  ComoMeterReading,
} from './como-browser';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3101');
const API_SECRET = process.env.API_SECRET || 'changeme';
const BPU_USERNAME = process.env.BPU_USERNAME || '';
const BPU_PASSWORD = process.env.BPU_PASSWORD || '';
const COMO_USERNAME = process.env.COMO_USERNAME || '';
const COMO_PASSWORD = process.env.COMO_PASSWORD || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// ─── Supabase Client ──────────────────────────────────────────────────────

let supabase: ReturnType<typeof createClient> | null = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log('   Supabase: ✓ configured');
} else {
  console.log('   Supabase: ⚠️  not configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY)');
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

// ─── Routes ───────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Check if both BPU and COMO browsers are running and sessions are valid.
 */
app.get('/api/health', async (_req, res) => {
  try {
    const [bpuStatus, comoStatus] = await Promise.all([
      isLoggedIn(),
      isComoLoggedIn().catch((err: any) => ({ loggedIn: false, url: `error: ${err.message}` })),
    ]);
    res.json({
      ok: true,
      bpu: { logged_in: bpuStatus.loggedIn, current_url: bpuStatus.url },
      como: { logged_in: comoStatus.loggedIn, current_url: comoStatus.url },
      // Legacy fields for backward compat
      logged_in: bpuStatus.loggedIn,
      current_url: bpuStatus.url,
    });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/login
 * Start interactive login in visible browser.
 * User must solve CAPTCHA in the browser window.
 */
app.post('/api/login', async (_req, res) => {
  try {
    const email = _req.body?.email || BPU_USERNAME;
    const password = _req.body?.password || BPU_PASSWORD;

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: 'Missing email/password in body or env vars' });
    }

    console.log('[api] Starting interactive login...');
    const result = await interactiveLogin(email, password);

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/scrape
 * Trigger BPU scrape: download CSV → parse → upload to Supabase.
 *
 * Body (optional):
 * {
 *   start_date?: "YYYY-MM-DD",  // default: 14 days ago
 *   end_date?: "YYYY-MM-DD",    // default: today
 *   dry_run?: boolean            // if true, parse but don't upload
 * }
 */
app.post('/api/scrape', async (req, res) => {
  try {
    // Check login status first
    const loginStatus = await isLoggedIn();
    if (!loginStatus.loggedIn) {
      return res.status(400).json({
        error: 'Not logged in. Run `npm run login` or POST /api/login first.',
        current_url: loginStatus.url,
      });
    }

    const { start_date, end_date, dry_run } = req.body || {};

    console.log('[api] Starting scrape...');
    const scrapeResult = await scrapeUsageData(start_date, end_date);

    if (!scrapeResult.success) {
      return res.status(500).json({
        success: false,
        error: scrapeResult.error,
        records_parsed: 0,
        records_uploaded: 0,
      });
    }

    const records = scrapeResult.records;
    console.log(`[api] Parsed ${records.length} records.`);

    // Upload to Supabase (unless dry_run)
    let recordsUploaded = 0;
    let uploadError: string | undefined;

    if (dry_run) {
      console.log('[api] Dry run — skipping Supabase upload.');
    } else if (!supabase) {
      uploadError = 'Supabase not configured. Records parsed but not uploaded.';
      console.warn('[api]', uploadError);
    } else if (records.length > 0) {
      try {
        recordsUploaded = await uploadToSupabase(records);
        console.log(`[api] Uploaded ${recordsUploaded} records to Supabase.`);
      } catch (err: any) {
        uploadError = `Supabase upload error: ${err.message}`;
        console.error('[api]', uploadError);
      }
    }

    res.json({
      success: true,
      records_parsed: records.length,
      records_uploaded: recordsUploaded,
      upload_error: uploadError,
      sample: records.slice(0, 3), // First 3 records for debugging
    });
  } catch (err: any) {
    console.error('[api] Scrape error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── COMO Routes ─────────────────────────────────────────────────────────

/**
 * POST /api/como/login
 * Start interactive login for COMO MyMeter portal.
 */
app.post('/api/como/login', async (_req, res) => {
  try {
    const email = _req.body?.email || COMO_USERNAME;
    const password = _req.body?.password || COMO_PASSWORD;

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: 'Missing email/password in body or COMO_USERNAME/COMO_PASSWORD env vars' });
    }

    console.log('[api] Starting COMO interactive login...');
    const result = await interactiveComoLogin(email, password);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/como/scrape
 * Scrape all COMO properties: iterate properties → download CSV → parse → upload.
 *
 * Body (optional):
 * {
 *   start_date?: "YYYY-MM-DD",  // default: 3 years ago
 *   end_date?: "YYYY-MM-DD",    // default: today
 *   dry_run?: boolean
 * }
 */
app.post('/api/como/scrape', async (req, res) => {
  try {
    const comoStatus = await isComoLoggedIn();
    if (!comoStatus.loggedIn) {
      return res.status(400).json({
        error: 'COMO not logged in. POST /api/como/login first.',
        current_url: comoStatus.url,
      });
    }

    const { start_date, end_date, dry_run } = req.body || {};

    console.log('[api] Starting COMO scrape...');
    const scrapeResult = await scrapeComoData(start_date, end_date);

    if (!scrapeResult.success) {
      return res.status(500).json({
        success: false,
        error: scrapeResult.error,
        records_parsed: scrapeResult.records.length,
        properties_scraped: scrapeResult.properties_scraped,
        records_uploaded: 0,
      });
    }

    const records = scrapeResult.records;
    console.log(`[api] COMO: Parsed ${records.length} records from ${scrapeResult.properties_scraped} properties.`);

    let recordsUploaded = 0;
    let uploadError: string | undefined;

    if (dry_run) {
      console.log('[api] Dry run — skipping Supabase upload.');
    } else if (!supabase) {
      uploadError = 'Supabase not configured.';
    } else if (records.length > 0) {
      try {
        recordsUploaded = await uploadComoToSupabase(records);
        console.log(`[api] COMO: Uploaded ${recordsUploaded} records to Supabase.`);
      } catch (err: any) {
        uploadError = `Supabase upload error: ${err.message}`;
        console.error('[api]', uploadError);
      }
    }

    res.json({
      success: true,
      records_parsed: records.length,
      properties_scraped: scrapeResult.properties_scraped,
      records_uploaded: recordsUploaded,
      upload_error: uploadError,
      sample: records.slice(0, 5),
    });
  } catch (err: any) {
    console.error('[api] COMO scrape error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Supabase Upload ──────────────────────────────────────────────────────

async function uploadComoToSupabase(records: ComoMeterReading[]): Promise<number> {
  if (!supabase) throw new Error('Supabase not configured');

  const BATCH_SIZE = 100;
  let totalUploaded = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { data, error } = await (supabase as any)
      .from('como_meter_readings')
      .upsert(batch, {
        onConflict: 'reading_timestamp,meter,account_number',
      })
      .select();

    if (error) {
      console.error(`[supabase] COMO batch ${i / BATCH_SIZE + 1} error:`, error.message);
      throw error;
    }

    totalUploaded += data?.length || batch.length;
    console.log(
      `[supabase] COMO batch ${i / BATCH_SIZE + 1}: upserted ${data?.length || batch.length} records`
    );
  }

  return totalUploaded;
}

async function uploadToSupabase(records: MeterReading[]): Promise<number> {
  if (!supabase) throw new Error('Supabase not configured');

  // Batch upsert in chunks of 100
  const BATCH_SIZE = 100;
  let totalUploaded = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('bpu_meter_readings')
      .upsert(batch, {
        onConflict: 'reading_timestamp,meter,account_number',
      })
      .select();

    if (error) {
      console.error(`[supabase] Batch ${i / BATCH_SIZE + 1} error:`, error.message);
      throw error;
    }

    totalUploaded += data?.length || batch.length;
    console.log(
      `[supabase] Batch ${i / BATCH_SIZE + 1}: upserted ${data?.length || batch.length} records`
    );
  }

  return totalUploaded;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────

async function shutdownAll() {
  console.log('\nShutting down...');
  await Promise.all([
    closeBrowser().catch(() => {}),
    closeComoBrowser().catch(() => {}),
  ]);
}

process.on('SIGINT', async () => {
  await shutdownAll();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await shutdownAll();
  process.exit(0);
});

// ─── Start ────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`\n🏢 Utility Bot running on port ${PORT}`);
  console.log(
    `   API Secret: ${API_SECRET === 'changeme' ? '⚠️  DEFAULT (set API_SECRET env var!)' : '✓ set'}`
  );
  console.log(`   BPU Username: ${BPU_USERNAME || '⚠️  not set'}`);
  console.log(`   COMO Username: ${COMO_USERNAME || '⚠️  not set'}`);
  console.log('');

  // Pre-warm both browsers in parallel
  await Promise.all([
    ensureBrowser(),
    ensureComoBrowser().catch((err: any) => {
      console.log(`   COMO browser error: ${err.message}`);
    }),
  ]);

  // Check session status for both
  const [bpuStatus, comoStatus] = await Promise.all([
    isLoggedIn(),
    isComoLoggedIn().catch(() => ({ loggedIn: false, url: 'error' })),
  ]);

  console.log(`   BPU:  ${bpuStatus.loggedIn ? '✅ Session active' : '⚠️  Not logged in → POST /api/login'}`);
  console.log(`   COMO: ${comoStatus.loggedIn ? '✅ Session active' : '⚠️  Not logged in → POST /api/como/login'}`);
  console.log('');
});

export default app;
