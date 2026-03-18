import { requireAuth } from '../../../../lib/auth';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`;

async function embedQuery(text: string): Promise<number[]> {
  const response = await fetch(GEMINI_EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text }] },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini embedding error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.embedding.values;
}

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;

  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: 'Search query required' }, { status: 400 });
    }

    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: 'Embedding API not configured' }, { status: 500 });
    }

    // Embed the search query
    const queryEmbedding = await embedQuery(query.trim());

    // Call the match_work_orders RPC
    const { data, error } = await supabase.rpc('match_work_orders', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: 0.25,
      match_count: 30,
    });

    if (error) throw error;

    // Enrich with bill details
    const billIds = (data || []).map((wo: any) => wo.vendor_bill_id).filter(Boolean);
    let billMap: Record<string, any> = {};
    if (billIds.length > 0) {
      const { data: bills } = await supabase
        .from('af_bill_detail')
        .select('bill_id, vendor_name, amount, gl_account_name, memo, status, paid_date')
        .in('bill_id', billIds);

      if (bills) {
        billMap = Object.fromEntries(bills.map((b: any) => [b.bill_id, b]));
      }
    }

    return NextResponse.json({
      query,
      results: (data || []).map((wo: any) => ({
        ...wo,
        bill: wo.vendor_bill_id ? billMap[wo.vendor_bill_id] || null : null,
      })),
    });
  } catch (error: any) {
    console.error('Work orders search error:', error);
    return NextResponse.json(
      { error: error?.message || 'Search failed' },
      { status: 500 }
    );
  }
}
