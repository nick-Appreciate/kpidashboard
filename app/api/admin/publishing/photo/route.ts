/**
 * GET /api/admin/publishing/photo?url=<encoded>&filename=<f>
 *
 * Proxies a single image from AppFolio's CDN and streams it back with
 * Content-Disposition: attachment so the browser saves it directly.
 * Two reasons we route through our server instead of letting the
 * browser hit the CDN directly:
 *
 *   1. Cross-origin <a download> is ignored when the file lives on a
 *      different origin — the browser navigates to the image instead
 *      of downloading it. Proxying makes the response same-origin.
 *   2. Lets us inject a clean filename (e.g. "hilltop-2628D-1.jpg")
 *      instead of AppFolio's UUID-based path.
 *
 * The URL whitelist is strict — only images.cdn.appfolio.com is
 * proxied — so this can't be turned into a generic open proxy.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../../lib/auth';

const ALLOWED_HOSTS = new Set(['images.cdn.appfolio.com']);

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get('url') || '';
  const filename  = (searchParams.get('filename') || 'photo.jpg').replace(/[^A-Za-z0-9._-]/g, '_');

  let parsed: URL;
  try { parsed = new URL(targetUrl); }
  catch { return NextResponse.json({ error: 'Invalid url' }, { status: 400 }); }
  if (!ALLOWED_HOSTS.has(parsed.host)) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 400 });
  }

  const upstream = await fetch(parsed.toString());
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') || 'image/jpeg';
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, max-age=60',
    },
  });
}
