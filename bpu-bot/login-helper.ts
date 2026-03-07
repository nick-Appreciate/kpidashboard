/**
 * BPU Login Helper
 *
 * Interactive CLI tool to log in to mymeter.bpu.com.
 * Opens a visible browser window where you can solve the CAPTCHA manually.
 * On successful login, saves the session to .session-state.json.
 *
 * Usage: npm run login
 */
import 'dotenv/config';
import { interactiveLogin, closeBrowser } from './browser';

const BPU_USERNAME = process.env.BPU_USERNAME || '';
const BPU_PASSWORD = process.env.BPU_PASSWORD || '';

async function main() {
  console.log('');
  console.log('🔐 BPU Login Helper');
  console.log('═══════════════════');
  console.log('');

  if (!BPU_USERNAME || !BPU_PASSWORD) {
    console.error('❌ BPU_USERNAME and BPU_PASSWORD must be set in .env file');
    console.error('   Copy .env.example to .env and fill in your credentials.');
    process.exit(1);
  }

  console.log(`   Username: ${BPU_USERNAME}`);
  console.log('   Password: ********');
  console.log('');
  console.log('   A browser window will open. Steps:');
  console.log('   1. Credentials will be auto-filled');
  console.log('   2. Solve the CAPTCHA');
  console.log('   3. Click the Login button');
  console.log('   4. Session will be saved automatically');
  console.log('');

  const result = await interactiveLogin(BPU_USERNAME, BPU_PASSWORD);

  if (result.success) {
    console.log('');
    console.log('✅ ' + result.message);
    console.log('   You can now start the server with `npm run dev` or `npm start`.');
    console.log('   The session will persist across restarts.');
  } else {
    console.log('');
    console.log('❌ ' + result.message);
    console.log('   Please try again.');
  }

  await closeBrowser();
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
