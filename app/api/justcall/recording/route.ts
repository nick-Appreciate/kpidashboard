/**
 * GET /api/justcall/recording?call_sid=<id>
 *
 * Fronts the JustCall recording endpoint so an <audio> tag in the
 * dashboard can play a call back in place. Flow:
 *
 *   1. requireAuth — only signed-in users can play recordings.
 *   2. Ask our justcall-recording edge function to resolve the
 *      call's stored `recording` URL into an actual short-lived
 *      S3 URL (the edge function holds the JustCall API key).
 *   3. 302-redirect the browser to that S3 URL. <audio> follows
 *      redirects natively so playback "just works."
 *
 * We prefer redirect over streaming so we don't pay the bandwidth
 * cost of the MP3 twice — the browser fetches directly from S3.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const call_sid = (searchParams.get('call_sid') || searchParams.get('id') || '').trim();
  if (!call_sid) return NextResponse.json({ error: 'call_sid required' }, { status: 400 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const upstream = await fetch(`${supabaseUrl}/functions/v1/justcall-recording`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ call_sid }),
  });
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return NextResponse.json({ error: `edge fn ${upstream.status}: ${text.slice(0, 200)}` }, { status: 502 });
  }
  const body = await upstream.json();
  const url = body?.url;
  if (!url) return NextResponse.json({ error: 'no url returned' }, { status: 502 });

  return NextResponse.redirect(url, 302);
}
