import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * justcall-recording — resolves the private JustCall recording URL for a
 * given call into a short-lived, publicly-fetchable S3 URL.
 *
 * The `recording` field on justcall_calls holds a URL like:
 *   https://bifrost.justcall.io/voice-tools-calling/v1/recording/get-presigned-url?recSid=RE...
 * Hitting that endpoint with our JustCall Authorization returns the actual
 * presigned S3 URL (either as a body or as a 302). We do the resolution
 * here (so the JustCall API key stays in edge-function env), then return
 * the resolved URL to the caller which redirects the browser.
 *
 * Called only server-side by /api/justcall/recording, with the Supabase
 * service-role key as the Authorization header. Never exposed to browsers
 * directly.
 *
 * Body: { call_sid: string }
 * Response: { url: string } | { error }
 */

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const jcKey    = Deno.env.get('JUSTCALL_API_KEY')    || '';
const jcSecret = Deno.env.get('JUSTCALL_API_SECRET') || '';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('POST required', { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const call_sid = String(body.call_sid || '').trim();
  if (!call_sid) return json({ error: 'call_sid required' }, 400);
  if (!jcKey || !jcSecret) return json({ error: 'JustCall creds not set' }, 500);

  // Look up the recording URL for this call
  const { data, error } = await supabase
    .from('justcall_calls')
    .select('recording')
    .or(`call_sid.eq.${call_sid},id.eq.${call_sid}`)
    .limit(1)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data || !data.recording) return json({ error: 'no recording for this call' }, 404);

  // Fetch the JustCall get-presigned-url endpoint. It may return either a
  // 302 redirect (Location: <s3-url>) or a JSON body with the URL — handle both.
  const upstream = await fetch(data.recording, {
    method: 'GET',
    headers: { 'Authorization': `${jcKey}:${jcSecret}`, 'Accept': 'application/json' },
    redirect: 'manual',
  });

  if (upstream.status >= 300 && upstream.status < 400) {
    const loc = upstream.headers.get('location');
    if (loc) return json({ url: loc });
  }
  if (upstream.ok) {
    const txt = await upstream.text();
    try {
      const j = JSON.parse(txt);
      // JustCall varies: sometimes { url }, sometimes { data: { url } }
      const url = j.url || j.data?.url || j.presigned_url || j.recording_url;
      if (url) return json({ url });
    } catch {
      // Not JSON — the response might itself be the URL as plain text
      const trimmed = txt.trim();
      if (trimmed.startsWith('http')) return json({ url: trimmed });
    }
  }
  return json({ error: `upstream ${upstream.status}` }, 502);
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
