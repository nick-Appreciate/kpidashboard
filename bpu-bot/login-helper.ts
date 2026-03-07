/**
 * Login Helper — supports both BPU and COMO MyMeter portals.
 *
 * Usage:
 *   npm run login              # login to BPU (default)
 *   npm run login -- --como    # login to COMO
 *   npm run login -- --both    # login to both sequentially
 */
import 'dotenv/config';
import { interactiveLogin, closeBrowser } from './browser';
import { interactiveComoLogin, closeComoBrowser } from './como-browser';

const BPU_USERNAME = process.env.BPU_USERNAME || '';
const BPU_PASSWORD = process.env.BPU_PASSWORD || '';
const COMO_USERNAME = process.env.COMO_USERNAME || '';
const COMO_PASSWORD = process.env.COMO_PASSWORD || '';

async function loginBpu(): Promise<boolean> {
  console.log('');
  console.log('🔐 BPU Login (mymeter.bpu.com)');
  console.log('═══════════════════════════════');

  if (!BPU_USERNAME || !BPU_PASSWORD) {
    console.error('❌ BPU_USERNAME and BPU_PASSWORD must be set in .env');
    return false;
  }

  console.log(`   Username: ${BPU_USERNAME}`);
  console.log('');
  console.log('   A browser window will open. Solve CAPTCHA and click Login.');
  console.log('');

  const result = await interactiveLogin(BPU_USERNAME, BPU_PASSWORD);
  await closeBrowser();

  if (result.success) {
    console.log('✅ BPU: ' + result.message);
  } else {
    console.log('❌ BPU: ' + result.message);
  }
  return result.success;
}

async function loginComo(): Promise<boolean> {
  console.log('');
  console.log('🔐 COMO Login (myutilitybill.como.gov)');
  console.log('═══════════════════════════════════════');

  if (!COMO_USERNAME || !COMO_PASSWORD) {
    console.error('❌ COMO_USERNAME and COMO_PASSWORD must be set in .env');
    return false;
  }

  console.log(`   Username: ${COMO_USERNAME}`);
  console.log('');
  console.log('   A browser window will open. Solve CAPTCHA and click Login.');
  console.log('');

  const result = await interactiveComoLogin(COMO_USERNAME, COMO_PASSWORD);
  await closeComoBrowser();

  if (result.success) {
    console.log('✅ COMO: ' + result.message);
  } else {
    console.log('❌ COMO: ' + result.message);
  }
  return result.success;
}

async function main() {
  const args = process.argv.slice(2);
  const wantComo = args.includes('--como');
  const wantBoth = args.includes('--both');
  const wantBpu = !wantComo || wantBoth; // default to BPU

  let success = true;

  if (wantBpu || wantBoth) {
    const ok = await loginBpu();
    if (!ok) success = false;
  }

  if (wantComo || wantBoth) {
    const ok = await loginComo();
    if (!ok) success = false;
  }

  console.log('');
  if (success) {
    console.log('You can now start the server with `npm run dev` or `npm start`.');
  } else {
    console.log('Some logins failed. Please try again.');
  }

  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
