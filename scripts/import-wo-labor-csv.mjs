/**
 * scripts/import-wo-labor-csv.mjs
 *
 * One-shot backfill of af_work_order_labor from a CSV export of AppFolio's
 * Work Orders Labor Summary report. Use this for any data older than the
 * report's live API window (the report only returns ~3 weeks via API).
 *
 * Usage:
 *   node scripts/import-wo-labor-csv.mjs <path-to-csv>
 *   node scripts/import-wo-labor-csv.mjs <path-to-csv> --dry-run
 *
 * CSV columns expected (in order, header row matches):
 *   Work Order Number, Date, Maintenance Tech, Property, Unit,
 *   Start Time, End Time, Worked Hours, Billable Hours, Hours Difference,
 *   Work Order Status, Description, Last Edited By, Last Bill Created At,
 *   Work Order Issue
 *
 * Notes:
 *   - CSV does NOT include the numeric work_order_id (AppFolio's primary
 *     key used for deep-link URLs). Imported rows will have null
 *     work_order_id and the UI's "click to open" won't work for them.
 *     Their work_order_number is still preserved for display.
 *   - Rows without a Date (separator rows like "->") are skipped.
 *   - Times in the CSV are local; we store them as UTC ISO strings for
 *     consistency. Without TZ info we treat them as already-UTC.
 */

import { readFile } from 'fs/promises';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

loadEnv({ path: fileURLToPath(new URL('../.env.local', import.meta.url)), override: true });
loadEnv({ path: fileURLToPath(new URL('../simmons-bot/.env', import.meta.url)) });

const DRY_RUN = process.argv.includes('--dry-run');
const csvPath = process.argv.find((a) => a.endsWith('.csv'));
if (!csvPath) {
  console.error('Usage: node scripts/import-wo-labor-csv.mjs <path-to-csv> [--dry-run]');
  process.exit(1);
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY missing'); process.exit(1); }

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ── CSV parser handling quoted fields with commas inside ────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else { field += c; }
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ── Field helpers ────────────────────────────────────────────────────────────
function parseUSDate(s) {
  if (!s) return null;
  const v = s.trim();
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let [, mm, dd, yyyy] = m;
  if (yyyy.length === 2) yyyy = '20' + yyyy;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

// "11/02/2025 02:00 PM" → "2025-11-02T14:00:00+00:00"
function parseUSDateTime(s, dateFallback) {
  if (!s) return null;
  const v = s.trim();
  if (!v) return null;
  // Many AppFolio CSV times come as "10/24/2025 7:30 AM" or "7:30 AM"
  const dtMatch = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (dtMatch) {
    let [, mm, dd, yyyy, hh, mn, ap] = dtMatch;
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    let h = parseInt(hh, 10);
    if (ap.toUpperCase() === 'PM' && h < 12) h += 12;
    if (ap.toUpperCase() === 'AM' && h === 12) h = 0;
    return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}T${String(h).padStart(2,'0')}:${mn.padStart(2,'0')}:00+00:00`;
  }
  const tMatch = v.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (tMatch && dateFallback) {
    let [, hh, mn, ap] = tMatch;
    let h = parseInt(hh, 10);
    if (ap.toUpperCase() === 'PM' && h < 12) h += 12;
    if (ap.toUpperCase() === 'AM' && h === 12) h = 0;
    return `${dateFallback}T${String(h).padStart(2,'0')}:${mn.padStart(2,'0')}:00+00:00`;
  }
  return null;
}

function parseFloatOr(s) {
  if (!s) return null;
  const n = parseFloat(s.replace(/[,$]/g, ''));
  return isNaN(n) ? null : n;
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Canonical hash for af_work_order_labor.row_hash so that API syncs and CSV
 * imports of the SAME logical entry produce IDENTICAL hashes — re-runs are
 * idempotent and there's no cross-source duplication.
 */
function canonicalRowHash({ technician, date_worked, work_order_number, hours, start_time }) {
  const key = [
    technician ?? '',
    date_worked ?? '',
    work_order_number ?? '',
    hours == null ? '' : String(hours),
    start_time ?? '',
  ].join('|');
  return crypto.createHash('md5').update(key).digest('hex');
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const text = await readFile(csvPath, 'utf8');
  const rows = parseCsv(text);
  const headerRow = rows[0];
  const expectedCols = [
    'Work Order Number', 'Date', 'Maintenance Tech', 'Property', 'Unit',
    'Start Time', 'End Time', 'Worked Hours', 'Billable Hours',
    'Hours Difference', 'Work Order Status', 'Description', 'Last Edited By',
    'Last Bill Created At', 'Work Order Issue'
  ];
  console.log('Header:', headerRow.length, 'cols');
  console.log('Mode:', DRY_RUN ? 'DRY RUN' : 'LIVE');
  console.log('File: ', csvPath);

  // Quick header sanity
  for (let i = 0; i < expectedCols.length; i++) {
    if (headerRow[i] !== expectedCols[i]) {
      console.warn(`  ⚠️  col ${i}: expected "${expectedCols[i]}", got "${headerRow[i]}"`);
    }
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 8) continue;
    const dateRaw = r[1];
    const date = parseUSDate(dateRaw);
    if (!date) continue; // skip "->" separator and empty rows

    const work_order_number = r[0].trim() || null;
    const technician = r[2].trim() || null;
    const property_name = r[3].trim() || null;
    const unit_name = r[4].trim() || null;
    const start_time = parseUSDateTime(r[5], date);
    const end_time = parseUSDateTime(r[6], date);
    const worked_hours = parseFloatOr(r[7]);
    const billable_hours = parseFloatOr(r[8]);
    const hours_difference = parseFloatOr(r[9]);
    const status = r[10].trim() || null;
    const description = r[11].trim() || null;
    const last_edited_by = r[12].trim() || null;
    const last_bill_created_at = parseUSDate(r[13]);
    const work_order_issue = r[14]?.trim() || null;

    // work_order_number is "{service_request_id}-{idx}" — derive the SR
    // prefix so AppFolio deep-links work for CSV-imported rows too.
    const srMatch = work_order_number && work_order_number.match(/^(\d+)-\d+$/);
    const service_request_id = srMatch ? srMatch[1] : null;

    const raw = {
      work_order_number,
      service_request_id,
      date,
      maintenance_tech: technician,
      property_name,
      unit_name,
      start_time,
      end_time,
      worked_hours: worked_hours != null ? String(worked_hours.toFixed(2)) : null,
      hours: worked_hours != null ? String(worked_hours.toFixed(2)) : null,
      billable_hours: billable_hours != null ? String(billable_hours.toFixed(2)) : null,
      hours_difference: hours_difference != null ? String(hours_difference.toFixed(2)) : null,
      work_order_status: status,
      description,
      last_edited_by,
      last_bill_created_at,
      work_order_issue,
      _source: 'csv-backfill',
    };

    records.push({
      raw,
      technician,
      // We don't have work_order_id from the CSV (only the WO number)
      work_order_id: null,
      date_worked: date,
      hours: worked_hours,
      // row_hash gets set by the DB trigger (af_wo_labor_set_hash_trigger).
      // We pass a placeholder so the column isn't NULL on its way through.
      row_hash: '__placeholder__',
      synced_at: new Date().toISOString(),
    });
  }

  console.log(`Parsed ${records.length} usable records`);
  if (records.length === 0) { console.log('Nothing to insert.'); return; }

  // Date range summary
  const dates = records.map(r => r.date_worked).sort();
  console.log(`Date range: ${dates[0]} → ${dates[dates.length - 1]}`);
  // Per-tech summary
  const byTech = {};
  for (const r of records) {
    const k = r.technician || '(no tech)';
    byTech[k] = byTech[k] || { rows: 0, hours: 0 };
    byTech[k].rows++;
    byTech[k].hours += (r.hours || 0);
  }
  console.log('\nPer-technician breakdown:');
  Object.entries(byTech).sort((a, b) => b[1].rows - a[1].rows).forEach(([k, v]) =>
    console.log(`  ${v.rows.toString().padStart(4)} rows, ${v.hours.toFixed(1).padStart(7)}h — ${k}`)
  );

  if (DRY_RUN) { console.log('\nDRY RUN — no DB writes.'); return; }

  // Upsert in batches
  const BATCH = 100;
  let upserted = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const slice = records.slice(i, i + BATCH);
    const { error } = await sb.from('af_work_order_labor').upsert(slice, { onConflict: 'row_hash' });
    if (error) {
      console.error(`Batch ${i}-${i + slice.length} error: ${error.message}`);
    } else {
      upserted += slice.length;
    }
  }
  console.log(`\n✅ Upserted ${upserted} rows.`);
})().catch((e) => { console.error('Fatal:', e); process.exit(1); });
