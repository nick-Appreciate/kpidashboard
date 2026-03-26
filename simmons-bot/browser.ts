/**
 * Simmons Bank browser automation via Playwright.
 *
 * Handles:
 * - Login with username/password + TOTP 2FA
 * - Navigating account deposit history
 * - Downloading check images as base64 PNG from shadow-DOM components
 * - Session persistence
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const SESSION_FILE = path.join(__dirname, '..', '.session-state.json');
const SCREENSHOT_DIR = path.join(__dirname, '..', '.screenshots');

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

// ─── Session Management ─────────────────────────────────────────────────

async function saveSession(): Promise<void> {
  if (!context) return;
  try {
    const state = await context.storageState();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
    console.log('[browser] Session saved.');
  } catch (err: any) {
    console.error('[browser] Failed to save session:', err.message);
  }
}

function loadSession(): any | null {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

export async function ensureBrowser(): Promise<Page> {
  if (page && !page.isClosed()) return page;

  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const session = loadSession();
  browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  context = await browser.newContext({
    ...(session ? { storageState: session } : {}),
    viewport: { width: 1470, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  page = await context.newPage();

  // Anti-bot detection stealth
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    (window as any).chrome = { runtime: {} };
  });

  console.log('[browser] Browser launched (non-headless + stealth).');
  return page;
}

export async function closeBrowser(): Promise<void> {
  if (context) await saveSession();
  if (browser) await browser.close();
  browser = null;
  context = null;
  page = null;
  console.log('[browser] Browser closed.');
}

// ─── TOTP Generation ────────────────────────────────────────────────────

function generateTOTP(secret: string): string {
  let s = secret.replace(/\s/g, '').toUpperCase();
  const padding = 8 - (s.length % 8);
  if (padding !== 8) s += '='.repeat(padding);

  // Base32 decode
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s) {
    if (c === '=') break;
    const val = alphabet.indexOf(c);
    if (val === -1) throw new Error(`Invalid base32 char: ${c}`);
    bits += val.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(
    bits.match(/.{1,8}/g)!.map((b) => parseInt(b, 2))
  );

  const counter = Math.floor(Date.now() / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1000000;

  return code.toString().padStart(6, '0');
}

// ─── Login Flow ─────────────────────────────────────────────────────────

export async function isLoggedIn(): Promise<{ loggedIn: boolean; url: string }> {
  const p = await ensureBrowser();
  const url = p.url();

  // If we're on the dashboard or an account page, we're logged in
  // Note: hostname is "login.simmonsbank.com" so check pathname, not full URL
  const parsedUrl = new URL(url, 'https://login.simmonsbank.com');
  if (
    url.includes('login.simmonsbank.com') &&
    parsedUrl.pathname !== '/login' &&
    !url.includes('www.simmonsbank.com')
  ) {
    return { loggedIn: true, url };
  }

  // Try navigating to dashboard
  try {
    await p.goto('https://login.simmonsbank.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await p.waitForTimeout(3000);
    const newUrl = p.url();
    const newParsed = new URL(newUrl, 'https://login.simmonsbank.com');
    const loggedIn =
      newUrl.includes('login.simmonsbank.com') &&
      newParsed.pathname !== '/login';
    return { loggedIn, url: newUrl };
  } catch {
    return { loggedIn: false, url: p.url() };
  }
}

export async function login(
  username: string,
  password: string,
  totpSecret: string
): Promise<{ success: boolean; error?: string }> {
  const p = await ensureBrowser();

  try {
    // Go directly to Banno login page (skip www.simmonsbank.com marketing site)
    console.log('[login] Step 1: Navigate to Banno login page');
    await p.goto('https://login.simmonsbank.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await p.waitForTimeout(5000); // Banno SPA needs time to render shadow DOM

    // Step 2: Enter username (Banno renders inputs inside shadow DOM)
    console.log('[login] Step 2: Enter username');
    const usernameInput = p.getByLabel('Username').first();
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    // Use fill() which handles shadow DOM + React state updates properly
    await usernameInput.fill(username);
    console.log(`[login] Filled username: ${username}`);
    await p.waitForTimeout(500);

    // Submit username — try multiple approaches for shadow DOM button
    console.log('[login] Step 3: Submit username');
    let submitted = false;

    // Approach 1: Find jha-button with text "Continue" or "Sign in", click its shadow <button>
    try {
      const jhaButtons = await p.$$('jha-button');
      for (const jha of jhaButtons) {
        const text = await jha.textContent().catch(() => '');
        if (text && /Continue|Sign in/i.test(text.trim())) {
          // Must click the inner <button> inside the shadow root
          const innerBtn = await jha.$('button');
          if (innerBtn) {
            await innerBtn.click();
            submitted = true;
            console.log(`[login] Clicked inner button of jha-button: "${text.trim()}"`);
          } else {
            // Fallback: click the jha-button itself
            await jha.click();
            submitted = true;
            console.log(`[login] Clicked jha-button directly: "${text.trim()}"`);
          }
          break;
        }
      }
    } catch (e: any) {
      console.log('[login] jha-button approach failed:', e.message);
    }

    // Approach 2: Tab to the button and press Enter
    if (!submitted) {
      console.log('[login] Trying Tab+Enter fallback');
      await p.keyboard.press('Tab');
      await p.waitForTimeout(200);
      await p.keyboard.press('Enter');
    }
    await p.waitForTimeout(8000);

    // Step 4: Password page (Banno shadow DOM — use Playwright's built-in
    // shadow-piercing selectors to avoid CSP eval restrictions)
    console.log('[login] Step 4: Enter password');
    try {
      // Playwright's css= engine pierces shadow DOM by default
      await p.waitForSelector('input[type="password"]', { state: 'visible', timeout: 15000 });
      await p.click('input[type="password"]');
      await p.waitForTimeout(300);
      await p.keyboard.type(password, { delay: 75 });
    } catch {
      // Fallback: try locator which also pierces shadow DOM
      const pwInput = p.locator('input[type="password"]').first();
      await pwInput.waitFor({ state: 'visible', timeout: 10000 });
      await pwInput.click();
      await p.waitForTimeout(300);
      await p.keyboard.type(password, { delay: 75 });
    }
    await p.waitForTimeout(500);

    // Submit password — Enter key (Banno shadow DOM buttons are hard to target)
    await p.keyboard.press('Enter');
    await p.waitForTimeout(8000);

    // Step 5: TOTP page (also shadow DOM)
    console.log('[login] Step 5: Enter TOTP code');
    const totpCode = generateTOTP(totpSecret);
    console.log(`[login] Generated TOTP: ${totpCode}`);

    // Find TOTP input via Playwright selectors (shadow-piercing)
    try {
      const totpInput = p.locator('input[inputmode="numeric"]').first();
      await totpInput.waitFor({ state: 'visible', timeout: 15000 });
      await totpInput.click();
    } catch {
      try {
        const totpInput2 = p.locator('input[type="tel"]').first();
        await totpInput2.click({ timeout: 5000 });
      } catch {
        // Last fallback: just Tab to the input
        await p.keyboard.press('Tab');
      }
    }
    await p.waitForTimeout(300);
    await p.keyboard.type(totpCode, { delay: 75 });
    await p.waitForTimeout(500);

    // Submit TOTP
    await p.keyboard.press('Enter');
    await p.waitForTimeout(8000);

    // Step 6: Accept User Agreement if shown (also shadow DOM)
    const checkbox = p.locator('input[type="checkbox"]').first();
    const hasAgreement = await checkbox.isVisible().catch(() => false);
    if (hasAgreement) {
      console.log('[login] Step 6: Accepting user agreement');
      await checkbox.check();
      await p.waitForTimeout(500);
      await p.keyboard.press('Enter');
      await p.waitForTimeout(3000);
    }

    // Check if we reached dashboard (pathname check — hostname contains "login")
    const finalUrl = p.url();
    const finalParsed = new URL(finalUrl, 'https://login.simmonsbank.com');
    const success = finalUrl.includes('login.simmonsbank.com') && finalParsed.pathname !== '/login';

    if (success) {
      await saveSession();
      console.log('[login] ✅ Login successful!');
    } else {
      // Take debug screenshot
      await p.screenshot({ path: path.join(SCREENSHOT_DIR, 'login-failed.png') });
      console.log(`[login] ❌ Login may have failed. URL: ${finalUrl}`);
    }

    return { success, error: success ? undefined : `Ended at: ${finalUrl}` };
  } catch (err: any) {
    await p.screenshot({ path: path.join(SCREENSHOT_DIR, 'login-error.png') }).catch(() => {});
    console.error('[login] Error:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── Deposit Scraping ───────────────────────────────────────────────────

export interface DepositInfo {
  date: string; // YYYY-MM-DD
  amount: number;
  balance_after: number | null;
  image_count: number;
  images: CheckImageInfo[];
  // Deposit slip metadata
  branch_name?: string;
  teller_id?: string;
  workstation?: string;
  hin_number?: string;
}

export interface CheckImageInfo {
  index: number; // 1-based
  amount: number | null;
  type: 'deposit_slip' | 'check';
  front_base64: string; // PNG base64
  back_base64?: string; // PNG base64
}

/**
 * Navigate to an account page by its Banno URL ID.
 */
async function navigateToAccount(accountUrlId: string): Promise<void> {
  const p = await ensureBrowser();
  const url = `https://login.simmonsbank.com/account/${accountUrlId}`;
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(3000);

  // Verify we're on the account page, not redirected to login
  const currentUrl = p.url();
  if (currentUrl.includes('/login?') || currentUrl.endsWith('/login')) {
    console.error(`[nav] ⚠️ Redirected to login! Session may have expired. URL: ${currentUrl}`);
    throw new Error('Session expired — redirected to login page');
  }
  console.log(`[nav] On account page: ${currentUrl}`);
}

/**
 * Search for deposits in the currently-loaded account.
 * Uses the transaction search to find DEPOSIT transactions.
 */
export async function scrapeDeposits(
  accountUrlId: string,
  startDate?: string,
  endDate?: string
): Promise<{ success: boolean; deposits: DepositInfo[]; error?: string }> {
  const p = await ensureBrowser();
  const deposits: DepositInfo[] = [];

  try {
    await navigateToAccount(accountUrlId);

    // We need to scroll through ALL transactions to find deposits with images.
    // The bank's Banno UI loads transactions in the shadow DOM.
    // Strategy: scroll the transaction list, collect all deposit entries,
    // then click each one to get images.

    // First, let's get all visible deposit transactions by scrolling
    const depositEntries = await collectDepositTransactions(p, startDate, endDate);
    console.log(`[scrape] Found ${depositEntries.length} deposit transactions to process.`);

    for (let i = 0; i < depositEntries.length; i++) {
      const entry = depositEntries[i];
      console.log(
        `[scrape] Processing deposit ${i + 1}/${depositEntries.length}: ${entry.date} $${entry.amount}`
      );

      try {
        // Navigate to account and click this deposit
        await navigateToAccount(accountUrlId);
        await p.waitForTimeout(2000);

        // Click the specific deposit transaction
        const clicked = await clickDepositByDateAmount(p, entry.date, entry.amount);
        if (!clicked) {
          console.warn(`[scrape] Could not click deposit ${entry.date} $${entry.amount}, skipping`);
          continue;
        }

        await p.waitForTimeout(3000);

        // Extract deposit amount from the detail panel ("+$1,320.00")
        const detailAmount = await p.evaluate(`(() => {
          const findAmount = (root, d) => {
            if (d > 10) return null;
            for (const el of root.querySelectorAll('*')) {
              const t = (el.textContent || '').trim();
              const m = t.match(/^\\+\\$([\\d,]+\\.\\d{2})$/);
              if (m) return parseFloat(m[1].replace(/,/g, ''));
              if (el.shadowRoot) { const f = findAmount(el.shadowRoot, d+1); if (f) return f; }
            }
            return null;
          };
          return findAmount(document, 0);
        })()`) as number | null;
        if (detailAmount) entry.amount = detailAmount;

        // Extract deposit info with images
        const depositInfo = await extractDepositImages(p, entry);
        if (depositInfo) {
          deposits.push(depositInfo);
          console.log(
            `[scrape]   → ${depositInfo.images.length} images extracted`
          );
        }
      } catch (err: any) {
        console.error(`[scrape] Error processing deposit ${entry.date}: ${err.message}`);
        await p.screenshot({
          path: path.join(SCREENSHOT_DIR, `deposit-error-${entry.date}.png`),
        }).catch(() => {});
      }
    }

    return { success: true, deposits };
  } catch (err: any) {
    console.error('[scrape] Error:', err.message);
    return { success: false, deposits, error: err.message };
  }
}

interface DepositEntry {
  date: string;
  amount: number;
  balance_after: number | null;
}

/**
 * Scroll through the transaction list and collect all deposit entries.
 * Optionally filter by date range.
 */
async function collectDepositTransactions(
  p: Page,
  startDate?: string,
  endDate?: string
): Promise<DepositEntry[]> {
  const deposits: DepositEntry[] = [];
  const seen = new Set<string>();

  // Scroll and collect deposits from the transaction list
  let previousCount = 0;
  let noNewCount = 0;

  for (let scroll = 0; scroll < 200; scroll++) {
    // Extract deposit transactions from the current viewport via shadow DOM
    // Banno UI: each transaction is a <button> with child divs for description/date
    // Amounts are NOT in the text — we collect DEPOSIT buttons and click them for details
    const newDeposits = await p.evaluate(`(() => {
      const results = [];
      const seen = new Set();
      const findDeposits = (root, d) => {
        if (d > 10) return;
        for (const el of root.querySelectorAll('*')) {
          const text = (el.textContent || '').trim();
          // Look for elements whose text is exactly "DEPOSIT" or "INTEREST DEPOSIT"
          if (text === 'DEPOSIT' || text === 'INTEREST DEPOSIT') {
            // Walk up to find the parent button (the clickable transaction row)
            let parent = el;
            for (let i = 0; i < 8; i++) {
              if (!parent.parentElement) break;
              parent = parent.parentElement;
              if (parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'button') break;
            }
            const parentText = (parent.textContent || '').trim().replace(/\\s+/g, ' ');
            // Extract date from parent text: "DEPOSIT Mar 16" or "DEPOSIT Feb 23"
            const dateMatch = parentText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+\\d{1,2}/);
            const dateStr = dateMatch ? dateMatch[0] : '';
            const key = parentText;
            if (dateStr && !seen.has(key)) {
              seen.add(key);
              results.push({ date: dateStr, amount: 0, balance: null });
            }
          }
          if (el.shadowRoot) findDeposits(el.shadowRoot, d + 1);
        }
      };
      findDeposits(document, 0);
      return results;
    })()`) as Array<{ date: string; amount: number; balance: number | null }>;

    for (const dep of newDeposits) {
      const key = `${dep.date}|${dep.amount}`;
      if (!seen.has(key)) {
        seen.add(key);

        // Parse date to YYYY-MM-DD
        const parsedDate = parseTransactionDate(dep.date);
        if (!parsedDate) continue;

        // Filter by date range
        if (startDate && parsedDate < startDate) continue;
        if (endDate && parsedDate > endDate) continue;

        deposits.push({
          date: parsedDate,
          amount: dep.amount,
          balance_after: dep.balance,
        });
      }
    }

    // Check if we found new deposits
    if (deposits.length === previousCount) {
      noNewCount++;
      if (noNewCount >= 5) break; // No new deposits after 5 scrolls
    } else {
      noNewCount = 0;
      previousCount = deposits.length;
    }

    // Check if we've scrolled past our start date
    if (startDate && deposits.length > 0) {
      const oldestDate = deposits.reduce((min, d) => (d.date < min ? d.date : min), deposits[0].date);
      if (oldestDate < startDate) break;
    }

    // Scroll down in the transaction list
    await p.evaluate(`(() => {
      const findScrollable = (root, depth) => {
        if (depth > 10) return null;
        const candidates = root.querySelectorAll('[class*="scroll"], [class*="transaction-list"], [style*="overflow"]');
        for (const c of candidates) {
          if (c.scrollHeight > c.clientHeight) return c;
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) { const f = findScrollable(el.shadowRoot, depth + 1); if (f) return f; }
        }
        return null;
      };
      const scrollable = findScrollable(document, 0);
      if (scrollable) scrollable.scrollTop += 500;
      else window.scrollBy(0, 500);
    })()`);

    await p.waitForTimeout(1000);
  }

  // Sort by date descending (newest first)
  deposits.sort((a, b) => b.date.localeCompare(a.date));

  return deposits;
}

/**
 * Parse various date formats to YYYY-MM-DD.
 */
function parseTransactionDate(dateStr: string): string | null {
  if (!dateStr) return null;

  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04',
    May: '05', Jun: '06', Jul: '07', Aug: '08',
    Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };

  // Format: "Oct 31, 2025" or "Oct 31 2025"
  const m1 = dateStr.match(/(\w{3})\s+(\d{1,2}),?\s*(\d{4})/);
  if (m1) {
    const month = months[m1[1]];
    if (month) return `${m1[3]}-${month}-${m1[2].padStart(2, '0')}`;
  }

  // Format: "10/31/2025"
  const m2 = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m2) {
    return `${m2[3]}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
  }

  // Format: "Oct 31" (current year) — from short display
  const m3 = dateStr.match(/(\w{3})\s+(\d{1,2})$/);
  if (m3) {
    const month = months[m3[1]];
    const year = new Date().getFullYear();
    if (month) return `${year}-${month}-${m3[2].padStart(2, '0')}`;
  }

  return null;
}

/**
 * Click a specific deposit transaction by matching date and amount.
 */
async function clickDepositByDateAmount(
  p: Page,
  date: string,
  amount: number
): Promise<boolean> {
  // Convert YYYY-MM-DD to display format "Mar 16"
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [, mm, dd] = date.split('-');
  const displayDate = `${monthNames[parseInt(mm) - 1]} ${parseInt(dd)}`;

  // Find and click the DEPOSIT button matching the target date
  // Banno renders each transaction as a <button> containing "DEPOSIT {date}"
  // Use string-based evaluate to avoid tsx __name decorator issue
  const escapedDate = displayDate.replace(/'/g, "\\'");
  const clicked = await p.evaluate(`(() => {
    const targetDate = '${escapedDate}';
    const findAndClick = (root, d) => {
      if (d > 10) return false;
      for (const el of root.querySelectorAll('*')) {
        const text = (el.textContent || '').trim();
        // Match elements with "DEPOSIT" text whose parent button contains the date
        if (text === 'DEPOSIT' || text === 'INTEREST DEPOSIT') {
          let parent = el;
          for (let i = 0; i < 8; i++) {
            if (!parent.parentElement) break;
            parent = parent.parentElement;
            if (parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'button') break;
          }
          const parentText = (parent.textContent || '').trim();
          if (parentText.includes(targetDate)) {
            parent.click();
            return true;
          }
        }
        if (el.shadowRoot && findAndClick(el.shadowRoot, d+1)) return true;
      }
      return false;
    };
    return findAndClick(document, 0);
  })()`) as boolean;

  await p.waitForTimeout(2000);
  return true;
}

// Reusable shadow DOM helpers (string-based to avoid tsx __name issue)
const SHADOW_FIND = `const find = (root, sel, d) => {
  if (d > 10) return null;
  const el = root.querySelector(sel);
  if (el) return el;
  for (const c of root.querySelectorAll('*')) {
    if (c.shadowRoot) { const f = find(c.shadowRoot, sel, d+1); if (f) return f; }
  }
  return null;
};`;

const SHADOW_CLICK_TEXT = `const clickText = (root, label, d) => {
  if (d > 10) return false;
  for (const el of root.querySelectorAll('*')) {
    if (el.textContent?.trim() === label) { el.click(); return true; }
    if (el.shadowRoot && clickText(el.shadowRoot, label, d+1)) return true;
  }
  return false;
};`;

const SHADOW_FIND_IMG = `const findImg = (root, d) => {
  if (d > 10) return null;
  const candidates = [];
  const scan = (r, depth) => {
    if (depth > 10) return;
    for (const img of r.querySelectorAll('img')) {
      const src = (img.src || img.currentSrc || '').toLowerCase();
      const alt = (img.alt || '').toLowerCase();
      const isLogo = src.includes('logo') || src.includes('brand') || src.includes('menu-logo')
        || alt.includes('logo') || alt.includes('simmons');
      const w = img.naturalWidth || img.offsetWidth || 0;
      const h = img.naturalHeight || img.offsetHeight || 0;
      if (w > 100) candidates.push({ img, w, h, isLogo, area: w * Math.max(h, 1) });
    }
    for (const el of r.querySelectorAll('*')) {
      if (el.shadowRoot) scan(el.shadowRoot, depth + 1);
    }
  };
  scan(root, 0);
  // Filter out logos, prefer non-logo images
  const nonLogos = candidates.filter(c => !c.isLogo);
  const pool = nonLogos.length > 0 ? nonLogos : candidates;
  // Sort by area (largest first), prefer images with actual height
  pool.sort((a, b) => {
    if (a.h > 10 && b.h <= 10) return -1;
    if (b.h > 10 && a.h <= 10) return 1;
    return b.area - a.area;
  });
  return pool.length > 0 ? pool[0].img : null;
};`;

const IMG_TO_BASE64 = `const imgToBase64 = (img) => {
  if (!img) return null;
  const w = img.naturalWidth || img.offsetWidth || img.width;
  const h = img.naturalHeight || img.offsetHeight || img.height;
  if (!w || w < 50) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h > 10 ? h : Math.round(w * 0.55); // estimate height for 0-height images
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch(e) {
    return null;
  }
};`;

/**
 * Once a deposit's Transaction Details dialog is open:
 * 1. Click the thumbnail icon (with badge count) to open the image viewer modal
 * 2. Screenshot each image (front + back)
 * 3. Navigate with the "<" back arrow or clicking the image area
 */
async function extractDepositImages(
  p: Page,
  entry: DepositEntry
): Promise<DepositInfo | null> {
  // Step 1: Click the thumbnail icon to open the image viewer
  // The thumbnail is a small icon with a number badge, located in the "Images" row
  // Use Playwright getByText to find "Images" label, then click the nearby thumbnail

  // Find the thumbnail badge — it's a small element containing just a number (the image count)
  // Located inside the Transaction details dialog
  let totalImages = 0;

  try {
    // The thumbnail is a clickable element with a document stack icon + number badge
    // It's inside the "Images" section of the Transaction details dialog
    // Strategy: find ALL clickable elements in the dialog area that contain just a number
    // (the badge shows "4", "5", etc.)

    // First, dump all interactive elements in the dialog to find the thumbnail
    const thumbInfo = await p.evaluate(`(() => {
      const results = [];
      const scan = (root, d) => {
        if (d > 10) return;
        for (const el of root.querySelectorAll('button, a, [role="button"], [tabindex]')) {
          const rect = el.getBoundingClientRect();
          // Must be in the dialog area (center of page)
          if (rect.x > 300 && rect.x < 800 && rect.y > 200 && rect.y < 600 && rect.width > 20 && rect.width < 120) {
            const text = (el.textContent || '').trim();
            results.push({
              tag: el.tagName,
              text: text.substring(0, 50),
              x: rect.x, y: rect.y, w: rect.width, h: rect.height,
              classes: (el.className || '').toString().substring(0, 100)
            });
          }
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) scan(el.shadowRoot, d + 1);
        }
      };
      scan(document, 0);
      return results;
    })()`) as Array<any>;

    console.log(`[extract] Found ${thumbInfo.length} clickable elements in dialog:`);
    for (const t of thumbInfo) {
      console.log(`[extract]   ${t.tag} "${t.text}" at (${Math.round(t.x)},${Math.round(t.y)}) ${Math.round(t.w)}x${Math.round(t.h)}`);
    }

    // Find the thumbnail: a clickable element whose text is just a number (the badge count)
    // or that contains an image/svg icon
    let clicked = false;
    for (const t of thumbInfo) {
      // The thumbnail badge text is just a number like "4", "5", "2"
      if (/^\d+$/.test(t.text) && parseInt(t.text) >= 1 && parseInt(t.text) <= 30) {
        console.log(`[extract] Clicking badge "${t.text}" at (${Math.round(t.x + t.w/2)}, ${Math.round(t.y + t.h/2)})`);
        await p.mouse.click(t.x + t.w / 2, t.y + t.h / 2);
        clicked = true;
        break;
      }
    }

    // Fallback: click any small button/element near the "Images" text
    if (!clicked) {
      const imagesLabel = p.getByText('Images', { exact: true });
      const count = await imagesLabel.count();
      for (let i = 0; i < count; i++) {
        const el = imagesLabel.nth(i);
        const box = await el.boundingBox();
        if (!box || box.x < 200) continue;
        console.log(`[extract] Fallback: clicking below "Images" at (${Math.round(box.x + 25)}, ${Math.round(box.y + box.height + 30)})`);
        await p.mouse.click(box.x + 25, box.y + box.height + 30);
        clicked = true;
        break;
      }
    }

    if (clicked) {
      await p.waitForTimeout(3000);
      // Save debug screenshot
      try {
        const buf = await p.screenshot({ type: 'png' });
        fs.writeFileSync(path.join(SCREENSHOT_DIR, `after-thumb-click-${entry.date}.png`), buf);
        console.log(`[extract] Screenshot saved (${buf.length}b)`);
      } catch (e: any) { console.warn(`[extract] Screenshot failed: ${e.message}`); }

      // Check what's on the page now — look for viewer indicators in shadow DOM
      const pageState = await p.evaluate(`(() => {
        const texts = [];
        const scan = (root, d) => {
          if (d > 10) return;
          for (const el of root.querySelectorAll('*')) {
            const t = (el.textContent || '').trim();
            if (t.length > 0 && t.length < 30 && el.children.length === 0) {
              texts.push(t);
            }
            if (el.shadowRoot) scan(el.shadowRoot, d + 1);
          }
        };
        scan(document, 0);
        // Return texts that look like viewer elements
        return texts.filter(t => /Image|of|View|Deposit|Check|front|back/i.test(t)).slice(0, 20);
      })()`) as string[];
      console.log(`[extract] Page text after click: ${JSON.stringify(pageState)}`);
    }

    // Get the "N of M" count — search in shadow DOM since viewer is a web component
    const counterText = await p.evaluate(`(() => {
      const find = (root, d) => {
        if (d > 15) return null;
        for (const el of root.querySelectorAll('*')) {
          const t = (el.textContent || '').trim();
          const m = t.match(/^(\\d+)\\s+of\\s+(\\d+)$/);
          if (m) return t;
          if (el.shadowRoot) { const f = find(el.shadowRoot, d+1); if (f) return f; }
        }
        return null;
      };
      return find(document, 0);
    })()`) as string | null;

    if (counterText) {
      const m = counterText.match(/(\d+) of (\d+)/);
      if (m) totalImages = parseInt(m[2]);
      console.log(`[extract] Counter: "${counterText}" → ${totalImages} images`);
    }
  } catch (e: any) {
    console.warn(`[extract] Error opening viewer: ${e.message}`);
  }

  if (totalImages === 0) {
    console.warn('[extract] Image viewer did not open or no images found');
    try {
      const buf = await p.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(SCREENSHOT_DIR, `no-viewer-${entry.date}.png`), buf);
    } catch {}
    return null;
  }

  console.log(`[extract] Viewer open with ${totalImages} images`);

  // Step 2: Iterate through images using the viewer
  // The viewer shows one image at a time with "N of M" counter
  // Navigation: use keyboard ArrowRight or click right side of viewer
  const images: CheckImageInfo[] = [];
  let depositSlipMetadata: any = {};

  for (let imgIdx = 1; imgIdx <= totalImages; imgIdx++) {
    try {
      // Navigate to next image (for imgIdx > 1)
      if (imgIdx > 1) {
        // Try keyboard navigation first
        await p.keyboard.press('ArrowRight');
        await p.waitForTimeout(2000);

        // Verify we advanced by checking counter in shadow DOM
        const counter = await p.evaluate(`(() => {
          const find = (root, d) => {
            if (d > 15) return null;
            for (const el of root.querySelectorAll('*')) {
              const t = (el.textContent || '').trim();
              if (/^\\d+\\s+of\\s+\\d+$/.test(t)) return t;
              if (el.shadowRoot) { const f = find(el.shadowRoot, d+1); if (f) return f; }
            }
            return null;
          };
          return find(document, 0);
        })()`) as string | null;
        const currentNum = counter ? parseInt(counter.split(' ')[0]) : 0;
        if (currentNum < imgIdx) {
          // ArrowRight didn't work, try clicking right side of the modal
          console.log(`[extract] ArrowRight didn't advance (at ${currentNum}), trying click...`);
          // Find the "Image N" header to locate the modal
          const headerEl = p.getByText(/^Image \d+$/).first();
          const headerBox = await headerEl.boundingBox().catch(() => null);
          if (headerBox) {
            // Click right side of the modal area (next image)
            await p.mouse.click(headerBox.x + 500, headerBox.y + 300);
            await p.waitForTimeout(2000);
          }
        }
      }

      // Wait for image to render
      await p.waitForTimeout(1000);

      // Get footer info from shadow DOM
      const footerText = await p.evaluate(`(() => {
        const find = (root, d) => {
          if (d > 15) return null;
          for (const el of root.querySelectorAll('*')) {
            const t = (el.textContent || '').trim();
            if (/^\\d+\\s+of\\s+\\d+$/.test(t)) return t;
            if (el.shadowRoot) { const f = find(el.shadowRoot, d+1); if (f) return f; }
          }
          return null;
        };
        return find(document, 0);
      })()`) as string || '';
      console.log(`[extract] Image ${imgIdx}: counter="${footerText}"`);

      // Capture the image via full-page screenshot
      // This is guaranteed to capture whatever is visually rendered
      const frontScreenshot = await p.screenshot({ type: 'png' });
      const frontBase64 = frontScreenshot.toString('base64');
      console.log(`[extract] Image ${imgIdx}: captured front screenshot (${frontScreenshot.length}b)`);

      images.push({
        index: imgIdx,
        amount: null,
        type: imgIdx === 1 ? 'deposit_slip' : 'check',
        front_base64: frontBase64,
      });

      // Extract deposit slip metadata from first image
      if (imgIdx === 1) {
        const pageText = await p.evaluate(`document.body?.textContent || ''`) as string;
        const branchMatch = pageText.match(/Branch Name:\s*(.+?)(?:\n|Teller)/);
        const tellerMatch = pageText.match(/Teller ID:\s*(\S+)/);
        depositSlipMetadata = {
          branch_name: branchMatch?.[1]?.trim() || null,
          teller_id: tellerMatch?.[1] || null,
        };
      }

      // Try to get back of check — find "View back" in shadow DOM and click it
      try {
        const hasViewBack = await p.evaluate(`(() => {
          const find = (root, d) => {
            if (d > 15) return false;
            for (const el of root.querySelectorAll('*')) {
              if ((el.textContent || '').trim() === 'View back' && el.children.length === 0) return true;
              if (el.shadowRoot && find(el.shadowRoot, d+1)) return true;
            }
            return false;
          };
          return find(document, 0);
        })()`) as boolean;
        if (hasViewBack) {
          await p.evaluate(`(() => {
            const find = (root, d) => {
              if (d > 15) return false;
              for (const el of root.querySelectorAll('*')) {
                if ((el.textContent || '').trim() === 'View back' && el.children.length === 0) { el.click(); return true; }
                if (el.shadowRoot && find(el.shadowRoot, d+1)) return true;
              }
              return false;
            };
            find(document, 0);
          })()`);
          await p.waitForTimeout(2000);

          const backScreenshot = await p.screenshot({ type: 'png' });
          images[images.length - 1].back_base64 = backScreenshot.toString('base64');
          console.log(`[extract] Image ${imgIdx}: captured back screenshot`);

          // Go back to front
          try {
            await p.evaluate(`(() => {
              const find = (root, d) => {
                if (d > 15) return false;
                for (const el of root.querySelectorAll('*')) {
                  if ((el.textContent || '').trim() === 'View front' && el.children.length === 0) { el.click(); return true; }
                  if (el.shadowRoot && find(el.shadowRoot, d+1)) return true;
                }
                return false;
              };
              find(document, 0);
            })()`);
            await p.waitForTimeout(500);
          } catch {}
        }
      } catch {}
    } catch (err: any) {
      console.error(`[extract] Error on image ${imgIdx}: ${err.message}`);
    }
  }

  // Close the viewer by pressing Escape or clicking the back arrow
  try {
    await p.keyboard.press('Escape');
  } catch {}

  return {
    date: entry.date,
    amount: entry.amount,
    balance_after: entry.balance_after,
    image_count: totalImages,
    images,
    ...depositSlipMetadata,
  };
}
