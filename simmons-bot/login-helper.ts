/**
 * Login Helper — Automated login to Simmons Bank with TOTP.
 *
 * Unlike BPU/COMO which need manual CAPTCHA solving, Simmons Bank
 * login is fully automated (username + password + TOTP).
 *
 * Usage:
 *   npm run login       # login and save session
 */
import 'dotenv/config';
import { ensureBrowser, login, isLoggedIn, closeBrowser } from './browser';

const SIMMONS_USERNAME = process.env.SIMMONS_USERNAME || '';
const SIMMONS_PASSWORD = process.env.SIMMONS_PASSWORD || '';
const SIMMONS_TOTP_SECRET = process.env.SIMMONS_TOTP_SECRET || '';

async function main() {
  console.log('');
  console.log('Simmons Bank Login');
  console.log('==================');

  if (!SIMMONS_USERNAME || !SIMMONS_PASSWORD || !SIMMONS_TOTP_SECRET) {
    console.error('SIMMONS_USERNAME, SIMMONS_PASSWORD, and SIMMONS_TOTP_SECRET must be set in .env');
    process.exit(1);
  }

  console.log(`  Username: ${SIMMONS_USERNAME}`);
  console.log('  Login is fully automated (TOTP).');
  console.log('');

  await ensureBrowser();

  // Check if already logged in from saved session
  const status = await isLoggedIn();
  if (status.loggedIn) {
    console.log('Already logged in from saved session.');
    await closeBrowser();
    process.exit(0);
  }

  console.log('Logging in...');
  const result = await login(SIMMONS_USERNAME, SIMMONS_PASSWORD, SIMMONS_TOTP_SECRET);

  if (result.success) {
    console.log('Login successful!');
    console.log('Session saved. You can now start the server with `npm run dev` or `npm start`.');
  } else {
    console.log('Login failed: ' + (result.error || 'unknown error'));
  }

  await closeBrowser();
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
