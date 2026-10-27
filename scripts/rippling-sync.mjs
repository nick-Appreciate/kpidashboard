/**
 * scripts/rippling-sync.mjs
 *
 * Refreshes the full Rippling roster into workers_rippling, links commission
 * payees to their worker IDs, then pulls time entries for tracked workers
 * (workers_rippling.is_tracked = true) into time_entries_rippling. By default,
 * fetches the last 90 days.
 *
 * Run:
 *   node scripts/rippling-sync.mjs                # last 90 days (default)
 *   node scripts/rippling-sync.mjs --days 30      # custom window
 *   node scripts/rippling-sync.mjs --since 2025-01-01
 *   node scripts/rippling-sync.mjs --dry-run      # no DB writes
 *
 * Reads RIPPLING_API_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */

import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'url';

// Load both .env.local (root) for SUPABASE_URL + RIPPLING_API_TOKEN, and
// simmons-bot/.env for the legacy JWT-style SUPABASE_SERVICE_KEY.
loadEnv({ path: fileURLToPath(new URL('../.env.local', import.meta.url)), override: true });
loadEnv({ path: fileURLToPath(new URL('../simmons-bot/.env', import.meta.url)) });

const RIP_TOKEN = process.env.RIPPLING_API_TOKEN;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
// Prefer the legacy JWT-style key (works with @supabase/supabase-js).
// The new sb_secret_v2 format in .env.local doesn't authenticate via REST yet.
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!RIP_TOKEN) { console.error('❌ RIPPLING_API_TOKEN missing'); process.exit(1); }
if (!SB_URL || !SB_KEY) { console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1); }

const RIP_BASE = 'https://rest.ripplingapis.com';
const RIP_HEADERS = { Authorization: `Bearer ${RIP_TOKEN}`, Accept: 'application/json' };

const DRY_RUN = process.argv.includes('--dry-run');
const argIdx = (flag) => process.argv.indexOf(flag);
const DAYS  = argIdx('--days')  >= 0 ? parseInt(process.argv[argIdx('--days')  + 1], 10) : 90;
const SINCE = argIdx('--since') >= 0 ? process.argv[argIdx('--since') + 1] : null;

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ── Rippling helpers ─────────────────────────────────────────────────────────
async function ripGet(path) {
  const r = await fetch(RIP_BASE + path, { headers: RIP_HEADERS });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Rippling ${r.status} ${path}: ${body.slice(0, 200)}`);
  }
  return await r.json();
}

async function ripPaginate(startPath) {
  let url = startPath;
  let all = [];
  while (url) {
    const j = await ripGet(url);
    all = all.concat(j.results || []);
    // next_link may be a full URL — convert to path-only if so
    if (j.next_link) {
      url = j.next_link.startsWith('http')
        ? j.next_link.replace(RIP_BASE, '')
        : j.next_link;
    } else {
      url = null;
    }
  }
  return all;
}

// ── Time math ───────────────────────────────────────────────────────────────
function hoursFromEntry(entry) {
  // Prefer job_shifts sum (handles split shifts / breaks correctly).
  const shifts = entry.job_shifts || [];
  let totalMs = 0;
  for (const s of shifts) {
    if (s.start_time && s.end_time) {
      totalMs += new Date(s.end_time) - new Date(s.start_time);
    }
  }
  if (totalMs > 0) return +(totalMs / 3.6e6).toFixed(2);
  // Fallback: end - start of the whole entry
  if (entry.start_time && entry.end_time) {
    return +((new Date(entry.end_time) - new Date(entry.start_time)) / 3.6e6).toFixed(2);
  }
  return null;
}

function localCalendarDate(iso) {
  // Use America/Chicago to bucket entries by tech's local day
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// ── Sync ────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`🤝 Rippling sync ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'} — window: ${SINCE || `last ${DAYS}d`}`);

  // 1) Get tracked workers from DB
  const { data: tracked, error: trErr } = await sb
    .from('workers_rippling')
    .select('worker_id, name, user_id, work_email')
    .eq('is_tracked', true);
  if (trErr) throw new Error('workers_rippling: ' + trErr.message);
  console.log(`📋 Tracking ${tracked.length} worker(s):`, tracked.map(t => t.name).join(', '));

  // 2) Refresh the whole roster in workers_rippling (status, dates, emails).
  //    is_tracked is left alone, so existing rows keep it and new rows default
  //    to false (not on the time-card dashboard).
  console.log('🔄 Refreshing all workers from Rippling…');
  const workers = await ripPaginate('/workers/?limit=100&expand=user');
  const roster = workers.map((w) => ({
    worker_id: w.id,
    user_id: w.user_id || w.user?.id || null,
    name: w.user?.name?.formatted || w.user?.display_name || null,
    work_email: w.work_email || null,
    personal_email: w.personal_email || null,
    status: w.status || null,
    start_date: w.start_date || null,
    end_date: w.end_date || null,
    synced_at: new Date().toISOString(),
  }));
  if (!DRY_RUN) {
    const { error } = await sb.from('workers_rippling').upsert(roster, { onConflict: 'worker_id' });
    if (error) throw new Error('workers_rippling upsert: ' + error.message);
  }
  console.log(`   ✓ ${roster.length} workers (${roster.filter((r) => r.status === 'ACTIVE').length} active)`);

  // 3) Link commission payees to their Rippling worker by name (active worker
  //    preferred), so the commissions export carries worker IDs.
  const { data: payees, error: pyErr } = await sb.from('commission_payees').select('id, name, rippling_worker_id');
  if (pyErr) console.log('   ⚠️  commission_payees: ' + pyErr.message);
  for (const p of payees || []) {
    const matches = roster.filter((r) => (r.name || '').toLowerCase() === p.name.toLowerCase());
    const pick = matches.find((r) => r.status === 'ACTIVE') || matches[0];
    if (!pick) { console.log(`   ⚠️  commission payee ${p.name}: no Rippling worker with that name`); continue; }
    if (pick.worker_id !== p.rippling_worker_id) {
      if (!DRY_RUN) await sb.from('commission_payees').update({ rippling_worker_id: pick.worker_id }).eq('id', p.id);
      console.log(`   ✓ commission payee ${p.name} → ${pick.worker_id}`);
    }
  }

  // 4) Compute window
  const sinceISO = SINCE
    ? new Date(SINCE + 'T00:00:00Z').toISOString()
    : new Date(Date.now() - DAYS * 24 * 3600 * 1000).toISOString();
  console.log(`\n📅 Pulling time entries since ${sinceISO.slice(0, 10)}`);

  // 5) Pull time entries per worker
  let totalEntries = 0;
  let totalUpserts = 0;
  for (const t of tracked) {
    console.log(`\n👤 ${t.name} (${t.worker_id})`);
    // Rippling /time-entries/ supports a single-field filter param using
    // `field eq 'value'` syntax. We filter by worker_id server-side; date
    // window filtering happens client-side (combined filters return 400).
    const filter = encodeURIComponent(`worker_id eq '${t.worker_id}'`);
    const entries = await ripPaginate(`/time-entries/?filter=${filter}&limit=100`);
    const inWindow = entries.filter(e => e.start_time && e.start_time >= sinceISO);
    console.log(`   ${entries.length} total entries, ${inWindow.length} in window`);
    totalEntries += inWindow.length;

    if (DRY_RUN) {
      inWindow.slice(0, 3).forEach(e => {
        const hrs = hoursFromEntry(e);
        const date = localCalendarDate(e.start_time);
        console.log(`     ${date}  ${hrs}h  ${e.start_time?.slice(11,16)}–${e.end_time?.slice(11,16) || '   '}`);
      });
      continue;
    }

    // Upsert in batches of 100
    const rows = inWindow.map(e => ({
      rippling_id: e.id,
      worker_id: t.worker_id,
      entry_date: localCalendarDate(e.start_time),
      start_time: e.start_time,
      end_time: e.end_time,
      duration_hours: hoursFromEntry(e),
      job_shifts: e.job_shifts || null,
      comments: e.comments || null,
      rippling_created_at: e.created_at,
      rippling_updated_at: e.updated_at,
      synced_at: new Date().toISOString(),
    }));

    const BATCH = 100;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error } = await sb.from('time_entries_rippling').upsert(slice, { onConflict: 'rippling_id' });
      if (error) {
        console.log(`   ❌ batch ${i}-${i + slice.length}: ${error.message}`);
      } else {
        totalUpserts += slice.length;
      }
    }
    console.log(`   ✓ upserted ${rows.length} rows`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ ${totalEntries} entries in window, ${totalUpserts} upserted`);
  process.exit(0);
})().catch(e => { console.error('\nFatal:', e); process.exit(1); });
