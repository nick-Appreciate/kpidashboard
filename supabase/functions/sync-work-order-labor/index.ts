import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// ─────────────────────────────────────────────────────────────────────────
// sync-work-order-labor
// Pulls AppFolio's `work_order_labor_summary` report and upserts into
// af_work_order_labor. Column mapping based on actual report schema:
//   maintenance_tech → technician
//   work_order_id    → work_order_id (the integer id, not _number)
//   date             → date_worked
//   worked_hours     → hours
// Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD query for narrowing the window.
// ─────────────────────────────────────────────────────────────────────────

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const afClientId = Deno.env.get('APPFOLIO_CLIENT_ID')!;
const afClientSecret = Deno.env.get('APPFOLIO_CLIENT_SECRET')!;
const afDatabase = Deno.env.get('APPFOLIO_DATABASE') || 'appreciateinc';

const sb = createClient(supabaseUrl, supabaseKey);

async function fetchAppFolioReport(reportName: string, filters: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
  const url = `https://${afDatabase}.appfolio.com/api/v2/reports/${reportName}.json`;
  const auth = btoa(`${afClientId}:${afClientSecret}`);
  let all: Record<string, unknown>[] = [];
  let nextPageUrl: string | null = url;
  let isFirst = true;
  while (nextPageUrl) {
    const r: Response = await fetch(nextPageUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: isFirst ? JSON.stringify({ ...filters, paginate_results: true }) : undefined,
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`AppFolio ${r.status} ${reportName}: ${t.slice(0, 400)}`);
    }
    const j: any = await r.json();
    if (Array.isArray(j.results)) all = all.concat(j.results);
    else if (Array.isArray(j)) all = all.concat(j);
    nextPageUrl = j.next_page_url || null;
    isFirst = false;
  }
  return all;
}

function parseDate(s: unknown): string | null {
  if (s == null || s === '') return null;
  const v = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  return null;
}

function parseNumber(s: unknown): number | null {
  if (s == null || s === '') return null;
  const n = parseFloat(String(s));
  return isNaN(n) ? null : n;
}

async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const filters: Record<string, unknown> = {};
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (from) filters['from_date'] = from;
    if (to) filters['to_date'] = to;

    const rows = await fetchAppFolioReport('work_order_labor_summary', filters);
    let inserted = 0, skipped = 0;
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const hash = await sha256Hex(JSON.stringify(r));
      const { error } = await sb.from('af_work_order_labor').upsert(
        {
          raw: r,
          technician: r.maintenance_tech == null ? null : String(r.maintenance_tech),
          work_order_id: r.work_order_id == null ? null : String(r.work_order_id),
          date_worked: parseDate(r.date),
          hours: parseNumber(r.worked_hours ?? r.hours),
          row_hash: hash,
          synced_at: new Date().toISOString(),
        },
        { onConflict: 'row_hash' }
      );
      if (error) skipped++; else inserted++;
    }

    return new Response(
      JSON.stringify({ ok: true, rows_fetched: rows.length, rows_upserted: inserted, rows_skipped: skipped }, null, 2),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || String(e) }, null, 2),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
