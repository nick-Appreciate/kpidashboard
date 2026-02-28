import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CLIENT_ID = process.env.QB_CLIENT_ID;
const CLIENT_SECRET = process.env.QB_CLIENT_SECRET;
const REDIRECT_URI = 'https://www.appreciate.io/api/qb-callback';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const realmId = searchParams.get('realmId');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  if (!code || !realmId) {
    return NextResponse.json({ error: 'Missing code or realmId' }, { status: 400 });
  }

  console.log('CLIENT_ID set:', !!CLIENT_ID);
  console.log('CLIENT_SECRET set:', !!CLIENT_SECRET);
  console.log('code:', code?.substring(0, 20));

  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const body = `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  const tokenRes = await fetch('https://oauth.platform.intuit.com/op/v1/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body,
  });

  const rawText = await tokenRes.text();
  console.log('Token response status:', tokenRes.status);
  console.log('Token response headers:', JSON.stringify(Object.fromEntries(tokenRes.headers.entries())));
  console.log('Token response body:', rawText);
  console.log('Redirect URI used:', REDIRECT_URI);
  console.log('POST body sent:', body.toString());

  let tokens;
  try {
    tokens = JSON.parse(rawText);
  } catch (e) {
    return NextResponse.json({ error: 'Invalid token response', raw: rawText, status: tokenRes.status }, { status: 500 });
  }

  if (!tokens.access_token) {
    return NextResponse.json({ error: 'Token exchange failed', details: tokens }, { status: 500 });
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const refreshExpiresAt = new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000).toISOString();

  const { error: dbError } = await supabase
    .from('qb_credentials')
    .upsert({
      realm_id: realmId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_token_expires_at: expiresAt,
      refresh_token_expires_at: refreshExpiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'realm_id' });

  if (dbError) {
    console.error('Supabase error:', dbError);
    return NextResponse.json({ error: 'Failed to save tokens', details: dbError }, { status: 500 });
  }

  return new NextResponse(`
    <html><body style="font-family:sans-serif;max-width:600px;margin:60px auto;text-align:center">
      <h2>✅ QuickBooks Connected!</h2>
      <p>Realm ID: <code>${realmId}</code></p>
      <p>Tokens saved. You can close this window.</p>
    </body></html>
  `, { headers: { 'Content-Type': 'text/html' } });
}
