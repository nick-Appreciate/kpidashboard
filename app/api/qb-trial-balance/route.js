import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CLIENT_ID = process.env.QB_CLIENT_ID;
const CLIENT_SECRET = process.env.QB_CLIENT_SECRET;

const getSupabaseClient = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  );
};

async function refreshAccessToken(supabase, tokenRow) {
  const tokenResponse = await fetch('https://quickbooks.api.intuit.com/oauth2/tokens/bearer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
    },
    body: `grant_type=refresh_token&refresh_token=${tokenRow.refresh_token}`,
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Token refresh failed: ${errorText}`);
  }

  const tokens = await tokenResponse.json();

  await supabase
    .from('qb_tokens')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('realm_id', tokenRow.realm_id);

  return tokens.access_token;
}

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const supabase = getSupabaseClient();
  const { searchParams } = new URL(req.url);

  // Optional date params - defaults to current period
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');
  const accountingMethod = searchParams.get('accounting_method') || 'Accrual';

  try {
    // Get stored tokens
    const { data: tokenRow, error: tokenError } = await supabase
      .from('qb_tokens')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (tokenError || !tokenRow) {
      return NextResponse.json(
        { error: 'No QuickBooks connection found. Please connect QuickBooks first.' },
        { status: 401 }
      );
    }

    // Check if token is expired and refresh if needed
    let accessToken = tokenRow.access_token;
    if (new Date(tokenRow.expires_at) <= new Date()) {
      console.log('Access token expired, refreshing...');
      accessToken = await refreshAccessToken(supabase, tokenRow);
    }

    // Build the TrialBalance report URL
    const reportParams = new URLSearchParams({
      accounting_method: accountingMethod,
    });
    if (startDate) reportParams.set('start_date', startDate);
    if (endDate) reportParams.set('end_date', endDate);

    const reportUrl = `https://quickbooks.api.intuit.com/v3/company/${tokenRow.realm_id}/reports/TrialBalance?${reportParams.toString()}`;

    console.log('Fetching trial balance:', reportUrl);

    const reportResponse = await fetch(reportUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (reportResponse.status === 401) {
      // Token might be invalid even though not expired, try refresh
      console.log('Got 401, attempting token refresh...');
      accessToken = await refreshAccessToken(supabase, tokenRow);

      const retryResponse = await fetch(reportUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });

      if (!retryResponse.ok) {
        const errorText = await retryResponse.text();
        return NextResponse.json(
          { error: 'QuickBooks API error after refresh', details: errorText },
          { status: retryResponse.status }
        );
      }

      const data = await retryResponse.json();
      return NextResponse.json(data);
    }

    if (!reportResponse.ok) {
      const errorText = await reportResponse.text();
      return NextResponse.json(
        { error: 'QuickBooks API error', details: errorText },
        { status: reportResponse.status }
      );
    }

    const data = await reportResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('QB Trial Balance error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
