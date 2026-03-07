import { chromium, Browser, BrowserContext, Page, Download } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

// ─── Constants ────────────────────────────────────────────────────────────

const COMO_BASE = 'https://myutilitybill.como.gov';
const BOT_DIR = process.env.PM2_HOME ? '/opt/bpu-bot' : __dirname;
const STATE_FILE = path.join(BOT_DIR, '.como-session-state.json');
const SCREENSHOT_DIR = path.join(BOT_DIR, '.screenshots');
const DOWNLOADS_DIR = path.join(BOT_DIR, 'downloads');

// ─── Types ────────────────────────────────────────────────────────────────

export interface ComoMeterReading {
  reading_timestamp: string;  // ISO 8601
  account_number: string;
  name: string;
  meter: string;
  location: string | null;
  address: string;
  ccf: number | null;
}

export interface ComoScrapeResult {
  success: boolean;
  records: ComoMeterReading[];
  properties_scraped: number;
  error?: string;
}

export interface ComoLoginResult {
  success: boolean;
  message: string;
}

// ─── Browser Manager ──────────────────────────────────────────────────────
// COMO gets its own browser + context, independent from BPU.

let browser: Browser | null = null;
let context: BrowserContext | null = null;

export async function ensureComoBrowser(): Promise<BrowserContext> {
  if (context) return context;

  console.log('[como] Launching Chromium (headless)...');
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const storageState = fs.existsSync(STATE_FILE) ? STATE_FILE : undefined;
  context = await browser.newContext({
    storageState,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });

  console.log(`[como] Context ready. Session state: ${storageState ? 'loaded' : 'fresh'}`);
  return context;
}

export async function ensureComoBrowserVisible(): Promise<BrowserContext> {
  await closeComoBrowser();

  console.log('[como] Launching Chromium (visible for login)...');
  browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const storageState = fs.existsSync(STATE_FILE) ? STATE_FILE : undefined;
  context = await browser.newContext({
    storageState,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });

  console.log(`[como] Visible context ready. Session state: ${storageState ? 'loaded' : 'fresh'}`);
  return context;
}

export async function saveComoSession(): Promise<void> {
  if (!context) return;
  try {
    const state = await context.storageState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log('[como] Session state saved.');
  } catch (err: any) {
    console.log('[como] Could not save session:', err.message);
  }
}

export async function closeComoBrowser(): Promise<void> {
  if (context) {
    await saveComoSession();
    await context.close().catch(() => {});
    context = null;
  }
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
  console.log('[como] Browser closed.');
}

async function getComoPage(): Promise<Page> {
  const ctx = await ensureComoBrowser();
  return ctx.newPage();
}

// ─── Screenshots ──────────────────────────────────────────────────────────

function ensureScreenshotDir() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

async function takeScreenshot(page: Page, name: string): Promise<string> {
  ensureScreenshotDir();
  const filepath = path.join(SCREENSHOT_DIR, `como-${name}-${Date.now()}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
  return filepath;
}

// ─── Session Check ────────────────────────────────────────────────────────

export async function isComoLoggedIn(): Promise<{ loggedIn: boolean; url: string }> {
  const page = await getComoPage();
  try {
    await page.goto(COMO_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const url = page.url();

    // Logged in: has "Select Property" button or property name visible
    const hasSelectProperty =
      (await page.$('#choosePropertyBtn')) !== null ||
      (await page.$('a[href*="Logout"]')) !== null ||
      (await page.$('.propertyName')) !== null ||
      url.includes('/Dashboard') ||
      url.includes('/Home');

    // Login page indicators
    const onLoginPage =
      (await page.$('#LoginEmail')) !== null ||
      (await page.$('#LoginPassword')) !== null ||
      (await page.$('input[name="Email"]')) !== null;

    const loggedIn = hasSelectProperty && !onLoginPage;
    return { loggedIn, url };
  } catch (err: any) {
    return { loggedIn: false, url: `error: ${err.message}` };
  } finally {
    await page.close();
  }
}

// ─── Login Flow ───────────────────────────────────────────────────────────

/**
 * Interactive login for COMO MyMeter portal.
 * Opens visible browser — user logs in manually (may have CAPTCHA).
 */
export async function interactiveComoLogin(
  email: string,
  password: string
): Promise<ComoLoginResult> {
  const ctx = await ensureComoBrowserVisible();
  const page = await ctx.newPage();

  try {
    console.log('[como-login] Navigating to COMO login page...');
    await page.goto(COMO_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const url = page.url();
    if (url.includes('/Dashboard') || url.includes('/Home')) {
      console.log('[como-login] Already logged in!');
      await saveComoSession();
      await page.close();
      return { success: true, message: 'Already logged in. Session saved.' };
    }

    // Fill login form — COMO uses same MyMeter platform as BPU
    const emailInput = await page.$('#LoginEmail') || await page.$('input[name="Email"]');
    const passwordInput = await page.$('#LoginPassword') || await page.$('input[name="Password"]');

    if (!emailInput || !passwordInput) {
      console.log('[como-login] Login form not found. URL:', page.url());
      await takeScreenshot(page, 'login-no-form');
      await page.close();
      return { success: false, message: 'Login form not found' };
    }

    console.log('[como-login] Filling credentials...');
    await emailInput.fill(email);
    await page.waitForTimeout(500);
    await passwordInput.fill(password);

    console.log('[como-login] Credentials filled. Solve CAPTCHA and click Login.');
    console.log('[como-login] Waiting for login to complete (up to 5 minutes)...');

    const loginTimeout = 300000;
    const pollInterval = 2000;
    let elapsed = 0;

    while (elapsed < loginTimeout) {
      await page.waitForTimeout(pollInterval);
      elapsed += pollInterval;

      const currentUrl = page.url();
      if (
        currentUrl.includes('/Dashboard') ||
        currentUrl.includes('/Home') ||
        (await page.$('#choosePropertyBtn')) !== null ||
        (await page.$('a[href*="Logout"]')) !== null
      ) {
        console.log('[como-login] Login successful!');
        await saveComoSession();
        await page.close();
        await closeComoBrowser();
        return { success: true, message: 'Login successful. Session saved.' };
      }

      if ((await page.$('#LoginEmail')) !== null) {
        if (elapsed % 10000 === 0) {
          console.log(`[como-login] Still on login page... (${elapsed / 1000}s)`);
        }
        continue;
      }

      if (elapsed % 10000 === 0) {
        console.log(`[como-login] On intermediate page: ${currentUrl} (${elapsed / 1000}s)`);
      }
    }

    console.log('[como-login] Login timed out after 5 minutes.');
    await takeScreenshot(page, 'login-timeout');
    await page.close();
    await closeComoBrowser();
    return { success: false, message: 'Login timed out.' };
  } catch (err: any) {
    console.error('[como-login] Error:', err.message);
    try {
      await takeScreenshot(page, 'login-error');
      await page.close();
    } catch {}
    await closeComoBrowser();
    return { success: false, message: `Login error: ${err.message}` };
  }
}

// ─── Property Discovery ──────────────────────────────────────────────────

interface PropertyInfo {
  name: string;      // e.g. "Pioneer 2404"
  account: string;   // e.g. "00655297-0054606"
  address: string;   // e.g. "2404 WHITE GATE DR, COLUMBIA, MO 65202"
  element_index: number; // position in the property list
}

/**
 * Get all properties from the "Select Property" dropdown.
 */
async function discoverProperties(page: Page): Promise<PropertyInfo[]> {
  console.log('[como] Discovering properties...');

  // Click "Select Property" button
  const selectBtn = await page.$('#choosePropertyBtn') ||
                    await page.$('button:has-text("Select Property")') ||
                    await page.$('a:has-text("Select Property")');

  if (!selectBtn) {
    console.log('[como] Select Property button not found, trying to find property list...');
    await takeScreenshot(page, 'no-select-property');
    return [];
  }

  await selectBtn.click();
  await page.waitForTimeout(2000);
  await takeScreenshot(page, 'property-list');

  // Parse the property list — each property is a clickable item
  const properties = await page.evaluate(() => {
    const results: { name: string; account: string; address: string; index: number }[] = [];
    // Look for property list items — they typically contain account info
    const items = document.querySelectorAll(
      '.propertyList a, .property-list a, .propertyList li, ' +
      '#propertyListModal a, [class*="property"] a, ' +
      '.modal-body a, .list-group a, .list-group-item'
    );

    items.forEach((item, i) => {
      const text = item.textContent?.trim() || '';
      if (!text || text.length < 5) return;

      // Try to parse: "PropertyName (Acct XXXXX) Address"
      const nameMatch = text.match(/^([^(]+)/);
      const acctMatch = text.match(/\(Acct\s+([^)]+)\)/i) || text.match(/Acct\s+([^\s,]+)/i);
      const addrMatch = text.match(/\d+\s+[A-Z][\w\s]+(?:DR|ST|AVE|RD|LN|CT|BLVD|WAY|PL|CIR)/i);

      results.push({
        name: nameMatch ? nameMatch[1].trim() : text.substring(0, 50),
        account: acctMatch ? acctMatch[1].trim() : '',
        address: addrMatch ? addrMatch[0].trim() : '',
        index: i,
      });
    });

    return results;
  });

  // Close modal if open
  const closeBtn = await page.$('.modal .close, .modal-header .close, button[data-dismiss="modal"]');
  if (closeBtn) {
    await closeBtn.click();
    await page.waitForTimeout(500);
  }

  console.log(`[como] Found ${properties.length} properties.`);
  return properties.map((p, i) => ({
    name: p.name,
    account: p.account,
    address: p.address,
    element_index: p.index,
  }));
}

/**
 * Select a specific property from the property list.
 */
async function selectProperty(page: Page, propertyIndex: number): Promise<boolean> {
  // Click "Select Property" button
  const selectBtn = await page.$('#choosePropertyBtn') ||
                    await page.$('button:has-text("Select Property")') ||
                    await page.$('a:has-text("Select Property")');

  if (!selectBtn) {
    console.log('[como] Select Property button not found.');
    return false;
  }

  await selectBtn.click();
  await page.waitForTimeout(2000);

  // Click the property at the given index
  const selected = await page.evaluate((idx) => {
    const items = document.querySelectorAll(
      '.propertyList a, .property-list a, .propertyList li, ' +
      '#propertyListModal a, [class*="property"] a, ' +
      '.modal-body a, .list-group a, .list-group-item'
    );

    const validItems: HTMLElement[] = [];
    items.forEach(item => {
      const text = item.textContent?.trim() || '';
      if (text.length >= 5 && item instanceof HTMLElement) {
        validItems.push(item);
      }
    });

    if (idx < validItems.length) {
      validItems[idx].click();
      return true;
    }
    return false;
  }, propertyIndex);

  if (selected) {
    await page.waitForTimeout(3000); // Wait for property page to load
  }

  return selected;
}

// ─── Scraping Logic ──────────────────────────────────────────────────────

/**
 * Scrape COMO MyMeter portal for all properties.
 *
 * Flow per property:
 * 1. Select property from dropdown
 * 2. Click "Data" tab
 * 3. Click download icon
 * 4. Configure download form: CSV, Water, all meters, all columns, date range
 * 5. Click Download
 * 6. Parse CSV
 */
export async function scrapeComoData(
  startDate?: string,
  endDate?: string
): Promise<ComoScrapeResult> {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }

  // Default: all available data (3 years back)
  const now = new Date();
  const defaultEnd = formatDate(now);
  const threeYearsAgo = new Date(now);
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  const defaultStart = formatDate(threeYearsAgo);

  const start = startDate || defaultStart;
  const end = endDate || defaultEnd;

  console.log(`[como] Starting scrape for ${start} to ${end}...`);

  const page = await getComoPage();
  const allRecords: ComoMeterReading[] = [];
  let propertiesScraped = 0;

  try {
    // Navigate to COMO
    await page.goto(COMO_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Verify logged in
    const loginCheck = await page.$('#LoginEmail') || await page.$('input[name="Email"]');
    if (loginCheck) {
      await page.close();
      return {
        success: false,
        records: [],
        properties_scraped: 0,
        error: 'Not logged in. Run login flow first.',
      };
    }

    // Discover all properties
    const properties = await discoverProperties(page);
    if (properties.length === 0) {
      // Try scraping just the current property
      console.log('[como] No property list found, scraping current property...');
      const records = await scrapeCurrentProperty(page, start, end);
      allRecords.push(...records);
      propertiesScraped = records.length > 0 ? 1 : 0;
    } else {
      // Iterate through each property
      for (let i = 0; i < properties.length; i++) {
        const prop = properties[i];
        console.log(`[como] [${i + 1}/${properties.length}] Scraping: ${prop.name} (${prop.account})`);

        const selected = await selectProperty(page, prop.element_index);
        if (!selected) {
          console.warn(`[como] Could not select property ${prop.name}, skipping.`);
          continue;
        }

        await page.waitForTimeout(2000);

        try {
          const records = await scrapeCurrentProperty(page, start, end);
          console.log(`[como]   → ${records.length} records from ${prop.name}`);
          allRecords.push(...records);
          if (records.length > 0) propertiesScraped++;
        } catch (err: any) {
          console.error(`[como]   → Error scraping ${prop.name}: ${err.message}`);
          await takeScreenshot(page, `error-property-${i}`);
        }
      }
    }

    await page.close();

    console.log(`[como] Total: ${allRecords.length} records from ${propertiesScraped} properties.`);

    return {
      success: true,
      records: allRecords,
      properties_scraped: propertiesScraped,
    };
  } catch (err: any) {
    console.error('[como] Scrape error:', err.message);
    try {
      await takeScreenshot(page, 'scrape-error');
      await page.close();
    } catch {}
    return {
      success: false,
      records: allRecords,
      properties_scraped: propertiesScraped,
      error: `Scrape error: ${err.message}`,
    };
  }
}

/**
 * Scrape the currently-selected property's usage data.
 */
async function scrapeCurrentProperty(
  page: Page,
  startDate: string,
  endDate: string
): Promise<ComoMeterReading[]> {
  // Step 1: Click "Data" tab
  let dataClicked = false;
  const dataTab = await page.$('a.dashboard-data');
  if (dataTab) {
    await dataTab.click();
    dataClicked = true;
  }
  if (!dataClicked) {
    dataClicked = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, span, div, li'));
      for (const el of links) {
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
  }
  if (!dataClicked) {
    console.warn('[como] Data tab not found.');
    await takeScreenshot(page, 'no-data-tab');
    return [];
  }

  await page.waitForTimeout(3000);

  // Step 2: Click download icon in toolbar
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
        break;
      }
    }
  }

  if (!downloadIconClicked) {
    downloadIconClicked = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('a, button, span, div, label'));
      for (const el of candidates) {
        const text = el.textContent?.trim().toLowerCase() || '';
        if (
          text === 'download' &&
          el instanceof HTMLElement &&
          el.offsetParent !== null &&
          el.getBoundingClientRect().width > 0
        ) {
          el.click();
          return true;
        }
      }
      return false;
    });
  }

  if (!downloadIconClicked) {
    console.warn('[como] Download icon not found.');
    await takeScreenshot(page, 'no-download-icon');
    return [];
  }

  await page.waitForTimeout(3000);

  // Step 3: Configure the download form
  // Enable all column checkboxes so CSV includes identifiers
  await page.evaluate(() => {
    const checkboxes = document.querySelectorAll(
      'input[type="checkbox"][name*="Column"], ' +
      'input[type="checkbox"][id*="Column"], ' +
      '.download-columns input[type="checkbox"], ' +
      '[class*="choose-col"] input[type="checkbox"]'
    );
    checkboxes.forEach(cb => {
      if (cb instanceof HTMLInputElement && !cb.checked) {
        cb.click();
      }
    });
  });
  await page.waitForTimeout(500);

  // Set interval to "Billing" (monthly data is what's available)
  // The select may already be set correctly
  const intervalSelect = await page.$('select[id*="nterval"], select[name*="nterval"]');
  if (intervalSelect) {
    // Try to select "Billing" — it's the most reliable interval
    await intervalSelect.selectOption({ label: 'Billing' }).catch(() => {
      // If "Billing" doesn't match, try by value
      intervalSelect.selectOption('Billing').catch(() => {});
    });
    await page.waitForTimeout(500);
  }

  // Set date range
  // COMO date inputs use MM/DD/YYYY format
  const startInput = await page.$('#DownloadStartDate') ||
                     await page.$('input[id*="tartDate"], input[name*="tartDate"]');
  const endInput = await page.$('#DownloadEndDate') ||
                   await page.$('input[id*="ndDate"], input[name*="ndDate"]');

  if (startInput) {
    await startInput.fill('');
    await startInput.fill(formatDateMMDDYYYY(startDate));
  }
  if (endInput) {
    await endInput.fill('');
    await endInput.fill(formatDateMMDDYYYY(endDate));
  }

  await page.waitForTimeout(1000);
  await takeScreenshot(page, 'download-form');

  // Step 4: Click the Download button
  const submitBtn = await page.evaluateHandle(() => {
    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn'));
    for (const btn of buttons) {
      const text = btn.textContent?.trim() || '';
      if (
        text === 'Download' &&
        btn instanceof HTMLElement &&
        btn.offsetParent !== null &&
        btn.getBoundingClientRect().y > 300
      ) {
        return btn;
      }
    }
    return null;
  });

  const submitElement = submitBtn.asElement();
  if (!submitElement) {
    console.warn('[como] Download submit button not found.');
    await takeScreenshot(page, 'no-submit-button');
    return [];
  }

  // Set up download handler before clicking
  const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
  await submitElement.click();

  let download: Download;
  try {
    download = await downloadPromise;
  } catch (err: any) {
    console.error('[como] Download timed out:', err.message);
    await takeScreenshot(page, 'download-timeout');
    return [];
  }

  // Save and parse
  const suggestedName = download.suggestedFilename() || `como-usage-${Date.now()}.csv`;
  const downloadPath = path.join(DOWNLOADS_DIR, suggestedName);
  await download.saveAs(downloadPath);
  console.log(`[como] Downloaded: ${downloadPath}`);

  const records = parseComoCsv(downloadPath);

  // Clean up
  try { fs.unlinkSync(downloadPath); } catch {}

  // Navigate back to dashboard for next property
  await page.goto(COMO_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  return records;
}

// ─── CSV Parsing ──────────────────────────────────────────────────────────

/**
 * Parse COMO MyMeter CSV.
 *
 * With all columns enabled, format is:
 *   End, Account Number, Name, Meter, Location, Address, CCF
 *
 * With minimal columns (default):
 *   End, CCF
 *
 * Handles both formats gracefully.
 */
function parseComoCsv(filePath: string): ComoMeterReading[] {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  if (!fileContent.trim()) return [];

  const rawRecords = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const results: ComoMeterReading[] = [];

  for (const row of rawRecords) {
    try {
      // "End" column has the date: "02/02/2023 12:00:00 AM"
      const dateStr: string = row['End'] || row['Read Date'] || '';
      if (!dateStr) continue;

      const timestamp = parseComoDate(dateStr);
      if (!timestamp) {
        console.warn(`[como-csv] Could not parse date: ${dateStr}`);
        continue;
      }

      // Parse CCF
      let ccf: number | null = null;
      const ccfStr = row['CCF'] || '';
      if (ccfStr) {
        const parsed = parseFloat(ccfStr.replace(/[$,]/g, ''));
        if (!isNaN(parsed)) ccf = parsed;
      }

      // Skip zero-CCF rows (inactive meters)
      if (ccf === null || ccf === 0) continue;

      results.push({
        reading_timestamp: timestamp,
        account_number: row['Account Number'] || row['Account Nu'] || 'unknown',
        name: row['Name'] || '',
        meter: row['Meter'] || 'unknown',
        location: row['Location'] || null,
        address: row['Address'] || '',
        ccf,
      });
    } catch (err: any) {
      console.warn('[como-csv] Error parsing row:', err.message);
    }
  }

  return results;
}

/**
 * Parse COMO date: "MM/DD/YYYY HH:MM:SS AM/PM" or "MM/DD/YYYY"
 */
function parseComoDate(dateStr: string): string | null {
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

  const dateMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dateMatch) {
    const [, month, day, year] = dateMatch;
    const d = new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      12, 0, 0
    );
    return d.toISOString();
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Convert YYYY-MM-DD to MM/DD/YYYY for COMO date inputs.
 */
function formatDateMMDDYYYY(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  return `${month}/${day}/${year}`;
}
