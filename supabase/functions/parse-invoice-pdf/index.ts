/**
 * Supabase Edge Function: Parse Invoice PDFs from Front
 *
 * Workflow:
 * 1. Query front_messages table for messages with attachments not yet parsed
 * 2. Check for duplicates in ops_bills by front_message_id
 * 3. Download PDF from Front API
 * 4. Send PDF to Claude for intelligent invoice parsing
 * 5. Store PDF in Supabase Storage
 * 6. Insert parsed data into ops_bills table (with conflict handling)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { Anthropic } from 'https://esm.sh/@anthropic-ai/sdk@0.24.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const frontApiKey = Deno.env.get('FRONT_API_KEY')!;
const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')!;

const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic({ apiKey: anthropicApiKey });

interface FrontMessage {
  front_id: string;
  conversation_id: string;
  subject: string;
  sender_name: string;
  sender_email: string;
  body_text: string;
  attachment_ids: string[];
  attachment_count: number;
  created_at: string;
}

interface ParsedInvoice {
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_amount: number | null;
  invoice_date: string | null;
  due_date: string | null;
  description: string | null;
}

// Fetch a PDF from Front API
async function downloadPdfFromFront(attachmentId: string): Promise<Uint8Array> {
  const url = `https://api2.frontapp.com/download/${attachmentId}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${frontApiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download PDF (${response.status}): ${response.statusText}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

// Convert PDF to base64 for Claude
function bufferToBase64(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

// Check if a bill already exists for this front_message_id
async function billAlreadyExists(frontMessageId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('ops_bills')
    .select('id')
    .eq('front_message_id', frontMessageId)
    .limit(1);

  if (error) {
    console.error('Error checking for duplicate:', error);
    return false; // Proceed on error, let the unique constraint catch it
  }

  return data !== null && data.length > 0;
}

// Use Claude to intelligently parse invoice data
async function parseInvoiceWithClaude(
  pdfBase64: string,
  emailSubject: string,
  emailBody: string,
  senderName: string
): Promise<ParsedInvoice> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `You are an invoice parsing expert. Extract the following information from this invoice PDF:
- Vendor/Company name
- Invoice number
- Invoice amount (total, as a number)
- Invoice date (YYYY-MM-DD format)
- Due date (YYYY-MM-DD format, if available)
- Brief description of what was invoiced

Email Subject: ${emailSubject}
Sender Name: ${senderName}
Email Body Preview: ${(emailBody || '').slice(0, 500)}

Return ONLY valid JSON (no markdown, no code blocks) with these exact keys:
{
  "vendor_name": "string or null",
  "invoice_number": "string or null",
  "invoice_amount": number or null,
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "description": "string or null"
}`,
          },
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          },
        ],
      },
    ],
  });

  try {
    const content = message.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');

    // Extract JSON from response (handle markdown code blocks if present)
    let jsonStr = content.text.trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);

    const parsed = JSON.parse(jsonStr.trim());
    return parsed as ParsedInvoice;
  } catch (error) {
    console.error('Failed to parse Claude response:', error);
    return {
      vendor_name: null,
      invoice_number: null,
      invoice_amount: null,
      invoice_date: null,
      due_date: null,
      description: null,
    };
  }
}

// Upload PDF to Supabase Storage
async function uploadPdfToStorage(
  pdfBuffer: Uint8Array,
  conversationId: string,
  attachmentId: string
): Promise<string> {
  const filename = `${conversationId}/${attachmentId}.pdf`;

  const { error } = await supabase.storage
    .from('billing-invoices')
    .upload(filename, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) {
    console.error('Storage upload error:', error);
    throw error;
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('billing-invoices')
    .getPublicUrl(filename);

  return urlData.publicUrl;
}

// Main handler using Deno.serve
Deno.serve(async (req: Request) => {
  try {
    console.log('Starting invoice PDF parsing...');

    // Query front_messages with attachments that haven't been parsed
    const { data: messages, error } = await supabase
      .from('front_messages')
      .select('*')
      .eq('ap_extracted', false)
      .gt('attachment_count', 0)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      throw new Error(`Supabase query error: ${error.message}`);
    }

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ message: 'No messages to process' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${messages.length} messages to process...`);

    const results: Array<Record<string, unknown>> = [];
    const opsBillsInserts: Array<Record<string, unknown>> = [];

    for (const msg of messages as FrontMessage[]) {
      try {
        if (!msg.attachment_ids || msg.attachment_ids.length === 0) {
          // Mark as extracted since there are no actual attachment IDs to process
          await supabase
            .from('front_messages')
            .update({ ap_extracted: true })
            .eq('front_id', msg.front_id);
          continue;
        }

        // Duplicate check: skip if bill already exists for this message
        const exists = await billAlreadyExists(msg.front_id);
        if (exists) {
          console.log(`Skipping ${msg.front_id} — bill already exists`);
          // Mark as extracted so we don't check it again
          await supabase
            .from('front_messages')
            .update({ ap_extracted: true })
            .eq('front_id', msg.front_id);
          results.push({
            frontMessageId: msg.front_id,
            status: 'skipped',
            reason: 'duplicate',
          });
          continue;
        }

        const attachmentId = msg.attachment_ids[0]; // Use first attachment
        console.log(`Processing message ${msg.front_id}, attachment ${attachmentId}...`);

        // Download PDF
        const pdfBuffer = await downloadPdfFromFront(attachmentId);

        // Parse with Claude
        const invoice = await parseInvoiceWithClaude(
          bufferToBase64(pdfBuffer),
          msg.subject || '',
          msg.body_text || '',
          msg.sender_name || 'Unknown'
        );

        // Validate required fields — ops_bills requires vendor_name, amount, invoice_date as NOT NULL
        if (!invoice.vendor_name || invoice.invoice_amount === null || !invoice.invoice_date) {
          console.warn(`Incomplete parse for ${msg.front_id}: vendor=${invoice.vendor_name}, amount=${invoice.invoice_amount}, date=${invoice.invoice_date}`);

          // Still mark as extracted but record the partial data on front_messages
          await supabase
            .from('front_messages')
            .update({
              ap_extracted: true,
              vendor_name: invoice.vendor_name,
              invoice_number: invoice.invoice_number,
              invoice_amount: invoice.invoice_amount,
              invoice_date: invoice.invoice_date,
              due_date: invoice.due_date,
              ap_notes: 'Incomplete parse — missing required fields for ops_bills',
            })
            .eq('front_id', msg.front_id);

          results.push({
            frontMessageId: msg.front_id,
            attachmentId,
            status: 'incomplete',
            invoice,
            reason: 'Missing required fields (vendor_name, amount, or invoice_date)',
          });
          continue;
        }

        // Upload to Storage
        const pdfUrl = await uploadPdfToStorage(pdfBuffer, msg.conversation_id, attachmentId);

        // Prepare ops_bills entry
        opsBillsInserts.push({
          vendor_name: invoice.vendor_name,
          amount: invoice.invoice_amount,
          invoice_date: invoice.invoice_date,
          invoice_number: invoice.invoice_number,
          front_conversation_id: msg.conversation_id,
          front_message_id: msg.front_id,
          front_email_subject: msg.subject,
          front_email_from: msg.sender_email,
          attachments_json: [{ filename: `${attachmentId}.pdf`, url: pdfUrl }],
          status: 'pending',
          due_date: invoice.due_date,
          description: invoice.description,
        });

        // Mark message as extracted with parsed data
        await supabase
          .from('front_messages')
          .update({
            ap_extracted: true,
            vendor_name: invoice.vendor_name,
            invoice_number: invoice.invoice_number,
            invoice_amount: invoice.invoice_amount,
            invoice_date: invoice.invoice_date,
            due_date: invoice.due_date,
          })
          .eq('front_id', msg.front_id);

        results.push({
          frontMessageId: msg.front_id,
          attachmentId,
          status: 'success',
          invoice,
          pdfUrl,
        });

        console.log(`Parsed ${invoice.vendor_name}: $${invoice.invoice_amount}`);
      } catch (error) {
        console.error(`Error processing message ${msg.front_id}:`, error);
        results.push({
          frontMessageId: msg.front_id,
          attachmentId: msg.attachment_ids?.[0],
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Batch insert into ops_bills with conflict handling
    if (opsBillsInserts.length > 0) {
      const { error: insertError } = await supabase
        .from('ops_bills')
        .upsert(opsBillsInserts, {
          onConflict: 'vendor_name,amount,invoice_date,front_message_id',
          ignoreDuplicates: true,
        });

      if (insertError) {
        console.error('ops_bills insert error:', insertError);
      } else {
        console.log(`Inserted ${opsBillsInserts.length} bills into ops_bills`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        inserted: opsBillsInserts.length,
        skipped: results.filter(r => r.status === 'skipped').length,
        incomplete: results.filter(r => r.status === 'incomplete').length,
        errors: results.filter(r => r.status === 'error').length,
        results,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in invoice parser:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
