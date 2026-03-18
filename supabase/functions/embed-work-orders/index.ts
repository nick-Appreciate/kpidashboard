import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const geminiApiKey = Deno.env.get('GEMINI_API_KEY')!;

const supabase = createClient(supabaseUrl, supabaseKey);

const GEMINI_BATCH_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${geminiApiKey}`;
// Process one batch per invocation to stay within edge function compute limits.
// Free tier: 100 embed requests/min.
const BATCH_SIZE = 90;

interface WorkOrder {
  id: number;
  work_order_issue: string | null;
  job_description: string | null;
  service_request_description: string | null;
  instructions: string | null;
  status_notes: string | null;
  property_name: string | null;
  unit_name: string | null;
  vendor: string | null;
  status: string | null;
}

function buildEmbeddingText(wo: WorkOrder): string {
  const parts: string[] = [];

  if (wo.work_order_issue) parts.push(`Issue: ${wo.work_order_issue}`);
  if (wo.job_description) parts.push(`Description: ${wo.job_description}`);
  // Only include service request if it differs from job description
  if (wo.service_request_description && wo.service_request_description !== wo.job_description) {
    parts.push(`Request: ${wo.service_request_description}`);
  }
  if (wo.instructions) parts.push(`Instructions: ${wo.instructions}`);
  if (wo.status_notes) parts.push(`Notes: ${wo.status_notes}`);
  if (wo.property_name) parts.push(`Property: ${wo.property_name}`);
  if (wo.unit_name) parts.push(`Unit: ${wo.unit_name}`);
  if (wo.vendor) parts.push(`Vendor: ${wo.vendor}`);
  if (wo.status) parts.push(`Status: ${wo.status}`);

  return parts.join('\n') || 'No description';
}

async function batchEmbed(texts: string[], retries = 3): Promise<number[][]> {
  const requests = texts.map(text => ({
    model: 'models/gemini-embedding-001',
    content: { parts: [{ text }] }
  }));

  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(GEMINI_BATCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    });

    if (response.ok) {
      const data = await response.json();
      return data.embeddings.map((e: any) => e.values);
    }

    if (response.status === 429 && attempt < retries - 1) {
      console.log(`Rate limited, waiting 65s before retry ${attempt + 2}/${retries}...`);
      await new Promise(resolve => setTimeout(resolve, 65000));
      continue;
    }

    const errorText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  throw new Error('Max retries exceeded');
}

Deno.serve(async (_req: Request) => {
  try {
    // Fetch work orders that need embedding
    const { data: workOrders, error: fetchError } = await supabase
      .from('af_work_orders')
      .select('id, work_order_issue, job_description, service_request_description, instructions, status_notes, property_name, unit_name, vendor, status')
      .is('embedding', null)
      .order('id');

    if (fetchError) throw new Error(`Fetch error: ${JSON.stringify(fetchError)}`);
    if (!workOrders || workOrders.length === 0) {
      return new Response(JSON.stringify({ success: true, embedded: 0, message: 'No work orders to embed' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Process only one batch per invocation to stay within compute limits
    const batch = workOrders.slice(0, BATCH_SIZE);
    const texts = batch.map(wo => buildEmbeddingText(wo));
    const embeddings = await batchEmbed(texts);

    let embedded = 0;
    for (let j = 0; j < batch.length; j++) {
      const { error: updateError } = await supabase
        .from('af_work_orders')
        .update({ embedding: JSON.stringify(embeddings[j]) })
        .eq('id', batch[j].id);

      if (updateError) {
        console.error(`Failed to update WO ${batch[j].id}:`, updateError.message);
        continue;
      }
      embedded++;
    }

    const remaining = workOrders.length - embedded;

    return new Response(JSON.stringify({
      success: true,
      embedded,
      remaining,
      total: workOrders.length + (567 - workOrders.length), // approx total
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('Embedding error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error?.message || String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
