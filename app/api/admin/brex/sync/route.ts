import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      return NextResponse.json(
        { error: 'Missing Supabase URL' },
        { status: 500 }
      );
    }

    const response = await fetch(
      `${supabaseUrl}/functions/v1/sync-brex`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error calling sync-brex function:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
