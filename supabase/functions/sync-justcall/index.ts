import { createClient } from 'jsr:@supabase/supabase-js@2';

// Syncs JustCall call logs into public.justcall_calls, the source for
// time-to-first-warm-contact. A warm contact = Outgoing + Answered.
//
// Invoke: GET ?days=7  (default 7; API only serves the last ~3 months / 90d).
// Auth to JustCall is a plain colon-joined "api_key:api_secret" Authorization
// header (NOT Basic/Bearer), per https://developer.justcall.io/reference/authentication.md

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const jcKey = Deno.env.get('JUSTCALL_API_KEY') || '';
const jcSecret = Deno.env.get('JUSTCALL_API_SECRET') || '';

const supabase = createClient(supabaseUrl, supabaseKey);

// Last 10 digits — matches leasing_reports.phone like "(314) 325-9520".
function normPhone(v: unknown): string | null {
  if (!v) return null;
  const digits = String(v).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : (digits || null);
}

// Combine JustCall's UTC call_date + call_time into an ISO timestamp.
function callAt(row: any): string | null {
  const d = row.call_date || row.date || null;
  const t = row.call_time || row.time || null;
  if (!d) return null;
  const iso = t ? `${d}T${t}Z` : `${d}T00:00:00Z`;
  const parsed = new Date(iso);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function fetchCallsPage(fromDatetime: string, page: number): Promise<any[]> {
  const url = new URL('https://api.justcall.io/v2.1/calls');
  url.searchParams.set('from_datetime', fromDatetime);
  url.searchParams.set('per_page', '100');
  url.searchParams.set('page', String(page));

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `${jcKey}:${jcSecret}`,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`JustCall API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  // v2.1 list endpoints return { data: [...] }; be tolerant of shape.
  return json.data || json.calls || (Array.isArray(json) ? json : []);
}

Deno.serve(async (req: Request) => {
  try {
    if (!jcKey || !jcSecret) {
      return new Response(JSON.stringify({
        success: false,
        error: 'JUSTCALL_API_KEY / JUSTCALL_API_SECRET not set in edge function secrets.',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const url = new URL(req.url);
    const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') || '7', 10)));
    const fromDatetime = new Date(Date.now() - days * 86_400_000)
      .toISOString().slice(0, 19).replace('T', ' '); // "yyyy-mm-dd hh:mm:ss"

    // Page through results until a short page signals the end.
    const all: any[] = [];
    for (let page = 1; page <= 50; page++) {
      const rows = await fetchCallsPage(fromDatetime, page);
      all.push(...rows);
      if (rows.length < 100) break;
    }

    const records = all.map((row: any) => ({
      id: String(row.id ?? row.call_sid),
      call_sid: row.call_sid ?? null,
      contact_number: row.contact_number ?? null,
      contact_number_norm: normPhone(row.contact_number),
      direction: row.call_info?.direction ?? row.direction ?? null,
      call_type: row.call_info?.type ?? row.type ?? null,
      call_at: callAt(row),
      duration_seconds: row.call_duration?.total_duration ?? row.duration ?? null,
      agent_id: row.agent_id != null ? String(row.agent_id) : null,
      agent_name: row.agent_name ?? null,
      agent_email: row.agent_email ?? null,
      recording: row.recording ?? null,
      synced_at: new Date().toISOString(),
    })).filter((r: any) => r.id && r.id !== 'undefined');

    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase
        .from('justcall_calls')
        .upsert(batch, { onConflict: 'id', ignoreDuplicates: false });
      if (error) throw new Error(JSON.stringify(error));
    }

    return new Response(JSON.stringify({
      success: true,
      syncedAt: new Date().toISOString(),
      from_datetime: fromDatetime,
      rowsProcessed: records.length,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error?.message || String(error) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
