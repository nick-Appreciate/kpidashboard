import { chromium, Browser, BrowserContext, Page, Download } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

// ─── Constants ────────────────────────────────────────────────────────────

const BPU_BASE = 'https://mymeter.bpu.com';
const BOT_DIR = process.env.PM2_HOME ? '/opt/bpu-bot' : __dirname;
const STATE_FILE = path.join(BOT_DIR, '.session-state.json');
const SCREENSHOT_DIR = path.join(BOT_DIR, '.screenshots');
const DOWNLOADS_DIR = path.join(BOT_DIR, 'downloads');

// ─── Types ────────────────────────────────────────────────────────────────

export interface MeterReading {
  reading_timestamp: string;  // ISO 8601
  account_number: string;
  name: string;
  meter: string;
  location: string | null;
  address: string;
  estimated_indicator: string;
  ccf: number | null;
  cost: string;
}

export interface ScrapeResult {
  success: boolean;
  records: MeterReading[];
  error?: string;
  screenshot?: string;  // base64
}

export interface LoginResult {
  success: boolean;
  message: string;
}

// ─── Browser Manager ──────────────────────────────────────────────────────

let browser: Browser | null = null;
let context: BrowserContext | null = null;

/**
 * Launch headless browser and load saved session if available.
 */
export async function ensureBrowser(): Promise<BrowserContext> {
  if (context) return context;

  console.log('[browser] Launching Chromium (headless)...');
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  // Load saved session if it exists
  const storageState = fs.existsSync(STATE_FILE) ? STATE_FILE : undefined;
  context = await browser.newContext({
    storageState,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
  });

  console.log(`[browser] Context ready. Session state: ${storageState ? 'loaded' : 'fresh'}`);
  return context;
}

/**
 * Launch NON-HEADLESS browser for interactive login (CAPTCHA solving).
 * This creates a separate browser instance — the main headless browser
 * is closed first to avoid conflicts.
 */
export async function ensureBrowserVisible(): Promise<BrowserContext> {
  // Close existing headless browser
  await closeBrowser();

  console.log('[browser] Launching Chromium (visible for login)...');
  browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  // Load saved session if it exists
  const storageState = fs.existsSync(STATE_FILE) ? STATE_FILE : undefined;
  context = await browser.newContext({
    storageState,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  console.log(`[browser] Visible context ready. Session state: ${storageState ? 'loaded' : 'fresh'}`);
  return context;
}

export async function saveSession(): Promise<void> {
  if (!context) return;
  try {
    const state = await context.storageState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log('[browser] Session state saved.');
  } catch (err: any) {
    console.log('[browser] Could not save session:', err.message);
  }
}

export async function closeBrowser(): Promise<void> {
  if (context) {
    await saveSession();
    await context.close().catch(() => {});
    context = null;
  }
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
  console.log('[browser] Browser closed.');
}

export async function getNewPage(): Promise<Page> {
  const ctx = await ensureBrowser();
  return ctx.newPage();
}

// ─── Screenshots ──────────────────────────────────────────────────────────

function ensureScreenshotDir() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

export async function takeScreenshot(page: Page, name: string): Promise<string> {
  ensureScreenshotDir();
  const filepath = path.join(SCREENSHOT_DIR, `${name}-${Date.now()}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
  return filepath;
}

export async function takeScreenshotBuffer(page: Page): Promise<Buffer> {
  return (await page.screenshot({ fullPage: true })) as Buffer;
}

// ─── Session Check ────────────────────────────────────────────────────────

export async function isLoggedIn(): Promise<{ loggedIn: boolean; url: string }> {
  const page = await getNewPage();
  try {
    await page.goto(BPU_BASE, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait a moment for redirects to complete
    await page.waitForTimeout(3000);
    const url = page.url();

    // Check for dashboard indicators
    const hasDashboard =
      url.includes('/Dashboard') ||
      url.includes('/Home') ||
      (await page.$('#choosePropertyBtn')) !== null ||
      (await page.$('a.dashboard-data')) !== null ||
      (await page.$('a[href*="Logout"]')) !== null;

    // Check if still on login page
    const onLoginPage =
      (await page.$('#LoginEmail')) !== null ||
      (await page.$('#LoginPassword')) !== null;

    const loggedIn = hasDashboard && !onLoginPage;

    return { loggedIn, url };
  } catch (err: any) {
    return { loggedIn: false, url: `error: ${err.message}` };
  } finally {
    await page.close();
  }
}

// ─── Login Flow ───────────────────────────────────────────────────────────

/**
 * Interactive login — opens visible browser for CAPTCHA solving.
 * Call from CLI (login-helper.ts) or via POST /api/login.
 *
 * Flow:
 * 1. Opens mymeter.bpu.com in visible browser
 * 2. Fills email + password
 * 3. User solves CAPTCHA and clicks login manually
 * 4. We detect successful login and save session
 */
export async function interactiveLogin(
  email: string,
  password: string
): Promise<LoginResult> {
  const ctx = await ensureBrowserVisible();
  const page = await ctx.newPage();

  try {
    console.log('[login] Navigating to BPU login page...');
    await page.goto(BPU_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Check if already logged in
    const url = page.url();
    if (url.includes('/Dashboard') || url.includes('/Home')) {
      console.log('[login] Already logged in!');
      await saveSession();
      await page.close();
      return { success: true, message: 'Already logged in. Session saved.' };
    }

    // Fill login form
    const emailInput = await page.$('#LoginEmail');
    const passwordInput = await page.$('#LoginPassword');

    if (!emailInput || !passwordInput) {
      console.log('[login] Login form not found. Current URL:', page.url());
      await takeScreenshot(page, 'login-no-form');
      await page.close();
      return { success: false, message: 'Login form not found' };
    }

    console.log('[login] Filling credentials...');
    await emailInput.fill(email);
    await page.waitForTimeout(500);
    await passwordInput.fill(password);

    console.log('[login] Credentials filled. Solve the CAPTCHA and click Login.');
    console.log('[login] Waiting for login to complete (up to 5 minutes)...');

    // Wait for navigation away from login page
    // The user needs to solve the CAPTCHA and click Login manually
    const loginTimeout = 300000; // 5 minutes
    const pollInterval = 2000;
    let elapsed = 0;

    while (elapsed < loginTimeout) {
      await page.waitForTimeout(pollInterval);
      elapsed += pollInterval;

      const currentUrl = page.url();

      // Success indicators
      if (
        currentUrl.includes('/Dashboard') ||
        currentUrl.includes('/Home') ||
        (await page.$('#choosePropertyBtn')) !== null ||
        (await page.$('a[href*="Logout"]')) !== null
      ) {
        console.log('[login] ✅ Login successful!');
        await saveSession();
        await page.close();
        // Close visible browser, switch back to headless
        await closeBrowser();
        return { success: true, message: 'Login successful. Session saved.' };
      }

      // Still on login page — keep waiting
      if ((await page.$('#LoginEmail')) !== null) {
        if (elapsed % 10000 === 0) {
          console.log(`[login] Still on login page... (${elapsed / 1000}s elapsed)`);
        }
        continue;
      }

      // On some intermediate page (processing login)
      if (elapsed % 10000 === 0) {
        console.log(`[login] On intermediate page: ${currentUrl} (${elapsed / 1000}s elapsed)`);
      }
    }

    console.log('[login] Login timed out after 5 minutes.');
    await takeScreenshot(page, 'login-timeout');
    await page.close();
    await closeBrowser();
    return { success: false, message: 'Login timed out. Please try again.' };
  } catch (err: any) {
    console.error('[login] Error:', err.message);
    try {
      await takeScreenshot(page, 'login-error');
      await page.close();
    } catch {}
    await closeBrowser();
    return { success: false, message: `Login error: ${err.message}` };
  }
}

// ─── Scraping Logic ───────────────────────────────────────────────────────

/**
 * Navigate the BPU portal, download usage CSV, and parse it.
 *
 * Flow:
 * 1. Navigate to mymeter.bpu.com (session should auto-login)
 * 2. Click "Choose Property" → "All Meters"
 * 3. Click "Data" tab
 * 4. Click Download link
 * 5. Set date range
 * 6. Click Download button
 * 7. Wait for CSV download
 * 8. Parse CSV into MeterReading[]
 */
export async function scrapeUsageData(
  startDate?: string,
  endDate?: string
): Promise<ScrapeResult> {
  // Ensure downloads directory exists
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }

  // Default date range: last 14 days
  const now = new Date();
  const defaultEnd = formatDate(now);
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const defaultStart = formatDate(twoWeeksAgo);

  const start = startDate || defaultStart;
  const end = endDate || defaultEnd;

  console.log(`[scrape] Starting scrape for ${start} to ${end}...`);

  const page = await getNewPage();

  try {
    // Step 1: Navigate to BPU (fresh load to ensure latest data)
    console.log('[scrape] Navigating to BPU...');
    await page.goto(BPU_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Force reload to ensure fresh meter data is populated (not stale cached page)
    console.log('[scrape] Reloading page to ensure fresh data...');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Verify we're logged in
    const loginCheck = await page.$('#LoginEmail');
    if (loginCheck) {
      await page.close();
      return {
        success: false,
        records: [],
        error: 'Not logged in. Run `npm run login` or POST /api/login first.',
      };
    }

    // Step 2: We land on the Dashboard with "All Meters" and "Charts" tab.
    // The page shows tabs: Charts | Data | Property
    // We need to click the "Data" tab to get to the download section.
    console.log('[scrape] Clicking Data tab...');
    await takeScreenshot(page, 'before-data-click');

    // Wait for the page to fully load after login redirect
    await page.waitForTimeout(2000);

    // Click the "Data" tab — try multiple selectors
    let dataClicked = false;
    const dataTab = await page.$('a.dashboard-data');
    if (dataTab) {
      await dataTab.click();
      dataClicked = true;
      console.log('[scrape] Clicked Data tab (a.dashboard-data).');
    }

    if (!dataClicked) {
      // Try clicking by text content — look for links/spans with "Data"
      dataClicked = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, span, div'));
        for (let i = 0; i < links.length; i++) {
          const el = links[i];
          if (
            el.textContent?.trim() === 'Data' &&
            el instanceof HTMLElement &&
            el.offsetParent !== null
          ) {
            el.click();
            return true;
          }
        }
        return false;
      });
      if (dataClicked) {
        console.log('[scrape] Clicked Data tab (by text).');
      }
    }

    if (!dataClicked) {
      await takeScreenshot(page, 'no-data-tab');
      await page.close();
      return {
        success: false,
        records: [],
        error: 'Could not find Data tab on the dashboard.',
      };
    }

    // Wait for Data tab content to load — wait for the download icon to appear
    console.log('[scrape] Waiting for Data tab toolbar to load...');
    try {
      await page.waitForSelector('.icon-Download, span.icon-Download', { state: 'visible', timeout: 20000 });
      console.log('[scrape] Data tab toolbar loaded.');
    } catch {
      // Fallback: just wait a fixed time
      console.log('[scrape] Download icon not found within 20s, waiting extra...');
      await page.waitForTimeout(10000);
    }
    await takeScreenshot(page, 'after-data-click');

    // Step 3: Click the "download" icon in the toolbar
    // The Data tab toolbar has icons: Full screen | range | download | markers
    console.log('[scrape] Looking for download icon in toolbar...');

    // Try multiple selectors for the download icon/button
    const downloadSelectors = [
      'span.icon-Download',
      '.icon-Download',
      'a[title*="download" i]',
      'button[title*="download" i]',
      'span[title*="download" i]',
      '[class*="download" i]:not([class*="downloadSubmit"])',
    ];

    let downloadIconClicked = false;
    for (const sel of downloadSelectors) {
      const el = await page.$(sel);
      if (el) {
        const isVisible = await el.isVisible().catch(() => false);
        if (isVisible) {
          await el.click();
          downloadIconClicked = true;
          console.log(`[scrape] Clicked download icon (${sel}).`);
          break;
        }
      }
    }

    if (!downloadIconClicked) {
      // Fallback: find by text content "download" in the toolbar area
      downloadIconClicked = await page.evaluate(() => {
        // Look for elements with "download" text near the toolbar
        const candidates = Array.from(document.querySelectorAll('a, button, span, div, label'));
        for (let i = 0; i < candidates.length; i++) {
          const el = candidates[i] as HTMLElement;
          const text = el.textContent?.trim().toLowerCase() || '';
          if (
            text === 'download' &&
            el.offsetParent !== null &&
            el.getBoundingClientRect().width > 0
          ) {
            el.click();
            return true;
          }
        }
        return false;
      });
      if (downloadIconClicked) {
        console.log('[scrape] Clicked download icon (by text).');
      }
    }

    if (!downloadIconClicked) {
      await takeScreenshot(page, 'no-download-icon');
      // Dump available elements for debugging
      const debugInfo = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('[class*="ownload"], [class*="icon-D"]'));
        return els.map(e => ({
          tag: e.tagName,
          classes: e.className,
          text: (e.textContent || '').trim().substring(0, 50),
          visible: e instanceof HTMLElement && e.offsetParent !== null,
        }));
      });
      console.log('[scrape] Debug - download-related elements:', JSON.stringify(debugInfo, null, 2));
      await page.close();
      return {
        success: false,
        records: [],
        error: 'Download icon not found in toolbar.',
      };
    }

    // Wait for download form to fully render (including service type dropdown)
    console.log('[scrape] Waiting for download form to load...');
    try {
      await page.waitForSelector('#SelectedServiceType', { state: 'visible', timeout: 15000 });
      console.log('[scrape] Download form loaded.');
    } catch {
      // Form didn't show service type selector — wait extra and retry
      console.log('[scrape] Service type dropdown not found, waiting extra...');
      await page.waitForTimeout(5000);
    }

    // Step 4: Configure download form - change service type to Water (CCF data)
    console.log('[scrape] Configuring download form...');

    // 4a: Change Service Type to Water (CCF data) if not already set
    const serviceTypeChanged = await page.evaluate(() => {
      const sel = document.getElementById('SelectedServiceType') as HTMLSelectElement;
      if (!sel) return { changed: false, reason: 'No #SelectedServiceType dropdown found' };
      const waterOpt = Array.from(sel.options).find(o => o.text.toLowerCase().includes('water'));
      if (!waterOpt) return { changed: false, reason: 'No Water option found' };
      if (sel.value === waterOpt.value) return { changed: false, reason: 'Already set to Water' };
      return { changed: true, value: waterOpt.value };
    });

    if (serviceTypeChanged.changed) {
      console.log('[scrape] Changing service type to Water...');
      await page.selectOption('#SelectedServiceType', serviceTypeChanged.value!);
      await page.waitForTimeout(5000); // Wait for form to reload with Water columns/meters
      console.log('[scrape] Service type changed to Water.');
    } else {
      console.log(`[scrape] Service type: ${serviceTypeChanged.reason}`);
    }

    // 4c: Check ALL column checkboxes. The inputs are visible but a custom-styled
    // label sits on top of them and intercepts clicks, so Playwright's .check() can
    // fail (silently if you swallow the error). Set .checked directly via JS — the
    // ASP.NET MVC form serializes from input.checked at submit time.
    const columnResult = await page.evaluate(() => {
      const cbs = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[id^="ColumnOptions"][id$="__Checked"]')
      );
      const failed: string[] = [];
      let newlyChecked = 0;
      for (const cb of cbs) {
        if (cb.checked) continue;
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        cb.dispatchEvent(new Event('input', { bubbles: true }));
        if (cb.checked) newlyChecked++;
        else failed.push(cb.id);
      }
      return { total: cbs.length, newlyChecked, failed };
    });
    console.log(
      `[scrape] Columns: ${columnResult.total} total, ${columnResult.newlyChecked} newly checked` +
        (columnResult.failed.length ? `, failed: ${columnResult.failed.join(',')}` : '.')
    );
    await page.waitForTimeout(1000);

    // 4d: Set interval to Daily
    const intervalSelects = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      for (const sel of selects) {
        const dailyOpt = Array.from(sel.options).find(o => o.text.toLowerCase().includes('daily'));
        if (dailyOpt) {
          return { selector: sel.id ? `#${sel.id}` : '', value: dailyOpt.value, currentValue: sel.value };
        }
      }
      return null;
    });
    if (intervalSelects?.selector && intervalSelects.value !== intervalSelects.currentValue) {
      console.log(`[scrape] Setting interval to Daily...`);
      await page.selectOption(intervalSelects.selector, intervalSelects.value);
      await page.waitForTimeout(2000);
    }

    // 4e: Set date range using Playwright fill (re-queries DOM each time)
    console.log(`[scrape] Setting date range: ${start} to ${end}...`);
    try {
      await page.waitForSelector('#DownloadStartDate', { state: 'visible', timeout: 5000 });
      await page.fill('#DownloadStartDate', start);
      console.log(`[scrape] Set start date: ${start}`);
    } catch {
      console.warn('[scrape] #DownloadStartDate not found, trying label-based approach...');
      // Try to find and fill by evaluating in page context
      await page.evaluate((val: string) => {
        const labels = Array.from(document.querySelectorAll('*'));
        for (const el of labels) {
          if (el.textContent?.trim() === 'Start Date' && el.nextElementSibling?.tagName === 'INPUT') {
            const input = el.nextElementSibling as HTMLInputElement;
            input.value = val;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }, start);
    }
    try {
      await page.waitForSelector('#DownloadEndDate', { state: 'visible', timeout: 5000 });
      await page.fill('#DownloadEndDate', end);
      console.log(`[scrape] Set end date: ${end}`);
    } catch {
      console.warn('[scrape] #DownloadEndDate not found, trying label-based approach...');
      await page.evaluate((val: string) => {
        const labels = Array.from(document.querySelectorAll('*'));
        for (const el of labels) {
          if (el.textContent?.trim() === 'End Date' && el.nextElementSibling?.tagName === 'INPUT') {
            const input = el.nextElementSibling as HTMLInputElement;
            input.value = val;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }, end);
    }

    await page.waitForTimeout(1000);
    await takeScreenshot(page, 'after-form-config');

    // Step 5: Click the "Download" submit button (#downloadSubmit)
    console.log('[scrape] Looking for Download button...');

    // Use Playwright's click with selector (re-queries DOM, avoids stale handles)
    const downloadBtn = await page.$('#downloadSubmit');
    if (!downloadBtn) {
      await takeScreenshot(page, 'no-submit-button');
      await page.close();
      return {
        success: false,
        records: [],
        error: 'Download submit button #downloadSubmit not found.',
      };
    }

    console.log('[scrape] Found #downloadSubmit, clicking...');

    // Set up download handler BEFORE clicking
    const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
    await page.click('#downloadSubmit');
    console.log('[scrape] Clicked Download button, waiting for file...');

    let download: Download;
    try {
      download = await downloadPromise;
    } catch (err: any) {
      console.error('[scrape] Download timed out:', err.message);
      await takeScreenshot(page, 'download-timeout');
      await page.close();
      return {
        success: false,
        records: [],
        error: 'CSV download timed out after 90 seconds.',
      };
    }

    // Save downloaded file
    const suggestedName = download.suggestedFilename() || `usage-${Date.now()}.csv`;
    const downloadPath = path.join(DOWNLOADS_DIR, suggestedName);
    await download.saveAs(downloadPath);
    console.log(`[scrape] Downloaded: ${downloadPath}`);

    // Step 8: Parse CSV
    console.log('[scrape] Parsing CSV...');

    const records = parseUsageCsv(downloadPath);
    console.log(`[scrape] Parsed ${records.length} records.`);

    // Clean up downloaded file
    try {
      fs.unlinkSync(downloadPath);
    } catch {}

    await page.close();

    return {
      success: true,
      records,
    };
  } catch (err: any) {
    console.error('[scrape] Error:', err.message);
    try {
      await takeScreenshot(page, 'scrape-error');
      await page.close();
    } catch {}
    return {
      success: false,
      records: [],
      error: `Scrape error: ${err.message}`,
    };
  }
}

// ─── CSV Parsing ──────────────────────────────────────────────────────────

function parseUsageCsv(filePath: string): MeterReading[] {
  const fileContent = fs.readFileSync(filePath, 'utf-8');

  if (!fileContent.trim()) {
    console.warn('[csv] File is empty.');
    return [];
  }

  const rawRecords = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const results: MeterReading[] = [];

  for (const row of rawRecords) {
    try {
      const startStr: string = row['Start'] || '';
      if (!startStr) continue;

      // Parse date: try full datetime first, then date only
      const timestamp = parseBpuDate(startStr);
      if (!timestamp) {
        console.warn(`[csv] Could not parse date: ${startStr}`);
        continue;
      }

      const accountNumber = row['Account Number'] || '';
      const meter = row['Meter'] || '';
      if (!accountNumber || !meter) continue;

      // Parse CCF (numeric usage value)
      let ccf: number | null = null;
      const ccfStr = row['CCF'] || '';
      if (ccfStr) {
        const cleaned = ccfStr.replace(/[$,]/g, '');
        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed)) ccf = parsed;
      }

      // Location — keep as string (can be very large numbers)
      const location: string | null = row['Location'] || null;

      results.push({
        reading_timestamp: timestamp,
        account_number: accountNumber,
        name: row['Name'] || '',
        meter,
        location,
        address: row['Address'] || '',
        estimated_indicator: row['Estimated Indicator'] || '',
        ccf,
        cost: row['$'] || '',
      });
    } catch (err: any) {
      console.warn(`[csv] Error parsing row:`, err.message);
    }
  }

  return results;
}

/**
 * Parse BPU date formats into ISO 8601 string.
 * Supports: "MM/DD/YYYY HH:MM:SS AM/PM" and "MM/DD/YYYY"
 */
function parseBpuDate(dateStr: string): string | null {
  // Try full datetime: "3/6/2026 12:00:00 AM"
  const fullMatch = dateStr.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i
  );

  if (fullMatch) {
    const [, month, day, year, hourStr, min, sec, ampm] = fullMatch;
    let hour = parseInt(hourStr, 10);
    if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
    if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;

    const d = new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      hour,
      parseInt(min, 10),
      parseInt(sec, 10)
    );
    return d.toISOString();
  }

  // Try date only: "3/6/2026"
  const dateMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dateMatch) {
    const [, month, day, year] = dateMatch;
    const d = new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      12, 0, 0 // noon to avoid timezone issues
    );
    return d.toISOString();
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

async function screenshotBase64(page: Page): Promise<string> {
  try {
    const buf = await takeScreenshotBuffer(page);
    return buf.toString('base64');
  } catch {
    return '';
  }
}
