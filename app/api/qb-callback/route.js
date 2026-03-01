import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CLIENT_ID = process.env.QB_CLIENT_ID;
const CLIENT_SECRET = process.env.QB_CLIENT_SECRET;
const REDIRECT_URI = 'https://www.appreciate.io/api/qb-callback';

const getSupabaseClient = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  );
};

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const supabase = getSupabaseClient();
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

  try {
    const tokenResponse = await fetch('https://quickbooks.api.intuit.com/oauth2/tokens/bearer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
      },
      body: `grant_type=authorization_code&code=${code}&redirect_uri=${REDIRECT_URI}`,
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Token exchange failed:', errorData);
      return NextResponse.json({ error: 'Token exchange failed' }, { status: 401 });
    }

    const tokens = await tokenResponse.json();
    console.log('Tokens received, realmId:', realmId);

    // Store tokens in Supabase
    const { data: existingData, error: selectError } = await supabase
      .from('qb_tokens')
      .select('*')
      .eq('realm_id', realmId)
      .single();

    let dbResult;
    if (existingData) {
      dbResult = await supabase
        .from('qb_tokens')
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('realm_id', realmId);
    } else {
      dbResult = await supabase
        .from('qb_tokens')
        .insert([
          {
            realm_id: realmId,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);
    }

    if (dbResult.error) {
      console.error('Database error:', dbResult.error);
      return NextResponse.json({ error: 'Failed to store tokens' }, { status: 500 });
    }

    return NextResponse.json(
      { success: true, message: 'Connected to QuickBooks' },
      { status: 200 }
    );
  } catch (error) {
    console.error('QBCallback error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
