import { createClient } from 'jsr:@supabase/supabase-js@2';

// Real-time JustCall receiver for the `call.completed` event. JustCall POSTs
// here the moment a call ends, so we don't depend on the /calls list API
// (which lags ~2 days). Upserts into justcall_calls by call id — idempotent
// with the 15-min poll, which stays on as a backfill safety net.
//
// Signature (per developer.justcall.io/docs/dynamic-webhook-signatures):
//   HMAC-SHA256, key = API Secret,
//   message = `${secret}|${encoded_webhook_url}|${event_type}|${timestamp}`
//   signature header = x-justcall-signature, timestamp = x-justcall-request-timestamp

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const jcSecret = Deno.env.get('JUSTCALL_API_SECRET') || '';

function normPhone(v: unknown): string | null {
  if (!v) return null;
  const d = String(v).replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : (d || null);
}
function callAt(d: any): string | null {
  const date = d.call_date || null;
  const time = d.call_time || null;
  if (!date) return null;
  const parsed = new Date(time ? `${date}T${time}Z` : `${date}T00:00:00Z`);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function hmac(key: string, msg: string): Promise<{ hex: string; b64: string }> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const buf = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
  const hex = [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
  const b64 = btoa(String.fromCharCode(...buf));
  return { hex, b64 };
}
const eq = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

// Verify against a few encoding variants (URL-encoding / hex-case / base64) so
// a cosmetic mismatch doesn't reject a legitimate JustCall webhook.
async function verify(sigHeader: string, webhookUrl: string, type: string, timestamp: string): Promise<boolean> {
  if (!jcSecret || !sigHeader) return false;
  const sig = sigHeader.trim();
  const urls = [encodeURIComponent(webhookUrl), encodeURIComponent(webhookUrl).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()), webhookUrl];
  for (const u of urls) {
    const { hex, b64 } = await hmac(jcSecret, `${jcSecret}|${u}|${type}|${timestamp}`);
    if (eq(sig.toLowerCase(), hex) || eq(sig, hex) || eq(sig, b64)) return true;
  }
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('ok');
  try {
    const raw = await req.text();
    let body: any;
    try { body = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }

    const type = body.type || '';
    const webhookUrl = body.webhook_url || '';
    const sigHeader = req.headers.get('x-justcall-signature') || '';
    const timestamp = req.headers.get('x-justcall-request-timestamp') || '';

    const verified = await verify(sigHeader, webhookUrl, type, timestamp);
    if (!verified) {
      // Don't store unverified payloads (the poll backfills anyway). Return 200
      // so JustCall keeps the webhook enabled; the log surfaces any mismatch.
      console.warn(`justcall-webhook: unverified (type=${type}, has_sig=${!!sigHeader})`);
      return new Response(JSON.stringify({ ok: true, stored: false, reason: 'unverified' }), { headers: { 'Content-Type': 'application/json' } });
    }

    const d = body.data;
    if (!d || !d.id) {
      // Validation ping (sent when saving the webhook URL) — no call payload.
      return new Response(JSON.stringify({ ok: true, validated: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const record = {
      id: String(d.id ?? d.call_sid),
      call_sid: d.call_sid ?? null,
      contact_number: d.contact_number ?? null,
      contact_number_norm: normPhone(d.contact_number),
      direction: d.call_info?.direction ?? null,
      call_type: d.call_info?.type ?? null,
      call_at: callAt(d),
      duration_seconds: d.call_duration?.total_duration ?? null,
      agent_id: d.agent_id != null ? String(d.agent_id) : null,
      agent_name: d.agent_name ?? null,
      agent_email: d.agent_email ?? null,
      recording: d.recording ?? null,
      synced_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('justcall_calls').upsert(record, { onConflict: 'id' });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    return new Response(JSON.stringify({ ok: true, stored: true, id: record.id }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500 });
  }
});
