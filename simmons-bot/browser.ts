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
    console.log('[login] Step 1: Navigate to simmonsbank.com');
    await p.goto('https://www.simmonsbank.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await p.waitForTimeout(2000);

    // Click Business tab — must find the VISIBLE one (page has multiple duplicates)
    console.log('[login] Step 2: Click Business tab');
    const tabs = await p.$$('[role="tab"]');
    for (const tab of tabs) {
      const text = await tab.textContent();
      if (text?.trim() === 'Business' && await tab.isVisible()) {
        await tab.click();
        break;
      }
    }
    await p.waitForTimeout(1000);

    // Enter username in User ID field — field name is "id", need the visible one
    console.log('[login] Step 3: Enter username');
    const userInputs = await p.$$('input[name="id"]');
    let userInput = null;
    for (const input of userInputs) {
      if (await input.isVisible()) {
        userInput = input;
        break;
      }
    }
    if (!userInput) throw new Error('Could not find visible User ID input');
    await userInput.click();
    await p.waitForTimeout(200);
    await p.keyboard.type(username, { delay: 80 });
    await p.waitForTimeout(500);

    // Click the visible "Go" submit button
    const goButtons = await p.$$('button.btn-login-js, button:has-text("Go")');
    for (const btn of goButtons) {
      if (await btn.isVisible()) {
        await btn.click();
        break;
      }
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

    // Click Sign In — use locator with text matching (pierces shadow DOM)
    const signInBtn = p.getByRole('button', { name: /Sign [iI]n/ }).first();
    try {
      await signInBtn.click({ timeout: 5000 });
    } catch {
      // Fallback: try jha-button inner button
      const jhaSignIn = p.locator('jha-button:has-text("Sign in") >> button').first();
      await jhaSignIn.click({ timeout: 5000 }).catch(() => {
        // Last resort: press Enter
        return p.keyboard.press('Enter');
      });
    }
    await p.waitForTimeout(8000);

    // Step 5: TOTP page (also shadow DOM)
    console.log('[login] Step 5: Enter TOTP code');
    const totpCode = generateTOTP(totpSecret);
    console.log(`[login] Generated TOTP: ${totpCode}`);

    // Find TOTP input via Playwright selectors (shadow-piercing)
    try {
      const totpInput = p.locator('input[inputmode="numeric"]').first();
      await totpInput.waitFor({ state: 'visible', timeout: 10000 });
      await totpInput.click();
    } catch {
      const totpInput2 = p.locator('input[type="tel"]').first();
      await totpInput2.click({ timeout: 5000 });
    }
    await p.waitForTimeout(300);
    await p.keyboard.type(totpCode, { delay: 75 });
    await p.waitForTimeout(500);

    // Click Verify/Submit/Continue
    const verifyBtn = p.getByRole('button', { name: /Verify|Submit|Continue/ }).first();
    try {
      await verifyBtn.click({ timeout: 5000 });
    } catch {
      const jhaVerify = p.locator('jha-button:has-text("Verify") >> button').first();
      await jhaVerify.click({ timeout: 5000 }).catch(() => p.keyboard.press('Enter'));
    }
    await p.waitForTimeout(8000);

    // Step 6: Accept User Agreement if shown (also shadow DOM)
    const checkbox = p.locator('input[type="checkbox"]').first();
    const hasAgreement = await checkbox.isVisible().catch(() => false);
    if (hasAgreement) {
      console.log('[login] Step 6: Accepting user agreement');
      await checkbox.check();
      await p.waitForTimeout(500);
      const acceptBtn = p.getByRole('button', { name: /Accept|Continue|Agree/ }).first();
      try {
        await acceptBtn.click({ timeout: 5000 });
      } catch {
        const jhaAccept = p.locator('jha-button:has-text("Accept") >> button').first();
        await jhaAccept.click({ timeout: 5000 }).catch(() => p.keyboard.press('Enter'));
      }
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
  for (const img of root.querySelectorAll('img')) {
    if (img.naturalWidth > 500 && img.naturalHeight > 200) return img;
  }
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) { const f = findImg(el.shadowRoot, d+1); if (f) return f; }
  }
  return null;
};`;

const IMG_TO_BASE64 = `const imgToBase64 = (img) => {
  if (!img) return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/png');
};`;

/**
 * Once a deposit's Transaction Details dialog is open,
 * click into Images, iterate through each image, and extract as base64 PNG.
 */
async function extractDepositImages(
  p: Page,
  entry: DepositEntry
): Promise<DepositInfo | null> {
  // The detail panel already shows the image list: "1. Deposit slip", "2. Check $100.00", etc.
  // Extract the image list with amounts and count from the detail text
  const imageList = await p.evaluate(`(() => {
    const results = [];
    const scan = (root, d) => {
      if (d > 10) return;
      for (const el of root.querySelectorAll('*')) {
        const text = (el.textContent || '').trim();
        // Match "1. Deposit slip" or "2. Check" patterns
        const m = text.match(/^(\\d+)\\.\\s*(Deposit slip|Check)/);
        if (m && text.length < 50) {
          const idx = parseInt(m[1]);
          const type = m[2] === 'Deposit slip' ? 'deposit_slip' : 'check';
          const am = text.match(/\\$([\\d,]+\\.\\d{2})/);
          if (!results.find(r => r.index === idx)) {
            results.push({ index: idx, amount: am ? parseFloat(am[1].replace(/,/g, '')) : null, type });
          }
        }
        if (el.shadowRoot) scan(el.shadowRoot, d+1);
      }
    };
    scan(document, 0);
    return results;
  })()`) as Array<{ index: number; amount: number | null; type: string }>;

  // Also get the "X of Y" count as fallback
  const imageInfo = await p.evaluate(`(() => {
    const findText = (root, d) => {
      if (d > 10) return null;
      for (const el of root.querySelectorAll('*')) {
        const t = (el.textContent || '').trim();
        const m = t.match(/^(\\d+)\\s+of\\s+(\\d+)$/);
        if (m) return { current: parseInt(m[1]), total: parseInt(m[2]) };
        if (el.shadowRoot) { const f = findText(el.shadowRoot, d+1); if (f) return f; }
      }
      return null;
    };
    return findText(document, 0);
  })()`) as { current: number; total: number } | null;

  const totalImages = imageList.length || imageInfo?.total || 0;
  if (totalImages === 0) {
    console.warn('[extract] Could not determine image count');
    return null;
  }

  console.log(`[extract] Deposit has ${totalImages} images (${imageList.length} from list, ${imageInfo?.total || 0} from counter)`);

  const images: CheckImageInfo[] = [];
  let depositSlipMetadata: any = {};

  for (let imgIdx = 1; imgIdx <= totalImages; imgIdx++) {
    try {
      // Click the image item in the list (e.g., "1. Deposit slip", "2. Check")
      // Use string-based evaluate to avoid tsx __name decorator issue
      await p.evaluate(`(() => {
        const idx = ${imgIdx};
        const prefix = idx + '.';
        const findAndClick = (root, d) => {
          if (d > 10) return false;
          for (const el of root.querySelectorAll('*')) {
            const text = (el.textContent || '').trim();
            if (text.startsWith(prefix) && (text.includes('Deposit slip') || text.includes('Check')) && text.length < 50) {
              el.click();
              return true;
            }
            if (el.shadowRoot && findAndClick(el.shadowRoot, d+1)) return true;
          }
          return false;
        };
        findAndClick(document, 0);
      })()`);
      // Wait for image to load
      await p.waitForTimeout(3000);

      // Extract check image at native resolution
      const imageData = await p.evaluate(`(() => {
        ${SHADOW_FIND_IMG}
        ${IMG_TO_BASE64}
        return imgToBase64(findImg(document, 0));
      })()`) as string | null;

      if (imageData) {
        const base64 = (imageData as string).replace(/^data:image\/png;base64,/, '');
        const listEntry = imageList.find((e) => e.index === imgIdx);

        images.push({
          index: imgIdx,
          amount: listEntry?.amount || null,
          type: imgIdx === 1 ? 'deposit_slip' : 'check',
          front_base64: base64,
        });

        // Extract deposit slip metadata
        if (imgIdx === 1) {
          depositSlipMetadata = await p.evaluate(`(() => {
            const text = document.body?.textContent || '';
            const branchMatch = text.match(/Branch Name:\\s*(.+?)(?:\\n|Teller)/);
            const tellerMatch = text.match(/Teller ID:\\s*(\\S+)/);
            const wsMatch = text.match(/Workstation:\\s*(\\S+)/);
            const hinMatch = text.match(/HIN #:\\s*(\\S+)/);
            return {
              branch_name: branchMatch?.[1]?.trim() || null,
              teller_id: tellerMatch?.[1] || null,
              workstation: wsMatch?.[1] || null,
              hin_number: hinMatch?.[1] || null,
            };
          })()`);
        }

        // Try to get the back of the check
        const hasViewBack = await p.evaluate(`(() => {
          const find = (root, d) => {
            if (d > 10) return false;
            for (const el of root.querySelectorAll('*')) {
              if (el.textContent?.includes('View back')) return true;
              if (el.shadowRoot && find(el.shadowRoot, d+1)) return true;
            }
            return false;
          };
          return find(document, 0);
        })()`) as boolean;

        if (hasViewBack) {
          await p.evaluate(`(() => {
            ${SHADOW_CLICK_TEXT}
            clickText(document, 'View back', 0);
          })()`);
          await p.waitForTimeout(1500);

          const backData = await p.evaluate(`(() => {
            ${SHADOW_FIND_IMG}
            ${IMG_TO_BASE64}
            return imgToBase64(findImg(document, 0));
          })()`) as string | null;

          if (backData) {
            images[images.length - 1].back_base64 = (backData as string).replace(
              /^data:image\/png;base64,/,
              ''
            );
          }

          await p.evaluate(`(() => {
            ${SHADOW_CLICK_TEXT}
            clickText(document, 'View front', 0);
          })()`);
          await p.waitForTimeout(500);
        }
      }

      // Go back to image list
      await p.evaluate(`(() => {
        const findAndClick = (root, d) => {
          if (d > 10) return false;
          for (const el of root.querySelectorAll('*')) {
            const t = el.textContent || '';
            if (t.match(/\\d+\\s+of\\s+\\d+/) && el.tagName !== 'BODY') { el.click(); return true; }
            if (el.shadowRoot && findAndClick(el.shadowRoot, d+1)) return true;
          }
          return false;
        };
        findAndClick(document, 0);
      })()`);
      await p.waitForTimeout(1000);
    } catch (err: any) {
      console.error(`[extract] Error extracting image ${imgIdx}: ${err.message}`);
    }
  }

  return {
    date: entry.date,
    amount: entry.amount,
    balance_after: entry.balance_after,
    image_count: totalImages,
    images,
    ...depositSlipMetadata,
  };
}
