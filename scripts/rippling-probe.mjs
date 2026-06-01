/**
 * scripts/rippling-probe.mjs
 *
 * One-shot probe of the Rippling Platform API:
 *   1. Lists employees and prints any matching Will Herbert / Brett Seldomridge
 *   2. Probes likely GET time-entries endpoints to find the working one
 *   3. Fetches last 30 days of clock-in/out for the matched workers
 *
 * Reads RIPPLING_API_TOKEN from .env.local at the repo root.
 * Run:  node scripts/rippling-probe.mjs
 */

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'url';

loadEnv({ path: fileURLToPath(new URL('../.env.local', import.meta.url)), override: true });

const TOKEN = process.env.RIPPLING_API_TOKEN;
if (!TOKEN) {
  console.error('❌ RIPPLING_API_TOKEN missing in .env.local');
  process.exit(1);
}

const BASE = 'https://api.rippling.com/platform/api';
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/json',
};

async function get(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers: HEADERS });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, body };
}

const TARGETS = ['Will Herbert', 'Brett Seldomridge'];
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

(async () => {
  console.log('🔍 Step 1: List employees');
  const { status, body } = await get('/employees');
  if (status !== 200) {
    console.error('   ❌ /employees returned', status, body);
    process.exit(1);
  }
  const employees = Array.isArray(body) ? body : (body.results || body.employees || []);
  console.log(`   ✅ got ${employees.length} employees`);
  // Find the targets
  const matches = [];
  for (const e of employees) {
    const name = e.preferredFirstName
      ? `${e.preferredFirstName} ${e.preferredLastName || e.lastName || ''}`
      : `${e.firstName || ''} ${e.lastName || ''}`;
    const cleaned = norm(name);
    if (TARGETS.some((t) => cleaned.includes(norm(t)))) {
      matches.push({ id: e.id, userId: e.userId, name: name.trim(), workEmail: e.workEmail });
    }
  }
  console.log('\n👥 Matched workers:');
  matches.forEach((m) => console.log('   ', m));

  if (matches.length === 0) {
    console.log('\n📝 First 5 employees in response (for reference):');
    employees.slice(0, 5).forEach((e) => console.log('   ', {
      id: e.id, firstName: e.firstName, lastName: e.lastName, workEmail: e.workEmail,
    }));
    process.exit(0);
  }

  // ── Step 2: Probe time-entries endpoint variations ────────────────────────
  console.log('\n🧪 Step 2: Probe GET endpoints for time entries');
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const worker = matches[0].id;

  const candidates = [
    { path: '/time_entries', q: { worker_id: worker, start_date: since, limit: 5 } },
    { path: '/time_entries', q: { workerId: worker, startDate: since, limit: 5 } },
    { path: '/time_entries', q: { employee_id: worker, since, limit: 5 } },
    { path: '/time_entries',                q: { limit: 5 } },
    { path: '/employees/' + worker + '/time_entries', q: { limit: 5 } },
    { path: '/time_and_attendance/time_entries', q: { worker_id: worker, limit: 5 } },
    { path: '/time_cards', q: { worker_id: worker, limit: 5 } },
  ];
  for (const c of candidates) {
    const { status, body } = await get(c.path, c.q);
    console.log(`   ${status} ${c.path} ${JSON.stringify(c.q)}`);
    if (status === 200) {
      console.log('   ✅ payload preview:', JSON.stringify(body).slice(0, 400));
      break;
    } else if (status !== 404 && status !== 405) {
      console.log('       body:', JSON.stringify(body).slice(0, 200));
    }
  }
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
