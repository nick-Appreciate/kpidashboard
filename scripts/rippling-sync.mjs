/**
 * scripts/rippling-sync.mjs
 *
 * Pulls Rippling time entries for tracked workers (workers_rippling.is_tracked = true)
 * and upserts into time_entries_rippling. By default, fetches the last 90 days.
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

  // 2) Refresh workers_rippling for our tracked workers (status, end_date, etc.)
  console.log('🔄 Refreshing worker metadata from Rippling…');
  for (const t of tracked) {
    try {
      const w = await ripGet(`/workers/${t.worker_id}/`);
      if (!DRY_RUN) {
        await sb.from('workers_rippling').update({
          status: w.status,
          start_date: w.start_date,
          end_date: w.end_date,
          synced_at: new Date().toISOString(),
        }).eq('worker_id', t.worker_id);
      }
      console.log(`   ✓ ${t.name}: ${w.status}, start ${w.start_date}, end ${w.end_date || '(none)'}`);
    } catch (e) {
      console.log(`   ⚠️  ${t.name}: ${e.message}`);
    }
  }

  // 3) Compute window
  const sinceISO = SINCE
    ? new Date(SINCE + 'T00:00:00Z').toISOString()
    : new Date(Date.now() - DAYS * 24 * 3600 * 1000).toISOString();
  console.log(`\n📅 Pulling time entries since ${sinceISO.slice(0, 10)}`);

  // 4) Pull time entries per worker
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
